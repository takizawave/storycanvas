import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = path.join(root, 'artifacts/demo-v2');
await mkdir(out, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-demo-popup-'));
const extension = path.join(temporary, 'extension');
let context;
try {
  await cp(path.join(root, 'dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Disposable recording copy only: grants the same page access as an action click.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, deviceScaleFactor: 2,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.route('**/__library/content.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('http://127.0.0.1:4173/spectrum-web-components/storybook/?path=/story/button-black-fill--primary', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#storybook-preview-iframe').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('[data-story-library]').count(), 0);
  await page.bringToFront();
  let popupMode = 'chrome.action.openPopup';
  let openPopupError;
  let popup;
  try {
    await worker.evaluate(() => chrome.action.openPopup());
    popup = context.pages().find(candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/popup.html`));
    if (!popup) popup = await context.waitForEvent('page', { timeout: 5000, predicate: candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/popup.html`) });
  } catch (error) {
    popupMode = 'extension page';
    openPopupError = error.message;
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  }
  await popup.locator('#open').waitFor();
  const body = popup.locator('body');
  const bounds = await body.boundingBox();
  await body.screenshot({ path: path.join(out, 'popup.png') });
  const png = await readFile(path.join(out, 'popup.png'));
  let popupClickVerified = false;
  // The extension deliberately rejects OPEN_LIBRARY from a normal browser tab.
  // Thus an extension-page fallback is a capture surface, not a popup test.
  if (popupMode === 'chrome.action.openPopup') {
    await popup.locator('#open').evaluate(button => button.click());
    await page.locator('[data-story-library]').waitFor({ timeout: 30000 });
    popupClickVerified = true;
  }
  const result = {
    popupMode, openPopupError, bounds,
    imagePixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    bytes: png.length, popupClickVerified,
    note: popupClickVerified ? 'Real popup click verified.' : 'Unmodified dist/popup.html captured as an extension page. Normal extension tabs cannot invoke OPEN_LIBRARY because sender.tab is deliberately rejected.',
  };
  await writeFile(path.join(out, 'popup-capture.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
