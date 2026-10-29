import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Uses npm run dev. Every preview and addon event comes from the public
// Storybook through the development proxy; no runtime or DOM events are mocked.
const base = process.env.STORY_LIBRARY_TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const results = [];
await mkdir('artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1100 } });
  const library = page.locator('[data-story-library]');
  const sourceStoryCount = () => library.locator('.sl-canvas-world .sl-card').evaluateAll(cards => new Set(cards.map(card => card.dataset.story)).size);
  const settled = async () => {
    await library.locator('.sl-inspector-preview[data-state="ready"]').waitFor({ timeout: 60000 });
    await library.locator('.sl-properties-section[aria-busy="false"]').waitFor({ timeout: 60000 });
    assert.equal(await library.locator('.sl-properties-error').count(), 0, 'Properties must load without an error');
  };
  const emptyActions = async () => {
    await library.locator('.sl-actions-section').getByText('記録されたイベントはありません。', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await library.locator('.sl-action-event').count(), 0);
    assert.doesNotMatch(await library.locator('.sl-actions-section').innerText(), /取得できません|読み込み中/);
  };
  const visiblePreviewsReady = () => page.waitForFunction(() => {
    const root = document.querySelector('[data-story-library]').shadowRoot;
    const viewport = root.querySelector('.sl-canvas').getBoundingClientRect();
    const visible = [...root.querySelectorAll('.sl-canvas-world .sl-preview')].filter(preview => {
      const box = preview.getBoundingClientRect();
      return box.right > viewport.left && box.left < viewport.right && box.bottom > viewport.top && box.top < viewport.bottom;
    });
    return visible.length > 0 && visible.every(preview => ['ready', 'error'].includes(preview.dataset.state) && [...preview.querySelectorAll('img')].every(image => image.complete));
  }, {}, { timeout: 60000 });
  const switchSource = async label => {
    const target = await library.getByRole('combobox', { name: 'ライブラリを切り替え' }).locator('option').evaluateAll((options, label) => options.find(option => option.textContent === label)?.value, label);
    assert.ok(target, `Source switcher offers ${label}`);
    await Promise.all([
      page.waitForURL(target, { waitUntil: 'domcontentloaded', timeout: 60000 }),
      library.getByRole('combobox', { name: 'ライブラリを切り替え' }).selectOption({ label }),
    ]);
    await settled();
    assert.equal(await library.getByRole('combobox', { name: 'ライブラリを切り替え' }).inputValue(), target);
  };
  const formErrorBorder = expected => page.waitForFunction(expected => {
    const root = document.querySelector('[data-story-library]').shadowRoot;
    const selectors = ['.sl-inspector-preview iframe', '.sl-card[data-story="form-group--default"][aria-selected="true"] iframe'];
    return selectors.every(selector => {
      const doc = root.querySelector(selector)?.contentDocument;
      if (!doc?.querySelector('#storybook-root')) return false;
      const hasBorder = [...doc.querySelectorAll('#storybook-root *')].some(element => {
        const style = doc.defaultView.getComputedStyle(element);
        return style.borderLeftWidth === '5px' && style.borderLeftColor === 'rgb(212, 53, 28)';
      });
      return hasBorder === expected;
    });
  }, expected, { timeout: 30000 });

  await page.goto(`${base}/spectrum-web-components/storybook/?path=/story/button-black-fill--primary`, { waitUntil: 'domcontentloaded' });
  await settled();
  assert.deepEqual(await library.locator('.sl-source-select option').allTextContents(), ['Adobe Spectrum', 'GOV.UK React', 'Chakra UI']);
  assert.equal(await sourceStoryCount(), 177);
  assert.equal(await library.locator('.sl-master-frame').count(), 1);
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button-black-fill--primary');
  assert.deepEqual(await library.locator('[data-variant-axis]').evaluateAll(controls => controls.map(control => ({ axis: control.dataset.variantAxis, value: control.value }))), [
    { axis: 'path0', value: 'Black' }, { axis: 'path1', value: 'Fill' }, { axis: 'path2', value: 'Base' },
  ]);
  assert.deepEqual((await library.locator('.sl-properties-section .sl-property-label > span:last-of-type').allTextContents()).sort(), ['disabled', 'href', 'label', 'pending', 'staticColor', 'treatment', 'variant']);
  await emptyActions();
  await library.frameLocator('.sl-inspector-preview iframe').locator('sp-button:not([disabled])').first().click();
  await page.waitForTimeout(1700); // Allow the Actions polling interval to run.
  await emptyActions();
  await visiblePreviewsReady();
  await page.screenshot({ path: 'artifacts/modern-spectrum-library.png', fullPage: true });
  results.push({ site: 'Spectrum', sourceStories: 177, controls: 7, variantAxes: 3, unregisteredButtonActions: 'empty history, not unavailable' });
  console.log('✓ Spectrum exposes seven Controls and hierarchy variants; unregistered button clicks remain an empty Actions history');

  await switchSource('GOV.UK React');
  assert.equal(new URL(page.url()).searchParams.get('path'), '/docs/form-group--docs');
  assert.equal(await sourceStoryCount(), 5);
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'form-group--default');
  assert.equal(await library.locator('.sl-properties-section .sl-property-row').count(), 6);
  await library.locator('[data-property="error"]').click();
  await settled();
  assert.equal(await library.locator('[data-property="error"]').getAttribute('aria-checked'), 'true');
  await formErrorBorder(true);
  await emptyActions();
  await visiblePreviewsReady();
  await page.screenshot({ path: 'artifacts/modern-govuk-library.png', fullPage: true });
  await library.locator('[data-action="reset-properties"]').click();
  await settled();
  await formErrorBorder(false);
  assert.equal(await library.locator('[data-property="error"]').getAttribute('aria-checked'), 'false');
  results.push({ site: 'GOV.UK', sourceSwitch: 'Spectrum → GOV.UK docs', sourceStories: 5, controls: 6, errorProperty: 'inspector and canvas red border, then reset' });
  console.log('✓ Header source switching opens GOV.UK docs as Form group; its error Control updates and resets both previews');

  await switchSource('Adobe Spectrum');
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'button-black-fill--primary');
  await library.locator('[data-group="Checkbox"]').click();
  await library.locator('#sl-variant-select').selectOption('checkbox-sizes--s');
  await settled();
  await emptyActions();
  await library.frameLocator('.sl-inspector-preview iframe').locator('sp-checkbox').click();
  await page.waitForFunction(() => {
    const names = [...document.querySelector('[data-story-library]').shadowRoot.querySelectorAll('.sl-action-event-heading strong')].map(element => element.textContent);
    return names.includes('click') && names.includes('change');
  }, {}, { timeout: 30000 });
  const actions = await library.locator('.sl-action-event').evaluateAll(events => events.map(event => ({ name: event.querySelector('strong').textContent, args: JSON.parse(event.querySelector('.sl-action-args').textContent) })));
  assert.deepEqual(actions.map(event => event.name).sort(), ['change', 'click']);
  for (const action of actions) {
    assert.ok(Array.isArray(action.args), 'Single Event payloads are normalized into argument arrays');
    assert.ok(action.args.length > 0);
  }
  await visiblePreviewsReady();
  await library.locator('.sl-actions-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/modern-spectrum-actions.png', fullPage: true });
  await library.getByRole('button', { name: 'アクションの履歴をクリア' }).click();
  await emptyActions();
  assert.equal(await library.getByRole('button', { name: 'アクションの履歴をクリア' }).isDisabled(), true);
  results.push({ site: 'Spectrum', sourceSwitch: 'GOV.UK → Spectrum', story: 'checkbox-sizes--s', actions, clearHistory: 'passed' });
  console.log('✓ Real Spectrum Checkbox addon Actions appear as click/change with arguments and can be cleared');

  await switchSource('Chakra UI');
  assert.equal(await library.locator('#sl-variant-select').inputValue(), 'heading--default');
  await library.locator('#sl-example-select').waitFor({ timeout: 30000 });
  assert.equal(await library.locator('#sl-example-select option').count(), 6);
  assert.match(await library.locator('.sl-properties-section').innerText(), /プロパティを公開していません/);
  results.push({ site: 'Chakra', sourceSwitch: 'Spectrum → Chakra', story: 'heading--default', individualExamples: 6, controls: 'not published by legacy source' });
  console.log('✓ The third source choice opens Chakra and preserves its six individual Heading examples');

  await writeFile('artifacts/modern-library-results.json', JSON.stringify(results, null, 2));
  console.log('\n4 modern library live checks passed.');
} finally {
  await browser.close();
}
