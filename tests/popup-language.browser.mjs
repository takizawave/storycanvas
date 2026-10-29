/** Popup language behavior in the shipped MV3 extension. No host permissions
 * or external pages are required; every profile and extension copy is disposable. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-popup-language-'));
const extension = path.join(temporary, 'extension');
const storageKey = 'story-library-language';
let context;
let completed = 0;
const pageErrors = [];
async function check(name, action) {
  await action();
  completed++;
  console.log(`✓ ${name}`);
}

try {
  await cp(path.join(project, 'dist'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 340, height: 560 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).host_permissions, undefined);
  const openPopup = async () => {
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    return page;
  };
  const waitLanguage = (page, language) => page.waitForFunction(language => document.documentElement.lang === language, language);
  const waitSaved = (page, language) => page.waitForFunction(async ({ key, language }) => (await chrome.storage.local.get(key))[key] === language, { key: storageKey, language });
  let popup = await openPopup();

  await check('Japanese is the default and the compact language buttons expose their selection', async () => {
    assert.equal(await popup.locator('html').getAttribute('lang'), 'ja');
    assert.equal(await popup.getByRole('button', { name: '日本語', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await popup.getByRole('button', { name: 'English', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.match(await popup.locator('#open').textContent(), /このStorybookを展開/);
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });

  await check('English updates the copy, persists in extension storage, and survives reopening', async () => {
    await popup.getByRole('button', { name: 'English', exact: true }).click();
    await waitSaved(popup, 'en');
    assert.equal(await popup.getByRole('button', { name: 'English', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await popup.locator('h1').innerText(), /Turn Storybook into\nyour design library\./);
    assert.match(await popup.locator('.examples').textContent(), /Try a public library/);
    assert.match(await popup.locator('footer').textContent(), /Link/);
    await popup.close();
    popup = await openPopup();
    await waitLanguage(popup, 'en');
    assert.match(await popup.locator('#open').textContent(), /Open this Storybook/);
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });

  await check('invalid-page errors follow the selected language immediately', async () => {
    // This active tab is the extension popup itself, not an HTTP Storybook.
    await popup.locator('#open').click();
    await popup.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.equal(await popup.locator('#status').textContent(), 'Open a Storybook page, then try again.');
    await popup.getByRole('button', { name: '日本語', exact: true }).click();
    await waitSaved(popup, 'ja');
    assert.equal(await popup.locator('#status').textContent(), 'Storybookのページを開いてからお試しください。');
    assert.equal(await popup.locator('#open').isEnabled(), true);
  });

  await check('switching language also updates an in-flight loading message and the resulting error', async () => {
    await popup.evaluate(() => {
      chrome.tabs.query = () => new Promise(resolve => { window.finishTabQuery = resolve; });
    });
    await popup.locator('#open').click();
    assert.equal(await popup.locator('#status').textContent(), 'ライブラリを開いています…');
    await popup.getByRole('button', { name: 'English', exact: true }).click();
    assert.equal(await popup.locator('#status').textContent(), 'Opening the library…');
    await popup.waitForFunction(() => typeof window.finishTabQuery === 'function');
    await popup.evaluate(() => window.finishTabQuery([{ id: 1, url: 'chrome://extensions/' }]));
    await popup.waitForFunction(() => !document.querySelector('#open').disabled);
    assert.equal(await popup.locator('#status').textContent(), 'Open a Storybook page, then try again.');
  });

  await check('the open request carries the language and connection failures are localized', async () => {
    await popup.evaluate(() => {
      chrome.tabs.query = async () => [{ id: 42, url: 'https://storybook.example/' }];
      chrome.runtime.sendMessage = async message => {
        window.lastOpenRequest = message;
        return { ok: false, error: 'A raw browser diagnostic' };
      };
    });
    await popup.locator('#open').click();
    await popup.waitForFunction(() => !document.querySelector('#open').disabled);
    assert.deepEqual(await popup.evaluate(() => window.lastOpenRequest), { type: 'OPEN_LIBRARY', tabId: 42, language: 'en' });
    assert.equal(await popup.locator('#status').textContent(), 'The library could not be opened. Reload the page, then try again.');
    await popup.getByRole('button', { name: '日本語', exact: true }).click();
    assert.equal(await popup.locator('#status').textContent(), 'ライブラリを開けませんでした。ページを再読み込みして、もう一度お試しください。');
    await waitSaved(popup, 'ja');
    await popup.close();
    popup = await openPopup();
    await waitLanguage(popup, 'ja');
    assert.match(await popup.locator('#open').textContent(), /このStorybookを展開/);
  });

  await check('the next popup reads a language saved by another extension context', async () => {
    await worker.evaluate(key => chrome.storage.local.set({ [key]: 'en' }), storageKey);
    await popup.close();
    popup = await openPopup();
    await waitLanguage(popup, 'en');
    assert.match(await popup.locator('#open').textContent(), /Open this Storybook/);
  });

  assert.deepEqual(pageErrors, []);
  console.log(`${completed} popup language checks passed.`);
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
