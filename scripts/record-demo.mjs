// Record the actual shipped UI. Loading time is trimmed in the final edit.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

const out = path.resolve('artifacts/demo');
await mkdir(`${out}/raw`, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1408, height: 688 }, colorScheme: 'light',
  recordVideo: { dir: `${out}/raw`, size: { width: 1408, height: 688 } },
});
const base = 'http://127.0.0.1:4173';
const onlyScene = process.env.DEMO_SCENE;
const takes = onlyScene ? JSON.parse(await readFile(`${out}/takes.json`, 'utf8')) : [];

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
  await page.waitForTimeout(700);
}

async function cursor(page) {
  // The visible pointer follows the actual mouse operations in this recording.
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'demo-cursor';
    el.style.cssText = 'position:fixed;left:-80px;top:-80px;width:22px;height:28px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 2px #0004)';
    el.innerHTML = '<svg viewBox="0 0 22 28" width="22" height="28"><path d="M2 2v21l5.8-5.2 4.2 8 4-2.2-4.2-7.7H20Z" fill="#151515" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.append(el);
    document.addEventListener('mousemove', event => { el.style.left = `${event.clientX}px`; el.style.top = `${event.clientY}px`; });
  });
}
async function move(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The recorded control must be visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
}
async function take({ id, route, original, duration, setup, action }) {
  if (onlyScene && id !== onlyScene) return;
  const page = await context.newPage();
  if (original) await page.route('**/__library/content.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  if (original) {
    await page.frameLocator('#storybook-preview-iframe').getByText('Heading 6', { exact: true }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
  } else await ready(page);
  if (setup) await setup(page);
  if (!original) await ready(page);
  await cursor(page);
  await page.mouse.move(800, 608);
  await page.waitForTimeout(400);
  const start = performance.now();
  if (action) await action(page);
  const rest = Math.max(0, duration * 1000 - (performance.now() - start));
  await page.waitForTimeout(rest);
  const elapsed = (performance.now() - start) / 1000;
  await page.screenshot({ path: `${out}/${id}.png` });
  const tail = (performance.now() - start) / 1000 - elapsed;
  const video = page.video();
  await page.close();
  const filename = `${out}/raw/${id}.webm`;
  await video.saveAs(filename);
  const recorded = { id, filename, duration, elapsed, tail };
  const existing = takes.findIndex(take => take.id === id);
  if (existing >= 0) takes[existing] = recorded;
  else takes.push(recorded);
  await writeFile(`${out}/takes.json`, JSON.stringify(takes, null, 2));
  console.log(`Recorded ${id}: ${elapsed.toFixed(2)}s of actual UI`);
}

try {
  await take({ id: '01-storybook', route: '/?path=/story/heading--default', original: true, duration: 1.2 });
  await take({
    id: '02-chakra', route: '/?path=/story/heading--default', duration: 2.4,
    setup: async page => {
      await page.locator('#sl-example-select').waitFor();
      await page.locator('[data-action="zoom-fit"]').click();
      await page.locator('.sl-search input').blur();
    },
    action: async page => {
      await page.waitForTimeout(550);
      const card = page.locator('.sl-card').filter({ has: page.locator('.sl-story-label', { hasText: 'Heading 3' }) });
      await move(page, card.locator('.sl-preview'));
      await card.click();
      await page.waitForTimeout(650);
      await move(page, page.locator('.sl-source-select'));
    },
  });
  await take({
    id: '03-govuk', route: '/govuk-react/?path=/docs/form-group--docs', duration: 2.5,
    setup: async page => {
      await page.locator('.sl-search input').blur();
      await page.locator('[data-property="error"]').waitFor();
    },
    action: async page => {
      await page.waitForTimeout(350);
      await move(page, page.locator('[data-property="error"]'));
      await page.waitForTimeout(150);
      await page.locator('[data-property="error"]').click();
      await page.waitForTimeout(700);
      await move(page, page.locator('.sl-source-select'));
    },
  });
  await take({
    id: '04-spectrum', route: '/spectrum-web-components/storybook/?path=/story/button-black-fill--primary', duration: 3.9,
    setup: async page => {
      await page.locator('.sl-source-logo img').waitFor();
      await page.locator('.sl-properties-section[aria-busy="false"]').waitFor();
      await page.locator('.sl-search input').blur();
    },
    action: async page => {
      await page.waitForTimeout(500);
      const control = page.locator('[data-property="treatment"]');
      await move(page, control);
      await page.waitForTimeout(220);
      await control.selectOption({ label: 'outline' });
      await page.locator('.sl-properties-section[aria-busy="false"]').waitFor();
      await page.waitForTimeout(850);
      await page.mouse.move(930, 585, { steps: 18 });
    },
  });
} finally {
  await context.close();
  await browser.close();
}
