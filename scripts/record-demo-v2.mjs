// Before and after are recorded in the SAME tab using the installed MV3 bundle.
// Only the disposable capture copy receives localhost permission (automation
// cannot grant activeTab by clicking Chrome's native toolbar action).
import { chromium } from 'playwright';
import { mkdir, cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
const out = path.resolve('artifacts/demo-v2');
await mkdir(`${out}/raw`, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'story-library-demo-capture-'));
const extension = path.join(temporary, 'extension');
await cp('dist', extension, { recursive: true });
const manifest = JSON.parse(await readFile(`${extension}/manifest.json`, 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, colorScheme: 'light',
  viewport: { width: 1408, height: 688 },
  recordVideo: { dir: `${out}/raw`, size: { width: 1408, height: 688 } },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
let takes = [];
try { takes = JSON.parse(await readFile(`${out}/takes.json`, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const requestedScenes = new Set(process.argv.slice(2));
const base = 'http://127.0.0.1:4173';
const scenes = [
  { id: 'chakra', source: 'Chakra UI', route: '/?path=/story/heading--default', publicUrl: 'https://chakra-ui.netlify.app/?path=/story/heading--default', before: 5, after: 3 },
  { id: 'govuk', source: 'GOV.UK React', route: '/govuk-react/?path=/docs/form-group--docs', publicUrl: 'https://govuk-react.github.io/govuk-react/?path=/docs/form-group--docs', before: 3, after: 3 },
  { id: 'spectrum', source: 'Adobe Spectrum', route: '/spectrum-web-components/storybook/?path=/story/button-black-fill--primary', publicUrl: 'https://opensource.adobe.com/spectrum-web-components/storybook/?path=/story/button-black-fill--primary', before: 3, after: 3 },
];
async function ready(page) {
  await page.locator('.sl-inspector-preview[data-state="ready"]').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const root = document.querySelector('#story-library-host')?.shadowRoot;
    if (!root) return false;
    const viewport = root.querySelector('.sl-canvas').getBoundingClientRect();
    const visible = [...root.querySelectorAll('.sl-card .sl-preview')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    return visible.length && visible.every(el => el.dataset.state === 'ready' && [...el.querySelectorAll('img')].every(img => img.complete && img.naturalWidth));
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);
}
async function cursor(page) {
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-80px;top:-80px;width:22px;height:28px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 2px #0004)';
    el.innerHTML = '<svg viewBox="0 0 22 28" width="22" height="28"><path d="M2 2v21l5.8-5.2 4.2 8 4-2.2-4.2-7.7H20Z" fill="#151515" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.append(el);
    document.addEventListener('mousemove', event => { el.style.left = `${event.clientX}px`; el.style.top = `${event.clientY}px`; });
    document.addEventListener('mousedown', event => {
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${event.clientX - 10}px;top:${event.clientY - 10}px;width:20px;height:20px;z-index:2147483647;pointer-events:none;border:2px solid #0d99ff;border-radius:50%`;
      document.documentElement.append(ring);
      ring.animate([{transform:'scale(.4)',opacity:.9},{transform:'scale(1.7)',opacity:0}],{duration:380}).onfinish=()=>ring.remove();
    }, true);
  });
}
async function move(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}
try {
  for (const scene of scenes) {
    if (requestedScenes.size && !requestedScenes.has(scene.id)) continue;
    if (!requestedScenes.size && ['storybook', 'library'].every(mode => takes.some(take => take.id === scene.id && take.mode === mode))) {
      console.log(`Keeping existing ${scene.source} recordings`);
      continue;
    }
    const page = await context.newPage();
    await page.route('**/__library/content.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    await page.goto(base + scene.route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
      // Storybook 7/8 docs use a separate #storybook-docs root. #storybook-root
      // still exists alongside it but is empty in docs mode.
      return [...(doc?.querySelectorAll('#root, #storybook-root, #storybook-docs, .sbdocs') || [])]
        .some(root => root.innerText?.trim().length > 1);
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1400);
    const beforeStart = performance.now();
    await page.waitForTimeout(scene.before * 1000);
    const beforeEnd = performance.now();
    await page.screenshot({ path: `${out}/${scene.id}-before.png` });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    if (!Number.isInteger(tabId)) throw new Error(`No source tab: ${scene.id}`);
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), tabId);
    await ready(page);
    if (scene.id === 'chakra') {
      await page.locator('#sl-example-select').waitFor();
      await page.locator('[data-action="zoom-fit"]').click();
      await ready(page);
    }
    await page.locator('.sl-search input').blur();
    if (scene.id !== 'chakra') await page.locator('.sl-properties-section[aria-busy="false"]').waitFor();
    await cursor(page);
    await page.mouse.move(975, 340);
    const afterStart = performance.now();
    if (scene.id === 'chakra') {
      // Keep this view quiet so the reorganization into six variants is clear.
      await page.waitForTimeout(700);
      await move(page, page.locator('.sl-variants-section'));
    } else if (scene.id === 'govuk') {
      await page.waitForTimeout(450);
      await move(page, page.locator('[data-property="error"]'));
      await page.locator('[data-property="error"]').click();
      await page.locator('[data-property="error"][aria-checked="true"]').waitFor();
    } else {
      const control = page.locator('[data-property="disabled"]');
      await page.waitForTimeout(350);
      await move(page, control);
      await control.click();
      await page.locator('[data-property="disabled"][aria-checked="true"]').waitFor();
      await page.waitForTimeout(850);
      await control.click();
      await page.locator('[data-property="disabled"][aria-checked="false"]').waitFor();
    }
    await page.waitForTimeout(Math.max(0, scene.after * 1000 - (performance.now() - afterStart)));
    const afterEnd = performance.now();
    await page.screenshot({ path: `${out}/${scene.id}-after.png` });
    const end = performance.now();
    const video = page.video();
    await page.close();
    const filename = `${out}/raw/${scene.id}.webm`;
    await video.saveAs(filename);
    takes = takes.filter(take => take.id !== scene.id);
    takes.push(
      { ...scene, mode: 'storybook', filename, duration: scene.before, elapsed: (beforeEnd-beforeStart)/1000, fromEnd: (end-beforeStart)/1000 },
      { ...scene, mode: 'library', filename, duration: scene.after, elapsed: (afterEnd-afterStart)/1000, fromEnd: (end-afterStart)/1000 },
    );
    takes.sort((a, b) => scenes.findIndex(scene => scene.id === a.id) - scenes.findIndex(scene => scene.id === b.id) || (a.mode === 'storybook' ? -1 : 1));
    await writeFile(`${out}/takes.json`, JSON.stringify(takes, null, 2));
    console.log(`Recorded ${scene.source}: same-tab original ${scene.before}s → installed extension ${scene.after}s`);
  }
} finally {
  await context.close();
  await rm(temporary, { recursive: true, force: true });
}
