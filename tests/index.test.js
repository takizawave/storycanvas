import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, normalizeIndex, loadStoryIndex, initialStoryId, resolveInitialStoryId } from '../src/story-index.js';
import { index as fixtureIndex } from './fixtures/stories.js';

test('base URLs retain subdirectory deployments and remove Storybook navigation', () => {
  assert.equal(normalizeBaseUrl('https://example.com/design/storybook/?path=/story/button--primary#demo'), 'https://example.com/design/storybook/');
  assert.equal(normalizeBaseUrl('https://example.com/design/storybook/iframe.html?id=button--primary'), 'https://example.com/design/storybook/');
  assert.equal(normalizeBaseUrl('https://example.com/design/storybook/index.html?path=/story/a--b'), 'https://example.com/design/storybook/');
  assert.equal(normalizeBaseUrl('http://localhost:6006'), 'http://localhost:6006/');
});

test('only HTTP and HTTPS sources are accepted', () => {
  for (const url of ['file:///tmp/storybook/index.html', 'javascript:alert(1)', 'chrome://extensions']) assert.throws(() => normalizeBaseUrl(url));
});

test('v5 index groups variants and excludes generated docs', () => {
  const groups = normalizeIndex(fixtureIndex, 'https://example.com/ui/');
  assert.equal(groups.length, 6);
  assert.equal(groups.flatMap(group => group.stories).length, 18);
  const buttons = groups.find(group => group.id === 'Forms/Button');
  assert.equal(buttons.title, 'Button');
  assert.equal(buttons.category, 'Forms');
  assert.deepEqual(buttons.stories.map(story => story.name), ['Primary', 'Secondary', 'Disabled', 'Sizes']);
  assert.equal(buttons.stories[0].previewUrl, 'https://example.com/ui/iframe.html?id=button--primary&viewMode=story');
  assert.equal(new URL(buttons.stories[0].url).searchParams.get('path'), '/story/button--primary');
});

for (const version of [3, 4]) {
  test(`v${version} stories.json indexes are normalized`, () => {
    const groups = normalizeIndex({ v: version, stories: { 'button--primary': { id: 'button--primary', title: 'Button', name: 'Primary' } } }, 'https://example.com/');
    assert.equal(groups[0].title, 'Button');
    assert.equal(groups[0].category, 'Components');
    assert.equal(groups[0].stories[0].id, 'button--primary');
  });
}

test('legacy runtime records use kind and story fields', () => {
  const groups = normalizeIndex([{ id: 'accordion--allow-toggle', kind: 'Accordion', story: 'allow toggle' }], 'https://chakra-ui.netlify.app/');
  assert.equal(groups[0].stories[0].name, 'allow toggle');
  assert.equal(groups[0].stories[0].title, 'Accordion');
});

test('invalid, hidden, and duplicate entries do not create broken cards', () => {
  const entries = [null, false, {}, { id: 1, title: 'Button' }, { id: 'a', title: '' }, { id: 'b', title: 'Button', tags: ['hidden'] }, { id: 'c', title: 'Button', type: 'docs' }, { id: 'd', title: 'Button', name: 'First' }, { id: 'd', title: 'Other', name: 'Duplicate' }];
  assert.equal(normalizeIndex(entries, 'https://example.com/').flatMap(group => group.stories).length, 1);
  assert.deepEqual(normalizeIndex({}, 'https://example.com/'), []);
});

test('story IDs are encoded as query parameters, never URLs or markup', () => {
  const id = 'a&path=<img src=x onerror=alert(1)>';
  const [group] = normalizeIndex([{ id, title: '<script>alert(1)</script>', name: 'Unsafe-looking text' }], 'https://example.com/ui/');
  const url = new URL(group.stories[0].previewUrl);
  assert.equal(url.origin, 'https://example.com');
  assert.equal(url.pathname, '/ui/iframe.html');
  assert.equal(url.searchParams.get('id'), id);
  assert.equal(url.searchParams.size, 2);
});

test('loader prefers modern index and preserves same-origin credentials', async () => {
  const calls = [];
  const result = await loadStoryIndex({ baseUrl: 'https://example.com/ui/?path=/story/button--primary', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => fixtureIndex }; } });
  assert.equal(result.source, 'index.json');
  assert.equal(result.baseUrl, 'https://example.com/ui/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/ui/index.json');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('loader tries stories.json when modern endpoint is missing', async () => {
  const calls = [];
  const result = await loadStoryIndex({ baseUrl: 'https://example.com/', fetchImpl: async url => { calls.push(url); return url.endsWith('/index.json') ? { ok: false, status: 404 } : { ok: true, json: async () => ({ v: 3, stories: { a: { id: 'a', title: 'Button', name: 'Primary' } } }) }; } });
  assert.equal(result.source, 'stories.json');
  assert.equal(calls.length, 2);
});

