import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { storyRuntimeAction } from '../src/story-runtime.js';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [site, url, updates] of [
    ['spectrum', 'https://opensource.adobe.com/spectrum-web-components/storybook/iframe.html?id=button-black-fill--primary&viewMode=story', { disabled: true, treatment: 'outline' }],
    ['govuk', 'https://govuk-react.github.io/govuk-react/iframe.html?id=form-group--default&viewMode=story', { error: true }],
    ['chakra', 'https://chakra-ui.netlify.app/iframe.html?id=accordion--default&viewMode=story', null],
  ]) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => { try { return window.__STORYBOOK_PREVIEW__?.currentRender?.story || window.__STORYBOOK_CLIENT_API__?.raw?.()?.length; } catch { return false; } }, {}, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate(source => { window.name = 'story-library-inspector-runtime-test'; window.testRuntime = (0, eval)(`(${source})`); }, storyRuntimeAction.toString());
    const request = { frameName: 'story-library-inspector-runtime-test', storyId: new URL(url).searchParams.get('id') };
    const call = input => page.evaluate(input => window.testRuntime(input), input);
    assert.equal(await call({ ...request, frameName: 'wrong-frame' }), null);
    const before = await call(request);
    assert.equal(before.error, undefined, `${site}: ${before.error}`);
    let rendered;
    if (updates) {
      const htmlBefore = await page.locator('#storybook-root, #root').first().innerHTML();
      const changed = await call({ ...request, operation: 'update', updatedArgs: updates });
      assert.equal(changed.error, undefined, `${site}: ${changed.error}`);
      for (const [key, value] of Object.entries(updates)) assert.equal(changed.args[key], value);
      await page.waitForTimeout(300);
      const htmlAfter = await page.locator('#storybook-root, #root').first().innerHTML();
      assert.notEqual(htmlBefore, htmlAfter, `${site} DOM should change`);
      if (site === 'spectrum') {
        rendered = await page.locator('sp-button').evaluateAll(buttons => buttons.map(button => ({ disabled: button.disabled, treatment: button.treatment })));
        assert.ok(rendered.some(button => button.disabled === true && button.treatment === 'outline'));
        assert.deepEqual(before.argTypes.treatment.options, ['fill', 'outline']);
      } else {
        rendered = await page.locator('#storybook-root').evaluate(root => [...root.querySelectorAll('*')].map(el => ({ tag: el.tagName, borderLeft: getComputedStyle(el).borderLeft })).filter(item => !item.borderLeft.startsWith('0px')));
        assert.ok(rendered.some(item => item.borderLeft.includes('5px') && item.borderLeft.includes('rgb(212, 53, 28)')));
        assert.ok(before.omittedArgs.includes('children'));
      }
      const reset = await call({ ...request, operation: 'reset' });
      for (const key of Object.keys(updates)) assert.equal(reset.args[key], before.args[key]);
      const htmlReset = await page.locator('#storybook-root, #root').first().innerHTML();
      assert.equal(htmlReset, htmlBefore, `${site} reset should restore original DOM`);
    } else assert.equal(before.unavailable, true);
    results.push({ site, storyId: request.storyId, properties: Object.keys(before.argTypes), available: before.available, rendered, reset: updates ? 'passed' : 'not applicable' });
    await page.close();
  }
  await writeFile('artifacts/story-runtime-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
