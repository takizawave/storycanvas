/* Local companion plugin. No server, telemetry or private clipboard formats. */
figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

const fontCache = new Map();
let fontInventory;

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rgb(value) {
  const hex = String(value || '#000000').replace('#', '');
  if (/^[\da-f]{6}$/i.test(hex)) return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 };
  if (/^[\da-f]{3}$/i.test(hex)) return { r: parseInt(hex[0] + hex[0], 16) / 255, g: parseInt(hex[1] + hex[1], 16) / 255, b: parseInt(hex[2] + hex[2], 16) / 255 };
  return { r: 0, g: 0, b: 0 };
}

const solid = value => [{ type: 'SOLID', color: rgb(value) }];

async function fontFor(spec, warnings) {
  if (!fontInventory) fontInventory = await figma.listAvailableFontsAsync();
  const families = String(spec.fontFamily || 'Inter').split(',').map(name => name.trim().replace(/^['"]|['"]$/g, ''));
  const weight = finite(spec.fontWeight, 400);
  const desired = weight >= 800 ? 'ExtraBold' : weight >= 700 ? 'Bold' : weight >= 600 ? 'SemiBold' : weight >= 500 ? 'Medium' : weight <= 300 ? 'Light' : 'Regular';
  const normalize = value => value.toLowerCase().replace(/[^a-z]/g, '');
  let familyFonts = [];
  for (const family of families) {
    familyFonts = fontInventory.filter(entry => entry.fontName.family.toLowerCase() === family.toLowerCase());
    if (familyFonts.length) break;
  }
  if (!familyFonts.length) {
    familyFonts = fontInventory.filter(entry => entry.fontName.family === 'Inter');
    warnings.add(`Font substituted: ${families[0]} → Inter`);
  }
  const italic = spec.fontStyle === 'italic';
  const wanted = normalize(desired + (italic ? 'Italic' : ''));
  const chosen = familyFonts.find(entry => normalize(entry.fontName.style) === wanted)
    || familyFonts.find(entry => normalize(entry.fontName.style) === normalize(desired))
    || familyFonts.find(entry => entry.fontName.style === 'Regular')
    || familyFonts[0];
  const font = chosen ? chosen.fontName : { family: 'Inter', style: 'Regular' };
  const key = `${font.family}/${font.style}`;
  if (!fontCache.has(key)) fontCache.set(key, figma.loadFontAsync(font));
  await fontCache.get(key);
  return font;
}

function setRadii(node, spec) {
  const radii = Array.isArray(spec.radii) ? spec.radii : [0, 0, 0, 0];
  ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].forEach((property, index) => {
    if (property in node) node[property] = Math.max(0, finite(radii[index]));
  });
}

async function buildNode(spec, warnings) {
  let node;
  const width = Math.max(0.01, Math.min(16384, finite(spec.width, 1)));
  const height = Math.max(0.01, Math.min(16384, finite(spec.height, 1)));
  if (spec.type === 'text') {
    const font = await fontFor(spec, warnings);
    node = figma.createText();
    node.fontName = font;
    node.fontSize = Math.max(1, Math.min(1000, finite(spec.fontSize, 16)));
    node.characters = String(spec.text || '').slice(0, 24000);
    node.fills = solid(spec.color);
    node.letterSpacing = { unit: 'PIXELS', value: finite(spec.letterSpacing) };
    node.lineHeight = { unit: 'PIXELS', value: height };
    node.textAutoResize = 'WIDTH_AND_HEIGHT';
    if (String(spec.textDecoration).includes('underline')) node.textDecoration = 'UNDERLINE';
    else if (String(spec.textDecoration).includes('line-through')) node.textDecoration = 'STRIKETHROUGH';
    node.name = node.characters.slice(0, 48) || 'Text';
  } else if (spec.type === 'svg') {
    if (typeof spec.svg !== 'string' || spec.svg.length > 4_000_000 || !/^\s*<svg\b/.test(spec.svg)) throw new Error('Invalid SVG layer');
    node = figma.createNodeFromSvg(spec.svg);
    node.resize(width, height);
    node.name = 'Vector';
  } else if (spec.type === 'image') {
    const match = String(spec.dataUrl || '').match(/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new Error('Invalid embedded image');
    if (match[1] === 'svg+xml') {
      const decoded = figma.base64Decode(match[2]);
      // SVG from the exporter is UTF-8; createNodeFromSvg handles ASCII markup
      // and this decoder retains non-ASCII text without accessing the network.
      const svg = decodeURIComponent(Array.from(decoded, byte => `%${byte.toString(16).padStart(2, '0')}`).join(''));
      node = figma.createNodeFromSvg(svg);
      node.resize(width, height);
    } else {
      const image = figma.createImage(figma.base64Decode(match[2]));
      node = figma.createRectangle();
      node.resize(width, height);
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: spec.fit === 'contain' ? 'FIT' : spec.fit === 'fill' ? 'STRETCH' : 'FILL' }];
      setRadii(node, spec);
    }
    node.name = 'Image';
  } else if (spec.type === 'rect') {
    node = figma.createRectangle();
    node.resize(width, height);
    node.fills = spec.fill ? solid(spec.fill) : [];
    if (spec.stroke) {
      node.strokes = solid(spec.stroke);
      node.strokeWeight = Math.max(0, finite(spec.strokeWidth, 1));
      node.strokeAlign = 'INSIDE';
    }
    setRadii(node, spec);
    node.name = spec.stroke ? 'Border' : 'Surface';
  } else return null;
  node.x = finite(spec.x);
  node.y = finite(spec.y);
  node.opacity = Math.max(0, Math.min(1, finite(spec.opacity, 1)));
  return node;
}

let importing = false;
figma.ui.onmessage = async message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'close') return figma.closePlugin();
  if (message.type !== 'import' || importing) return;
  importing = true;
  let component;
  try {
    const payload = JSON.parse(String(message.json));
    if (!payload || payload.schema !== 'story-library/design' || payload.version !== 1 || !Array.isArray(payload.nodes)) throw new Error('Paste the Figma JSON copied from storycanvas.');
    if (payload.nodes.length > 10000) throw new Error('This component contains too many layers. Export a smaller story.');
    if (payload.nodes.some(spec => !spec || typeof spec !== 'object' || typeof spec.type !== 'string')) throw new Error('The component contains an invalid layer. Copy a fresh Figma JSON export.');
    if (![payload.width, payload.height].every(value => Number.isFinite(value) && value > 0 && value <= 16384)) throw new Error('The component dimensions are invalid.');
    const warnings = new Set(Array.isArray(payload.warnings) ? payload.warnings.map(String) : []);
    component = figma.createComponent();
    component.name = String(payload.name || 'Storybook component').slice(0, 240);
    component.resize(payload.width, payload.height);
    component.fills = [];
    component.clipsContent = true;
    component.description = `Imported from storycanvas${payload.storyUrl ? `\n${String(payload.storyUrl).slice(0, 2000)}` : ''}\nFixed-layout editable snapshot. See export warnings for visual differences.`;
    let count = 0;
    for (const spec of payload.nodes) {
      try {
        const node = await buildNode(spec, warnings);
        if (node) { component.appendChild(node); count += 1; }
      } catch (error) { warnings.add(`Skipped ${String(spec.type)} layer: ${error.message}`); }
    }
    if (!count) throw new Error('No supported layers were found in this export.');
    component.x = figma.viewport.center.x - component.width / 2;
    component.y = figma.viewport.center.y - component.height / 2;
    figma.currentPage.selection = [component];
    figma.viewport.scrollAndZoomIntoView([component]);
    figma.ui.postMessage({ type: 'success', count, name: component.name, warnings: [...warnings] });
    figma.notify(`Imported ${component.name} · ${count} editable layers`);
  } catch (error) {
    if (component) component.remove();
    figma.ui.postMessage({ type: 'error', message: error.message || 'Import failed' });
  } finally { importing = false; }
};
