/**
 * DOM → portable SVG, HTML and editable Figma JSON.
 * SVG deliberately uses ordinary vectors/text, never foreignObject or Figma's
 * undocumented clipboard format. Browser-only effects are reported as warnings.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_NODES = 2400;
const MAX_TEXT = 24000;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'ANIMATE', 'SET', 'ANIMATEMOTION', 'ANIMATETRANSFORM']);
const HTML_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'padding', 'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
  'flex-basis', 'align-items', 'align-content', 'align-self', 'justify-content', 'grid-template-columns',
  'grid-template-rows', 'grid-column', 'grid-row', 'vertical-align', 'overflow', 'opacity',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow', 'color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'text-decoration', 'white-space', 'word-break', 'overflow-wrap', 'list-style',
  'object-fit', 'object-position', 'fill', 'stroke', 'stroke-width', 'visibility', 'transform',
  'transform-origin', 'top', 'right', 'bottom', 'left', 'z-index',
];

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const num = value => Number.parseFloat(value) || 0;
const round = value => Math.round(value * 100) / 100;
const attr = value => esc(round(value));

function transformMatrix(value) {
  const values = value?.match(/^matrix\(([^)]+)\)$/)?.[1].split(/[,\s]+/).map(Number);
  return values?.length === 6 && values.every(Number.isFinite) ? values : null;
}

const axisAligned = matrix => matrix && Math.abs(matrix[1]) < 0.001 && Math.abs(matrix[2]) < 0.001;

function splitOutside(value, delimiter = ',') {
  let depth = 0;
  let start = 0;
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (value[index] === delimiter && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function color(value) {
  if (!value || value === 'transparent' || value === 'none') return { color: '#000000', opacity: 0 };
  const match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (match) return {
    color: `#${match.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`,
    opacity: match[4] === undefined ? 1 : Number(match[4]),
  };
  return { color: value, opacity: 1 };
}

function paintAttributes(paint, name = 'fill') {
  return `${name}="${esc(paint.color)}" ${name}-opacity="${attr(paint.opacity)}"`;
}

function safeUrl(value, base, allowImageData = false) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return trimmed;
  if (allowImageData && /^data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);/i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed, base);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

// Follow the browser's composed tree: an open shadow root replaces its host's
// light children, and a slot renders its assigned nodes (or its fallback).
// Traversing both trees would duplicate labels and include unslotted content.
function renderedChildren(element) {
  if (element.localName === 'slot' && typeof element.assignedNodes === 'function') {
    const assigned = element.assignedNodes({ flatten: true });
    return assigned.length ? assigned : [...element.childNodes];
  }
  return [...(element.shadowRoot || element).childNodes];
}

function visibleBounds(root, win) {
  const own = root.getBoundingClientRect();
  if (own.width && own.height) return own;
  const boxes = [];
  const seen = new WeakSet();
  let count = 0;
  function collect(element) {
    if (seen.has(element) || ++count > MAX_NODES) return;
    seen.add(element);
    if (SKIP_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute('data-atlas-ignore')) return;
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return;
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) boxes.push(rect);
    for (const child of renderedChildren(element)) {
      if (child.nodeType === 1) collect(child);
      else if (child.nodeType === 3 && child.nodeValue?.trim()) {
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(child);
        const textRect = range.getBoundingClientRect();
        if (textRect.width && textRect.height) boxes.push(textRect);
        range.detach();
      }
    }
  }
  collect(root);
  if (!boxes.length) return own;
  const left = Math.min(...boxes.map(box => box.left));
  const top = Math.min(...boxes.map(box => box.top));
  const right = Math.max(...boxes.map(box => box.right));
  const bottom = Math.max(...boxes.map(box => box.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function makeHtml(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const seen = new WeakSet();
  function clean(original) {
    if (seen.has(original)) return null;
    seen.add(original);
    if (original.nodeType === 3) return doc.createTextNode(original.nodeValue || '');
    if (original.nodeType !== 1 || SKIP_TAGS.has(original.tagName.toUpperCase()) || original.hasAttribute('data-atlas-ignore')) return null;
    // Flatten Web Components into ordinary, styled HTML so the snapshot works
    // without registering the source site's custom elements or shadow styles.
    const flattened = original.localName.includes('-') || original.localName === 'slot';
    const clone = flattened ? doc.createElement(original.localName === 'slot' ? 'span' : 'div') : original.cloneNode(false);
    if (flattened) for (const attribute of original.attributes) clone.setAttribute(attribute.name, attribute.value);
    for (const attribute of [...clone.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || name === 'srcset' || name === 'action' || name === 'formaction' || name === 'autofocus' || name === 'autoplay' || name === 'ping') clone.removeAttribute(attribute.name);
      else if (['href', 'src', 'xlink:href', 'poster'].includes(name)) {
        const imageAttribute = ['IMG', 'IMAGE'].includes(original.tagName.toUpperCase()) || name === 'poster';
        const url = safeUrl(attribute.value, doc.baseURI, imageAttribute);
        if (url) clone.setAttribute(attribute.name, url);
        else clone.removeAttribute(attribute.name);
      }
    }
    const computed = win.getComputedStyle(original);
    const styles = HTML_STYLE_PROPERTIES.flatMap(property => {
      const value = computed.getPropertyValue(property);
      if (!value || /(?:expression\s*\(|javascript\s*:|-moz-binding)/i.test(value)) return [];
      if (/url\(/i.test(value)) {
        const matches = [...value.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi)];
        if (matches.some(match => !safeUrl(match[1], doc.baseURI, true))) return [];
      }
      return [`${property}:${value}`];
    });
    clone.setAttribute('style', styles.join(';'));
    if (original.tagName === 'INPUT') {
      // Password fields are never exported, including their attribute default.
      clone.setAttribute('value', original.type === 'password' ? '' : original.value);
      if (original.checked) clone.setAttribute('checked', '');
      else clone.removeAttribute('checked');
    }
    if (original.tagName === 'BUTTON') clone.setAttribute('type', 'button');
    if (original.tagName === 'TEXTAREA') clone.textContent = original.value;
    else for (const child of renderedChildren(original)) {
      const safeChild = clean(child);
      if (safeChild) clone.appendChild(safeChild);
    }
    return clone;
  }
  return clean(root)?.outerHTML || '';
}

function bounds(element, origin) {
  const box = element.getBoundingClientRect();
  return { x: round(box.left - origin.left), y: round(box.top - origin.top), width: round(box.width), height: round(box.height) };
}

function radius(value, size) {
  return value.endsWith('%') ? num(value) * size / 100 : num(value);
}

function roundedPath(box, radii) {
  const { x, y, width: w, height: h } = box;
  const [tl, tr, br, bl] = radii.map(r => Math.min(r, w / 2, h / 2));
  return `M${round(x + tl)} ${round(y)}H${round(x + w - tr)}Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + tr)}V${round(y + h - br)}Q${round(x + w)} ${round(y + h)} ${round(x + w - br)} ${round(y + h)}H${round(x + bl)}Q${round(x)} ${round(y + h)} ${round(x)} ${round(y + h - bl)}V${round(y + tl)}Q${round(x)} ${round(y)} ${round(x + tl)} ${round(y)}Z`;
}

function rectSvg(box, radii, paint, extra = '') {
  return `<path d="${roundedPath(box, radii)}" ${paintAttributes(paint)} ${extra}/>`;
}

async function imageData(url, doc) {
  if (!url) throw new Error('Image has no source');
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);/i.test(url)) return url;
  // SVG files can contain active or external resources; sanitize them first.
  const response = await doc.defaultView.fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Image returned HTTP ${response.status}`);
  const blob = await response.blob();
  if (!/^image\//i.test(blob.type)) throw new Error('Resource is not an image');
  if (blob.type.includes('svg')) {
    const parser = new doc.defaultView.DOMParser();
    const svg = parser.parseFromString(await blob.text(), 'image/svg+xml');
    svg.querySelectorAll('script,foreignObject,iframe,style').forEach(node => node.remove());
    svg.querySelectorAll('*').forEach(node => {
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#'))) node.removeAttribute(attribute.name);
      }
    });
    const source = new doc.defaultView.XMLSerializer().serializeToString(svg.documentElement);
    return `data:image/svg+xml;base64,${doc.defaultView.btoa(unescape(encodeURIComponent(source)))}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new doc.defaultView.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Capture the currently rendered, accessible Storybook preview DOM. */
