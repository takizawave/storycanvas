import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

await mkdir('artifacts', {recursive:true});
await build({entryPoints:['src/exporter.js'],outfile:'artifacts/exporter-test.js',bundle:true,format:'iife',globalName:'StoryLibraryExports'});
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:1536,height:1024},permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const errors = [];
  let phase = 'original-storybook';
  page.on('pageerror',error => errors.push({phase,message:error.message,stack:error.stack?.slice(0,600)}));
  await page.goto('https://chakra-ui.netlify.app/?path=/story/accordion--default', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('#storybook-preview-iframe')?.contentWindow?.__STORYBOOK_CLIENT_API__?.raw()?.length > 0,{},{timeout:60000});
  const stories = await page.evaluate(() => document.querySelector('#storybook-preview-iframe').contentWindow.__STORYBOOK_CLIENT_API__.raw().map(s => ({id:s.id,title:s.kind,name:s.name})));
  phase = 'library';
  await page.addScriptTag({path:'dist/content.js'});
  await page.waitForFunction(() => !!document.querySelector('#story-library-host')?.shadowRoot, {}, {timeout:30000});
  await page.waitForTimeout(6000);
  await page.screenshot({path:'artifacts/chakra-library.png',fullPage:true});
  const summary = await page.evaluate(() => {
    const host = document.querySelector('#story-library-host');
    return {text:host.shadowRoot.innerText,frames:[...host.shadowRoot.querySelectorAll('iframe')].map(f => ({src:f.src,text:f.contentDocument?.querySelector('#root')?.innerText || ''}))};
  });
  await page.addScriptTag({path:'artifacts/exporter-test.js'});
  const capture = await page.evaluate(async () => {
    const frame = [...document.querySelector('#story-library-host').shadowRoot.querySelectorAll('iframe')].find(f => f.src.includes('accordion--default'));
    return await StoryLibraryExports.captureStory(frame.contentDocument.querySelector('#root'),{name:'Accordion / default',storyUrl:'https://chakra-ui.netlify.app/?path=/story/accordion--default'});
  });
  assert.ok(capture.design.nodes.some(n => n.type === 'text'), 'real Accordion text exports');
  assert.ok(capture.width > 100 && capture.height > 30, 'export has dimensions');
  await writeFile('artifacts/chakra-accordion.svg',capture.svg);
  await writeFile('artifacts/chakra-accordion.figma.json',JSON.stringify(capture.design,null,2));
  await page.locator('.sl-primary-button[data-export="figma"]').click();
  await page.waitForFunction(async () => { try { return JSON.parse(await navigator.clipboard.readText()).schema === 'story-library/design'; } catch { return false; } });
  const copied = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  assert.ok(copied.nodes.some(node => node.type === 'text'));
  await page.locator('.sl-format-actions [data-export="png"]').click();
  let png;
  for (let attempt = 0; attempt < 40 && !png; attempt++) {
    png = await page.evaluate(async () => {
      const item=(await navigator.clipboard.read()).find(item=>item.types.includes('image/png'));
      if (!item) return null;
      const blob=await item.getType('image/png');
      return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
    });
    if (!png) await page.waitForTimeout(250);
  }
  assert.ok(png, 'PNG appears in the system clipboard');
  await writeFile('artifacts/chakra-accordion.png',Buffer.from(png,'base64'));
  await page.locator('[data-view="all"]').click();
  await page.waitForFunction(() => [...document.querySelector('#story-library-host').shadowRoot.querySelectorAll('.sl-card .sl-preview')].filter(element=>element.dataset.state==='ready').length>=6,{}, {timeout:30000});
  await page.screenshot({path:'artifacts/chakra-overview.png',fullPage:true});
  const result={storyCount:stories.length,componentCount:new Set(stories.map(s=>s.title)).size,previewCount:summary.frames.length,renderedFrames:summary.frames.filter(f=>f.text.trim()).length,export:{width:capture.width,height:capture.height,layers:capture.design.nodes.length,warnings:capture.warnings},errors};
  await writeFile('artifacts/live-chakra-results.json',JSON.stringify(result,null,2));
  assert.ok(!errors.some(error=>error.stack?.includes('content.js')), 'no extension JavaScript errors');
  console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
