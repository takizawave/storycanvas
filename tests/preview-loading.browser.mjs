/** Sample discovery and filtering must not restart already loading Stories. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
let releaseSizes;
const sizesGate = new Promise(resolve => { releaseSizes = resolve; });
let completed = 0;
async function check(name, action) {
  await action();
  completed++;
  console.log(`✓ ${name}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  const requests = [];
  let injected = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.resourceType() !== 'document' || !url.pathname.endsWith('/iframe.html')) return;
    requests.push({ story: url.searchParams.get('id'), frame: request.frame(), library: injected });
  });
  await page.goto(`${fixture.baseUrl}?path=/story/button--sizes`);
  assert.equal(requests.length, 1, 'Count the manager iframe separately from library previews');
  await page.route('**/iframe.html?**', async route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    // Hold initial samples until their DOM references are captured. Meanwhile,
    // a slow sibling guarantees that discovery happens during another load.
    if (id === 'button--sizes') await sizesGate;
    if (id === 'button--secondary') await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue().catch(() => {}); // A regressed implementation aborts discarded frames.
  });
  injected = true;
  await page.addScriptTag({ content: await readFile(process.env.STORY_LIBRARY_BUNDLE || 'dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const sizeFrames = library.locator('.sl-card[data-story="button--sizes"] iframe');
  const secondaryFrame = library.locator('.sl-card[data-story="button--secondary"] iframe');
  await sizeFrames.waitFor({ state: 'attached' });
  await secondaryFrame.waitFor({ state: 'attached' });
  await library.locator('.sl-inspector-preview iframe').waitFor({ state: 'attached' });
  await library.evaluate(host => {
    const root = host.shadowRoot;
    const inspector = root.querySelector('.sl-inspector-preview iframe');
    const sizes = root.querySelector('.sl-card[data-story="button--sizes"]');
    const secondary = root.querySelector('.sl-card[data-story="button--secondary"] iframe');
    host.__loadingRegression = {
      inspector, inspectorWindow: inspector.contentWindow,
      sizes, sizesFrame: sizes.querySelector('iframe'),
      secondary, maxFrames: root.querySelectorAll('iframe').length,
    };
    const state = host.__loadingRegression;
    state.observer = new MutationObserver(() => {
      state.maxFrames = Math.max(state.maxFrames, root.querySelectorAll('iframe').length);
    });
    state.observer.observe(root, { childList: true, subtree: true });
  });
  const inspectorFrame = await (await library.locator('.sl-inspector-preview iframe').elementHandle()).contentFrame();
  releaseSizes();

  const requestCount = (story, role) => requests.filter(request => request.library && request.story === story && (role === 'inspector' ? request.frame === inspectorFrame : request.frame !== inspectorFrame)).length;
  await check('sample discovery keeps unrelated pending previews and adopts the original sample iframe', async () => {
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card[data-story="button--sizes"][data-example]:not([data-example=""])').length === 3);
    assert.equal(await library.locator('.sl-card').count(), 6);
    const retained = await library.evaluate(host => {
      const root = host.shadowRoot, previous = host.__loadingRegression;
      const first = root.querySelector('.sl-card[data-story="button--sizes"]');
      return {
        secondary: root.querySelector('.sl-card[data-story="button--secondary"] iframe') === previous.secondary,
        secondaryConnected: previous.secondary.isConnected,
        card: first === previous.sizes,
        sizesFrame: first.querySelector('iframe') === previous.sizesFrame,
        inspector: root.querySelector('.sl-inspector-preview iframe') === previous.inspector,
      };
    });
    assert.equal(retained.secondary, true, 'Discovering samples must retain the unrelated pending iframe');
    assert.equal(retained.secondaryConnected, true);
    assert.equal(retained.card, true, 'The original card becomes the first sample');
    assert.equal(retained.sizesFrame, true, 'The first sample reuses the document that discovered it');
    assert.equal(retained.inspector, true, 'Cropping the inspector must not rebuild its iframe');
    assert.equal(requestCount('button--secondary', 'canvas'), 1);
    assert.equal(requestCount('button--sizes', 'inspector'), 1);
    await library.locator('.sl-card[data-story="button--secondary"] .sl-preview[data-state="ready"]').waitFor();
    assert.equal(await secondaryFrame.evaluate(frame => frame === frame.getRootNode().host.__loadingRegression.secondary), true);
    assert.equal(requestCount('button--secondary', 'canvas'), 1, 'The slow Story finishes its original request');
    await page.waitForFunction(() => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-card .sl-preview[data-state="ready"]').length === 6);
  });

  await check('changing examples keeps the loaded inspector iframe and document', async () => {
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
    await library.locator('.sl-inspector-preview iframe').evaluate(frame => {
      const state = frame.getRootNode().host.__loadingRegression;
      state.inspectorDocument = frame.contentDocument;
      frame.contentWindow.__loadingRegressionToken = 'preserved';
    });
    const options = await library.locator('#sl-example-select option').evaluateAll(options => options.map(option => option.value));
    assert.equal(options.length, 3);
    for (const key of [options[2], options[1], options[0]]) {
      await library.locator('#sl-example-select').selectOption(key);
      await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor();
      const retained = await library.evaluate(host => {
        const frame = host.shadowRoot.querySelector('.sl-inspector-preview iframe');
        const before = host.__loadingRegression;
        return { frame: frame === before.inspector, window: frame.contentWindow === before.inspectorWindow, document: frame.contentDocument === before.inspectorDocument, token: frame.contentWindow.__loadingRegressionToken };
      });
      assert.deepEqual(retained, { frame: true, window: true, document: true, token: 'preserved' });
      assert.equal(await library.locator('.sl-card.sl-selected').getAttribute('data-example'), key);
      assert.equal(requestCount('button--sizes', 'inspector'), 1, 'An example selection changes the crop, not the Story document');
    }
  });

  await check('narrowing and broadening search preserve a retained live preview', async () => {
    const selectedFrame = library.locator('.sl-card.sl-selected iframe');
    await selectedFrame.waitFor({ state: 'attached' });
    await selectedFrame.evaluate(frame => {
      const state = frame.getRootNode().host.__loadingRegression;
      state.searchedFrame = frame;
      state.searchedWindow = frame.contentWindow;
      state.searchedDocument = frame.contentDocument;
    });
    const search = library.getByRole('searchbox', { name: 'コンポーネントを検索' });
    // Keep Button in view: clearing every term opens all families and may
    // legitimately unload this preview through viewport virtualization.
    for (const [query, count] of [['button', 6], ['button sizes', 3], ['button', 6]]) {
      await search.fill(query);
      assert.equal(await library.locator('.sl-card').count(), count);
      const retained = await selectedFrame.evaluate(frame => {
        const previous = frame.getRootNode().host.__loadingRegression;
        return frame === previous.searchedFrame && frame.contentWindow === previous.searchedWindow && frame.contentDocument === previous.searchedDocument;
      });
      assert.equal(retained, true, `Filtering to ${query} must preserve the selected preview`);
    }
  });

  assert.deepEqual(errors, [], `Unhandled errors: ${errors.join('\n')}`);
  const maxFrames = await library.evaluate(host => {
    const state = host.__loadingRegression;
    state.observer.disconnect();
    return state.maxFrames;
  });
  assert.ok(maxFrames <= 9, `At most eight canvas frames plus one inspector may be live (saw ${maxFrames})`);
  assert.equal(requestCount('button--sizes', 'inspector'), 1);
  console.log(`\n${completed} preview-loading browser checks passed; max live iframes: ${maxFrames}.`);
} finally {
  releaseSizes();
  await browser.close();
  await fixture.close();
}
