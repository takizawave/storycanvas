const IGNORED = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
const WRAPPERS = new Set(['DIV', 'SPAN', 'SECTION', 'MAIN', 'ARTICLE', 'SP-THEME', 'SP-STORY-DECORATOR']);
const COMPOSITE = 'form,fieldset,nav,ol,ul,li,table,details,[role="navigation"],[role="tablist"],[role="listbox"],[role="menu"],[role="tree"],[role="dialog"]';
const CONTROLS = 'button,input,select,textarea,a[href],summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"]';
const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * Split only recognizable sibling examples in Heading, Button or Badge stories.
 * This reads the source DOM without moving nodes or changing their styles.
 * A single primitive, a compound widget or an ambiguous layout returns [].
 */
export function detectStoryExamples(root, { familyTitle = '' } = {}) {
  const win = root?.ownerDocument?.defaultView;
  if (!win || root.nodeType !== 1 || !root.isConnected) return [];
  const family = String(familyTitle).split('/').filter(part => part.trim()).at(-1)?.trim().toLowerCase();
  if (!['heading', 'button', 'badge'].includes(family)) return [];
  const styleOf = element => win.getComputedStyle(element);
  const shown = element => {
    if (IGNORED.has(element.tagName) || element.hidden) return false;
    const style = styleOf(element);
    return style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility) && Number(style.opacity) !== 0;
  };
  const childrenOf = element => [...element.children].filter(shown);
  const hasOwnText = element => [...element.childNodes].some(node => node.nodeType === 3 && cleanText(node.nodeValue));
  const isComposite = element => element.matches(COMPOSITE) || !!element.querySelector(COMPOSITE);
  const isWrapper = element => WRAPPERS.has(element.tagName) && !hasOwnText(element) && !element.matches(COMPOSITE) && !element.hasAttribute('role');
  const isPrimitive = element => {
    if (!shown(element) || isComposite(element)) return false;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    if (family === 'heading') {
      return /^H[1-6]$/.test(element.tagName) && !element.querySelector(CONTROLS) && !!cleanText(element.textContent);
    }
    if (family === 'button') {
      // Accordion/tab/menu triggers are parts of a larger widget, even when a
      // caller labels that story as Button. Disabled standalone buttons count.
      return ['BUTTON', 'SP-BUTTON'].includes(element.tagName)
        && !element.hasAttribute('aria-expanded') && !element.hasAttribute('aria-controls')
        && (!element.getAttribute('role') || element.getAttribute('role') === 'button')
        && !element.querySelector(CONTROLS);
    }
    if (element.querySelector(CONTROLS)) return false;
    if (element.tagName === 'SP-BADGE' || element.classList.contains('chakra-badge')) return true;
    // Older Chakra releases have generated classes instead of chakra-badge.
    // Accept compact, painted text primitives, not arbitrary div containers.
    if (!['DIV', 'SPAN'].includes(element.tagName) || box.width > 640 || box.height > 96) return false;
    const text = cleanText(element.textContent);
    if (!text || text.length > 120 || element.querySelector('h1,h2,h3,h4,h5,h6,div,section,article')) return false;
    const style = styleOf(element);
    const background = style.backgroundColor.replace(/\s+/g, '').toLowerCase();
    const hasBackground = background && background !== 'transparent' && background !== 'rgba(0,0,0,0)' && !/\/0(?:\.0+)?\)$/.test(background);
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(edge => parseFloat(style[`border${edge}Width`]) > 0 && style[`border${edge}Style`] !== 'none');
    return !!(hasBackground || hasBorder || (style.boxShadow && style.boxShadow !== 'none'));
  };

  // Ignore unambiguous outer layout/decorator chains. Never enter a primitive
  // and accidentally reinterpret its own label or icon as separate examples.
  let container = root;
  for (let depth = 0; depth < 8; depth++) {
    if (!shown(container) || container.matches(COMPOSITE) || isPrimitive(container)) return [];
    const children = childrenOf(container);
    if (children.length !== 1) break;
    const child = children[0];
    if (!isWrapper(child)) break;
    container = child;
  }
  if (hasOwnText(container)) return [];
  const siblings = childrenOf(container);
  if (siblings.length < 2 || siblings.length > 128) return [];
  const elements = [];
  for (const sibling of siblings) {
    if (isPrimitive(sibling)) { elements.push(sibling); continue; }
    // Permit one lightweight wrapper per example, but not rows containing
    // multiple controls, captions, forms or several nested component parts.
    if (!isWrapper(sibling)) return [];
    const children = childrenOf(sibling);
    if (children.length !== 1 || !isPrimitive(children[0])) return [];
    elements.push(children[0]);
  }
  if (elements.length < 2) return [];

  const labels = elements.map(element => cleanText(element.getAttribute('aria-label') || element.innerText || element.textContent).slice(0, 72) || familyTitle || element.localName);
  const sizeHints = elements.map(element => {
    const named = element.getAttribute('size') || element.getAttribute('data-size') || element.getAttribute('variant') || element.getAttribute('data-variant') || element.getAttribute('treatment');
    return named ? cleanText(named) : `${Math.round(element.getBoundingClientRect().height)}px`;
  });
  return elements.map((element, index) => {
    const indices = [];
    for (let node = element; node && node !== root; node = node.parentElement) {
      const siblings = [...(node.parentElement?.children || [])].filter(child => !IGNORED.has(child.tagName));
      indices.unshift(siblings.indexOf(node));
    }
    let label = labels[index];
    if (labels.filter(value => value === label).length > 1) {
      const hint = sizeHints[index];
      const distinctHint = elements.every((_, other) => other === index || labels[other] !== label || sizeHints[other] !== hint);
      label += distinctHint ? ` · ${hint}` : ` · ${index + 1}`;
    }
    return { key: `${element.localName}:${indices.join('.')}`, label, element };
  });
}
