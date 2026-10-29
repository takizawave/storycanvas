/** Conservative detection of independent samples inside one published Story. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const detector = await readFile(new URL('../src/story-examples.js', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../src/exporter.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
let completed = 0;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: `(() => { ${detector.replace(/export function/g, 'function')} window.detectStoryExamples = detectStoryExamples; })();` });
  await page.addScriptTag({ content: `(() => { ${exporter.replace(/export async function/g, 'async function')} window.captureStory = captureStory; })();` });
  const load = html => page.setContent(`<style>body{font:16px Arial}h2{margin:0}button{font:16px Arial;padding:8px 16px}.badge{display:inline-block;background:#ddd;padding:3px 7px;border-radius:3px}.row{display:flex;gap:12px}</style>${html}`);
  const inspect = familyTitle => page.evaluate(familyTitle => {
    const root = document.querySelector('#root');
    const original = root.innerHTML;
    const examples = detectStoryExamples(root, { familyTitle });
    return {
      unchanged: root.innerHTML === original,
      examples: examples.map(item => ({ key: item.key, label: item.label, tag: item.element.localName, text: item.element.textContent.trim(), id: item.element.id, connected: item.element.isConnected, originalElement: root.contains(item.element) })),
    };
  }, familyTitle);
  async function check(name, action) { await action(); completed += 1; console.log(`✓ ${name}`); }

  await check('six real Chakra-style h2 size examples retain independent DOM targets', async () => {
    await load(`<div id="root">${[48, 36, 30, 24, 20, 16].map((size, index) => `<h2 id="heading-${index}" style="font-size:${size}px">Heading ${index + 1}</h2>`).join('')}</div>`);
    const first = await inspect('Heading');
    assert.equal(first.examples.length, 6);
    assert.deepEqual(first.examples.map(example => example.label), ['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']);
    assert.equal(new Set(first.examples.map(example => example.key)).size, 6);
    assert.ok(first.unchanged && first.examples.every(example => example.connected && example.originalElement));
    assert.deepEqual(await inspect('Heading'), first, 'Repeated scans preserve keys and source markup');
    const capture = await page.evaluate(async () => {
      const example = detectStoryExamples(document.querySelector('#root'), { familyTitle: 'Heading' })[3];
      return captureStory(example.element, { name: example.label });
    });
    assert.ok(capture.design.nodes.some(node => node.type === 'text' && node.text === 'Heading 4'));
    assert.equal(/Heading [12356]/.test(capture.svg), false, 'Copying one descriptor never includes its sibling headings');
  });

  await check('button wrappers collapse and identical labels use measured size hints', async () => {
    await load('<div id="root"><div><div class="row"><button style="height:48px">Button</button><button style="height:40px">Button</button><button style="height:32px">Button</button></div></div></div>');
    const result = await inspect('Components / Button');
    assert.equal(result.examples.length, 3);
    assert.deepEqual(result.examples.map(example => example.label), ['Button · 48px', 'Button · 40px', 'Button · 32px']);
    assert.ok(result.examples.every(example => example.tag === 'button'));
  });

  await check('one wrapper around each specimen is accepted without selecting that wrapper', async () => {
    await load('<div id="root"><div><button id="first">First</button></div><div><button id="second">Second</button></div></div>');
    assert.deepEqual((await inspect('Button')).examples.map(example => example.id), ['first', 'second']);
  });

  await check('generated-class Chakra badges split but a single badge does not', async () => {
    await load(`<div id="root"><div class="row">${['gray', 'green', 'red', 'orange', 'purple', 'teal'].map(text => `<div class="badge">${text}</div>`).join('')}</div></div>`);
    assert.equal((await inspect('Badge')).examples.length, 6);
    await load('<div id="root"><div class="row"><div class="badge">Success</div></div></div>');
    assert.equal((await inspect('Badge')).examples.length, 0);
    await load('<div id="root"><div>Ordinary text</div><div>Other text</div></div>');
    assert.equal((await inspect('Badge')).examples.length, 0, 'Unstyled text containers are not inferred to be badges');
  });

  await check('Breadcrumb, Accordion, button groups and composite forms stay intact', async () => {
    await load('<div id="root"><nav><a href="#">Home</a><a href="#">Library</a></nav></div>');
    assert.equal((await inspect('Breadcrumb')).examples.length, 0);
    assert.equal((await inspect('Button')).examples.length, 0);
    await load('<div id="root"><div><button aria-expanded="false">Section A</button></div><div><button aria-expanded="false">Section B</button></div></div>');
    assert.equal((await inspect('Accordion')).examples.length, 0);
    assert.equal((await inspect('Button')).examples.length, 0);
    await load('<div id="root"><form><button>Submit</button><button>Cancel</button></form></div>');
    assert.equal((await inspect('Button')).examples.length, 0);
    await load('<div id="root"><button>First</button><button>Second</button></div>');
    assert.equal((await inspect('Button Group')).examples.length, 0);
    await load('<div id="root"><h2><button aria-expanded="false">First section</button></h2><h2><button aria-expanded="false">Second section</button></h2></div>');
    assert.equal((await inspect('Heading')).examples.length, 0);
  });

  await check('captions, nested button pairs and mixed content prevent ambiguous splitting', async () => {
    for (const content of [
      '<div><button>First</button><span>Caption</span></div><div><button>Second</button><span>Caption</span></div>',
      '<div><button>First</button><button>Nested</button></div><div><button>Second</button><button>Nested</button></div>',
      '<button>First</button><p>Explanation</p><button>Second</button>',
    ]) {
      await load(`<div id="root">${content}</div>`);
      assert.equal((await inspect('Button')).examples.length, 0);
    }
  });

  await check('hidden samples are excluded without changing remaining DOM-order keys', async () => {
    await load('<div id="root"><h2 id="a">A</h2><h2 id="b">B</h2><h2 id="c">C</h2></div>');
    const before = await inspect('Heading');
    await page.locator('#a').evaluate(element => { element.hidden = true; });
    const after = await inspect('Heading');
    assert.equal(after.examples.length, 2);
    assert.deepEqual(after.examples.map(example => example.key), before.examples.slice(1).map(example => example.key));
    assert.ok(after.unchanged);
  });

  await check('Web Component primitives stay whole instead of splitting their shadow parts', async () => {
    await load('<div id="root"><sp-button style="display:inline-block;padding:12px">Primary</sp-button><sp-button disabled style="display:inline-block;padding:12px">Disabled</sp-button></div>');
    await page.locator('sp-button').evaluateAll(elements => elements.forEach(element => { element.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot><span>Icon</span></button>'; }));
    const result = await inspect('Button');
    assert.equal(result.examples.length, 2);
    assert.ok(result.examples.every(example => example.tag === 'sp-button'));
  });

  console.log(`\n${completed} story-example browser checks passed.`);
} finally { await browser.close(); }
