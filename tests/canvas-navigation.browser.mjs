/** Frame traversal, navigation aliases and keyboard isolation in the shipped canvas. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
let completed = 0;
async function check(name, action) { await action(); completed++; console.log(`✓ ${name}`); }

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.baseUrl}?path=/story/button--sizes`);
  await page.evaluate(() => {
    window.__navigationCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => window.__navigationCopies.push({ text }),
      write: async items => {
        for (const item of items) for (const type of item.types) {
          const blob = await item.getType(type);
          window.__navigationCopies.push({ type, size: blob.size });
        }
      },
    } });
  });
  await page.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const canvas = library.locator('.sl-canvas');
  const search = library.locator('.sl-search input');
  const selected = library.locator('.sl-card.sl-selected');
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const press = async key => { await canvas.focus(); await page.keyboard.press(key); await paint(); };
  const identity = card => card.evaluate(element => ({ story: element.dataset.story, example: element.dataset.example || '' }));
  const order = () => library.locator('.sl-card').evaluateAll(cards => cards.map(element => ({ story: element.dataset.story, example: element.dataset.example || '' })));
  const camera = () => library.locator('.sl-canvas-world').evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const ready = () => library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
  const selectedFits = async () => {
    const fit = await selected.evaluate(element => {
      const card = element.getBoundingClientRect(), viewport = element.getRootNode().querySelector('.sl-canvas').getBoundingClientRect();
      return { inside: card.left >= viewport.left - 1 && card.top >= viewport.top - 1 && card.right <= viewport.right + 1 && card.bottom <= viewport.bottom + 1, story: element.dataset.story, example: element.dataset.example, card: card.toJSON(), viewport: viewport.toJSON() };
    });
    assert.equal(fit.inside, true, `The traversed card must fit entirely inside the canvas: ${JSON.stringify(fit)}`);
  };
  const dispatch = (locator, options) => locator.evaluate((element, options) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
  await ready();
  await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card[data-story="button--sizes"][data-example]:not([data-example=""])').length === 3);
  await paint();

  await check('N and Shift+N traverse every rendered card and example in DOM order, including wraparound', async () => {
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    await paint();
    const cards = await order();
    assert.equal(cards.length, 20, 'Async size samples add two cards to the 18 Story fixture');
    assert.equal(cards.filter(card => card.story === 'button--sizes').length, 3);
    await press('Escape');
    assert.equal(await selected.count(), 0);
    for (const expected of cards) {
      await press('n');
      assert.deepEqual(await identity(selected), expected);
      await selectedFits();
    }
    await press('n');
    assert.deepEqual(await identity(selected), cards[0], 'Next wraps from last to first');
    await press('Shift+n');
    assert.deepEqual(await identity(selected), cards.at(-1), 'Previous wraps from first to last');
    await press('Escape');
    await press('Shift+n');
    assert.deepEqual(await identity(selected), cards.at(-1), 'Previous with no selection starts at the last card');
  });

  await check('Home and End traverse within the current group while keeping independent example selection', async () => {
    await library.locator('[data-group="Forms/Button"]').click();
    await paint();
    const cards = await order();
    assert.equal(cards.length, 6);
    await page.keyboard.press('n');
    await paint();
    assert.deepEqual(await identity(selected), cards[1], 'A group click leaves the canvas ready for N without another click');
    await press('Escape');
    await press('End');
    assert.deepEqual(await identity(selected), cards[0]);
    await press('Home');
    assert.deepEqual(await identity(selected), cards.at(-1));
    await press('Home');
    assert.deepEqual(await identity(selected), cards.at(-2));
    assert.equal(await library.locator('#sl-example-select').inputValue(), cards.at(-2).example);
    await press('End');
    assert.deepEqual(await identity(selected), cards.at(-1));
    await selectedFits();
  });

  await check('search and favorites restrict traversal; empty results leave the camera and selection unchanged', async () => {
    await search.fill('secondary');
    await paint();
    assert.equal(await library.locator('.sl-card').count(), 1);
    await press('n');
    assert.deepEqual(await identity(selected), { story: 'button--secondary', example: '' });
    await press('Shift+n');
    assert.deepEqual(await identity(selected), { story: 'button--secondary', example: '' });
    await search.fill('does-not-match-any-component');
    await paint();
    const emptyCamera = await camera();
    for (const key of ['n', 'Shift+n', 'Home', 'End']) await press(key);
    assert.deepEqual(await camera(), emptyCamera);
    assert.equal(await selected.count(), 0);
    await library.locator('[data-action="clear-search"]').click();
    await library.locator('[data-group="Forms/Button"]').click();
    await paint();
    await press('n');
    const favorite = library.locator('.sl-inspector [data-favorite="Forms/Button"]');
    if (await favorite.getAttribute('aria-pressed') !== 'true') await favorite.click();
    await library.locator('.sl-primary-nav [data-view="favorites"]').click();
    await paint();
    const favorites = await order();
    assert.equal(favorites.length, 6);
    assert.ok(favorites.every(card => card.story.startsWith('button--')));
    await press('Escape');
    for (const expected of favorites) {
      await press('n');
      assert.deepEqual(await identity(selected), expected);
    }
    await press('n');
    assert.deepEqual(await identity(selected), favorites[0]);
  });

  await check('unselected arrows pan, Shift+arrows pan faster and preserve selection', async () => {
    await library.locator('[data-group="Navigation/Tabs"]').click();
    await ready();
    await paint();
    await press('Escape');
    const before = await camera();
    await press('ArrowRight');
    const normal = await camera();
    assert.ok(Math.abs(Math.abs(normal.x - before.x) - 40) < .01);
    assert.equal(normal.y, before.y);
    assert.equal(normal.scale, before.scale);
    assert.equal(await selected.count(), 0);
    await press('Shift+ArrowRight');
    const fast = await camera();
    assert.ok(Math.abs(Math.abs(fast.x - normal.x) - 160) < .01);
    await press('n');
    await ready();
    const current = await identity(selected), selectedCamera = await camera();
    await press('Shift+ArrowDown');
    const shifted = await camera();
    assert.deepEqual(await identity(selected), current);
    assert.ok(Math.abs(Math.abs(shifted.y - selectedCamera.y) - 160) < .01);
    assert.equal(shifted.scale, selectedCamera.scale);
  });

  await check('preview, search, PNG copy and export-menu aliases invoke their existing actions', async () => {
    await press('Shift+Space');
    await library.locator('.sl-preview-modal').waitFor();
    await page.keyboard.press('Escape');
    for (const key of ['Control+f', 'Meta+f']) {
      await press(key);
      assert.equal(await search.evaluate(input => input.getRootNode().activeElement === input), true);
      await page.keyboard.press('Escape');
    }
    await press('Control+Shift+c');
    await page.waitForFunction(() => window.__navigationCopies.some(copy => copy.type === 'image/png'));
    const png = await page.evaluate(() => window.__navigationCopies.find(copy => copy.type === 'image/png'));
    assert.ok(png.size > 100, 'PNG shortcut must produce actual image data');
    await press('Meta+Shift+e');
    await library.locator('.sl-copy-menu').waitFor({ state: 'visible' });
    assert.ok(await library.locator('.sl-copy-menu [data-export]').count() >= 5);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('.sl-copy-menu').isVisible(), false);
  });

  await check('inputs, native controls, composition, modifiers and live Story controls own their keys', async () => {
    const before = await camera(), current = await identity(selected);
    const navigationKeys = [{ key: 'n', code: 'KeyN' }, { key: 'N', code: 'KeyN', shiftKey: true }, { key: 'Home' }, { key: 'End' }];
    for (const options of navigationKeys) assert.equal(await dispatch(search, options), false);
    const favorite = library.locator('.sl-inspector [data-favorite="Navigation/Tabs"]');
    for (const options of navigationKeys) assert.equal(await dispatch(favorite, options), false, 'Native controls retain unrecognized keys');
    for (const options of [
      { key: 'n', ctrlKey: true }, { key: 'n', metaKey: true }, { key: 'N', metaKey: true, shiftKey: true },
      { key: 'n', altKey: true }, { key: 'n', isComposing: true }, { key: 'n', keyCode: 229 },
    ]) assert.equal(await dispatch(canvas, options), false);
    const previewTab = library.frameLocator('.sl-inspector-preview iframe').getByRole('tab', { name: 'Activity', exact: true });
    for (const key of ['n', 'Shift+n', 'Home', 'End']) await previewTab.press(key);
    assert.deepEqual(await camera(), before);
    assert.deepEqual(await identity(selected), current);
    await search.focus();
    await page.keyboard.type('nN');
    assert.equal(await search.inputValue(), 'nN', 'N remains ordinary text inside search');
    await search.fill('');
    await paint();
  });

  await check('Story mode preserves the Canvas camera and selection without capturing new shortcuts', async () => {
    await library.locator('[data-group="Navigation/Tabs"]').click();
    await ready();
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card .sl-preview[data-state="ready"]').length === 2);
    await paint();
    const before = await camera(), current = await identity(selected);
    await library.locator('[data-display-mode="story"]').click();
    const storyToggle = library.locator('[data-display-mode="story"]');
    for (const options of [
      { key: 'n' }, { key: 'N', shiftKey: true }, { key: 'Home' }, { key: 'End' },
      { key: ' ', code: 'Space', shiftKey: true }, { key: 'f', ctrlKey: true },
      { key: 'C', ctrlKey: true, shiftKey: true }, { key: 'E', metaKey: true, shiftKey: true },
      { key: 'ArrowDown', shiftKey: true },
    ]) assert.equal(await dispatch(storyToggle, options), false);
    assert.deepEqual(await camera(), before);
    assert.deepEqual(await identity(selected), current);
    assert.equal(await library.locator('.sl-modal-backdrop').count(), 0);
    await library.locator('[data-display-mode="canvas"]').click();
    assert.deepEqual(await camera(), before);
    assert.deepEqual(await identity(selected), current);
    const cards = await order();
    await page.keyboard.press('n');
    await paint();
    assert.deepEqual(await identity(selected), cards[1], 'Returning from Story focuses Canvas so N works immediately');
  });

  await check('Japanese and English shortcut lists include traversal and fit the mobile dialog', async () => {
    for (const language of ['ja', 'en']) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await library.locator(`[data-language="${language}"]`).click();
      await press('?');
      const dialog = library.locator('.sl-shortcuts-modal');
      await dialog.waitFor();
      const text = await dialog.textContent();
      assert.match(text, /N/);
      assert.match(text, /PNG/);
      assert.ok(await dialog.locator('li').count() >= 20, 'The additional commands are discoverable in help');
      await page.setViewportSize({ width: 375, height: 812 });
      await paint();
      const metrics = await dialog.evaluate(element => ({
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        rows: [...element.querySelectorAll('li')].map(row => ({ width: row.clientWidth, scrollWidth: row.scrollWidth })),
      }));
      assert.ok(metrics.left >= 0 && metrics.right <= 375, JSON.stringify(metrics));
      assert.equal(metrics.scrollWidth, metrics.width, 'Mobile help must not overflow horizontally');
      assert.ok(metrics.rows.every(row => row.scrollWidth <= row.width + 1), JSON.stringify(metrics.rows));
      await page.keyboard.press('Escape');
    }
  });

  await check('manual zoom and pan cancel pending frame-fit while a cold preview is still loading', async () => {
    const cold = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let sawPreview;
    const intercepted = new Promise(resolve => { sawPreview = resolve; });
    await cold.route('**/iframe.html?*', async route => {
      if (new URL(route.request().url()).searchParams.get('id') === 'accordion--default') {
        sawPreview();
        await gate;
      }
      await route.continue();
    });
    try {
      await cold.goto(`${fixture.baseUrl}?path=/story/button--primary`);
      await cold.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
      const coldLibrary = cold.locator('[data-story-library]');
      await coldLibrary.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
      await coldLibrary.locator('[data-group="Disclosure/Accordion"]').click();
      await cold.keyboard.press('Escape');
      await cold.keyboard.press('n');
      assert.equal(await coldLibrary.locator('.sl-card.sl-selected').getAttribute('data-story'), 'accordion--default');
      await Promise.race([intercepted, new Promise((_, reject) => setTimeout(() => reject(new Error('Cold Accordion preview was never requested')), 5000))]);
      await cold.keyboard.press('-');
      await cold.keyboard.press('Shift+ArrowRight');
      const readCamera = () => coldLibrary.locator('.sl-canvas-world').evaluate(element => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, scale: matrix.a };
      });
      const manual = await readCamera();
      release();
      await coldLibrary.locator('.sl-card.sl-selected .sl-preview[data-state="ready"]').waitFor();
      await coldLibrary.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
      await cold.waitForFunction(() => {
        const card = document.querySelector('[data-story-library]')?.shadowRoot.querySelector('.sl-card.sl-selected');
        return card && parseFloat(card.style.width) > 400;
      });
      await cold.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const afterLoad = await readCamera();
      assert.equal(afterLoad.scale, manual.scale, 'Loading a larger frame must not override the user’s zoom');
      assert.equal(afterLoad.x, manual.x, 'Loading a larger frame must not recenter after the user pans');
    } finally {
      release();
      await cold.close();
    }
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join('\n')}`);
  console.log(`\n${completed} canvas-navigation browser checks passed.`);
} finally {
  await browser.close();
  await fixture.close();
}
