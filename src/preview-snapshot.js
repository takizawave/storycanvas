import { captureStory } from './exporter.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'ANIMATE', 'SET', 'ANIMATEMOTION', 'ANIMATETRANSFORM']);

// captureStory uses the root's viewport rectangle as its SVG origin. For a
// display:contents/zero-size root it uses the visible composed-tree union.
// Mirror that fallback here because its origin is intentionally not exported.
function captureOrigin(root, win) {
  const own = root.getBoundingClientRect();
  if (own.width && own.height) return own;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const seen = new WeakSet();
  let visited = 0;
  const add = rect => {
    if (!rect.width || !rect.height) return;
    left = Math.min(left, rect.left); top = Math.min(top, rect.top);
    right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
  };
  function visit(element) {
    if (seen.has(element) || ++visited > 2400) return;
    seen.add(element);
    if (SKIP_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute('data-atlas-ignore')) return;
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return;
    add(element.getBoundingClientRect());
    let children;
    if (element.localName === 'slot' && typeof element.assignedNodes === 'function') {
      const assigned = element.assignedNodes({ flatten: true });
      children = assigned.length ? assigned : element.childNodes;
    } else children = (element.shadowRoot || element).childNodes;
    for (const child of children) {
      if (child.nodeType === 1) visit(child);
      else if (child.nodeType === 3 && child.nodeValue?.trim()) {
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(child);
        add(range.getBoundingClientRect());
        range.detach();
      }
    }
  }
  visit(root);
  return Number.isFinite(left) ? { left, top, right, bottom, width: right - left, height: bottom - top } : own;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const RESOURCE_ATTRIBUTES = ['src', 'poster', 'href', 'xlink:href'];
const FONT_DESCRIPTORS = ['font-family', 'font-style', 'font-weight', 'font-stretch', 'unicode-range', 'font-feature-settings', 'font-variation-settings', 'size-adjust', 'ascent-override', 'descent-override', 'line-gap-override'];
const fontResources = new Map();
const fontFamily = value => value.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();

function dataUrl(blob, win) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The browser could not encode the story preview snapshot.'));
    reader.readAsDataURL(blob);
  });
}

async function embedFont(url, doc) {
  const win = doc.defaultView;
  const resolved = new URL(url, doc.baseURI);
  if (!['https:', 'http:', 'data:'].includes(resolved.protocol)) throw new Error('Unsupported font resource');
  const key = `${doc.location?.origin || ''}:${resolved.href}`;
  if (!fontResources.has(key)) {
    const pending = (async () => {
      const response = await win.fetch(resolved.href, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Font resource unavailable');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('Font resource is too large');
      const bytes = new Uint8Array(buffer);
      const signature = String.fromCharCode(...bytes.subarray(0, 4));
      const mime = ({ wOFF: 'font/woff', wOF2: 'font/woff2', OTTO: 'font/otf', true: 'font/ttf', ttcf: 'font/collection' })[signature] || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0 ? 'font/ttf' : '');
      if (!mime) throw new Error('Resource is not a supported font');
      return dataUrl(new win.Blob([buffer], { type: mime }), win);
    })();
    fontResources.set(key, pending);
    pending.catch(() => fontResources.delete(key));
    if (fontResources.size > 32) fontResources.delete(fontResources.keys().next().value);
  }
  return fontResources.get(key);
}

