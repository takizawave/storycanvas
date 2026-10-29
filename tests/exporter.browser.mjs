import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = await readFile(new URL('../src/exporter.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>body{font-family:Arial}#root{box-sizing:border-box;width:340px;padding:20px;background:white}button{background:#3182ce;color:white;padding:10px 20px;border-radius:6px;border:0;font:600 16px Arial}.line{width:130px;line-height:24px}.invisible{display:none}</style>
    <div id="root"><button onclick="alert(1)">Get started</button><p class="line">Multiple words wrap onto different lines.</p><svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 2L22 22" stroke="currentColor"/><script type="text/plain">dangerous()</script></svg><input type="password" value="private-password"><input value="Public value"><a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a><span class="invisible">Hidden content</span><script type="text/plain">dangerous()</script></div>`);
  await page.addScriptTag({ content: source.replace(/export async function/g, 'async function') + '\nwindow.captureStory = captureStory; window.svgToPng = svgToPng;' });
  const result = await page.evaluate(async () => {
    const capture = await window.captureStory(document.querySelector('#root'), { name: 'Button & controls', storyUrl: 'https://example.com/story' });
    const parsed = new DOMParser().parseFromString(capture.svg, 'image/svg+xml');
    const png = await window.svgToPng(capture.svg, capture.width, capture.height);
    return { ...capture, parserError: parsed.querySelector('parsererror')?.textContent, pngType: png.type, pngSize: png.size };
  });
  assert.equal(result.width, 340);
  assert.ok(result.height > 100);
  assert.equal(result.parserError, undefined, 'SVG must be valid XML');
  assert.equal(result.pngType, 'image/png');
  assert.ok(result.pngSize > 1000, 'SVG should rasterize to meaningful PNG data');
  assert.equal(/private-password/.test(JSON.stringify(result)), false, 'Passwords must not reach any export');
  assert.equal(/javascript:|onclick|<script/i.test(result.html), false, 'Exported HTML must remove scripts, event handlers and unsafe URLs');
  assert.equal(/foreignObject/.test(result.svg), false);
  assert.equal(/Hidden content/.test(result.svg), false);
  assert.equal(result.design.schema, 'story-library/design');
  assert.ok(result.design.nodes.some(node => node.type === 'rect' && node.fill === '#3182ce'));
  assert.ok(result.design.nodes.some(node => node.type === 'text' && node.text === 'Get started'));
  assert.ok(result.design.nodes.some(node => node.type === 'text' && node.text === 'Public value'));
  const wrapped = result.design.nodes.filter(node => node.type === 'text' && /Multiple|words|wrap|onto|different|lines/.test(node.text));
  assert.ok(new Set(wrapped.map(node => node.y)).size > 1, 'Wrapped text should retain distinct measured lines');
  assert.ok(result.design.nodes.some(node => node.type === 'svg'));
  // Chakra Accordion rotates its expanded chevron with CSS. Its bounding box
  // is unchanged by 180°, so serializing only that box loses the open state.
  await page.evaluate(() => {
    document.body.innerHTML = `<div style="padding:10px;background:white">
      <svg id="rotate180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" style="transform:rotate(-180deg)"><path d="M2 3H21L8 21Z"/></svg>
      <svg id="mirror" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" style="transform:scaleX(-1)"><path d="M2 3H21L8 21Z"/></svg>
      <svg id="child" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path style="transform:rotate(180deg);transform-origin:12px 12px" d="M2 3H21L8 21Z"/></svg>
    </div>`;
    document.querySelectorAll('svg').forEach(svg => { svg.style.display = 'block'; });
  });
  for (const id of ['rotate180', 'mirror', 'child']) {
    const reference = (await page.locator(`#${id}`).screenshot()).toString('base64');
    const rotation = await page.evaluate(async ({ id, reference }) => {
      const capture = await window.captureStory(document.getElementById(id));
      async function pixels(url) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 24; canvas.height = 24;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white'; context.fillRect(0, 0, 24, 24);
        context.drawImage(image, 0, 0, 24, 24);
        return context.getImageData(0, 0, 24, 24).data;
      }
      const actual = await pixels(`data:image/png;base64,${reference}`);
      async function difference(svg) {
        const exported = await pixels(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        return exported.reduce((sum, channel, index) => sum + Math.abs(channel - actual[index]), 0) / exported.length;
      }
      return { svgDifference: await difference(capture.svg), figmaDifference: await difference(capture.design.nodes[0].svg), warnings: capture.warnings };
    }, { id, reference });
    assert.ok(rotation.svgDifference < 3, `${id}: SVG must preserve the live icon orientation (${rotation.svgDifference})`);
    assert.ok(rotation.figmaDifference < 3, `${id}: Figma vector must preserve the live icon orientation (${rotation.figmaDifference})`);
    assert.equal(rotation.warnings.some(warning => /rotation|transform/.test(warning)), false, 'Supported SVG transforms should not warn');
  }

  // Web Components render their shadow tree, with light children distributed
  // through named/default/forwarded slots. Export exactly that composed tree.
  await page.evaluate(() => {
    customElements.define('export-test-icon', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;width:20px;height:20px}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20"><path d="M2 10L8 16L18 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      }
    });
    customElements.define('export-test-button', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-block;color:#fbe35a}button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:210px;height:48px;padding:0 12px;border:0;border-radius:12px;background:#173f7a;color:inherit;font:600 16px Arial}#label{display:block}slot{color:#fbe35a}</style><button type="button"><slot name="icon"></slot><span id="label"><slot>Fallback label</slot></span></button>';
      }
    });
    customElements.define('export-test-inner', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;color:#264c23;font:14px Arial}span{display:block;padding-top:8px}</style><span><slot></slot></span>';
      }
    });
    customElements.define('export-test-forwarder', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:contents}</style><export-test-inner><slot></slot></export-test-inner>';
      }
    });
    customElements.define('export-test-zero', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;position:relative;width:0;height:0}div{position:absolute;left:10px;top:8px;width:120px;height:30px;background:#b45b2a;color:white;font:14px Arial}</style><div>Zero size</div>';
      }
    });
    document.body.innerHTML = '<div id="composed-root" style="box-sizing:border-box;width:460px;padding:16px;background:white;font:14px Arial"><export-test-button>Composed label<export-test-icon slot="icon"></export-test-icon><span slot="unused">Unslotted secret</span></export-test-button><export-test-button></export-test-button><export-test-forwarder>Forwarded once</export-test-forwarder></div><export-test-zero id="zero-root"></export-test-zero>';
  });
  const composed = await page.evaluate(async () => {
    const capture = await window.captureStory(document.querySelector('#composed-root'));
    const raster = await window.svgToPng(capture.svg, capture.width, capture.height);
    return { ...capture, pngSize: raster.size };
  });
  assert.equal(composed.design.nodes.filter(node => node.type === 'text' && node.text === 'Composed label').length, 1, 'Slotted text appears exactly once');
  assert.equal(composed.design.nodes.filter(node => node.type === 'text' && node.text === 'Forwarded once').length, 1, 'Forwarded slots do not duplicate nodes');
  assert.equal(composed.design.nodes.filter(node => node.type === 'text' && node.text === 'Fallback label').length, 1, 'Unused fallback is excluded while active fallback renders');
  assert.ok(composed.design.nodes.some(node => node.type === 'text' && node.text === 'Composed label' && node.color === '#fbe35a'), 'Slotted text uses the composed parent styles');
  assert.equal(composed.design.nodes.filter(node => node.type === 'rect' && node.fill === '#173f7a').length, 2, 'Shadow button backgrounds become native Figma shapes');
  assert.ok(composed.design.nodes.some(node => node.type === 'svg'), 'An SVG inside a slotted custom icon is preserved');
  assert.equal(/Unslotted secret/.test(JSON.stringify(composed)), false, 'Unslotted light DOM is never exported');
  assert.equal(/<export-test-|<slot[\s>]/.test(composed.html), false, 'HTML output uses ordinary elements instead of inert Web Components');
  assert.equal((composed.html.match(/Composed label/g) || []).length, 1);
  assert.equal((composed.html.match(/Forwarded once/g) || []).length, 1);
  assert.ok(composed.html.includes('rgb(23, 63, 122)'), 'Shadow styles are inlined into HTML');
  assert.ok(composed.pngSize > 1000, 'Composed-tree SVG rasterizes into meaningful PNG content');
  const plainSnapshot = await browser.newPage();
  await plainSnapshot.setContent(composed.html);
  assert.equal(await plainSnapshot.locator('button').count(), 2, 'HTML snapshot renders shadow buttons without custom-element registration');
  assert.equal(await plainSnapshot.locator('button').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(23, 63, 122)');
  assert.equal(await plainSnapshot.locator('button').first().evaluate(element => Math.round(element.getBoundingClientRect().width)), 210, 'HTML snapshot preserves computed component dimensions');
  await plainSnapshot.close();
  const zero = await page.evaluate(() => window.captureStory(document.querySelector('#zero-root')));
  assert.equal(zero.width, 120, 'A zero-size custom host uses its visible shadow descendant bounds');
  assert.equal(zero.height, 30);
  assert.ok(zero.design.nodes.some(node => node.type === 'rect' && node.fill === '#b45b2a' && node.x === 0 && node.y === 0));
  assert.ok(zero.design.nodes.some(node => node.type === 'text' && node.text === 'Zero size'));
  console.log(`Exporter browser tests passed: ${result.design.nodes.length} editable layers, ${result.pngSize} PNG bytes.`);
} finally { await browser.close(); }
