import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Uses npm run dev: the public Storybooks are proxied without fixture replacements.
const base = process.env.STORY_LIBRARY_TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({headless:true});
const results = [];
await mkdir('artifacts', {recursive:true});
try {
  const context = await browser.newContext({viewport:{width:1536,height:1100}, permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const library = page.locator('[data-story-library]');
  const sourceStoryCount = () => library.locator('.sl-canvas-world .sl-card').evaluateAll(cards => new Set(cards.map(card => card.dataset.story)).size);
  const settled = async () => {
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor({timeout:60000});
    await library.locator('.sl-properties-section[aria-busy="false"]').waitFor({timeout:60000});
  };
  const checkButtons = async (selector, disabled, treatment) => {
    await library.frameLocator(selector).locator('sp-button').first().waitFor();
    await page.waitForFunction(({selector, disabled, treatment}) => {
      const frame = document.querySelector('[data-story-library]').shadowRoot.querySelector(selector);
      const buttons = [...frame.contentDocument.querySelectorAll('sp-button')];
      return buttons.length > 0 && buttons.every(button => button.disabled === disabled && button.treatment === treatment);
    }, {selector, disabled, treatment}, {timeout:30000});
  };

  await page.goto(`${base}/spectrum-web-components/storybook/?path=/story/button-black-fill--primary`, {waitUntil:'domcontentloaded'});
  await settled();
  assert.equal(await sourceStoryCount(), 177, 'Spectrum opens all source stories in the Button family detail page');
  assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
  await library.locator('[data-group]').filter({has:page.getByText('Button', {exact:true})}).click();
  await settled();
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button-black-fill--primary');
  assert.equal(await library.locator('[data-variant-axis="path0"]').inputValue(), 'Black');
  assert.equal(await library.locator('[data-variant-axis="path1"]').inputValue(), 'Fill');
  const originalButtons = await library.frameLocator('.sl-inspector-preview iframe').locator('sp-button').evaluateAll(buttons => buttons.map(button => ({disabled:button.disabled,treatment:button.treatment})));
  await library.locator('[data-property="disabled"]').click();
  await settled();
  await library.locator('select[data-property="treatment"]').selectOption({label:'outline'});
  await settled();
  await checkButtons('.sl-inspector-preview iframe', true, 'outline');
  await checkButtons('.sl-canvas-world [data-story="button-black-fill--primary"][aria-selected="true"] iframe', true, 'outline');
  // Virtualization must restore edited args when the selected canvas instance
  // is released offscreen and later remounted from its cached preview.
  const canvasBounds = await library.locator('.sl-canvas').boundingBox();
  await page.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2);
  await page.mouse.wheel(0, 20000);
  await library.locator('.sl-canvas-world [data-story="button-black-fill--primary"][aria-selected="true"] iframe').waitFor({state:'detached',timeout:30000});
  await library.locator('[data-group]').filter({has:page.getByText('Button', {exact:true})}).click();
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button-black-fill--primary');
  await checkButtons('.sl-canvas-world [data-story="button-black-fill--primary"][aria-selected="true"] iframe', true, 'outline');
  await library.locator('.sl-primary-button[data-export="figma"]').click();
  await page.waitForFunction(async () => {
    try { const data=JSON.parse(await navigator.clipboard.readText()); return data.schema==='story-library/design' && data.properties.disabled===true; } catch { return false; }
  });
  const copied = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  assert.equal(copied.properties.treatment, 'outline');
  assert.equal(copied.variants.path0, 'Black');
  assert.ok(copied.nodes.some(node => node.type === 'text' && node.text.includes('Click Me')));
  await library.locator('.sl-inspector-body').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({path:'artifacts/spectrum-properties.png', fullPage:true});
  await library.locator('[data-action="expand"]').click();
  await checkButtons('.sl-expanded-inspector-preview iframe', true, 'outline');
  await library.locator('.sl-preview-modal [data-action="close-modal"]').click();
  await library.locator('[data-action="reset-properties"]').click();
  await settled();
  for (const selector of ['.sl-inspector-preview iframe', '.sl-canvas-world [data-story="button-black-fill--primary"][aria-selected="true"] iframe']) {
    await page.waitForFunction(({selector, originalButtons}) => {
      const doc=document.querySelector('[data-story-library]').shadowRoot.querySelector(selector).contentDocument;
      return JSON.stringify([...doc.querySelectorAll('sp-button')].map(button=>({disabled:button.disabled,treatment:button.treatment})))===JSON.stringify(originalButtons);
    }, {selector, originalButtons});
  }
  await library.locator('[data-variant-axis="path1"]').selectOption('Outline');
  await settled();
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button-black-outline--primary');
  results.push({site:'Spectrum',properties:'read/update/reset',canvasSync:true,panRemountPreservesArgs:true,shadowDomCopy:true,variants:'Black / Fill → Black / Outline',expandedRetainsArgs:true});

  await page.goto(`${base}/govuk-react/?path=/docs/form-group--docs`, {waitUntil:'domcontentloaded'});
  await settled();
  assert.equal(await library.locator('.sl-canvas-world .sl-card').count(), 5, 'The GOV.UK docs route opens its Form group detail page');
  assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
  await library.locator('[data-group]').filter({has:page.getByText('Form group', {exact:true})}).click();
  await settled();
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'form-group--default');
  await library.locator('[data-property="error"]').click();
  await settled();
  const hasErrorBorder = selector => page.waitForFunction(selector => {
    const doc=document.querySelector('[data-story-library]').shadowRoot.querySelector(selector).contentDocument;
    return [...doc.querySelectorAll('#storybook-root *')].some(element => {const s=doc.defaultView.getComputedStyle(element);return s.borderLeftWidth==='5px' && s.borderLeftColor==='rgb(212, 53, 28)';});
  }, selector, {timeout:30000});
  await hasErrorBorder('.sl-inspector-preview iframe');
  await hasErrorBorder('.sl-canvas-world [data-story="form-group--default"] iframe');
  await page.screenshot({path:'artifacts/govuk-properties.png',fullPage:true});
  await library.locator('[data-action="reset-properties"]').click();
  await settled();
  assert.equal(await library.locator('[data-property="error"]').getAttribute('aria-checked'), 'false');
  results.push({site:'GOV.UK',docsRoute:'Form group / Default',properties:'error → red border → reset',canvasSync:true});

  await page.goto(`${base}/?path=/story/badge--solid-badges`, {waitUntil:'domcontentloaded'});
  await settled();
  assert.equal(await sourceStoryCount(), 4, 'Chakra initially opens the four Badge source stories');
  assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'badge--solid-badges');
  await library.locator('.sl-primary-nav [data-view="all"]').click();
  const allStories = await sourceStoryCount();
  assert.equal(allStories, 157, 'All components mounts every Chakra story on one infinite canvas');
  assert.equal(await library.locator('.sl-master-frame:visible').count(), 54, 'Every Chakra family has its own master frame');
  await library.locator('[data-group]').filter({has:page.getByText('Badge', {exact:true})}).click();
  assert.equal(await sourceStoryCount(), 4, 'Badge navigation returns to its dedicated detail page');
  assert.equal(await library.locator('.sl-master-frame:visible').count(), 1);
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'badge--solid-badges', 'All/detail navigation preserves the selected Badge story');
  const badgeIds = await library.locator('#sl-variant-select option').evaluateAll(options => options.map(option => option.value));
  const sizes = [];
  // Discover each source story, then focus every individual Badge sample. This
  // also checks offscreen samples without forcing all iframe previews to load.
  for (const storyId of badgeIds) {
    await library.locator('#sl-variant-select').selectOption(storyId);
    await settled();
    const expectedExamples = storyId === 'badge--default' ? 1 : 6;
    if (expectedExamples > 1) {
      await library.locator('#sl-example-select').waitFor();
      assert.equal(await library.locator('#sl-example-select option').count(), 6);
    }
    const exampleKeys = expectedExamples > 1
      ? await library.locator('#sl-example-select option').evaluateAll(options => options.map(option => option.value))
      : [''];
    for (const exampleKey of exampleKeys) {
      if (exampleKey) await library.locator('#sl-example-select').selectOption(exampleKey);
      await settled();
      const nativeHeight = await library.frameLocator('.sl-inspector-preview iframe').locator('body').evaluate((body, exampleKey) => {
        const root = body.querySelector('#storybook-root, #root');
        let sample;
        if (exampleKey) {
          sample = exampleKey.split(':')[1].split('.').map(Number).reduce((parent, index) => [...parent.children].filter(child => !['STYLE','SCRIPT','LINK','META','TEMPLATE','NOSCRIPT'].includes(child.tagName))[index], root);
        } else {
          // The Default source contains one native badge. Read that primitive,
          // rather than the layout wrapper that spans the iframe's full width.
          sample = [...root.querySelectorAll('div,span')].filter(element => element.textContent.trim() === 'Success').at(-1);
        }
        return sample?.getBoundingClientRect().height || 0;
      }, exampleKey);
      assert.ok(nativeHeight > 0 && nativeHeight < 96, `Badge native height is measurable: ${storyId} / ${exampleKey}`);
      const expectedHeight = Math.ceil(Math.max(20, nativeHeight) + 32);
      await page.waitForFunction(({storyId, exampleKey, expectedHeight}) => {
        const card = document.querySelector('[data-story-library]').shadowRoot.querySelector('.sl-card[aria-selected="true"]');
        const preview = card?.querySelector('.sl-preview');
        return card?.dataset.story === storyId && card.dataset.example === exampleKey && preview?.dataset.state === 'ready' && Math.abs(preview.clientHeight - expectedHeight) <= 1;
      }, {storyId, exampleKey, expectedHeight}, {timeout:30000});
      sizes.push(await library.locator('.sl-canvas-world .sl-card[aria-selected="true"]').evaluate((card, {nativeHeight, expectedHeight}) => {
        const preview=card.querySelector('.sl-preview');
        return {story:card.dataset.story,example:card.dataset.example,name:card.querySelector('.sl-story-label').textContent,width:preview.clientWidth,height:preview.clientHeight,nativeHeight,expectedHeight,background:getComputedStyle(card).backgroundColor,border:getComputedStyle(card).borderWidth};
      }, {nativeHeight, expectedHeight}));
    }
  }
  await library.locator('#sl-variant-select').selectOption('badge--solid-badges');
  await settled();
  assert.equal(sizes.length,19);
  assert.equal(await library.locator('.sl-canvas-world .sl-card').count(),19, 'Badge renders one Default plus six examples from each color story');
  assert.equal(await sourceStoryCount(),4);
  assert.ok(sizes.every(size => Math.abs(size.height - size.expectedHeight) <= 1 && size.background==='rgba(0, 0, 0, 0)' && size.border==='0px'));
  await page.screenshot({path:'artifacts/chakra-raw-variants.png',fullPage:true});
  results.push({site:'Chakra',canvasStories:allStories,detailStories:4,individualExamples:19,rawVariants:sizes});
  await writeFile('artifacts/live-properties-results.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally { await browser.close(); }
