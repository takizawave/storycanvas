import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// npm run dev proxies the actual public Chakra Storybook without fixtures.
// Clipboard permission is confined to this disposable local browser context.
const base = process.env.STORY_LIBRARY_TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const results = {};
await mkdir('artifacts', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1536, height: 1100 }, colorScheme: 'light' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  const library = page.locator('[data-story-library]');
  const settle = async () => {
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor({ timeout: 60000 });
    await library.locator('.sl-properties-section[aria-busy="false"]').waitFor({ timeout: 60000 });
  };
  const family = title => library.locator('.sl-nav-item').filter({ has: page.getByText(title, { exact: true }) }).click();
  const expectCards = count => page.waitForFunction(count => document.querySelector('[data-story-library]')?.shadowRoot.querySelectorAll('.sl-canvas-world .sl-card').length === count, count, { timeout: 60000 });
  const snapshotPixels = async () => page.evaluate(async () => {
    const root = document.querySelector('[data-story-library]').shadowRoot;
    const images = [...root.querySelectorAll('.sl-card:not(.sl-selected) .sl-preview-snapshot')];
    return Promise.all(images.map(async image => {
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let paintedPixels = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) paintedPixels++;
      const style = getComputedStyle(image);
      return { label: image.closest('.sl-card').querySelector('.sl-story-label').textContent, width: image.naturalWidth, height: image.naturalHeight, paintedPixels, left: style.left, top: style.top };
    }));
  });

  await page.goto(`${base}/?path=/story/accordion--default`, { waitUntil: 'domcontentloaded' });
  await settle();
  await family('Heading');
  await expectCards(6);
  await settle();
  assert.equal(await library.locator('.sl-card[data-example=""]').count(), 0, 'Every heading should reference its real source element');
  assert.equal(await library.locator('#sl-variant-select option').count(), 1);
  assert.equal(await library.locator('#sl-example-select option').count(), 6);
  assert.equal((await library.locator('.sl-variants-section .sl-inspector-section-heading > span').textContent()).trim(), '6', 'Heading variant count should reflect its six real examples');
  await library.locator('[data-action="zoom-fit"]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-story-library]').shadowRoot;
    return [...root.querySelectorAll('.sl-card:not(.sl-selected)')].every(card => card.querySelector('.sl-preview-snapshot')?.naturalWidth > 0);
  }, null, { timeout: 60000 });
  const headingImages = await snapshotPixels();
  assert.equal(headingImages.length, 5);
  assert.ok(headingImages.every(image => image.paintedPixels > 10), 'Nonselected Heading snapshots must contain actual painted text');
  assert.ok(headingImages.every(image => image.left === '16px' && image.top === '16px'), 'Each real sample has 16px surrounding space');
  const masterPadding = await library.locator('.sl-master-frame').evaluate(frame => {
    const cards = [...frame.parentElement.querySelectorAll('.sl-card')];
    return {
      left: Math.min(...cards.map(card => parseFloat(card.style.left))) - parseFloat(frame.style.left),
      top: Math.min(...cards.map(card => parseFloat(card.style.top))) - parseFloat(frame.style.top) - 24,
    };
  });
  assert.deepEqual(masterPadding, { left: 40, top: 40 });
  const headingOptions = await library.locator('#sl-example-select option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent })));
  const third = headingOptions.find(option => /Heading\s*3/i.test(option.label));
  assert.ok(third, `Heading 3 should be selectable: ${JSON.stringify(headingOptions)}`);
  await library.locator('#sl-example-select').selectOption(third.value);
  await settle();
  assert.equal(await library.locator('.sl-card.sl-selected').getAttribute('data-example'), third.value);
  await library.locator('.sl-primary-button[data-export="figma"]').click();
  await page.waitForFunction(async () => { try { return JSON.parse(await navigator.clipboard.readText()).schema === 'story-library/design'; } catch { return false; } });
  const design = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  const copiedTexts = design.nodes.filter(node => node.type === 'text').map(node => node.text);
  assert.match(copiedTexts.join(' '), /Heading\s*3/i);
  assert.doesNotMatch(copiedTexts.join(' '), /Heading\s*[12456]/i, 'Figma copy must contain only the selected heading example');
  await library.locator('.sl-format-actions [data-export="html"]').click();
  const sourceHeadingTag = third.value.split(':')[0].toUpperCase();
  await page.waitForFunction(async tag => { const text = await navigator.clipboard.readText(); return text.toLowerCase().startsWith(`<${tag.toLowerCase()}`) && /Heading\s*3/i.test(text); }, sourceHeadingTag);
  const html = await page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    const parsed = new DOMParser().parseFromString(text, 'text/html');
    return { headings: [...parsed.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(node => ({ tag: node.tagName, text: node.textContent })) };
  });
  assert.equal(html.headings.length, 1);
  assert.equal(html.headings[0].tag, sourceHeadingTag);
  assert.match(html.headings[0].text, /Heading\s*3/i);
  await library.locator('.sl-inspector-body').evaluate(element => { element.scrollTop = 0; });
  await library.locator('[data-action="zoom-fit"]').click();
  await library.locator('.sl-toast.sl-show').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'artifacts/heading-examples.png', fullPage: true, animations: 'disabled' });
  results.heading = { stories: 1, examples: 6, labels: headingOptions.map(option => option.label), masterPadding, snapshots: headingImages, figmaTexts: copiedTexts, html: html.headings };

  await family('Breadcrumb');
  await settle();
  const breadcrumbStories = await library.locator('#sl-variant-select option').count();
  await expectCards(breadcrumbStories);
  assert.equal(await library.locator('.sl-card:not([data-example=""])').count(), 0, 'Breadcrumb links must remain part of their compound component');
  assert.equal(await library.locator('#sl-example-select').count(), 0);
  const metadata = await library.locator('.sl-card .sl-story-label').evaluateAll(labels => labels.map(label => ({ text: label.textContent, selected: label.closest('.sl-card').classList.contains('sl-selected'), color: getComputedStyle(label).color, size: getComputedStyle(label).fontSize, weight: getComputedStyle(label).fontWeight, top: getComputedStyle(label.closest('.sl-card-footer')).top })));
  assert.ok(metadata.every(label => label.color === (label.selected ? 'rgb(8, 121, 196)' : 'rgb(138, 56, 245)') && label.size === '10px' && label.weight === '400' && parseFloat(label.top) < 0), 'Story metadata should be small labels above the component, blue when selected and purple otherwise');
  await library.locator('[data-action="zoom-fit"]').click();
  await page.waitForFunction(() => [...document.querySelector('[data-story-library]').shadowRoot.querySelectorAll('.sl-card .sl-preview')].every(preview => preview.dataset.state === 'ready'), null, { timeout: 60000 });
  await page.screenshot({ path: 'artifacts/breadcrumb-metadata.png', fullPage: true, animations: 'disabled' });
  results.breadcrumb = { stories: breadcrumbStories, examples: breadcrumbStories, compoundPreserved: true, metadata };

  await family('Badge');
  await expectCards(19);
  await settle();
  assert.equal(await library.locator('#sl-variant-select option').count(), 4);
  assert.equal((await library.locator('.sl-variants-section .sl-inspector-section-heading > span').textContent()).trim(), '19', 'Badge variant count should reflect all nineteen real examples');
  const badgeStories = await library.locator('.sl-card').evaluateAll(cards => cards.reduce((result, card) => { result[card.dataset.story] = (result[card.dataset.story] || 0) + 1; return result; }, {}));
  assert.deepEqual(badgeStories, { 'badge--default': 1, 'badge--solid-badges': 6, 'badge--subtle-badges': 6, 'badge--outline-badges': 6 });
  await library.locator('[data-action="zoom-fit"]').click();
  await page.waitForFunction(() => [...document.querySelector('[data-story-library]').shadowRoot.querySelectorAll('.sl-card .sl-preview')].every(preview => preview.dataset.state === 'ready'), null, { timeout: 60000 });
  const badgeImages = await snapshotPixels();
  assert.ok(badgeImages.length >= 12 && badgeImages.every(image => image.paintedPixels > 10), 'Badge snapshots, including Outline, must render visible samples');
  await page.screenshot({ path: 'artifacts/badge-examples.png', fullPage: true, animations: 'disabled' });
  results.badge = { stories: 4, examples: 19, examplesPerStory: badgeStories, paintedSnapshots: badgeImages.length };
  await writeFile('artifacts/story-examples-live-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
