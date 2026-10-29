import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixtures/server.mjs';

const fixture = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const html = await readFile('tests/fixtures/iframe.html', 'utf8');
  // A fixture Story explicitly registers and emits addon Actions. The library
  // must observe that channel, never infer an action from arbitrary DOM clicks.
  const withActions = html.replace('</script>', `
    const actionListeners = new Map();
    const channel = {
      on(name, fn) { if (!actionListeners.has(name)) actionListeners.set(name, new Set()); actionListeners.get(name).add(fn); },
      off(name, fn) { actionListeners.get(name)?.delete(fn); },
      emit(name, data) { for (const fn of actionListeners.get(name) || []) fn(data); },
    };
    window.__STORYBOOK_ADDONS_CHANNEL__ = channel;
    const originalFromId = window.__STORYBOOK_STORY_STORE__.fromId;
    window.__STORYBOOK_STORY_STORE__.fromId = id => ({...originalFromId(id), argTypes:{onClick:{action:'onClick',control:false,type:{name:'function'}}}, parameters:{actions:{}}});
    let sequence = 0;
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button) channel.emit('storybook/actions/action-event', {id: 'test-' + ++sequence, data:{name:'onClick',args:[{label:button.textContent}]} });
    });
  </script>`);
  await page.route('**/iframe.html?*', route => route.fulfill({ contentType: 'text/html', body: withActions }));
  await page.goto(`${fixture.baseUrl}?path=/story/button--primary`);
  await page.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const library = page.locator('[data-story-library]');
  const actions = library.locator('.sl-actions-section');
  const empty = () => actions.getByText('記録されたイベントはありません。').waitFor();
  const inspectorButton = () => library.frameLocator('.sl-inspector-preview iframe').getByRole('button', { name: 'Get started' });
  await empty();
  await inspectorButton().click();
  await actions.locator('.sl-action-event').waitFor();
  assert.equal(await actions.locator('.sl-action-event-heading strong').textContent(), 'onClick');
  assert.match(await actions.locator('.sl-action-args').textContent(), /Get started/);
  console.log('✓ registered Actions appear after interacting with the live inspector');

  await library.locator('[data-action="clear-actions"]').click();
  await empty();
  assert.equal(await actions.locator('.sl-action-event').count(), 0);
  console.log('✓ clearing removes only the selected preview history');

  await library.locator('.sl-canvas-world .sl-card[data-story="button--primary"] iframe').evaluate(frame => frame.contentDocument.querySelector('button').click());
  await page.waitForTimeout(1700);
  assert.equal(await actions.locator('.sl-action-event').count(), 0);
  console.log('✓ another canvas iframe cannot pollute inspector Actions');

  await library.locator('[data-action="expand"]').click();
  await inspectorButton().click();
  await library.locator('[data-action="close-modal"]').click();
  await actions.locator('.sl-action-event').waitFor();
  console.log('✓ expanded preview events remain in the same action history');

  await library.locator('#sl-variant-select').selectOption('button--secondary');
  await empty();
  await inspectorButton().click();
  await actions.locator('.sl-action-event').waitFor();
  assert.equal(await actions.locator('.sl-action-event').count(), 1);
  await library.locator('[data-action="close"]').click();
  await library.waitFor({ state: 'detached' });
  console.log('✓ changing stories starts a fresh history and closing tears down previews');
} finally {
  await browser.close();
  await fixture.close();
}
