/** Exercises the installed MV3 bridge against a real Storybook. Extra host
 * permission exists only in a disposable test copy, because browser automation
 * cannot grant activeTab by pressing the real Chrome toolbar action. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-runtime-extension-'));
const testExtension = path.join(temporary, 'extension');
let context;
try {
  await cp(path.join(project, 'dist'), testExtension, { recursive: true });
  // Compile just the real background and its runtime adapter so this focused
  // test can run while unrelated UI files are being edited.
  await build({ entryPoints: [path.join(project, 'src/background.js')], outfile: path.join(testExtension, 'background.js'), bundle: true, format: 'iife', target: 'chrome120' });
  const manifest = JSON.parse(await readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://opensource.adobe.com/*'];
  await writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const sourceUrl = 'https://opensource.adobe.com/spectrum-web-components/storybook/?path=/story/button-black-fill--primary';
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#storybook-preview-iframe')?.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender?.story, {}, { timeout: 60000 });
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.id = 'test-library-inspector';
    iframe.name = 'story-library-inspector-test';
    iframe.src = 'iframe.html?id=button-black-fill--primary&viewMode=story';
    document.body.append(iframe);
  });
  await page.waitForFunction(() => document.querySelector('#test-library-inspector')?.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender?.story, {}, { timeout: 60000 });
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, sourceUrl);
  assert.ok(Number.isInteger(tabId));
  const request = { frameName: 'story-library-inspector-test', storyId: 'button-black-fill--primary', operation: 'read' };
  const bridge = request => worker.evaluate(async ({ tabId, request }) => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async request => chrome.runtime.sendMessage({ type: 'STORY_PROPERTIES', request }), args: [request] });
    return results[0].result;
  }, { tabId, request });
  const state = () => page.evaluate(() => {
    const properties = id => {
      const button = document.querySelector(id).contentDocument.querySelector('sp-button');
      return { disabled: button.disabled, treatment: button.treatment };
    };
    return { original: properties('#storybook-preview-iframe'), inspector: properties('#test-library-inspector') };
  });
  const before = await bridge(request);
  assert.equal(before.error, undefined, before.error);
  assert.equal(before.available, true);
  assert.deepEqual(before.argTypes.treatment.options, ['fill', 'outline']);
  const originalState = (await state()).original;
  const updated = await bridge({ ...request, operation: 'update', updatedArgs: { disabled: true, treatment: 'outline' } });
  assert.equal(updated.error, undefined, updated.error);
  assert.equal(updated.args.disabled, true);
  assert.equal(updated.args.treatment, 'outline');
  const rendered = await state();
  assert.equal(rendered.inspector.disabled, true);
  assert.equal(rendered.inspector.treatment, 'outline');
  assert.deepEqual(rendered.original, originalState, 'Original Storybook preview must stay unchanged');
  const reset = await bridge({ ...request, operation: 'reset' });
  assert.equal(reset.error, undefined, reset.error);
  assert.equal(reset.args.disabled, before.args.disabled);
  assert.equal(reset.args.treatment, before.args.treatment);
  assert.deepEqual((await state()).inspector, originalState);
  assert.deepEqual((await state()).original, originalState);
  const wrongStory = await bridge({ ...request, storyId: 'button-black-fill--secondary' });
  assert.equal(wrongStory.code, 'STORY_MISMATCH');
  const result = { site: 'Spectrum', installedMv3: true, bridge: 'ISOLATED runtime.sendMessage → service worker → MAIN allFrames', properties: Object.keys(before.argTypes), updated: rendered.inspector, originalPreviewUnchanged: true, reset: 'passed', wrongStoryRejected: true };
  await writeFile(path.join(project, 'artifacts/runtime-extension-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
