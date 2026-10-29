/** Temporary zoom gestures against the exact extension bundle and browser events. */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} ≈ ${expected}`);
let completed = 0;
const check = async (name, callback) => { await callback(); completed++; console.log(`✓ ${name}`); };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.baseUrl}?path=/story/button--primary`);
  await page.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const canvas = library.locator('.sl-canvas');
  const world = library.locator('.sl-canvas-world');
  const camera = () => world.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const cursor = () => canvas.evaluate(element => getComputedStyle(element).cursor);
  await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
  await library.locator('[data-action="zoom-reset"]').click();

  await check('Z click anchors zoom, Alt reverses it, and release restores the hand tool', async () => {
    await canvas.focus();
    await page.keyboard.press('h');
    const bounds = await canvas.boundingBox();
    const point = { x: bounds.width * 0.55, y: bounds.height * 0.45 };
    await page.mouse.move(bounds.x + point.x, bounds.y + point.y);
    const initial = await camera();
    const selected = await library.locator('#sl-variant-select').inputValue();
    await page.keyboard.down('z');
    assert.equal(await cursor(), 'zoom-in');
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    const zoomed = await camera();
    near(zoomed.scale, initial.scale * 1.25, 'Z click scale');
    near((point.x - zoomed.x) / zoomed.scale, (point.x - initial.x) / initial.scale, 'X anchor');
    near((point.y - zoomed.y) / zoomed.scale, (point.y - initial.y) / initial.scale, 'Y anchor');
    await page.keyboard.down('Alt');
    assert.equal(await cursor(), 'zoom-out');
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    const restored = await camera();
    near(restored.scale, initial.scale, 'Alt reverses scale');
    near(restored.x, initial.x, 'Alt reverses X');
    near(restored.y, initial.y, 'Alt reverses Y');
    await page.keyboard.up('Alt');
    await page.keyboard.up('z');
    assert.equal(await cursor(), 'grab');
    assert.equal(await library.locator('#sl-variant-select').inputValue(), selected, 'Zoom gestures preserve selected story');
    await page.keyboard.press('v');
    assert.equal(await cursor(), 'default');
  });

  await check('Z drag draws a marquee and fits its area without changing selection', async () => {
    const bounds = await canvas.boundingBox();
    const start = { x: Math.round(bounds.width * 0.3), y: Math.round(bounds.height * 0.3) };
    const end = { x: Math.round(bounds.width * 0.7), y: Math.round(bounds.height * 0.6) };
    const initial = await camera();
    const selected = await library.locator('#sl-variant-select').inputValue();
    await page.keyboard.down('z');
    await page.mouse.move(bounds.x + start.x, bounds.y + start.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + end.x, bounds.y + end.y, { steps: 5 });
    assert.equal(await library.locator('[data-canvas-zoom-marquee]').count(), 1);
    assert.deepEqual(await camera(), initial, 'Camera remains still until release');
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/canvas-zoom-marquee.png', animations: 'disabled' });
    await page.mouse.up();
    assert.equal(await library.locator('[data-canvas-zoom-marquee]').count(), 0);
    const fitted = await camera();
    const expectedScale = Math.min(3, (bounds.width - 48) / ((end.x - start.x) / initial.scale), (bounds.height - 48) / ((end.y - start.y) / initial.scale));
    near(fitted.scale, expectedScale, 'Marquee fit scale');
    near((((start.x + end.x) / 2 - initial.x) / initial.scale) * fitted.scale + fitted.x, bounds.width / 2, 'Marquee centered X');
    near((((start.y + end.y) / 2 - initial.y) / initial.scale) * fitted.scale + fitted.y, bounds.height / 2, 'Marquee centered Y');
    await page.keyboard.up('z');
    assert.equal(await cursor(), 'default');
    assert.equal(await library.locator('#sl-variant-select').inputValue(), selected);
  });

  await check('Escape cancels a live marquee and release cannot zoom afterward', async () => {
    const bounds = await canvas.boundingBox();
    const initial = await camera();
    await page.keyboard.down('z');
    await page.mouse.move(bounds.x + 100, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 300, bounds.y + 250, { steps: 3 });
    assert.equal(await library.locator('[data-canvas-zoom-marquee]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('[data-canvas-zoom-marquee]').count(), 0);
    await page.mouse.up();
    await page.keyboard.up('z');
    assert.deepEqual(await camera(), initial);
    assert.equal(await cursor(), 'default');
  });

  await check('Shift Space reaches preview while Z typing and native controls remain untouched', async () => {
    await library.locator('[data-group="Forms/Button"]').click();
    await library.locator('#sl-variant-select').selectOption('button--secondary');
    await canvas.focus();
    await page.keyboard.press('Shift+Space');
    await library.locator('.sl-preview-modal').waitFor();
    assert.notEqual(await cursor(), 'grab', 'Shift Space does not enable temporary pan');
    await page.keyboard.press('Escape');
    await library.locator('.sl-preview-modal').waitFor({ state: 'detached' });
    const search = library.getByRole('searchbox');
    await search.fill('');
    await search.press('z');
    assert.equal(await search.inputValue(), 'z');
    assert.equal(await cursor(), 'default');
    await search.fill('');
    await library.locator('[data-action="zoom-fit"]').click();
    await canvas.focus();
    await page.keyboard.down('z');
    const previous = await camera();
    await library.locator('[data-action="zoom-reset"]').click();
    near((await camera()).scale, 1, 'Native zoom-reset button still acts');
    assert.notEqual(previous.scale, 1, 'Reset check begins at a distinct fit scale');
    await page.keyboard.up('z');
    assert.equal(await cursor(), 'default');
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join(', ')}`);
  console.log(`\n${completed} canvas zoom browser checks passed.`);
} finally {
  await browser.close();
  await fixture.close();
}
