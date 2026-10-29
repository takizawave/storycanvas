// Compose a 10-second, silent 1080p edit from recorded product UI.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
const out = path.resolve('artifacts/demo');
const takes = JSON.parse(await readFile(`${out}/takes.json`, 'utf8'));
if (takes.length !== 4) throw new Error('Record all four UI scenes first.');
await mkdir(`${out}/edit`, { recursive: true });
const scenes = [
  { title: 'Storybookを、Designer / PMにも。', tag: 'いつものStorybook', source: 'Chakra UI', active: 0 },
  { title: '実物を、まとめて見比べる。', tag: 'Chrome extension', source: 'Chakra UI', active: 0 },
  { title: 'ライブラリを切り替えて。', tag: 'Propertiesを編集', source: 'GOV.UK React', active: 1 },
  { title: 'Variantsも、Propertiesも。', tag: 'storycanvas', source: 'Adobe Spectrum', active: 2 },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [index, scene] of scenes.entries()) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#f1f1f3;color:#242426;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN",sans-serif}
      .eyebrow{position:absolute;left:80px;top:28px;color:#707078;letter-spacing:2px;font-size:13px;font-weight:600}
      h1{position:absolute;left:78px;top:48px;margin:0;font-size:42px;line-height:64px;font-weight:600;letter-spacing:-1.2px}
      .tag{position:absolute;right:80px;top:34px;color:#74747b;font-size:14px;font-weight:500}.tag b{color:#8a38f5;margin-right:8px}
      .sources{position:absolute;right:80px;top:78px;display:flex;gap:9px;font-size:14px}.source{padding:8px 13px;border-radius:6px;color:#8a8a90;background:#e8e8eb}.source.active{background:#28282d;color:#fff}
      .window{position:absolute;left:80px;top:146px;width:1760px;height:896px;background:white;border:1px solid #d2d2d8;border-radius:10px 10px 0 0;box-shadow:0 12px 25px #0000000b;overflow:hidden}
      .bar{height:35px;background:#fafafa;border-bottom:1px solid #e3e3e6;display:flex;align-items:center;padding:0 15px;gap:7px}.dot{width:8px;height:8px;border-radius:50%;background:#d6d6dc}.address{margin-left:17px;font-size:12px;color:#797980;letter-spacing:.2px}.address strong{font-weight:500;color:#47474e}
      .step{position:absolute;bottom:12px;left:80px;color:#818188;font-size:11px;letter-spacing:1.2px}.time{position:absolute;bottom:12px;right:80px;color:#818188;font-size:11px;letter-spacing:1px}
    </style><div class="eyebrow">storycanvas / CHROME EXTENSION</div><h1>${scene.title}</h1><div class="tag"><b>◇</b>${scene.tag}</div>
    <div class="sources">${['Chakra UI', 'GOV.UK React', 'Adobe Spectrum'].map((name, source) => `<div class="source${source === scene.active ? ' active' : ''}">${name}</div>`).join('')}</div>
    <div class="window"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="address"><strong>${scene.source}</strong> / ${index === 0 ? 'Storybook' : 'storycanvas'}</span></div></div><div class="step">${String(index + 1).padStart(2, '0')} / 04</div><div class="time">実際のUIを収録 · 読み込み時間を省略</div>`);
    await page.screenshot({ path: `${out}/edit/frame-${index}.png` });
  }
} finally { await browser.close(); }

const files = [];
for (const [index, take] of takes.entries()) {
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', take.filename])).stdout);
  const fullDuration = Number(probe.format.duration);
  const start = Math.max(0, fullDuration - take.elapsed - take.tail);
  const filename = `${out}/edit/scene-${index}.mp4`;
  const ratio = take.duration / take.elapsed;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', '30', '-i', `${out}/edit/frame-${index}.png`,
    '-ss', String(start), '-t', String(take.elapsed), '-i', take.filename,
    '-filter_complex_threads', '2',
    '-filter_complex', `[1:v]setpts=(PTS-STARTPTS)*${ratio},fps=30,scale=1760:860:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=1[screen];[0:v][screen]overlay=80:182:shortest=1,format=yuv420p[video]`,
    '-map', '[video]', '-t', String(take.duration), '-r', '30', '-an',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4', '-movflags', '+faststart', filename,
  ], { maxBuffer: 4 * 1024 * 1024 });
  files.push(filename);
  console.log(`Rendered ${take.id}, ${take.duration}s`);
}
await writeFile(`${out}/edit/concat.txt`, files.map(file => `file '${file}'`).join('\n'));
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${out}/edit/concat.txt`, '-c', 'copy', '-movflags', '+faststart', `${out}/story-library-demo.mp4`]);
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.2', '-i', `${out}/story-library-demo.mp4`, '-frames:v', '1', '-q:v', '2', `${out}/poster.jpg`]);
const final = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', `${out}/story-library-demo.mp4`])).stdout);
await writeFile(`${out}/video-info.json`, JSON.stringify(final, null, 2));
console.log(`Finished: ${out}/story-library-demo.mp4 (${final.format.duration}s)`);
