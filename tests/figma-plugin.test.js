import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../figma-plugin/code.js', import.meta.url), 'utf8');

function plugin() {
  const created = [];
  const messages = [];
  const loadedFonts = [];
  const node = type => {
    const item = {
      type, children: [], width: 1, height: 1,
      topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0,
      resize(width, height) { this.width = width; this.height = height; },
      appendChild(child) { this.children.push(child); },
      remove() { this.removed = true; },
    };
    created.push(item);
    return item;
  };
  const figma = {
    showUI() {},
    ui: { postMessage: message => messages.push(message) },
    listAvailableFontsAsync: async () => [
      { fontName: { family: 'Inter', style: 'Regular' } },
      { fontName: { family: 'Inter', style: 'Semi Bold' } },
    ],
    loadFontAsync: async font => loadedFonts.push(font),
    createComponent: () => node('COMPONENT'),
    createRectangle: () => node('RECTANGLE'),
    createText: () => node('TEXT'),
    createNodeFromSvg: svg => Object.assign(node('FRAME'), { sourceSvg: svg }),
    createImage: () => ({ hash: 'image-hash' }),
    base64Decode: value => new Uint8Array(Buffer.from(value, 'base64')),
    viewport: { center: { x: 800, y: 600 }, scrollAndZoomIntoView: () => {} },
    currentPage: { selection: [] },
    notify() {},
  };
  vm.runInNewContext(code, { figma, __html__: '<html></html>', console });
  return { figma, created, messages, loadedFonts, import: payload => figma.ui.onmessage({ type: 'import', json: typeof payload === 'string' ? payload : JSON.stringify(payload) }) };
}

const design = overrides => ({
  schema: 'story-library/design', version: 1, name: 'Button / Primary',
  storyUrl: 'https://example.com/?path=/story/button--primary', width: 140, height: 44,
  nodes: [
    { type: 'rect', x: 0, y: 0, width: 140, height: 44, fill: '#3182ce', radii: [6, 6, 6, 6], opacity: 1 },
    { type: 'text', x: 20, y: 13, width: 100, height: 18, text: 'Get started', fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 600, color: '#ffffff', opacity: 1 },
  ], warnings: [], ...overrides,
});

test('Figma import creates a main component with native editable surfaces and text', async () => {
  const context = plugin();
  await context.import(design());
  const component = context.created.find(node => node.type === 'COMPONENT');
  assert.equal(component.name, 'Button / Primary');
  assert.equal(component.width, 140);
  assert.equal(component.height, 44);
  assert.equal(component.children.length, 2);
  assert.equal(component.children[0].type, 'RECTANGLE');
  assert.equal(component.children[0].topLeftRadius, 6);
  assert.equal(component.children[1].type, 'TEXT');
  assert.equal(component.children[1].characters, 'Get started');
  assert.equal(component.children[1].fontName.style, 'Semi Bold');
  assert.equal(component.children[1].x, 20);
  assert.equal(context.figma.currentPage.selection[0], component);
  assert.equal(context.messages.at(-1).type, 'success');
  assert.equal(context.messages.at(-1).count, 2);
});

test('Figma import rejects malformed and incompatible payloads without creating a component', async () => {
  for (const payload of ['{', 'null', {}, design({ version: 2 }), design({ width: -2 }), design({ height: Infinity }), design({ nodes: null }), design({ nodes: [null] })]) {
    const context = plugin();
    await context.import(payload);
    assert.equal(context.messages.at(-1).type, 'error');
    assert.equal(context.created.length, 0);
  }
});

test('Figma import reports font substitution and skips bad layers while retaining supported layers', async () => {
  const context = plugin();
  const payload = design();
  payload.nodes[1].fontFamily = 'Missing Local Font';
  payload.nodes.push({ type: 'svg', svg: 'not an svg', width: 20, height: 20 });
  await context.import(payload);
  assert.equal(context.messages.at(-1).type, 'success');
  assert.equal(context.messages.at(-1).count, 2);
  assert.ok(context.messages.at(-1).warnings.some(warning => warning.includes('Font substituted')));
  assert.ok(context.messages.at(-1).warnings.some(warning => warning.includes('Skipped svg')));
});

test('Figma import removes an empty failed component and can recover on the next import', async () => {
  const context = plugin();
  await context.import(design({ nodes: [] }));
  assert.equal(context.messages.at(-1).type, 'error');
  assert.equal(context.created[0].removed, true);
  await context.import(design());
  assert.equal(context.messages.at(-1).type, 'success');
});

test('Figma import retains vector and raster layers without fetching network resources', async () => {
  const context = plugin();
  await context.import(design({ nodes: [
    { type: 'svg', x: 2, y: 3, width: 24, height: 24, svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h20v20z"/></svg>' },
    { type: 'image', x: 30, y: 0, width: 40, height: 40, dataUrl: 'data:image/png;base64,aGVsbG8=', fit: 'contain' },
  ] }));
  const component = context.created[0];
  assert.equal(component.children[0].sourceSvg.includes('<path'), true);
  assert.equal(component.children[1].fills[0].imageHash, 'image-hash');
  assert.equal(component.children[1].fills[0].scaleMode, 'FIT');
  assert.equal(context.messages.at(-1).count, 2);
});
