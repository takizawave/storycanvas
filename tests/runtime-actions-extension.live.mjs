/** Real addon Actions through the installed MV3 background bridge. Extra host
 * access exists only in this disposable test extension, never the shipped one. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-actions-extension-'));
const testExtension = path.join(temporary, 'extension');
let context;
try {
  await cp(path.join(project, 'dist'), testExtension, { recursive: true });
  await build({ entryPoints: [path.join(project, 'src/background.js')], outfile: path.join(testExtension, 'background.js'), bundle: true, format: 'iife', target: 'chrome120' });
  const manifest = JSON.parse(await readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://opensource.adobe.com/*', 'https://govuk-react.github.io/*'];
  await writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const results = [];
  for (const site of [
    { name: 'Spectrum', base: 'https://opensource.adobe.com/spectrum-web-components/storybook/', id: 'checkbox-sizes--s', actionNames: ['click', 'change'] },
    { name: 'GOV.UK', base: 'https://govuk-react.github.io/govuk-react/', id: 'radio--usage-with-final-redux-form-multi-checkbox-validation', actionNames: [] },
  ]) {
    const page = await context.newPage();
    const sourceUrl = `${site.base}?path=/story/${site.id}`;
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#storybook-preview-iframe')?.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender?.story, {}, { timeout: 60000 });
    await page.evaluate(id => {
      const iframe = document.createElement('iframe');
      iframe.id = 'test-library-inspector'; iframe.name = 'story-library-inspector-actions-test';
      iframe.src = `iframe.html?id=${id}&viewMode=story`;
      iframe.style.cssText = 'position:fixed;inset:0;width:650px;height:550px;z-index:999999;background:white';
      document.body.append(iframe);
    }, site.id);
    await page.waitForFunction(() => document.querySelector('#test-library-inspector')?.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender?.story, {}, { timeout: 60000 });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, sourceUrl);
    const request = { frameName: 'story-library-inspector-actions-test', storyId: site.id, operation: 'read-actions' };
    const bridge = (operation = 'read-actions') => worker.evaluate(async ({ tabId, request }) => {
      const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async request => chrome.runtime.sendMessage({ type: 'STORY_PROPERTIES', request }), args: [request] });
      return results[0].result;
    }, { tabId, request: { ...request, operation } });
    const before = await bridge();
    assert.equal(before.error, undefined, before.error);
    assert.equal(before.listening, true);
    assert.deepEqual(before.actionNames.sort(), site.actionNames.sort());
    assert.equal(before.actionsAvailable, site.actionNames.length > 0);
    const inspector = page.frameLocator('#test-library-inspector');
    const original = page.frameLocator('#storybook-preview-iframe');
    if (site.name === 'Spectrum') {
      await page.locator('#test-library-inspector').evaluate(element => element.style.display = 'none');
      await original.locator('sp-checkbox').first().click();
      await page.waitForTimeout(250);
      assert.deepEqual((await bridge()).actions, [], 'Original Storybook events must not enter inspector buffer');
      await page.locator('#test-library-inspector').evaluate(element => element.style.display = 'block');
      await inspector.locator('sp-checkbox').first().click();
    } else {
      await inspector.getByText('Yep', { exact: true }).click();
      await inspector.getByRole('button', { name: 'Submit', exact: true }).click();
    }
    await page.waitForTimeout(200);
    const after = await bridge();
    assert.equal(after.actionsAvailable, true);
    assert.ok(after.actions.length > 0, 'Actual component interaction should emit Storybook Actions');
    if (site.name === 'Spectrum') {
      assert.ok(after.actions.some(event => event.name === 'click'));
      assert.ok(after.actions.some(event => event.name === 'change'));
      assert.ok(after.actions.some(event => event.args[0]?.type === 'change'));
      assert.equal(await original.locator('sp-checkbox').first().evaluate(element => element.checked), true);
    } else {
      const submit = after.actions.find(event => event.name === 'submit');
      assert.ok(submit);
      assert.deepEqual(submit.args[0], { likesAnimals: 'yes' });
      assert.equal(await original.getByRole('radio', { name: 'Yep', exact: true }).isChecked(), false, 'Original form state must stay unchanged');
    }
    const cleared = await bridge('clear-actions');
    assert.deepEqual(cleared.actions, []);
    assert.equal(cleared.actionsAvailable, true);
    results.push({ site: site.name, storyId: site.id, installedMv3: true, before, recorded: after.actions, cleared: true, originalPreviewIsolated: true });
    await page.close();
  }
  await writeFile(path.join(project, 'artifacts/runtime-actions-extension-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
