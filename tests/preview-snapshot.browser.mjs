import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/preview-snapshot.js'], bundle: true, format: 'iife', globalName: 'StorySnapshots', write: false });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body style="background:#eee;margin:20px"><iframe id="preview" style="width:600px;height:300px"></iframe></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(async () => {
    const iframe = document.querySelector('#preview');
    const doc = iframe.contentDocument;
    doc.open();
    doc.write('<!doctype html><style>body{margin:24px}#root{box-sizing:border-box;width:400px;height:160px;padding:40px;background:white}</style><div id="root"><snapshot-button>コピー</snapshot-button></div>');
    doc.close();
    iframe.contentWindow.customElements.define('snapshot-button', class extends iframe.contentWindow.HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-block}button{display:block;box-sizing:border-box;width:120px;height:40px;border:0;border-radius:0;padding:0;background:#8a38f5;color:white;font:16px Arial}</style><button onclick="alert(1)"><slot></slot></button>';
      }
    });
    const root = doc.querySelector('#root');
    const button = root.querySelector('snapshot-button').shadowRoot.querySelector('button');
    const bounds = () => {
      const { left, top, right, bottom } = button.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const full = await StorySnapshots.snapshotPreview(root, { storyId: 'button--default' });
    const cropped = await StorySnapshots.snapshotPreview(root, { storyId: 'button--default', tightBounds: bounds() });
    root.style.display = 'contents';
    const zero = await StorySnapshots.snapshotPreview(root, { storyId: 'button--zero-root', tightBounds: bounds() });
    const readSvg = async snapshot => await (await fetch(snapshot.src)).text();
    const fullSvg = await readSvg(full);
    const croppedSvg = await readSvg(cropped);
    const zeroSvg = await readSvg(zero);
    iframe.remove();
    let detachedRejected = false;
    try { await StorySnapshots.snapshotPreview(root, { storyId: 'gone' }); } catch { detachedRejected = true; }
    const images = [];
    for (const [name, snapshot] of [['cropped', cropped], ['zero', zero]]) {
      const image = new Image();
      image.id = `snapshot-${name}`;
      image.src = snapshot.src;
      await image.decode();
      document.body.append(image);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      images.push({ name, width: image.naturalWidth, height: image.naturalHeight, cornerPixel: [...context.getImageData(5, 5, 1, 1).data] });
    }
    return {
      full: { width: full.width, height: full.height, viewBox: new DOMParser().parseFromString(fullSvg, 'image/svg+xml').documentElement.getAttribute('viewBox') },
      cropped: { width: cropped.width, height: cropped.height, viewBox: new DOMParser().parseFromString(croppedSvg, 'image/svg+xml').documentElement.getAttribute('viewBox') },
      zero: { width: zero.width, height: zero.height, viewBox: new DOMParser().parseFromString(zeroSvg, 'image/svg+xml').documentElement.getAttribute('viewBox') },
      images, detachedRejected, unicodePreserved: croppedSvg.includes('コピー'), scriptRemoved: !/onclick|<script/.test(croppedSvg), usesRenderedHtml: croppedSvg.includes('foreignObject'), warnings: cropped.warnings,
    };
  });
  assert.deepEqual(results.full, { width: 400, height: 160, viewBox: '0 0 400 160' });
  assert.deepEqual(results.cropped, { width: 120, height: 40, viewBox: '40 40 120 40' });
  assert.deepEqual(results.zero, { width: 120, height: 40, viewBox: '0 0 120 40' });
  for (const image of results.images) {
    assert.equal(image.width, 120);
    assert.equal(image.height, 40);
    assert.deepEqual(image.cornerPixel, [138, 56, 245, 255], 'The wrapper padding should not be visible in a cropped snapshot');
  }
  assert.equal(results.unicodePreserved, true);
  assert.equal(results.scriptRemoved, true);
  assert.equal(results.usesRenderedHtml, true);
  assert.equal(results.detachedRejected, true);
  // Visual-cache fidelity differs intentionally from editable vector export:
  // an inset shadow is a real border for many design-system components.
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.id = 'visual-fixture'; document.body.append(iframe);
    const doc = iframe.contentDocument;
    doc.open(); doc.write('<!doctype html><body style="margin:20px"><div id="badge-root" style="width:160px"><span id="badge" style="display:block;margin-top:40px;box-sizing:border-box;width:160px;height:44px;line-height:44px;text-align:center;font:700 14px/44px Arial;color:#21123a;background:linear-gradient(#f9f0ff,#d7c1fa);box-shadow:inset 0 0 0 2px #8a38f5;border-radius:4px">Outline ああ</span></div></body>'); doc.close();
  });
  const reference = (await page.frameLocator('#visual-fixture').locator('#badge-root').screenshot({ omitBackground: true })).toString('base64');
  const fidelity = await page.evaluate(async reference => {
    const iframe = document.querySelector('#visual-fixture');
    const capture = await StorySnapshots.snapshotPreview(iframe.contentDocument.querySelector('#badge-root'), { storyId: 'badge--outline' });
    iframe.remove();
    async function pixels(src) {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 44;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, 160, 44).data;
    }
    const actual = await pixels(capture.src);
    const expected = await pixels(`data:image/png;base64,${reference}`);
    const index = (22 * 160) * 4;
    const image = new Image(); image.id = 'snapshot-outline'; image.src = capture.src; document.body.append(image); await image.decode();
    return { pixelDifference: actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length, insetBorder: [...actual.slice(index, index + 4)], warnings: capture.warnings };
  }, reference);
  assert.ok(fidelity.pixelDifference < 1, `Snapshot should visually match inset border, gradient and text (${fidelity.pixelDifference})`);
  assert.deepEqual(fidelity.insetBorder, [138, 56, 245, 255]);
  results.fidelity = fidelity;
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'select-fixture';
    select.style.cssText = 'display:block;width:160px;height:36px;font:16px Arial;margin:0';
    select.innerHTML = '<option value="initial" selected>Initial value</option><option value="current">Current value</option>';
    document.body.append(select); select.value = 'current';
  });
  const selectReference = (await page.locator('#select-fixture').screenshot({ omitBackground: true })).toString('base64');
  const selectState = await page.evaluate(async reference => {
    const element = document.querySelector('#select-fixture');
    const snapshot = await StorySnapshots.snapshotPreview(element, { storyId: 'select--edited' });
    const source = await (await fetch(snapshot.src)).text();
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    async function pixels(src) {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 36;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, 160, 36).data;
    }
    const actual = await pixels(snapshot.src), expected = await pixels(`data:image/png;base64,${reference}`);
    return { selectedValue: parsed.querySelector('option[selected]')?.getAttribute('value'), pixelDifference: actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length };
  }, selectReference);
  assert.equal(selectState.selectedValue, 'current', 'Snapshot should retain the live select option instead of its initial markup value');
  assert.ok(selectState.pixelDifference < 2, `Live select selection should look the same (${selectState.pixelDifference})`);
  results.select = selectState;

  // Use Playwright's bundled icon font as a local deterministic web-font
  // fixture. The remote-looking stylesheet is fulfilled locally: its CSSOM is
  // cross-origin, just like Spectrum's Typekit stylesheet, without networking.
  const fontDirectory = new URL('../node_modules/playwright-core/lib/vite/recorder/assets/', import.meta.url);
  const fontName = (await readdir(fontDirectory)).find(name => /^codicon-.*\.ttf$/.test(name));
  const fontBytes = await readFile(new URL(fontName, fontDirectory));
  let fontRequests = 0;
  await page.route('https://fonts.snapshot.test/**', async route => {
    fontRequests++;
    const css = route.request().url().endsWith('.css');
    await route.fulfill({ status: 200, contentType: css ? 'text/css' : 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: css ? '@font-face{font-family:SnapshotFixture;src:url("./fixture.ttf") format("truetype");font-weight:400;font-style:normal}' : fontBytes });
  });
  await page.evaluate(async () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'font-fixture'; iframe.style.cssText = 'display:block;width:500px;height:120px'; document.body.append(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write('<!doctype html><link rel="stylesheet" href="https://fonts.snapshot.test/fixture.css"><style>body{margin:20px}#font-root{display:inline-block;background:#b5d1d3;padding:14px 20px;font:18px SnapshotFixture,sans-serif}</style><div id="font-root"><font-button>\ueab6 \ueab7</font-button> <font-button>\uea60 \uea61</font-button></div>');
    doc.close();
    iframe.contentWindow.customElements.define('font-button', class extends iframe.contentWindow.HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-flex;box-sizing:border-box;align-items:center;height:38px;padding:0 14px;border:2px solid transparent;border-radius:20px;background:#101918;color:white;font:18px SnapshotFixture,sans-serif}span{display:block;line-height:22px}</style><span><slot></slot></span>';
      }
    });
    const link = doc.querySelector('link');
    if (!link.sheet) await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; });
    await doc.fonts.load('18px SnapshotFixture');
    await doc.fonts.ready;
  });
  const fontReference = (await page.frameLocator('#font-fixture').locator('#font-root').screenshot({ omitBackground: true })).toString('base64');
  const fontState = await page.evaluate(async reference => {
    const iframe = document.querySelector('#font-fixture');
    const doc = iframe.contentDocument;
    let crossOriginSheet = false;
    try { [...doc.styleSheets].find(sheet => sheet.href)?.cssRules; } catch { crossOriginSheet = true; }
    const snapshot = await StorySnapshots.snapshotPreview(doc.querySelector('#font-root'), { storyId: 'web-component--web-font' });
    const source = await (await fetch(snapshot.src)).text();
    iframe.remove();
    async function pixels(src) {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = snapshot.width; canvas.height = snapshot.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const actual = await pixels(snapshot.src), expected = await pixels(`data:image/png;base64,${reference}`);
    const image = new Image(); image.id = 'snapshot-web-font'; image.src = snapshot.src; document.body.append(image); await image.decode();
    return { crossOriginSheet, embeddedFaces: (source.match(/@font-face/g) || []).length, selfContained: source.includes('data:font/ttf;base64,') && !source.includes('https://fonts.snapshot.test'), pixelDifference: actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length, warnings: snapshot.warnings };
  }, fontReference);
  assert.equal(fontState.crossOriginSheet, true, 'The fixture should exercise inaccessible cross-origin stylesheet CSSOM');
  assert.equal(fontState.embeddedFaces, 1);
  assert.equal(fontState.selfContained, true, 'The cached image must retain its fonts after its source iframe is gone');
  assert.deepEqual(fontState.warnings, []);
  assert.ok(fontState.pixelDifference < 2, `Web Component labels should retain their font metrics and wrapping (${fontState.pixelDifference})`);
  assert.equal(fontRequests, 4, 'Only the source page and snapshot capture should fetch the stylesheet/font; displaying the cache makes no requests');
  results.webFont = fontState;
  await mkdir('artifacts', { recursive: true });
  await page.locator('#snapshot-cropped').screenshot({ path: 'artifacts/preview-snapshot.png' });
  await page.locator('#snapshot-outline').screenshot({ path: 'artifacts/preview-snapshot-outline.png' });
  await page.locator('#snapshot-web-font').screenshot({ path: 'artifacts/preview-snapshot-web-font.png' });
  await writeFile('artifacts/preview-snapshot-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