test('invalid endpoint content falls through to the legacy runtime bridge', async () => {
  let bridgeCalls = 0;
  const result = await loadStoryIndex({ baseUrl: 'https://chakra-ui.netlify.app/', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }), legacyLoader: async () => { bridgeCalls++; return [{ id: 'accordion--default', kind: 'Accordion', name: 'default' }]; } });
  assert.equal(result.source, 'Storybook runtime');
  assert.equal(result.groups[0].stories[0].id, 'accordion--default');
  assert.equal(bridgeCalls, 1);
});

test('empty indexes are not reported as a successfully loaded library', async () => {
  await assert.rejects(loadStoryIndex({ baseUrl: 'https://example.com/', fetchImpl: async () => ({ ok: true, json: async () => ({ entries: {} }) }), legacyLoader: async () => [] }), /Storybook/);
});

test('aborting index fetch stops fallback work', async () => {
  const controller = new AbortController();
  let bridgeCalls = 0;
  const error = new DOMException('Cancelled', 'AbortError');
  const promise = loadStoryIndex({ baseUrl: 'https://example.com/', signal: controller.signal, fetchImpl: async () => { controller.abort(); throw error; }, legacyLoader: async () => { bridgeCalls++; return []; } });
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(bridgeCalls, 0);
});

test('initial selection understands manager and iframe URLs', () => {
  assert.equal(initialStoryId('https://example.com/?path=/story/accordion--default'), 'accordion--default');
  assert.equal(initialStoryId('https://example.com/iframe.html?id=button--primary'), 'button--primary');
  assert.equal(initialStoryId('https://example.com/?path=/docs/button--docs'), 'button--docs');
  assert.equal(initialStoryId('https://example.com/'), '');
});

test('Spectrum package hierarchy becomes one family with only published variant axes', () => {
  const groups = normalizeIndex([
    { id:'button-black-fill--primary', title:'Button/Black/Fill', name:'Primary', importPath:'./packages/button/stories/black.stories.js' },
    { id:'button-black-outline--primary', title:'Button/Black/Outline', name:'Primary', importPath:'./packages/button/stories/outline.stories.js' },
    { id:'button-white-fill-sizes--s', title:'Button/White/Fill/Sizes', name:'S', importPath:'./packages/button/stories/sizes.stories.js' },
    { id:'button-black-fill--docs', title:'Button/Black/Fill', type:'docs', importPath:'./packages/button/stories/black.stories.js' },
    { id:'button-group--default', title:'Button Group', name:'Default', importPath:'./packages/button-group/stories/group.stories.js' },
  ], 'https://example.com/storybook/');
  const family = groups.find(group => group.id === 'Button');
  assert.equal(groups.length,2);
  assert.equal(family.stories.length,3);
  assert.deepEqual(family.axes.map(axis => [axis.key,axis.label,axis.values]),[
    ['path0','Style',['Black','White']], ['path1','Treatment',['Fill','Outline']], ['path2','Examples',['Base','Sizes']]
  ]);
  assert.deepEqual(family.stories[0].variantProperties,{path0:'Black',path1:'Fill',path2:'Base'});
  assert.equal(family.stories[0].displayName,'Black / Fill / Primary');
  assert.equal(resolveInitialStoryId(groups,'button-black-fill--docs'),'button-black-fill--primary');
});

test('GOV.UK categories stay separate and docs navigation resolves to their live component', () => {
  const groups = normalizeIndex([
    { id:'form-group--docs', title:'Form/Form group', type:'docs', importPath:'../../components/form-group/src/stories.tsx' },
    { id:'form-group--default', title:'Form/Form group', name:'Default', importPath:'../../components/form-group/src/stories.tsx' },
    { id:'form-group--error', title:'Form/Form group', name:'Error', importPath:'../../components/form-group/src/stories.tsx' },
    { id:'input--default', title:'Form/Input', name:'Default', importPath:'../../components/input/src/stories.tsx' },
  ], 'https://example.com/govuk-react/');
  assert.equal(groups.length,2);
  const group=groups.find(group=>group.id==='Form/Form group');
  assert.equal(group.category,'Form');
  assert.deepEqual(group.axes,[]);
  assert.equal(resolveInitialStoryId(groups,'form-group--docs'),'form-group--default');
  assert.equal(resolveInitialStoryId(groups,'form-group--error'),'form-group--error');
});