export async function captureStory(rootElement, { name = 'Storybook component', storyUrl = '' } = {}) {
  if (!rootElement?.ownerDocument?.defaultView) throw new Error('The story preview is not ready. Wait for the component to render.');
  const doc = rootElement.ownerDocument;
  const win = doc.defaultView;
  // Let web fonts finish so measured positions match exported text.
  if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))]);
  const origin = visibleBounds(rootElement, win);
  const width = Math.max(1, Math.ceil(origin.width));
  const height = Math.max(1, Math.ceil(origin.height));
  if (width > 16384 || height > 16384) throw new Error('This preview is too large to export. Choose a smaller story or viewport.');
  const warnings = new Set();
  const nodes = [];
  const defs = [];
  let visited = 0;
  let textLength = 0;
  let sequence = 0;
  const rendered = new WeakSet();

  function addText(text, box, style, opacity = 1) {
    if (!text || !text.trim()) return '';
    const fill = color(style.color);
    const node = {
      type: 'text', text, ...box, color: fill.color, opacity: fill.opacity * opacity,
      fontFamily: style.fontFamily, fontSize: num(style.fontSize) || 16,
      fontWeight: num(style.fontWeight) || 400, fontStyle: style.fontStyle,
      letterSpacing: num(style.letterSpacing), lineHeight: num(style.lineHeight) || num(style.fontSize) * 1.2,
      textDecoration: style.textDecorationLine || 'none',
    };
    nodes.push(node);
    const baseline = box.y + box.height - Math.max(0, (box.height - node.fontSize) / 2) - node.fontSize * 0.18;
    return `<text x="${attr(box.x)}" y="${attr(baseline)}" ${paintAttributes(fill)} font-family="${esc(node.fontFamily)}" font-size="${attr(node.fontSize)}" font-weight="${attr(node.fontWeight)}" font-style="${esc(node.fontStyle)}" letter-spacing="${attr(node.letterSpacing)}" text-decoration="${esc(node.textDecoration)}" xml:space="preserve">${esc(text)}</text>`;
  }

  function textSvg(textNode, style, opacity) {
    if (!textNode.nodeValue?.trim()) return '';
    let source = textNode.nodeValue;
    if (textLength + source.length > MAX_TEXT) {
      source = source.slice(0, Math.max(0, MAX_TEXT - textLength));
      warnings.add('Long text was shortened to keep the export responsive.');
    }
    textLength += source.length;
    const range = doc.createRange();
    let current = null;
    const runs = [];
    let offset = 0;
    for (const character of source) {
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + character.length);
      offset += character.length;
      const rect = range.getBoundingClientRect();
      if (!rect.height || (!rect.width && /\s/.test(character))) continue;
      const box = { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
      if (current && Math.abs(current.y - box.y) < 1 && Math.abs(current.height - box.height) < 1 && box.x >= current.x - 1 && box.x <= current.x + current.width + 3) {
        current.text += character;
        current.width = Math.max(current.width, box.x + box.width - current.x);
      } else {
        current = { ...box, text: character };
        runs.push(current);
      }
    }
    range.detach();
    return runs.map(({ text, ...box }) => {
      let transformed = text;
      if (style.textTransform === 'uppercase') transformed = text.toUpperCase();
      if (style.textTransform === 'lowercase') transformed = text.toLowerCase();
      if (style.textTransform === 'capitalize') transformed = text.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
      return addText(transformed, box, style, opacity);
    }).join('');
  }

  async function inlineSvg(element, box, opacity) {
    const clone = element.cloneNode(true);
    const rootStyle = win.getComputedStyle(element);
    const sources = [element, ...element.querySelectorAll('*')];
    const targets = [clone, ...clone.querySelectorAll('*')];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const source = sources[index];
      if (['script', 'foreignobject', 'iframe', 'style'].includes(target.tagName.toLowerCase())) {
        target.remove();
        warnings.add('Embedded SVG scripts and HTML were removed.');
        continue;
      }
      for (const attribute of [...target.attributes]) {
        if (/^on/i.test(attribute.name)) target.removeAttribute(attribute.name);
        if (/url\(/i.test(attribute.value) && !/^url\(\s*['"]?#[^)]*\)$/i.test(attribute.value)) {
          target.removeAttribute(attribute.name);
          warnings.add('External SVG paint and filter references could not be embedded.');
        }
        if (/href$/i.test(attribute.name) && !attribute.value.startsWith('#')) {
          if (target.tagName.toLowerCase() === 'image') {
            try { target.setAttribute(attribute.name, await imageData(attribute.value, doc)); }
            catch { target.removeAttribute(attribute.name); warnings.add('An SVG image could not be embedded because its source is inaccessible.'); }
          } else {
            target.removeAttribute(attribute.name);
            warnings.add('External SVG references could not be embedded.');
          }
        }
      }
      target.removeAttribute('style');
      const computed = win.getComputedStyle(source);
      if (index > 0 && computed.transform && computed.transform !== 'none') {
        const matrix = transformMatrix(computed.transform);
        if (matrix) {
          const origin = computed.transformOrigin.split(/\s+/).map(num);
          let [ox = 0, oy = 0] = origin;
          // SVG CSS transforms are expressed in local user units. Bake their
          // origin into a presentation transform so Figma also keeps the pose.
          if (computed.transformBox === 'fill-box' || computed.transformBox === 'stroke-box') {
            try { const local = source.getBBox(); ox += local.x; oy += local.y; }
            catch { warnings.add('An SVG child transform origin could not be resolved.'); }
          }
          const [a, b, c, d, e, f] = matrix;
          target.setAttribute('transform', `matrix(${a} ${b} ${c} ${d} ${e + ox - a * ox - c * oy} ${f + oy - b * ox - d * oy})`);
        } else warnings.add('A 3D SVG child transform could not be reproduced.');
      }
      for (const property of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stop-color', 'stop-opacity', 'color', 'opacity']) {
        const value = computed.getPropertyValue(property);
        if (value && !/url\(/.test(value)) target.setAttribute(property, value);
      }
    }
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('opacity', '1');
    // The measured outer box already contains CSS scale and translation. Its
    // orientation does not: e.g. Chakra's expanded chevron rotates by 180°.
    // Bake axis flips around the viewBox center into the icon's own vectors.
    const rootMatrix = transformMatrix(rootStyle.transform);
    if (rootMatrix && axisAligned(rootMatrix)) {
      const viewBox = element.viewBox?.baseVal;
      const vb = viewBox?.width > 0 && viewBox?.height > 0
        ? { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height }
        : { x: 0, y: 0, width: num(rootStyle.width) || element.clientWidth || box.width, height: num(rootStyle.height) || element.clientHeight || box.height };
      clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
      clone.removeAttribute('transform');
      const sx = rootMatrix[0] < 0 ? -1 : 1;
      const sy = rootMatrix[3] < 0 ? -1 : 1;
      if (sx < 0 || sy < 0) {
        const group = doc.createElementNS(SVG_NS, 'g');
        const cx = vb.x + vb.width / 2;
        const cy = vb.y + vb.height / 2;
        group.setAttribute('transform', `matrix(${sx} 0 0 ${sy} ${cx * (1 - sx)} ${cy * (1 - sy)})`);
        while (clone.firstChild) group.appendChild(clone.firstChild);
        clone.appendChild(group);
      }
    }
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    const source = new win.XMLSerializer().serializeToString(clone);
    nodes.push({ type: 'svg', ...box, svg: source, opacity });
    clone.setAttribute('x', String(box.x));
    clone.setAttribute('y', String(box.y));
    return new win.XMLSerializer().serializeToString(clone);
  }

  async function visitChildren(element, style, opacity) {
    let output = '';
    for (const child of renderedChildren(element)) {
      if (child.nodeType === 3 && !rendered.has(child)) {
        rendered.add(child);
        output += textSvg(child, style, opacity);
      } else if (child.nodeType === 1) output += await visit(child, opacity);
    }
    return output;
  }

  async function visit(element, inheritedOpacity = 1) {
    if (rendered.has(element)) return '';
    rendered.add(element);
    if (++visited > MAX_NODES) {
      warnings.add('The export reached its element limit; choose a smaller story for a complete export.');
      return '';
    }
    if (SKIP_TAGS.has(element.tagName.toUpperCase()) || element.hasAttribute('data-atlas-ignore')) return '';
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return '';
    const box = bounds(element, origin);
    const ownOpacity = Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1;
    const opacity = inheritedOpacity * ownOpacity;
    if (!box.width || !box.height) {
      // Slots, display:contents and zero-size hosts can still paint descendants.
      // Preserve their inherited styles/opacity instead of dropping their tree.
      if (style.display !== 'contents' && ['hidden', 'clip'].includes(style.overflowX) && ['hidden', 'clip'].includes(style.overflowY)) return '';
      return `<g opacity="${attr(ownOpacity)}">${await visitChildren(element, style, opacity)}</g>`;
    }
    if (style.filter !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none')) warnings.add('CSS filters and backdrop blur are not reproduced in vector exports.');
    if (style.mixBlendMode !== 'normal') warnings.add('CSS blend modes are flattened to normal blending.');
    if (style.clipPath && style.clipPath !== 'none') warnings.add('CSS clip-path shapes are not reproduced.');
    if (style.transform && style.transform !== 'none') {
      const matrix = transformMatrix(style.transform);
      const isSvg = element.namespaceURI === SVG_NS && element.tagName.toLowerCase() === 'svg';
      if (!axisAligned(matrix) || (!isSvg && (matrix[0] < 0 || matrix[3] < 0))) warnings.add(isSvg ? 'An SVG rotation or skew could not be reproduced exactly.' : 'Rotated, mirrored or skewed HTML elements are exported using their measured bounds.');
    }
    for (const pseudo of ['::before', '::after']) {
      const pseudoStyle = win.getComputedStyle(element, pseudo);
      if (pseudoStyle.content && !['none', 'normal', '""', "''"].includes(pseudoStyle.content)) warnings.add('Generated ::before/::after content may differ in vector exports.');
    }
    if (element.namespaceURI === SVG_NS && element.tagName.toLowerCase() === 'svg') return `<g opacity="${attr(ownOpacity)}">${await inlineSvg(element, box, opacity)}</g>`;
    const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map(property => radius(style[property].split(' ')[0], Math.min(box.width, box.height)));
    let output = '';
    const fill = color(style.backgroundColor);
    if (style.boxShadow && style.boxShadow !== 'none') {
      warnings.add('CSS box shadows are approximate in SVG and omitted from native Figma JSON.');
      for (const shadow of splitOutside(style.boxShadow)) {
        if (/\binset\b/.test(shadow)) continue;
        const shadowColorMatch = shadow.match(/rgba?\([^)]+\)|#[\da-f]+/i);
        const shadowColor = color(shadowColorMatch?.[0] || 'rgba(0,0,0,0.2)');
        const lengths = shadow.replace(shadowColorMatch?.[0] || '', '').match(/-?[\d.]+px/g)?.map(num) || [];
        if (lengths.length < 2) continue;
        const [dx, dy, blur = 0, spread = 0] = lengths;
        const id = `atlas-shadow-${++sequence}`;
        defs.push(`<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${attr(blur / 2)}"/></filter>`);
        output += rectSvg({ x: box.x + dx - spread, y: box.y + dy - spread, width: box.width + spread * 2, height: box.height + spread * 2 }, radii, shadowColor, `filter="url(#${id})"`);
      }
    }
    if (fill.opacity > 0) {
      output += rectSvg(box, radii, fill);
      nodes.push({ type: 'rect', ...box, radii, fill: fill.color, opacity: fill.opacity * opacity });
    }
    if (style.backgroundImage && style.backgroundImage !== 'none') warnings.add('CSS background images and gradients are omitted; ordinary image elements are embedded when accessible.');
    const edges = ['Top', 'Right', 'Bottom', 'Left'].map(edge => ({ width: num(style[`border${edge}Width`]), color: color(style[`border${edge}Color`]), style: style[`border${edge}Style`] }));
    const sameBorder = edges.every(edge => edge.width === edges[0].width && edge.color.color === edges[0].color.color && edge.color.opacity === edges[0].color.opacity && edge.style === edges[0].style);
    if (sameBorder && edges[0].width > 0 && edges[0].color.opacity > 0 && edges[0].style !== 'none') {
      const edge = edges[0];
      const half = edge.width / 2;
      const borderBox = { x: box.x + half, y: box.y + half, width: Math.max(0, box.width - edge.width), height: Math.max(0, box.height - edge.width) };
      const dash = edge.style === 'dashed' ? `stroke-dasharray="${edge.width * 3} ${edge.width * 2}"` : edge.style === 'dotted' ? `stroke-dasharray="${edge.width} ${edge.width}"` : '';
      output += `<path d="${roundedPath(borderBox, radii.map(r => Math.max(0, r - half)))}" fill="none" ${paintAttributes(edge.color, 'stroke')} stroke-width="${attr(edge.width)}" ${dash}/>`;
      nodes.push({ type: 'rect', ...box, radii, fill: null, stroke: edge.color.color, strokeWidth: edge.width, opacity: edge.color.opacity * opacity });
    } else {
      edges.forEach((edge, index) => {
        if (edge.width <= 0 || edge.color.opacity <= 0 || edge.style === 'none') return;
        const borderBox = index === 0 ? { ...box, height: edge.width } : index === 1 ? { ...box, x: box.x + box.width - edge.width, width: edge.width } : index === 2 ? { ...box, y: box.y + box.height - edge.width, height: edge.width } : { ...box, width: edge.width };
        output += rectSvg(borderBox, [0, 0, 0, 0], edge.color);
        nodes.push({ type: 'rect', ...borderBox, radii: [0, 0, 0, 0], fill: edge.color.color, opacity: edge.color.opacity * opacity });
      });
    }
    if (element.tagName === 'IMG' || element.tagName === 'CANVAS' || element.tagName === 'VIDEO') {
      try {
        const href = element.tagName === 'CANVAS' ? element.toDataURL('image/png') : await imageData(element.tagName === 'VIDEO' ? element.poster : element.currentSrc || element.src, doc);
        const fit = style.objectFit === 'contain' ? 'xMidYMid meet' : style.objectFit === 'cover' ? 'xMidYMid slice' : 'none';
        const id = `atlas-image-${++sequence}`;
        defs.push(`<clipPath id="${id}"><path d="${roundedPath(box, radii)}"/></clipPath>`);
        output += `<image x="${attr(box.x)}" y="${attr(box.y)}" width="${attr(box.width)}" height="${attr(box.height)}" href="${esc(href)}" preserveAspectRatio="${fit}" clip-path="url(#${id})"/>`;
        nodes.push({ type: 'image', ...box, dataUrl: href, fit: style.objectFit, radii, opacity });
      } catch { warnings.add('An image or canvas could not be embedded because its source is inaccessible or cross-origin.'); }
    } else if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
      if (element.type === 'password') warnings.add('Password field contents were excluded.');
      let value = element.type === 'password' ? '' : element.tagName === 'SELECT' ? element.selectedOptions?.[0]?.text || '' : element.value || element.placeholder || '';
      if (['checkbox', 'radio'].includes(element.type)) {
        warnings.add('Native checkbox and radio appearances may differ from the browser.');
        if (element.checked) {
          const checkBox = { x: box.x + 3, y: box.y + 3, width: Math.max(1, box.width - 6), height: Math.max(1, box.height - 6) };
          const checkColor = color(style.accentColor === 'auto' ? '#3182ce' : style.accentColor);
          output += rectSvg(checkBox, [2, 2, 2, 2], checkColor);
          nodes.push({ type: 'rect', ...checkBox, radii: [2, 2, 2, 2], fill: checkColor.color, opacity });
        }
        value = '';
      }
      const fontSize = num(style.fontSize) || 16;
      const textStyle = !element.value && element.placeholder ? win.getComputedStyle(element, '::placeholder') : style;
      if (element.tagName === 'TEXTAREA' && value.includes('\n')) warnings.add('Multiline form values may wrap differently in vector exports.');
      output += addText(value, { x: box.x + num(style.paddingLeft) + num(style.borderLeftWidth), y: box.y + Math.max(num(style.paddingTop), (box.height - fontSize * 1.2) / 2), width: Math.max(0, box.width - num(style.paddingLeft) - num(style.paddingRight)), height: fontSize * 1.2 }, textStyle, opacity);
    } else {
      let children = await visitChildren(element, style, opacity);
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {
        const id = `atlas-clip-${++sequence}`;
        defs.push(`<clipPath id="${id}"><path d="${roundedPath(box, radii)}"/></clipPath>`);
        children = `<g clip-path="url(#${id})">${children}</g>`;
        if ((element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) warnings.add('Scrollable content is clipped in SVG; the native Figma JSON may include content outside its scroll viewport.');
      }
      output += children;
    }
    return `<g opacity="${attr(ownOpacity)}">${output}</g>`;
  }

  const content = await visit(rootElement);
  const svg = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(name)}"><title>${esc(name)}</title><defs>${defs.join('')}</defs>${content}</svg>`;
  const design = {
    schema: 'story-library/design', version: 1, name, storyUrl, width, height,
    nodes, warnings: [...warnings],
    note: 'Native layers preserve measured bounds. Fonts must be available in Figma. Effects, generated content, transforms and clipping may differ; SVG is the visual interchange format.',
  };
  return { svg, html: makeHtml(rootElement), design, width, height, warnings: [...warnings] };
}

/** Rasterize the self-contained SVG using the browser's canvas. */
export async function svgToPng(svg, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('The preview has no exportable dimensions.');
  // Bound memory while preserving the preview's aspect ratio.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(32_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create an image canvas.');
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The browser could not render this SVG as PNG. Try downloading SVG instead.'));
      image.src = url;
    });
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG encoding failed. Try SVG instead.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
