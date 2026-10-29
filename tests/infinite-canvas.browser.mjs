/** Pan, zoom, all/detail navigation and virtualization against actual fixture DOM. */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
let completed = 0;
async function check(name, action) {
  await action();
  completed += 1;
  console.log(`✓ ${name}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.baseUrl}?path=/story/button--primary`);
  // Extension installation/permissions are covered by browser.spec.mjs. This
  // page injection exercises the exact built bundle with the development bridge.
  await page.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const canvas = library.locator('.sl-canvas');
  const world = library.locator('.sl-canvas-world');
  const storyCount = () => library.locator('.sl-card').evaluateAll(cards => new Set(cards.map(card => card.dataset.story)).size);
  const transform = () => world.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  const isOnCanvas = async selector => library.locator(selector).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const viewport = element.getRootNode().querySelector('.sl-canvas').getBoundingClientRect();
    return bounds.right > viewport.left && bounds.left < viewport.right && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  const waitForTransform = async previous => page.waitForFunction(previous => {
    const world = document.querySelector('[data-story-library]')?.shadowRoot.querySelector('.sl-canvas-world');
    if (!world) return false;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    return Math.abs(matrix.e - previous.x) > 2 || Math.abs(matrix.f - previous.y) > 2 || Math.abs(matrix.a - previous.scale) > .001;
  }, previous);

  await check('master frames group raw story instances on one canvas without individual card chrome', async () => {
    await world.waitFor();
    assert.equal(await storyCount(), 4, 'The initial Button URL opens its four-story detail page');
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button--primary');
    await library.locator('#sl-variant-select').selectOption('button--sizes');
    await library.locator('#sl-example-select').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card[data-story="button--sizes"][data-example]:not([data-example=""])').length === 3);
    assert.equal(await library.locator('.sl-card').count(), 6);
    await library.locator('#sl-variant-select').selectOption('button--primary');
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await library.locator('.sl-card').count(), 20);
    assert.equal(await storyCount(), 18);
    assert.equal(await library.locator('.sl-canvas-world').count(), 1);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 6, 'Every component family has one visible master frame');
    const frames = await library.locator('.sl-master-frame').evaluateAll(elements => elements.map(element => {
      const outline = element.querySelector('rect[stroke-dasharray]');
      return { group: element.dataset.masterGroup, background: getComputedStyle(element).backgroundColor, label: element.textContent.trim(), icon: !!element.querySelector('.sl-master-icon'), dash: outline?.getAttribute('stroke-dasharray'), stroke: outline && getComputedStyle(outline).stroke };
    }));
    assert.equal(new Set(frames.map(frame => frame.group)).size, 6);
    assert.ok(frames.every(frame => frame.background === 'rgba(0, 0, 0, 0)' && frame.label && frame.icon && /[1-9]/.test(frame.dash || '') && frame.stroke !== 'none'), `Master frames must have transparent backgrounds, labels, master icons and dashed outlines: ${JSON.stringify(frames)}`);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button--primary');
    const style = await library.locator('.sl-card').first().evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow };
    });
    assert.equal(style.background, 'rgba(0, 0, 0, 0)');
    assert.equal(style.border, '0px');
    assert.equal(style.shadow, 'none');
  });

  await check('zoom controls adjust scale and restore 100 percent', async () => {
    const initial = await transform();
    await library.locator('[data-action="zoom-in"]').click();
    await waitForTransform(initial);
    const zoomed = await transform();
    assert.ok(zoomed.scale > initial.scale, `${initial.scale} → ${zoomed.scale}`);
    await library.locator('[data-action="zoom-out"]').click();
    await waitForTransform(zoomed);
    assert.ok((await transform()).scale < zoomed.scale);
    await library.locator('[data-action="zoom-reset"]').click();
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-story-library]').shadowRoot.querySelector('.sl-canvas-world')).transform).a - 1) < .001);
  });

  await check('wheel and middle-button drag pan the world instead of scrolling the page', async () => {
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .6);
    const initial = await transform();
    await page.mouse.wheel(110, 170);
    await waitForTransform(initial);
    const wheeled = await transform();
    assert.ok(Math.abs(wheeled.x - initial.x) > 2 || Math.abs(wheeled.y - initial.y) > 2);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(bounds.x + bounds.width * .55 + 90, bounds.y + bounds.height * .6 + 60, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await waitForTransform(wheeled);
    const dragged = await transform();
    assert.ok(Math.abs(dragged.x - wheeled.x) > 20 && Math.abs(dragged.y - wheeled.y) > 20);
  });

  await check('family detail pages support independent pan/zoom and preserve the all-canvas camera', async () => {
    const allCamera = await transform();
    await library.locator('[data-group="Navigation/Tabs"]').click();
    assert.equal(await library.locator('.sl-card').count(), 2);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('.sl-master-frame').getAttribute('data-master-group'), 'Navigation/Tabs');
    assert.ok(await isOnCanvas('.sl-card[data-story="tabs--default"]'), 'The selected Tabs story is visible on its detail page');
    const initialDetail = await transform();
    await library.locator('[data-action="zoom-in"]').click();
    await waitForTransform(initialDetail);
    const zoomedDetail = await transform();
    assert.ok(zoomedDetail.scale > initialDetail.scale);
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .6);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(bounds.x + bounds.width * .6 + 60, bounds.y + bounds.height * .6 + 45, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await waitForTransform(zoomedDetail);
    const draggedDetail = await transform();
    assert.ok(Math.abs(draggedDetail.x - zoomedDetail.x) > 20 && Math.abs(draggedDetail.y - zoomedDetail.y) > 20);
    await library.locator('[data-group="Forms/Button"]').click();
    assert.equal(await library.locator('.sl-card').count(), 6);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.ok(await isOnCanvas('.sl-card[data-story="button--primary"]'));
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await library.locator('.sl-card').count(), 20);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 6);
    const restored = await transform();
    assert.ok(Math.abs(restored.x - allCamera.x) < 1 && Math.abs(restored.y - allCamera.y) < 1 && Math.abs(restored.scale - allCamera.scale) < .001, `All-canvas camera changed: ${JSON.stringify({ allCamera, restored })}`);
  });

  await check('double-click opens a family from all and an interactive preview from detail', async () => {
    await library.locator('[data-action="zoom-fit"]').click();
    await library.locator('.sl-card[data-story="button--secondary"]').dblclick();
    assert.equal(await library.locator('.sl-card').count(), 6);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button--secondary');
    assert.equal(await library.locator('.sl-preview-modal').count(), 0);
    await library.locator('.sl-card[data-story="button--secondary"]').dblclick();
    await library.frameLocator('.sl-expanded-inspector-preview iframe').locator('button.secondary').waitFor();
    await library.locator('.sl-preview-modal [data-action="close-modal"]').click();
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await library.locator('.sl-card').count(), 20);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button--secondary', 'Returning to all preserves the selected story');
  });

  await check('search filters individual stories and clearing it restores all stories', async () => {
    const search = library.getByRole('searchbox', { name: 'コンポーネントを検索' });
    await search.fill('secondary');
    assert.equal(await library.locator('.sl-card').count(), 1);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('.sl-card').getAttribute('data-story'), 'button--secondary');
    await search.fill('button');
    assert.equal(await library.locator('.sl-card').count(), 6);
    await search.fill('');
    assert.equal(await library.locator('.sl-card').count(), 20);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 6);
    await library.locator('[data-action="zoom-fit"]').click();
    assert.ok(Number.isFinite((await transform()).scale));
    assert.ok(await isOnCanvas('.sl-card[data-story="badge--default"]'));
    assert.ok(await isOnCanvas('.sl-card[data-story="tabs--pills"]'));
  });

  await check('settled nonselected previews become images while the selected story stays live', async () => {
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelector('.sl-card .sl-preview-snapshot'), null, { timeout: 30000 });
    const snapshot = library.locator('.sl-card .sl-preview-snapshot').first();
    await snapshot.evaluate(image => image.decode());
    assert.ok(await snapshot.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0), 'Cached preview must be a rendered image');
    await library.locator('[data-group="Forms/Button"]').click();
    assert.equal(await library.locator('.sl-card').count(), 6);
    await library.locator('#sl-variant-select').selectOption('button--secondary');
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
    await library.locator('.sl-card[data-story="button--secondary"] iframe').waitFor({ state: 'attached', timeout: 30000 });
    await library.frameLocator('.sl-card[data-story="button--secondary"] iframe').locator('button.secondary').waitFor({ timeout: 30000 });
    assert.ok(await library.locator('.sl-card iframe').count() <= 8);
    assert.equal(await library.locator('.sl-inspector-preview iframe').count(), 1);
    assert.ok(await library.locator('iframe').count() <= 9, 'At most eight canvas frames plus the inspector may be live');
  });

  await check('375px viewport contains the canvas and its zoom controls', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const dimensions = await library.locator('.sl-app').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    assert.ok(dimensions.width <= 375 && dimensions.scrollWidth <= 375, JSON.stringify(dimensions));
    for (const action of ['zoom-in', 'zoom-out', 'zoom-reset', 'zoom-fit']) {
      const bounds = await library.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375, `${action}: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await library.locator('[data-action="zoom-fit"]').click();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/infinite-canvas-fixture.png', animations: 'disabled' });
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join('\n')}`);
  console.log(`\n${completed} infinite-canvas browser checks passed.`);
} finally {
  await browser.close();
  await fixture.close();
}