test('Chakra Input/Variants joins its published Input family without losing stories', () => {
  const groups = normalizeIndex([
    { id:'input--default', kind:'Input', name:'Default' },
    { id:'input--readonly', kind:'Input', name:'Readonly' },
    { id:'input-variants--filled', kind:'Input/Variants', name:'Filled' },
    { id:'input-variants--outline', kind:'Input/Variants', name:'Outline' },
    { id:'input-group--default', kind:'InputGroup', name:'Default' },
  ], 'https://chakra-ui.netlify.app/');
  assert.equal(groups.length,2, 'Three raw titles describe two component families');
  assert.equal(groups.find(group=>group.id==='Input').stories.length,4);
  assert.deepEqual(groups.find(group=>group.id==='Input').axes[0].values,['Base','Variants']);
  assert.equal(groups.flatMap(group=>group.stories).length,5);
  assert.equal(resolveInitialStoryId(groups,'input-variants--filled'),'input-variants--filled');
});

test('docs selection stays in its variant path inside a merged Spectrum family', () => {
  const groups = normalizeIndex([
    { id:'button-black-fill--default', title:'Button/Black/Fill', name:'Default', importPath:'./packages/button/stories/black.stories.js' },
    { id:'button-white-outline--primary', title:'Button/White/Outline', name:'Primary', importPath:'./packages/button/stories/white.stories.js' },
    { id:'button-white-outline--default', title:'Button/White/Outline', name:'Default', importPath:'./packages/button/stories/white.stories.js' },
    { id:'button-white-outline--docs', title:'Button/White/Outline', type:'docs', importPath:'./packages/button/stories/white.stories.js' },
    { id:'button--docs', title:'Button', type:'docs', importPath:'./packages/button/stories/overview.mdx' },
  ], 'https://example.com/storybook/');
  assert.equal(resolveInitialStoryId(groups,'button-white-outline--docs'),'button-white-outline--default');
  assert.equal(resolveInitialStoryId(groups,'button--docs'),'button-black-fill--default');
  assert.equal(resolveInitialStoryId(groups,'button-white-outline--primary'),'button-white-outline--primary');
  assert.equal(resolveInitialStoryId(groups,undefined),'button-black-fill--default');
  assert.equal(resolveInitialStoryId([],undefined),undefined);
});

test('hidden, docs-only and invalid parent titles do not collapse category components', () => {
  const groups = normalizeIndex([
    { id:'form--docs', title:'Form', type:'docs' },
    { id:'feedback--hidden', title:'Feedback', tags:['hidden'] },
    { id:7, title:'Layout' },
    { id:'shared--default', title:'Unrelated', name:'Default' },
    { id:'shared--default', title:'Navigation', name:'Discarded duplicate' },
    { id:'form-input--default', title:'Form/Input', name:'Default', importPath:42 },
    { id:'form-checkbox--default', title:'Form/Checkbox', name:'Default' },
    { id:'feedback-alert--default', title:'Feedback/Alert', name:'Default' },
    { id:'layout-grid--default', title:'Layout/Grid', name:'Default' },
    { id:'navigation-tabs--default', title:'Navigation/Tabs', name:'Default' },
    { id:'empty-title--default', title:' / / ' },
  ], 'https://example.com/');
  assert.deepEqual(groups.map(group=>group.id).sort(),['Feedback/Alert','Form/Checkbox','Form/Input','Layout/Grid','Navigation/Tabs','Unrelated']);
});

test('family evidence normalizes hierarchy whitespace and retains Unicode package names', () => {
  const groups = normalizeIndex([
    { id:'button--default', title:'Components / Button', name:'Default' },
    { id:'button-size--large', title:'Components / Button / Sizes', name:'Large' },
    { id:'japanese--default', title:'部品/ボタン/塗り', name:'Default', importPath:'./packages/ボタン/stories/fill.js' },
    { id:'japanese-other--default', title:'部品/入力/塗り', name:'Default', importPath:'./packages/入力/stories/fill.js' },
  ], 'https://example.com/');
  assert.equal(groups.find(group=>group.id==='Components/Button').stories.length,2);
  assert.equal(groups.find(group=>group.id==='部品/ボタン').stories.length,1);
  assert.equal(groups.find(group=>group.id==='部品/入力').stories.length,1);
});
