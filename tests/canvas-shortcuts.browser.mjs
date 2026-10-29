/** Canvas tools and shortcuts stay scoped to the canvas, not text or Stories. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
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
  await page.evaluate(() => {
    window.__shortcutCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__shortcutCopies.push(text) } });
  });
  await page.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const canvas = library.locator('.sl-canvas');
  const world = library.locator('.sl-canvas-world');
  const search = library.locator('.sl-search input');
  const tool = name => library.locator(`button[data-canvas-tool="${name}"]`);
  const action = name => library.locator(`[data-action="${name}"]:visible`).first();
  const selectedStory = () => library.locator('.sl-card.sl-selected').getAttribute('data-story');
  const camera = () => world.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pressCanvas = async key => { await canvas.focus(); await page.keyboard.press(key); await paint(); };
  const isInsideCanvas = locator => locator.evaluate(element => {
    const a = element.getBoundingClientRect(), b = element.getRootNode().querySelector('.sl-canvas').getBoundingClientRect();
    return a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  });
  await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card .sl-preview[data-state="ready"]').length === 2);
  await paint();
  await library.evaluate(host => {
    const root = host.shadowRoot;
    const inspector = root.querySelector('.sl-inspector-preview iframe');
    const preview = root.querySelector('.sl-card.sl-selected iframe');
    host.__shortcutFrames = { inspector, inspectorDocument: inspector.contentDocument, preview, previewDocument: preview.contentDocument };
  });

  await check('V/H, Space and zoom shortcuts work without reloading selected previews', async () => {
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    await pressCanvas('h');
    assert.equal(await tool('hand').getAttribute('aria-pressed'), 'true');
    const bounds = await canvas.boundingBox();
    const drag = async () => {
      await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * .7 + 65, bounds.y + bounds.height * .7 + 45, { steps: 4 });
      await page.mouse.up();
      await paint();
    };
    const beforeHand = await camera();
    await drag();
    const afterHand = await camera();
    assert.ok(Math.abs(afterHand.x - beforeHand.x) > 50 && Math.abs(afterHand.y - beforeHand.y) > 30);
    await pressCanvas('v');
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    await canvas.focus();
    await page.keyboard.down('Space');
    assert.equal(await canvas.evaluate(element => getComputedStyle(element).cursor), 'grab');
    const beforeSpace = await camera();
    await drag();
    await page.keyboard.up('Space');
    assert.ok(Math.abs((await camera()).x - beforeSpace.x) > 50);
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true', 'Space is a temporary pan override');
    assert.notEqual(await canvas.evaluate(element => getComputedStyle(element).cursor), 'grab', 'Releasing Space restores the Select cursor');
    await pressCanvas('Shift+Digit1');
    for (const card of await library.locator('.sl-card').all()) assert.equal(await isInsideCanvas(card), true, 'Shift+1 fits all visible cards');
    await pressCanvas('Shift+Digit2');
    assert.equal(await isInsideCanvas(library.locator('.sl-card.sl-selected')), true, 'Shift+2 fits the selection');
    await pressCanvas('Shift+Digit0');
    assert.ok(Math.abs((await camera()).scale - 1) < .001);
    await pressCanvas('+');
    assert.ok((await camera()).scale > 1);
    await pressCanvas('-');
    assert.ok(Math.abs((await camera()).scale - 1) < .001);
    await pressCanvas('Control+Equal');
    assert.ok((await camera()).scale > 1);
    await pressCanvas('Meta+Minus');
    assert.ok(Math.abs((await camera()).scale - 1) < .001);
    const retained = await library.evaluate(host => {
      const root = host.shadowRoot, before = host.__shortcutFrames;
      const inspector = root.querySelector('.sl-inspector-preview iframe'), preview = root.querySelector('.sl-card.sl-selected iframe');
      return { inspector: inspector === before.inspector && inspector.contentDocument === before.inspectorDocument, preview: preview === before.preview && preview.contentDocument === before.previewDocument };
    });
    assert.deepEqual(retained, { inspector: true, preview: true });
  });

  await check('zoom menu, shortcut help and panel toggles have safe dismissal', async () => {
    const selection = await selectedStory();
    await action('zoom-menu').click();
    await library.locator('.sl-zoom-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('.sl-zoom-menu').isVisible(), false);
    assert.equal(await selectedStory(), selection);
    await pressCanvas('?');
    await library.locator('.sl-shortcuts-modal').waitFor();
    assert.match(await library.locator('.sl-shortcuts-modal').textContent(), /Shift|⇧/);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('.sl-shortcuts-modal').count(), 0);
    assert.equal(await selectedStory(), selection);
    await action('shortcuts').click();
    await library.locator('.sl-shortcuts-modal').waitFor();
    await page.keyboard.press('Escape');
    await pressCanvas('Control+Backslash');
    assert.equal(await library.locator('.sl-app').evaluate(element => element.classList.contains('sl-panels-hidden')), true);
    assert.equal(await library.locator('.sl-sidebar').isVisible(), false);
    await pressCanvas('Meta+Period');
    assert.equal(await library.locator('.sl-app').evaluate(element => element.classList.contains('sl-panels-hidden')), false);
    assert.equal(await library.locator('.sl-sidebar').isVisible(), true);
  });

  await check('arrow selection follows on-screen direction and Enter opens the selected preview', async () => {
    await pressCanvas('Shift+Digit1');
    const cards = await library.locator('.sl-card').evaluateAll(elements => elements.map(element => ({ story: element.dataset.story, x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
    const first = cards.find(card => card.story === 'tabs--default'), next = cards.find(card => card.story === 'tabs--pills');
    const key = Math.abs(next.x - first.x) > Math.abs(next.y - first.y) ? (next.x > first.x ? 'ArrowRight' : 'ArrowLeft') : (next.y > first.y ? 'ArrowDown' : 'ArrowUp');
    await library.locator('.sl-card[data-story="tabs--default"]').focus();
    await page.keyboard.press(key);
    assert.equal(await selectedStory(), 'tabs--pills');
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
    await page.keyboard.press('Enter');
    await library.locator('.sl-preview-modal').waitFor();
    await library.frameLocator('.sl-expanded-inspector-preview iframe').getByRole('tab', { name: 'Activity', exact: true }).click();
    assert.equal(await library.frameLocator('.sl-expanded-inspector-preview iframe').getByRole('tabpanel').textContent(), 'Activity content');
    await library.locator('.sl-preview-modal [data-action="close-modal"]').focus();
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('.sl-preview-modal').count(), 0);
    assert.equal(await selectedStory(), 'tabs--pills');
  });

  await check('text entry, IME composition and live preview keys keep their own behavior', async () => {
    await pressCanvas('Control+k');
    assert.equal(await search.evaluate(input => input.getRootNode().activeElement === input), true);
    await page.keyboard.type('hv');
    assert.equal(await search.inputValue(), 'hv');
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    const editing = await search.evaluate(input => ['h', 'v', '?', '+', '-', 'ArrowRight', 'Enter', ' '].map(key => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(event);
      return { key, prevented: event.defaultPrevented };
    }));
    assert.ok(editing.every(event => !event.prevented), JSON.stringify(editing));
    await search.fill('tabs');
    await library.locator('.sl-card[data-story="tabs--pills"]').click();
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
    await canvas.focus();
    const before = await camera();
    const composing = await canvas.evaluate(element => ['h', '?', '+', 'ArrowRight', 'Escape'].map(key => {
      const event = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, composed: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }));
    assert.deepEqual(composing, [false, false, false, false, false]);
    assert.equal(await canvas.evaluate(element => {
      const event = new KeyboardEvent('keydown', { key: 'h', keyCode: 229, bubbles: true, composed: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }), false, 'Legacy IME keyCode 229 must also bypass shortcuts');
    assert.deepEqual(await camera(), before);
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    const selection = await selectedStory();
    const previewTab = library.frameLocator('.sl-inspector-preview iframe').getByRole('tab', { name: 'Activity', exact: true });
    await previewTab.focus();
    for (const key of ['h', 'v', '+', 'Shift+Digit1', '?', 'ArrowRight', 'Escape']) await previewTab.press(key);
    assert.deepEqual(await camera(), before);
    assert.equal(await selectedStory(), selection);
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    assert.equal(await library.locator('.sl-modal-backdrop').count(), 0);
  });

  await check('copy exports the canvas selection while preserving native text copying', async () => {
    await pressCanvas('Control+c');
    await page.waitForFunction(() => window.__shortcutCopies.length === 1);
    const design = await page.evaluate(() => JSON.parse(window.__shortcutCopies[0]));
    assert.equal(design.schema, 'story-library/design');
    assert.match(design.name, /Tabs/);
    assert.ok(design.nodes.some(node => node.type === 'text' && node.text.includes('Activity')));
    const textCopy = await canvas.evaluate(element => {
      const text = document.createElement('span');
      text.textContent = 'Native text selection';
      element.append(text);
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = document.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, composed: true, cancelable: true });
      const selectedText = selection.toString();
      element.dispatchEvent(event);
      selection.removeAllRanges(); text.remove();
      return { prevented: event.defaultPrevented, selectedText };
    });
    assert.equal(textCopy.selectedText, 'Native text selection');
    assert.equal(textCopy.prevented, false, 'Copying selected text must keep the native copy action');
    await paint();
    assert.equal(await page.evaluate(() => window.__shortcutCopies.length), 1);
  });

  await check('Story mode leaves Canvas shortcuts inactive and retains Canvas state', async () => {
    const before = await camera(), selection = await selectedStory();
    await library.locator('[data-display-mode="story"]').click();
    for (const key of ['h', 'v', '+', 'Shift+Digit1', 'Shift+Digit2', '?', 'Control+k', 'Control+Backslash']) await page.keyboard.press(key);
    assert.deepEqual(await camera(), before);
    assert.equal(await selectedStory(), selection);
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    assert.equal(await library.locator('.sl-modal-backdrop').count(), 0);
    await page.frameLocator('#storybook-preview-iframe').getByRole('tab', { name: 'Activity', exact: true }).click();
    assert.equal(await page.frameLocator('#storybook-preview-iframe').getByRole('tabpanel').textContent(), 'Activity content');
    await library.locator('[data-display-mode="canvas"]').click();
    assert.deepEqual(await camera(), before);
  });

  await check('mobile controls fit and Escape resets the tool then deselects without closing Canvas', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await paint();
    for (const control of [tool('select'), tool('hand'), action('zoom-out'), action('zoom-in'), action('zoom-reset'), action('zoom-menu'), action('zoom-fit'), action('zoom-selection'), action('shortcuts')]) {
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= 375, JSON.stringify(bounds));
    }
    await pressCanvas('h');
    await page.keyboard.press('Escape');
    assert.equal(await tool('select').getAttribute('aria-pressed'), 'true');
    assert.equal(await library.locator('.sl-card.sl-selected').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('.sl-card.sl-selected').count(), 0);
    assert.equal(await library.locator('.sl-inspector-empty').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await library.count(), 1, 'Repeated Escape must never dismiss Canvas');
    await library.locator('.sl-header [data-action="close"]').click();
    await library.waitFor({ state: 'detached' });
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join('\n')}`);
  console.log(`\n${completed} canvas-shortcut browser checks passed.`);
} finally {
  await browser.close();
  await fixture.close();
}
