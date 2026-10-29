/** Header preferences switch views and language without reloading Stories. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
const bundle = await readFile('dist/content.js', 'utf8');
let completed = 0;
async function check(name, action) {
  await action();
  completed++;
  console.log(`✓ ${name}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.baseUrl}?path=/story/tabs--default`);
  // Non-default source styles, including priorities, must remain untouched
  // while Story is visible, after returning to Canvas, and on close.
  const originalBodyStyle = await page.evaluate(() => {
    document.body.style.cssText = 'min-height:12px!important;position:static;translate:none;height:93vh;overflow:auto;background-color:rgb(246,247,248)';
    const source = document.querySelector('#storybook-preview-iframe');
    window.__toggleRegression = { source, sourceWindow: source.contentWindow, sourceDocument: source.contentDocument };
    return document.body.getAttribute('style');
  });
  const sourceFrame = await page.locator('#storybook-preview-iframe').elementHandle().then(element => element.contentFrame());
  const documents = [];
  page.on('request', request => {
    if (request.resourceType() === 'document' && request.frame() === sourceFrame) documents.push(request.url());
  });
  await page.addScriptTag({ content: bundle });
  const library = page.locator('[data-story-library]');
  const language = value => library.locator(`[data-language="${value}"]`);
  const mode = value => library.locator(`[data-display-mode="${value}"]`);
  const search = library.locator('.sl-search input');
  await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
  await search.fill('tabs');
  await library.locator('.sl-card.sl-selected .sl-preview[data-state="ready"]').waitFor();
  await library.locator('[data-action="zoom-in"]').click();
  await page.waitForFunction(() => {
    const world = document.querySelector('[data-story-library]')?.shadowRoot.querySelector('.sl-canvas-world');
    return world && new DOMMatrixReadOnly(getComputedStyle(world).transform).a > 1;
  });
  await library.evaluate(host => {
    const root = host.shadowRoot;
    const inspector = root.querySelector('.sl-inspector-preview iframe');
    const canvas = root.querySelector('.sl-card.sl-selected iframe');
    host.__toggleRegression = {
      inspector, inspectorWindow: inspector.contentWindow, inspectorDocument: inspector.contentDocument,
      canvas, canvasWindow: canvas.contentWindow, canvasDocument: canvas.contentDocument,
      transform: getComputedStyle(root.querySelector('.sl-canvas-world')).transform,
      selectedStory: root.querySelector('.sl-card.sl-selected').dataset.story,
    };
  });
  const retainedCanvas = async () => library.evaluate(host => {
    const root = host.shadowRoot, previous = host.__toggleRegression;
    const inspector = root.querySelector('.sl-inspector-preview iframe');
    const canvas = root.querySelector('.sl-card.sl-selected iframe');
    return {
      inspector: inspector === previous.inspector && inspector.contentWindow === previous.inspectorWindow && inspector.contentDocument === previous.inspectorDocument,
      canvas: canvas === previous.canvas && canvas.contentWindow === previous.canvasWindow && canvas.contentDocument === previous.canvasDocument,
      camera: getComputedStyle(root.querySelector('.sl-canvas-world')).transform === previous.transform,
      selection: root.querySelector('.sl-card.sl-selected').dataset.story === previous.selectedStory,
      query: root.querySelector('.sl-search input').value,
    };
  });
  const unchangedCanvas = { inspector: true, canvas: true, camera: true, selection: true, query: 'tabs' };
  const retainedSource = async () => page.evaluate(() => {
    const before = window.__toggleRegression;
    const frame = document.querySelector('#storybook-preview-iframe');
    return frame === before.source && frame.contentWindow === before.sourceWindow && frame.contentDocument === before.sourceDocument;
  });
  const sourceGeometry = async () => page.evaluate(() => {
    const rect = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { body: rect(document.body), source: rect(document.querySelector('#storybook-preview-iframe')), style: document.body.getAttribute('style') };
  });
  const floatingModesOnly = async () => {
    assert.equal(await library.locator('.sl-header').isVisible(), false, 'Story hides the complete header background');
    const visibleControls = await library.locator('.sl-header button:visible, .sl-header a:visible').evaluateAll(elements => elements.map(element => element.dataset.displayMode || element.dataset.action || element.tagName));
    assert.deepEqual(visibleControls, ['story', 'canvas'], 'Only the Story/Canvas controls remain visible');
    assert.equal(await language('ja').isVisible(), false);
    assert.equal(await language('en').isVisible(), false);
    const floating = await library.locator('.sl-mode-toggle').evaluate(element => {
      const { top, right } = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top, right, viewportWidth: innerWidth, position: style.position, shadow: style.boxShadow };
    });
    assert.equal(floating.position, 'fixed');
    assert.ok(Math.abs(floating.top - 12) < 1 && Math.abs(floating.viewportWidth - floating.right - 12) < 1, JSON.stringify(floating));
    assert.notEqual(floating.shadow, 'none');
  };

  await check('日本語 and English update navigation in place without resetting Canvas', async () => {
    assert.equal(await language('ja').getAttribute('aria-pressed'), 'true');
    await language('en').click();
    assert.equal(await language('en').getAttribute('aria-pressed'), 'true');
    assert.equal(await language('ja').getAttribute('aria-pressed'), 'false');
    assert.equal(await library.locator('.sl-primary-nav [data-view="all"] span').textContent(), 'All components');
    assert.equal(await library.locator('.sl-primary-nav [data-view="favorites"] span').textContent(), 'Favorites');
    assert.equal(await search.getAttribute('placeholder'), 'Search components');
    assert.equal(await search.getAttribute('aria-label'), 'Search components');
    assert.equal(await library.locator('.sl-inspector-title > span').first().textContent(), 'Design');
    assert.deepEqual(await retainedCanvas(), unchangedCanvas);
    await language('ja').click();
    assert.equal(await library.locator('.sl-primary-nav [data-view="all"] span').textContent(), 'すべてのコンポーネント');
    assert.equal(await search.getAttribute('placeholder'), 'コンポーネントを検索');
    assert.deepEqual(await retainedCanvas(), unchangedCanvas);
  });

  await check('Story shows only floating mode controls without moving the existing Storybook', async () => {
    await language('en').click();
    const originalGeometry = await sourceGeometry();
    await mode('story').click();
    assert.equal(await mode('story').getAttribute('aria-pressed'), 'true');
    const sourceState = await library.evaluate(host => {
      const root = host.shadowRoot, layout = root.querySelector('.sl-layout');
      return {
        mode: host.classList.contains('sl-story-mode'), inert: layout.inert,
        hidden: layout.getAttribute('aria-hidden'), visibility: getComputedStyle(layout).visibility,
        modal: root.querySelector('.sl-app').getAttribute('aria-modal'),
      };
    });
    assert.equal(sourceState.mode, true);
    assert.equal(sourceState.inert, true);
    assert.equal(sourceState.hidden, 'true');
    assert.equal(sourceState.visibility, 'hidden');
    assert.equal(sourceState.modal, null);
    await floatingModesOnly();
    assert.deepEqual(await sourceGeometry(), originalGeometry, 'Story mode must not resize or shift the source page');
    assert.equal(await page.locator('body').getAttribute('style'), originalBodyStyle);
    assert.equal(await retainedSource(), true);
    await page.frameLocator('#storybook-preview-iframe').getByRole('tab', { name: 'Activity', exact: true }).click();
    assert.equal(await page.frameLocator('#storybook-preview-iframe').getByRole('tabpanel').textContent(), 'Activity content');
    assert.equal(await retainedSource(), true);
    assert.equal(await mode('story').getAttribute('aria-pressed'), 'true');
    await mode('canvas').click();
    assert.equal(await mode('canvas').getAttribute('aria-pressed'), 'true');
    assert.equal(await library.locator('.sl-layout').evaluate(element => element.inert), false);
    assert.equal(await library.locator('.sl-layout').isVisible(), true);
    assert.equal(await library.locator('.sl-header').isVisible(), true);
    assert.equal(await language('ja').isVisible(), true);
    assert.equal(await language('en').isVisible(), true);
    assert.equal(await language('en').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await sourceGeometry(), originalGeometry);
    assert.equal(await page.locator('body').getAttribute('style'), originalBodyStyle);
    assert.deepEqual(await retainedCanvas(), unchangedCanvas);
    assert.equal(await retainedSource(), true);
    assert.deepEqual(documents, [], 'Switching modes never reloads the original Storybook iframe');
  });

  await check('375px Canvas keeps both toggles and Story shows only floating modes', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const header = await library.locator('.sl-header').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, background: getComputedStyle(element).backgroundColor };
    });
    assert.ok(header.left >= 0 && header.right <= 375 && header.scrollWidth <= 375, JSON.stringify(header));
    const channels = header.background.match(/[\d.]+/g).slice(0, 3).map(Number);
    assert.ok(channels.every(value => value < 80), `Header should remain dark: ${header.background}`);
    const bounds = [];
    for (const button of [language('ja'), language('en'), mode('story'), mode('canvas')]) {
      assert.equal(await button.isVisible(), true);
      const rect = await button.boundingBox();
      assert.ok(rect && rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= 375, JSON.stringify(rect));
      bounds.push(rect);
    }
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i], b = bounds[j];
      assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, 'The header toggles must not overlap');
    }
    const originalGeometry = await sourceGeometry();
    await mode('story').click();
    await floatingModesOnly();
    assert.deepEqual(await sourceGeometry(), originalGeometry);
    assert.equal(await retainedSource(), true);
    await mode('canvas').click();
    assert.equal(await language('ja').isVisible(), true);
    assert.equal(await language('en').isVisible(), true);
    assert.deepEqual(await sourceGeometry(), originalGeometry);
  });

  await check('Escape closes Story without changing source styles and English persists', async () => {
    await page.waitForFunction(() => localStorage.getItem('story-library-language') === 'en');
    const originalGeometry = await sourceGeometry();
    await mode('story').click();
    await mode('story').focus();
    await mode('story').press('Escape');
    await library.waitFor({ state: 'detached' });
    assert.deepEqual(await sourceGeometry(), originalGeometry);
    assert.equal(await page.locator('body').getAttribute('style'), originalBodyStyle);
    assert.equal(await retainedSource(), true);
    assert.deepEqual(documents, []);
    await page.reload();
    await page.addScriptTag({ content: bundle });
    await library.locator('[data-language="en"][aria-pressed="true"]').waitFor();
    assert.equal(await library.locator('.sl-primary-nav [data-view="all"] span').textContent(), 'All components');
    assert.equal(await search.getAttribute('placeholder'), 'Search components');
    assert.equal(await mode('canvas').getAttribute('aria-pressed'), 'true', 'A fresh mount starts on Canvas');
    await library.locator('.sl-header [data-action="close"]').click();
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join('\n')}`);
  console.log(`\n${completed} library-toggle browser checks passed.`);
} finally {
  await browser.close();
  await fixture.close();
}