// SVG images have their own font set. Copying computed font-family without its
// loaded @font-face changes text metrics, wrapping even short Web Component
// labels inside their measured boxes. Embed only faces used by this snapshot.
async function snapshotFonts(root, clone, doc, warnings) {
  const win = doc.defaultView;
  const families = new Set([clone, ...clone.querySelectorAll('*')].flatMap(element => (element.style?.fontFamily || '').split(',').map(fontFamily)));
  const loaded = [...(doc.fonts || [])].filter(face => face.status === 'loaded' && families.has(fontFamily(face.family)));
  if (!loaded.length) return '';
  const sheets = new Set([...doc.styleSheets, ...(doc.adoptedStyleSheets || [])]);
  const seenElements = new WeakSet();
  function collectSheets(element) {
    if (seenElements.has(element)) return;
    seenElements.add(element);
    if (element.shadowRoot) {
      for (const sheet of [...element.shadowRoot.styleSheets, ...(element.shadowRoot.adoptedStyleSheets || [])]) sheets.add(sheet);
    }
    const assigned = element.localName === 'slot' ? element.assignedNodes?.({ flatten: true }) : null;
    for (const child of assigned?.length ? assigned : (element.shadowRoot || element).childNodes) if (child.nodeType === 1) collectSheets(child);
  }
  collectSheets(root);
  const faces = [];
  const visitedSheets = new Set();
  async function visitSheet(sheet, base = doc.baseURI) {
    if (visitedSheets.has(sheet)) return;
    visitedSheets.add(sheet);
    base = sheet.href || base;
    let rules;
    try { rules = [...sheet.cssRules]; }
    catch {
      if (!sheet.href || !/^https?:/i.test(sheet.href)) return;
      try {
        const response = await win.fetch(sheet.href, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const source = await response.text();
        if (source.length > 2 * 1024 * 1024) return;
        // An unattached constructable sheet parses declarations without running
        // original styles or loading any of their resources into the preview.
        const parsed = new win.CSSStyleSheet();
        parsed.replaceSync(source);
        rules = [...parsed.cssRules];
      } catch { return; }
    }
    async function visitRules(entries) {
      for (const rule of entries) {
        if (rule.type === win.CSSRule.FONT_FACE_RULE) faces.push({ style: rule.style, base });
        else if (rule.styleSheet) await visitSheet(rule.styleSheet, base);
        else if (rule.cssRules) await visitRules([...rule.cssRules]);
      }
    }
    await visitRules(rules);
  }
  await Promise.all([...sheets].map(sheet => visitSheet(sheet)));
  const weight = value => ({ normal: '400', bold: '700' })[value] || value || '400';
  const matches = (style, face) => fontFamily(style.fontFamily) === fontFamily(face.family)
    && (style.fontStyle || 'normal') === face.style
    && weight(style.fontWeight) === weight(face.weight)
    && (style.fontStretch || 'normal') === face.stretch;
  const embedded = new Set();
  const rules = await Promise.all(faces.filter(({ style }) => loaded.some(face => matches(style, face))).map(async ({ style, base }) => {
    for (const match of style.getPropertyValue('src').matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi)) {
      try {
        const src = await embedFont(new URL(match[1], base).href, doc);
        for (const face of loaded) if (matches(style, face)) embedded.add(face);
        const descriptors = FONT_DESCRIPTORS.map(property => {
          const value = style.getPropertyValue(property);
          return value ? `${property}:${value};` : '';
        }).join('');
        return `@font-face{${descriptors}src:url("${src}");font-display:block;}`;
      } catch { /* Try the next format in the original face's source list. */ }
    }
    return '';
  }));
  if (loaded.some(face => !embedded.has(face))) warnings.add('A web font could not be embedded in the preview snapshot.');
  return [...new Set(rules.filter(Boolean))].join('\n');
}

