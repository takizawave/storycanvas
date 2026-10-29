// 20-second edit: real Storybook / installed-extension recordings alternate.
// Browser chrome, the genuine popup capture, and the activation pointer are
// composited editorial layers. Originals use their full-resolution stills;
// Properties sequences use the live recording, aligned to the visible change.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const out = path.resolve('artifacts/demo-v2');
const edit = `${out}/edit`;
await mkdir(edit, { recursive: true });
const takes = JSON.parse(await readFile(`${out}/takes.json`, 'utf8'));
if (takes.length !== 6 || takes.reduce((sum, take) => sum + take.duration, 0) !== 20) {
  throw new Error('Record all three before/after pairs (20 seconds) first.');
}
const browser = await chromium.launch({ headless: true });
const geometries = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.resolve('demo/video-frame.html')).href);
  for (const [index, take] of takes.entries()) {
    const geometry = await page.evaluate(scene => window.setScene({
      source: scene.id, url: scene.publicUrl, mode: scene.mode,
      caption: 'Storybookを、Designer / PMにも。', image: '', popup: false,
    }), take);
    geometries.push(geometry);
    await page.screenshot({ path: `${edit}/frame-${index}.png` });
  }
  const popup = await readFile(`${out}/popup.png`);
  // A full-frame transparent layer preserves shadow and popup anchoring.
  const geometry = geometries[0];
  const popupWidth = 425;
  const popupLeft = geometry.extension.x + geometry.extension.width - popupWidth;
  const popupTop = 180;
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;background:transparent}.popup{position:absolute;left:${popupLeft}px;top:${popupTop}px;width:${popupWidth}px;border-radius:8px;overflow:hidden;box-shadow:0 14px 40px #162e4855,0 0 0 1px #233c482b}.popup img{display:block;width:100%;height:auto}.active{position:absolute;left:${geometry.extension.x}px;top:${geometry.extension.y}px;width:${geometry.extension.width}px;height:${geometry.extension.height}px;border-radius:7px;box-shadow:0 0 0 3px #648dc677}</style><div class="active"></div><div class="popup"><img src="data:image/png;base64,${popup.toString('base64')}"></div>`);
  await page.locator('img').evaluate(img => img.decode());
  await page.screenshot({ path: `${edit}/popup-overlay.png`, omitBackground: true });
  await page.setViewportSize({ width: 40, height: 48 });
  await page.setContent('<style>html,body{margin:0;background:transparent}svg{filter:drop-shadow(0 2px 2px #0005)}</style><svg width="34" height="43" viewBox="0 0 22 28"><path d="M2 2v21l5.8-5.2 4.2 8 4-2.2-4.2-7.7H20Z" fill="#151515" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  await page.screenshot({ path: `${edit}/cursor.png`, omitBackground: true });
  await page.setViewportSize({ width: 48, height: 48 });
  await page.setContent('<style>html,body{margin:0;background:transparent}</style><svg width="48" height="48"><circle cx="24" cy="24" r="17" fill="#0d99ff22" stroke="#0d99ff" stroke-width="2"/></svg>');
  await page.screenshot({ path: `${edit}/click.png`, omitBackground: true });
  await writeFile(`${edit}/geometry.json`, JSON.stringify({
    geometry, popup: { x: popupLeft, y: popupTop, width: popupWidth,
      buttonX: popupLeft + 340 * popupWidth / 680,
      buttonY: popupTop + 511 * popupWidth / 680 },
  }, null, 2));
} finally { await browser.close(); }

const { geometry, popup } = JSON.parse(await readFile(`${edit}/geometry.json`, 'utf8'));
const files = [];
for (const [index, take] of takes.entries()) {
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', take.filename])).stdout);
  let start = Math.max(0, Number(probe.format.duration) - take.fromEnd);
  if (take.mode === 'library' && ['govuk', 'spectrum'].includes(take.id)) {
    // Playwright's video tail may include held frames that do not correspond to
    // wall-clock timing. Locate the real switch turning purple in this capture.
    const y = take.id === 'govuk' ? 438 : 488;
    const { stdout: pixels } = await run('ffmpeg', ['-loglevel', 'error', '-i', take.filename,
      '-vf', `fps=25,format=rgb24,crop=28:24:1260:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });
    const bytesPerFrame = 28 * 24 * 3;
    let firstChecked = -1;
    for (let offset = 0; offset < pixels.length; offset += bytesPerFrame) {
      let purple = 0;
      for (let pixel = offset; pixel < offset + bytesPerFrame; pixel += 3) {
        if (pixels[pixel] > 90 && pixels[pixel+1] < 140 && pixels[pixel+2] > 150 && pixels[pixel+2] > pixels[pixel] * 1.1) purple++;
      }
      if (purple > 50) { firstChecked = offset / bytesPerFrame / 25; break; }
    }
    if (firstChecked < 0) throw new Error(`The recorded ${take.id} property toggle was not found.`);
    start = Math.max(0, firstChecked - 0.8);
  }
  const filename = `${edit}/scene-${index}.mp4`;
  const ratio = take.mode === 'storybook' ? 1 : take.duration / take.elapsed;
  const filters = [
    `[1:v]setpts=(PTS-STARTPTS)*${ratio},fps=30,scale=1760:860:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=1[screen]`,
    '[0:v][screen]overlay=80:180:shortest=1[base]',
  ];
  const inputs = ['-loop', '1', '-framerate', '30', '-i', `${edit}/frame-${index}.png`];
  if (take.mode === 'storybook') inputs.push('-loop', '1', '-framerate', '30', '-i', `${out}/${take.id}-before.png`);
  else inputs.push('-ss', String(start), '-t', String(take.elapsed), '-i', take.filename);
  if (take.mode === 'storybook') {
    inputs.push('-loop', '1', '-framerate', '30', '-i', `${edit}/popup-overlay.png`,
      '-loop', '1', '-framerate', '30', '-i', `${edit}/cursor.png`,
      '-loop', '1', '-framerate', '30', '-i', `${edit}/click.png`);
    const show = take.duration - (index === 0 ? 1.85 : 1.2);
    const move = show - 0.5;
    const click = take.duration - 0.2;
    const extensionX = geometry.extension.x + geometry.extension.width / 2;
    const extensionY = geometry.extension.y + geometry.extension.height / 2;
    // Smoothly move into Chrome's action and then down to the real popup CTA.
    const coordinate = (initial, action, target) => `${initial}+(${action-initial})*clip((t-${move})/0.4,0,1)+(${target-action})*clip((t-${show+0.25})/${click-show-0.45},0,1)`;
    filters.push(
      `[2:v]format=rgba,fade=t=in:st=${show}:d=0.1:alpha=1[popup]`,
      `[base][popup]overlay=0:0:enable='gte(t,${show})'[withpopup]`,
      `[withpopup][4:v]overlay=${popup.buttonX-24}:${popup.buttonY-24}:enable='gte(t,${click})'[withclick]`,
      `[withclick][3:v]overlay=x='${coordinate(1360,extensionX,popup.buttonX)}':y='${coordinate(350,extensionY,popup.buttonY)}':enable='gte(t,${move})'[composed]`,
      '[composed]format=yuv420p[video]',
    );
  } else filters.push('[base]format=yuv420p[video]');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex_threads', '2', '-filter_complex', filters.join(';'),
    '-map', '[video]', '-t', String(take.duration), '-r', '30', '-an',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-threads', '4',
    '-movflags', '+faststart', filename], { maxBuffer: 4 * 1024 * 1024 });
  files.push(filename);
  console.log(`Rendered ${take.source} / ${take.mode}: ${take.duration}s`);
}
await writeFile(`${edit}/concat.txt`, files.map(file => `file '${file}'`).join('\n'));
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${edit}/concat.txt`, '-c', 'copy', '-movflags', '+faststart', `${out}/story-library-demo.mp4`]);
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '6', '-i', `${out}/story-library-demo.mp4`, '-frames:v', '1', '-q:v', '2', `${out}/poster.jpg`]);
const final = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', `${out}/story-library-demo.mp4`])).stdout);
if (Math.abs(Number(final.format.duration) - 20) > 0.05) throw new Error(`Unexpected duration: ${final.format.duration}`);
await writeFile(`${out}/video-info.json`, JSON.stringify(final, null, 2));
// The demo server has stable public URLs; retain the previous cut once.
const published = path.resolve('artifacts/demo');
try { await access(`${published}/story-library-demo-10s.mp4`); }
catch { await copyFile(`${published}/story-library-demo.mp4`, `${published}/story-library-demo-10s.mp4`); }
await copyFile(`${out}/story-library-demo.mp4`, `${published}/story-library-demo.mp4`);
await copyFile(`${out}/poster.jpg`, `${published}/poster.jpg`);
await copyFile(`${out}/video-info.json`, `${published}/video-info.json`);
console.log(`Finished: ${out}/story-library-demo.mp4 (${final.format.duration}s)`);
