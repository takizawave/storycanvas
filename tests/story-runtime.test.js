import test from 'node:test';
import assert from 'node:assert/strict';
import { storyRuntimeAction } from '../src/story-runtime.js';

function fixture() {
  const node = { $$typeof: Symbol.for('react.element'), props: { children: 'Example' } };
  const story = { id: 'button--primary', initialArgs: { disabled: false, variant: 'primary', children: node }, argTypes: {
    disabled: { control: { type: 'boolean' }, type: { name: 'boolean' } },
    variant: { control: { type: 'inline-radio', options: ['primary', 'secondary'] } },
    children: { control: { type: 'object' } },
  } };
  let args = { ...story.initialArgs }, renders = 0, emits = 0;
  const store = { args: { get: () => args, update: (_, value) => { args = { ...args, ...value }; for (const key of Object.keys(args)) if (args[key] === undefined) delete args[key]; } }, getStoryContext: () => ({ args }) };
  const runtime = { name: 'story-library-inspector-test', location: { href: 'https://example.com/iframe.html?id=button--primary' }, Object, __STORYBOOK_PREVIEW__: { storyStore: store, currentRender: { id: story.id, story, rerender: async () => renders++ } }, __STORYBOOK_ADDONS_CHANNEL__: { emit: () => emits++ } };
  const request = { frameName: runtime.name, storyId: story.id };
  return { runtime, request, node, stats: () => ({ args, renders, emits }) };
}