// Images inside an SVG image cannot load network resources. Embed permitted
// image data and strip active/external SVG resource content before serialization.
async function embedImage(input, doc) {
  const win = doc.defaultView;
  const url = new URL(input, doc.baseURI);
  if (!['http:', 'https:', 'data:'].includes(url.protocol) || (url.protocol === 'data:' && !/^data:image\//i.test(input))) throw new Error('Unsupported image resource');
  const response = await win.fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Image resource unavailable');
  const blob = await response.blob();
  if (!/^image\//i.test(blob.type)) throw new Error('Resource is not an image');
  if (!/svg/i.test(blob.type)) return dataUrl(blob, win);
  const parsed = new win.DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Invalid SVG resource');
  parsed.querySelectorAll('script,foreignObject,iframe,object,embed,style,animate,set,animateMotion,animateTransform').forEach(node => node.remove());
  for (const node of [parsed.documentElement, ...parsed.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#')) || (/url\(/i.test(attribute.value) && !/^url\(\s*['"]?#[^)]*\)$/i.test(attribute.value))) node.removeAttribute(attribute.name);
    }
  }
  return dataUrl(new win.Blob([new win.XMLSerializer().serializeToString(parsed.documentElement)], { type: 'image/svg+xml' }), win);
}

async function snapshotHtml(root, capture, origin, warnings) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const template = doc.createElement('template');
  template.innerHTML = capture.html;
  let clone = template.content.firstElementChild;
  if (!clone) throw new Error('The story preview has no snapshot content.');
  // captureStory.html is already sanitized and has resolved styles. Harden the
  // image-only document further: links are inert, custom hosts are flattened,
  // every resource is embedded, and no script or remote stylesheet can run.
  clone.querySelectorAll('script,iframe,object,embed,link,style,foreignObject').forEach(node => node.remove());
  const embeddedImageUrls = new Set(capture.design.nodes.filter(node => node.type === 'image').map(node => node.dataUrl));
  const resources = new Map();
  const embed = input => {
    if (!resources.has(input)) resources.set(input, embedImage(input, doc));
    return resources.get(input);
  };
  const originalImages = [];
  const originalSelects = [];
  const seen = new WeakSet();
  function collectImages(element) {
    if (seen.has(element) || SKIP_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute('data-atlas-ignore')) return;
    seen.add(element);
    if (['IMG', 'CANVAS', 'VIDEO'].includes(element.tagName)) originalImages.push(element);
    if (element.tagName === 'SELECT') originalSelects.push(element);
    const assigned = element.localName === 'slot' ? element.assignedNodes?.({ flatten: true }) : null;
    for (const child of assigned?.length ? assigned : (element.shadowRoot || element).childNodes) if (child.nodeType === 1) collectImages(child);
  }
  collectImages(root);
  const cloneSelects = [clone, ...clone.querySelectorAll('select')].filter(node => node.tagName === 'SELECT');
  for (let index = 0; index < cloneSelects.length; index += 1) {
    const original = originalSelects[index];
    if (!original) continue;
    [...cloneSelects[index].options].forEach((option, optionIndex) => {
      option.toggleAttribute('selected', !!original.options[optionIndex]?.selected);
    });
  }
  const cloneImages = [clone, ...clone.querySelectorAll('img,canvas,video')].filter(node => ['IMG', 'CANVAS', 'VIDEO'].includes(node.tagName));
  for (let index = 0; index < cloneImages.length; index += 1) {
    const target = cloneImages[index];
    const original = originalImages[index];
    if (!original) continue;
    const box = original.getBoundingClientRect();
    const image = capture.design.nodes.find(node => node.type === 'image' && Math.abs(node.x - (box.left - origin.left)) < .03 && Math.abs(node.y - (box.top - origin.top)) < .03 && Math.abs(node.width - box.width) < .03 && Math.abs(node.height - box.height) < .03);
    if (image) {
      if (target.tagName === 'IMG') target.setAttribute('src', image.dataUrl);
      else {
        const replacement = doc.createElement('img');
        replacement.setAttribute('style', target.getAttribute('style') || '');
        replacement.src = image.dataUrl;
        target.replaceWith(replacement);
        if (target === clone) clone = replacement;
      }
    }
  }
  for (const element of [clone, ...clone.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || ['srcset', 'srcdoc', 'autofocus', 'autoplay', 'action', 'formaction'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    for (const name of RESOURCE_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const imageResource = ['img', 'image', 'video'].includes(element.localName) && (name !== 'href' || element.localName === 'image');
      if (value.startsWith('#') && element.namespaceURI === SVG_NS) continue;
      if (!imageResource) { element.removeAttribute(name); continue; }
      try {
        // Already embedded raster/vector data from captureStory is safe here.
        element.setAttribute(name, embeddedImageUrls.has(value) || /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(value) ? value : await embed(value));
      } catch {
        element.removeAttribute(name);
        warnings.add('An image could not be embedded in the preview snapshot.');
      }
    }
    const background = element.style?.backgroundImage;
    if (background && /url\(/i.test(background)) {
      let embedded = background;
      for (const match of background.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi)) {
        try { embedded = embedded.replace(match[0], `url("${await embed(match[1])}")`); }
        catch { embedded = embedded.replace(match[0], 'none'); warnings.add('A background image could not be embedded in the preview snapshot.'); }
      }
      element.style.backgroundImage = embedded;
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'style' || !/url\(/i.test(attribute.value)) continue;
      if (!/^url\(\s*['"]?#[^)]*\)$/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  const fonts = await snapshotFonts(root, clone, doc, warnings);
  // Measure the flattened HTML in an isolated offscreen tree. This preserves
  // margins/positioning and zero-size roots without baking source page offsets
  // into the image. Inline styles have no dependency on the original CSS.
  const host = doc.createElement('div');
  host.setAttribute('data-atlas-ignore', '');
  host.style.cssText = `all:initial!important;display:block!important;position:fixed!important;left:-100000px!important;top:0!important;width:${win.innerWidth}px!important;height:${win.innerHeight}px!important;contain:strict!important;pointer-events:none!important;`;
  const isolated = host.attachShadow({ mode: 'closed' });
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('xmlns', XHTML_NS);
  wrapper.style.cssText = `position:relative;width:${win.innerWidth}px;height:${win.innerHeight}px;overflow:visible;margin:0;padding:0;`;
  if (fonts) {
    const style = doc.createElement('style');
    style.textContent = fonts;
    wrapper.append(style);
  }
  wrapper.append(clone);
  isolated.append(wrapper);
  doc.documentElement.append(host);
  let localOrigin;
  try {
    const bounds = captureOrigin(clone, win);
    // Descendant top margins can collapse through the wrapper (Chakra's
    // Story decorator uses margin-top:40px). Measure against the fixed host,
    // whose formatting boundary cannot move, so that offset is not lost.
    const parent = host.getBoundingClientRect();
    localOrigin = { left: bounds.left - parent.left, top: bounds.top - parent.top };
  } finally { host.remove(); }
  wrapper.style.transformOrigin = '0 0';
  wrapper.style.transform = `translate(${-localOrigin.left}px, ${-localOrigin.top}px)`;
  return wrapper;
}

/**
 * Make a self-contained image of the rendered HTML, including native CSS
 * borders, inset shadows, gradients and flattened open Shadow DOM. Unlike SVG
 * export, this visual cache intentionally uses foreignObject for fidelity.
 * tightBounds uses iframe viewport coordinates: {left, top, right, bottom} or
 * {left, top, width, height}. The returned data URL outlives the original iframe.
 * Invalid/unrendered roots and capture failures reject with an Error.
 */
export async function snapshotPreview(root, { storyId = '', tightBounds } = {}) {
  const doc = root?.ownerDocument;
  const win = doc?.defaultView;
  if (!win || root.nodeType !== 1 || !root.isConnected) throw new Error('The story preview is not ready for a snapshot.');
  let crop;
  if (tightBounds) {
    const { left, top } = tightBounds;
    const width = tightBounds.right === undefined ? tightBounds.width : tightBounds.right - left;
    const height = tightBounds.bottom === undefined ? tightBounds.height : tightBounds.bottom - top;
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 16384 || height > 16384) throw new Error('The story preview has invalid snapshot bounds.');
    crop = { left, top, width: Math.ceil(width), height: Math.ceil(height) };
  }
  const capture = await captureStory(root, { name: String(storyId || 'Storybook component').slice(0, 1000) });
  if (!root.isConnected) throw new Error('The story preview was removed before its snapshot finished.');
  const origin = captureOrigin(root, win);
  const warnings = new Set(capture.warnings.filter(warning => !/box shadows|background images and gradients/.test(warning)));
  const html = await snapshotHtml(root, capture, origin, warnings);
  if (!root.isConnected) throw new Error('The story preview was removed before its snapshot finished.');
  const width = crop?.width || capture.width;
  const height = crop?.height || capture.height;
  const x = crop ? Math.round((crop.left - origin.left) * 100) / 100 : 0;
  const y = crop ? Math.round((crop.top - origin.top) * 100) / 100 : 0;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  const foreign = doc.createElementNS(SVG_NS, 'foreignObject');
  foreign.setAttribute('width', String(Math.max(capture.width, win.innerWidth, x + width)));
  foreign.setAttribute('height', String(Math.max(capture.height, win.innerHeight, y + height)));
  foreign.setAttribute('overflow', 'visible');
  foreign.append(html);
  svg.append(foreign);
  const source = new win.XMLSerializer().serializeToString(svg);
  const src = await dataUrl(new win.Blob([source], { type: 'image/svg+xml;charset=utf-8' }), win);
  return { src, width, height, warnings: [...warnings] };
}
