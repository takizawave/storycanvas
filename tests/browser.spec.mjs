/**
 * Browser integration against deterministic Storybook fixtures.
 * The shipped MV3 manifest is loaded without modification for install smoke.
 * Runtime integration uses a temporary copy granting ONLY the local fixture host:
 * browser automation cannot simulate Chrome's toolbar gesture that grants activeTab.
 */
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(project, 'dist');
const fixture = await startFixtureServer();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-browser-'));
const contexts = [];
let completed = 0;

async function check(name, action) {
  await action();
  completed++;
  console.log(`✓ ${name}`);
}

async function launchExtension(directory) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 960 },
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  });
  contexts.push(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  return { context, worker, id: new URL(worker.url()).hostname };
}

async function injectInstalled(worker, url) {
  const result = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab) throw new Error(`Fixture tab not found: ${url}`);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return tab.id;
  }, url);
  assert.ok(Number.isInteger(result));
}

try {
  await check('production Manifest V3 installs with gesture-scoped permissions', async () => {
    const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'clipboardWrite', 'scripting', 'storage'].sort());
    assert.equal(manifest.host_permissions, undefined);
    const { context, worker } = await launchExtension(dist);
    assert.match(worker.url(), /^chrome-extension:\/\/[^/]+\/background\.js$/);
    const installed = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(installed.name, manifest.name);
    await context.close();
    contexts.splice(contexts.indexOf(context), 1);
  });

  const testExtension = path.join(temporary, 'extension');
  await cp(dist, testExtension, { recursive: true });
  const testManifest = JSON.parse(await readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
  testManifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(testManifest));
  const { context, worker } = await launchExtension(testExtension);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixture.baseUrl });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const library = page.locator('[data-story-library]');
  const readyPreview = () => library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
  const storyCount = () => library.locator('.sl-card').evaluateAll(cards => new Set(cards.map(card => card.dataset.story)).size);
  const buttonLabels = ['Primary', 'Secondary', 'Disabled', 'Sizes / Small', 'Sizes / Medium', 'Sizes / Large'];
  const discoverButtonExamples = async () => {
    await library.locator('[data-group="Forms/Button"]').click();
    await library.locator('#sl-variant-select').selectOption('button--sizes');
    await library.locator('#sl-example-select').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card[data-story="button--sizes"][data-example]:not([data-example=""])').length === 3);
    await readyPreview();
  };
  const clipboardText = () => page.evaluate(() => navigator.clipboard.readText());
  const exportAs = async format => {
    await readyPreview();
    const button = format === 'figma' ? library.locator('.sl-primary-button[data-export="figma"]') : library.locator(`.sl-format-actions [data-export="${format}"]`);
    await button.click();
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-story-library]')?.shadowRoot;
      return root?.querySelector('.sl-toast.sl-show') && !root.querySelector('.sl-primary-button[data-export="figma"]')?.disabled;
    });
    assert.equal(await library.locator('.sl-toast-error').count(), 0, await library.locator('.sl-toast').textContent());
  };

  await check('modern index opens real previews and preserves the initial story', async () => {
    await page.goto(`${fixture.baseUrl}?path=/story/accordion--default`);
    await injectInstalled(worker, page.url());
    await library.waitFor();
    await readyPreview();
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'accordion--default');
    assert.equal(await library.locator('.sl-card').count(), 3, 'The initial URL opens its Accordion detail page');
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('[data-group="Disclosure/Accordion"]').evaluate(element => element.classList.contains('sl-active')), true);
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await storyCount(), 18);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 6);
    assert.equal(await library.locator('.sl-canvas-world').count(), 1);
  });

  await check('search filters individual stories and exposes a useful empty state', async () => {
    await discoverButtonExamples();
    const search = library.getByRole('searchbox', { name: 'コンポーネントを検索' });
    await search.fill('button');
    assert.equal(await library.locator('.sl-card').count(), 6);
    assert.equal(await storyCount(), 4);
    assert.deepEqual(await library.locator('.sl-story-label').allTextContents(), buttonLabels);
    await search.fill('secondary');
    assert.equal(await library.locator('.sl-card').count(), 1);
    assert.equal(await library.locator('.sl-card').getAttribute('data-story'), 'button--secondary');
    await search.fill('no-component-has-this-name');
    assert.equal(await library.locator('.sl-card').count(), 0);
    assert.equal(await library.locator('.sl-master-frame').count(), 0, 'Empty searches do not leave stale family frames');
    await library.locator('[data-action="clear-search"]').click();
    assert.equal(await library.locator('.sl-card').count(), 20);
    assert.equal(await storyCount(), 18);
  });

  await check('favorites can be added, filtered, removed, and saved', async () => {
    await library.locator('[data-group="Forms/Button"]').click();
    assert.equal(await library.locator('.sl-card').count(), 6, 'Four Button stories expose six independent examples');
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    const favorite = library.locator('.sl-inspector [data-favorite="Forms/Button"]');
    await favorite.focus();
    await page.keyboard.press('Enter');
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true', 'A focused favorite must respond to Enter inside the shadow root');
    await library.locator('[data-view="favorites"]').click();
    assert.equal(await library.locator('.sl-card').count(), 6);
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.deepEqual(await library.locator('.sl-story-label').allTextContents(), buttonLabels);
    await library.locator('.sl-inspector [data-favorite="Forms/Button"]').click();
    assert.equal(await library.locator('.sl-card').count(), 0);
    assert.match(await library.locator('.sl-empty').textContent(), /お気に入り/);
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    await library.locator('.sl-inspector [data-favorite="Forms/Button"]').click();
  });

  await check('individual examples select and copy only their own rendered component', async () => {
    await discoverButtonExamples();
    await library.locator('#sl-example-select').selectOption({ label: 'Medium' });
    await readyPreview();
    assert.equal(await library.locator('.sl-card[aria-selected="true"]').getAttribute('data-story'), 'button--sizes');
    assert.equal(await library.locator('.sl-card[aria-selected="true"]').getAttribute('data-example'), await library.locator('#sl-example-select').inputValue());
    await exportAs('svg');
    const svg = await clipboardText();
    assert.match(svg, /Medium/);
    assert.equal(/Small|Large/.test(svg), false, 'Copying Medium must exclude its Small/Large siblings');
  });

  await check('an all-canvas story opens its detail page and selects the matching live variant', async () => {
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await library.locator('.sl-card').count(), 20);
    await library.locator('[data-action="zoom-fit"]').click();
    await library.locator('.sl-card[data-story="button--secondary"]').dblclick();
    assert.equal(await library.locator('.sl-card').count(), 6, 'Double-clicking a story opens its family detail page with all examples');
    assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button--secondary');
    await library.locator('#sl-variant-select').selectOption('button--secondary');
    await readyPreview();
    assert.equal(await library.locator('.sl-inspector-preview iframe').getAttribute('data-story-id'), 'button--secondary');
    await library.frameLocator('.sl-inspector-preview iframe').locator('button.secondary').waitFor();
    assert.equal(await library.locator('.sl-card[aria-selected="true"]').getAttribute('data-story'), 'button--secondary');
  });

  await check('SVG copy produces portable vectors with the selected component text', async () => {
    await exportAs('svg');
    const svg = await clipboardText();
    assert.match(svg, /^<svg\s/);
    assert.match(svg, /Get started/);
    assert.ok(!svg.includes('foreignObject'));
    assert.match(svg, /<path/);
  });

  await check('HTML copy includes resolved styles and selected story content', async () => {
    await exportAs('html');
    const html = await clipboardText();
    assert.match(html, /<button/);
    assert.match(html, /Get started/);
    assert.match(html, /background-color:rgb\(237, 242, 247\)/);
    assert.ok(!html.includes('<script'));
  });

  await check('Figma copy contains editable native text and shape records', async () => {
    await exportAs('figma');
    const design = JSON.parse(await clipboardText());
    assert.equal(design.schema, 'story-library/design');
    assert.equal(design.version, 1);
    assert.equal(design.name, 'Forms/Button / Secondary');
    assert.ok(design.nodes.some(node => node.type === 'text' && node.text === 'Get started'));
    assert.ok(design.nodes.some(node => node.type === 'rect'));
    assert.equal(new URL(design.storyUrl).searchParams.get('path'), '/story/button--secondary');
  });

  await check('PNG copy writes a real image to the clipboard', async () => {
    await exportAs('png');
    const image = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find(item => item.types.includes('image/png'));
      if (!item) return null;
      const blob = await item.getType('image/png');
      return { size: blob.size, signature: [...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)] };
    });
    assert.ok(image?.size > 100);
    assert.deepEqual(image.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  await check('story link copy and SVG download point to the selected variant', async () => {
    await library.locator('[data-action="copy-menu"]').click();
    await library.locator('.sl-copy-menu [data-export="link"]').click();
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelector('.sl-primary-button[data-export="figma"]')?.disabled === false);
    assert.equal(new URL(await clipboardText()).searchParams.get('path'), '/story/button--secondary');
    const downloadPromise = page.waitForEvent('download');
    await library.locator('[data-export="download-svg"]').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'button--secondary.svg');
    await mkdir(path.join(project, 'artifacts'), { recursive: true });
    const filename = path.join(project, 'artifacts', 'browser-button.svg');
    await download.saveAs(filename);
    assert.match(await readFile(filename, 'utf8'), /<svg/);
  });

  await check('expanded previews remain interactive', async () => {
    await library.locator('[data-group="Disclosure/Accordion"]').click();
    await readyPreview();
    assert.equal(await library.locator('.sl-card').count(), 3);
    await library.locator('.sl-card[data-story="accordion--default"]').dblclick();
    const expanded = library.frameLocator('.sl-expanded-inspector-preview iframe');
    await expanded.locator('details').first().locator('summary').click();
    assert.equal(await expanded.locator('details').first().getAttribute('open'), '');
    await library.locator('.sl-preview-modal [data-action="close-modal"]').click();
    assert.equal(await library.locator('.sl-preview-modal').count(), 0);
  });

  await check('closing restores Storybook; reopening retains favorites without duplicate overlays', async () => {
    await library.getByRole('button', { name: 'ライブラリを閉じる', exact: true }).click();
    assert.equal(await library.count(), 0);
    await page.locator('#storybook-preview-iframe').waitFor();
    await injectInstalled(worker, page.url());
    await library.waitFor();
    assert.equal(await library.count(), 1);
    await discoverButtonExamples();
    await library.locator('[data-view="favorites"]').click();
    assert.equal(await library.locator('.sl-card').count(), 6);
    assert.deepEqual(await library.locator('.sl-story-label').allTextContents(), buttonLabels);
  });

  await check('legacy bridge reads stories in the page MAIN realm', async () => {
    await page.goto(`${fixture.baseUrl}legacy/?path=/story/accordion--default`);
    await page.frameLocator('#storybook-preview-iframe').locator('#storybook-root details').first().waitFor();
    await injectInstalled(worker, page.url());
    await library.waitFor({ timeout: 15000 });
    await readyPreview();
    assert.equal(await page.locator('#story-library-loading').count(), 0);
    assert.equal(await library.locator('#sl-variant-select').inputValue(), 'accordion--default');
    await library.locator('.sl-primary-nav [data-view="all"]').click();
    assert.equal(await storyCount(), 18);
  });

  await check('subdirectory Storybooks preserve preview and source paths', async () => {
    await page.goto(`${fixture.baseUrl}nested/storybook/?path=/story/button--primary`);
    await injectInstalled(worker, page.url());
    await library.waitFor();
    await readyPreview();
    const previewUrl = new URL(await library.locator('.sl-inspector-preview iframe').getAttribute('src'));
    assert.equal(previewUrl.pathname, '/nested/storybook/iframe.html');
    assert.equal(previewUrl.searchParams.get('id'), 'button--primary');
    assert.equal(new URL(await library.locator('.sl-open-story').getAttribute('href')).pathname, '/nested/storybook/');
  });

  await check('small viewports keep the library within the screen', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await library.locator('.sl-app').evaluate(element => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth }));
    assert.ok(dimensions.width <= 390);
    assert.ok(dimensions.scrollWidth <= 390, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
    await page.setViewportSize({ width: 1440, height: 960 });
    await readyPreview();
    assert.ok(await library.locator('.sl-card iframe').count() <= 8, 'Canvas live previews stay within the iframe budget');
    await page.screenshot({ path: path.join(project, 'artifacts', 'fixture-library.png'), animations: 'disabled' });
  });

  assert.deepEqual(pageErrors, [], `Unhandled errors: ${pageErrors.join('\n')}`);
  console.log(`\n${completed} browser checks passed. Temporary localhost host permission was used only in runtime tests.`);
} finally {
  for (const context of contexts) await context.close();
  await fixture.close();
  await rm(temporary, { recursive: true, force: true });
}