test('runtime only reads the requested frame and story', async () => {
  const f = fixture();
  assert.equal(await storyRuntimeAction({ ...f.request, frameName: 'other' }, f.runtime), null);
  const mismatch = await storyRuntimeAction({ ...f.request, storyId: 'other--story' }, f.runtime);
  assert.equal(mismatch.code, 'STORY_MISMATCH');
  const result = await storyRuntimeAction(f.request, f.runtime);
  assert.deepEqual(result.args, { disabled: false, variant: 'primary' });
  assert.deepEqual(result.omittedArgs, ['children']);
  assert.equal(result.argTypes.children.readOnly, true);
  assert.deepEqual(result.argTypes.variant.options, ['primary', 'secondary']);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('property update and reset only touch the selected renderer and preserve React args', async () => {
  const f = fixture();
  const result = await storyRuntimeAction({ ...f.request, operation: 'update', updatedArgs: { disabled: true, variant: 'secondary' } }, f.runtime);
  assert.equal(result.args.disabled, true);
  assert.equal(result.args.variant, 'secondary');
  assert.equal(f.stats().renders, 1);
  assert.equal(f.stats().emits, 0);
  assert.equal(f.stats().args.children, f.node);
  const reset = await storyRuntimeAction({ ...f.request, operation: 'reset' }, f.runtime);
  assert.equal(reset.args.disabled, false);
  assert.equal(reset.args.variant, 'primary');
  assert.equal(f.stats().args.children, f.node);
});

test('invalid args and prototype keys cannot mutate preview state', async () => {
  for (const updatedArgs of [{ disabled: 'true' }, { variant: 'invented' }, { children: 'replace node' }, { unknown: 1 }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    const f = fixture();
    assert.equal((await storyRuntimeAction({ ...f.request, operation: 'update', updatedArgs }, f.runtime)).code, 'INVALID_ARGS');
    assert.equal(f.stats().renders, 0);
    assert.equal(f.stats().args.disabled, false);
  }
});

test('legacy stories without controls return unavailable metadata without invented properties', async () => {
  const f = fixture();
  delete f.runtime.__STORYBOOK_PREVIEW__;
  f.runtime.__STORYBOOK_CLIENT_API__ = { raw: () => [{ id: f.request.storyId, name: 'Primary' }] };
  const result = await storyRuntimeAction(f.request, f.runtime);
  assert.equal(result.unavailable, true);
  assert.equal(result.canUpdate, false);
  assert.deepEqual(result.argTypes, {});
});

const actionPayload = (name, ...args) => ({ id: 'storybook-original-id', data: { name, args }, options: {} });
const actionEvent = 'storybook/actions/action-event';

test('registered Actions are observed only from the named iframe emit and preserve original behavior', async () => {
  const f = fixture();
  const story = f.runtime.__STORYBOOK_PREVIEW__.currentRender.story;
  story.argTypes.onClick = { action: 'click' };
  const delivered = [], remoteListeners = [];
  const channel = f.runtime.__STORYBOOK_ADDONS_CHANNEL__ = {
    emit(...args) { assert.equal(this, channel); delivered.push(args); return 'original-result'; },
    on(_, listener) { remoteListeners.push(listener); },
  };
  const read = () => storyRuntimeAction({ ...f.request, operation: 'read-actions' }, f.runtime);
  const initial = await read();
  assert.equal(initial.actionsAvailable, true);
  assert.equal(initial.listening, true);
  assert.equal(initial.configured, true);
  assert.deepEqual(initial.actionNames, ['click']);
  assert.deepEqual(initial.actions, []);
  assert.equal(channel.emit(actionEvent, actionPayload('click', { checked: true })), 'original-result');
  const first = await read();
  assert.deepEqual(first.actions[0].args, [{ checked: true }]);
  assert.equal(first.actions[0].name, 'click');
  assert.equal(first.actions[0].id, 'button--primary:1');
  assert.equal(typeof first.actions[0].time, 'number');
  assert.equal(delivered.length, 1);
  assert.equal(remoteListeners.length, 0, 'Incoming manager messages must not be subscribed to');
  const cleared = await storyRuntimeAction({ ...f.request, operation: 'clear-actions' }, f.runtime);
  assert.deepEqual(cleared.actions, []);
  assert.equal(delivered.length, 1, 'Clearing our buffer must not emit a Storybook clear event');
  assert.equal(first.actions.length, 1, 'Earlier read responses must not be mutated by clear');
  channel.emit(actionEvent, actionPayload('click', 2));
  assert.equal((await read()).actions.length, 1, 'Repeated reads must not install duplicate wrappers');
  assert.equal(f.stats().renders, 0);
});

test('Actions support addon versions that collapse a single Event argument', async () => {
  const f = fixture();
  f.runtime.Event = Event;
  const read = () => storyRuntimeAction({ ...f.request, operation: 'read-actions' }, f.runtime);
  await read();
  f.runtime.__STORYBOOK_ADDONS_CHANNEL__.emit(actionEvent, { data: { name: 'change', args: new Event('change', { bubbles: true }) } });
  const result = await read();
  assert.equal(result.actions[0].name, 'change');
  assert.equal(result.actions[0].args[0].type, 'change');
  assert.equal(result.actions[0].args[0].bubbles, true);
});

test('unregistered Actions stay unavailable until an actual addon event arrives', async () => {
  const f = fixture();
  const read = () => storyRuntimeAction({ ...f.request, operation: 'read-actions' }, f.runtime);
  const initial = await read();
  assert.equal(initial.actionsAvailable, false);
  assert.equal(initial.listening, true);
  assert.equal(initial.configured, false);
  const channel = f.runtime.__STORYBOOK_ADDONS_CHANNEL__;
  channel.emit('click', { target: 'not an addon action' });
  channel.emit(actionEvent, { name: 'wrong payload' });
  assert.deepEqual((await read()).actions, []);
  channel.emit(actionEvent, actionPayload('manual action', 'actual emitted value'));
  const observed = await read();
  assert.equal(observed.actionsAvailable, true);
  assert.equal(observed.configured, false);
  assert.deepEqual(observed.actionNames, ['manual action']);
  delete f.runtime.__STORYBOOK_ADDONS_CHANNEL__;
  assert.equal((await read()).listening, false);
});

test('Actions keep the newest 30 events and bound circular, huge, DOM and accessor payloads', async () => {
  const f = fixture();
  const read = () => storyRuntimeAction({ ...f.request, operation: 'read-actions' }, f.runtime);
  await read();
  const circular = { text: 'x'.repeat(100000), passwordInput: { nodeType: 1, nodeName: 'INPUT', type: 'password', value: 'secret' } };
  circular.self = circular;
  Object.defineProperty(circular, 'getter', { enumerable: true, get() { throw new Error('Accessor must not execute'); } });
  Object.defineProperty(circular, '__proto__', { value: { polluted: true }, enumerable: true });
  const channel = f.runtime.__STORYBOOK_ADDONS_CHANNEL__;
  for (let index = 0; index < 40; index++) channel.emit(actionEvent, actionPayload(`click ${index}`, circular, () => {}));
  const result = await read();
  assert.equal(result.actions.length, 30);
  assert.equal(result.actions[0].name, 'click 39');
  assert.equal(result.actions[29].name, 'click 10');
  assert.equal(result.actions[0].args[0].self, '[Circular]');
  assert.deepEqual(result.actions[0].args[0].passwordInput, { element: 'INPUT' });
  assert.equal(result.actions[0].args[0].text.length, 2000);
  assert.equal(result.actions[0].args[0].getter, undefined);
  assert.equal(result.actions[0].args[0].polluted, undefined);
  assert.ok(JSON.stringify(result).length < 100000);
});

test('Actions stop observing when the frame or story changes and do not swallow application errors', async () => {
  const f = fixture();
  const expected = new Error('Original failure');
  const channel = f.runtime.__STORYBOOK_ADDONS_CHANNEL__ = { emit() { throw expected; } };
  const read = () => storyRuntimeAction({ ...f.request, operation: 'read-actions' }, f.runtime);
  await read();
  f.runtime.name = 'original-storybook-frame';
  assert.throws(() => channel.emit(actionEvent, actionPayload('click', 1)), error => error === expected);
  f.runtime.name = f.request.frameName;
  f.runtime.location.href = 'https://example.com/iframe.html?id=other--story';
  assert.throws(() => channel.emit(actionEvent, actionPayload('click', 2)), error => error === expected);
  f.runtime.location.href = 'https://example.com/iframe.html?id=button--primary';
  assert.deepEqual((await read()).actions, []);
});
