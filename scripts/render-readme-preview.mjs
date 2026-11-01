// Publish only the selected, public-Storybook demo media; keep raw takes local.
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const source = path.resolve('artifacts/demo-v2/story-library-demo.mp4');
const output = path.resolve('docs/media');
await mkdir(output, { recursive: true });
const ffmpeg = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
  maxBuffer: 4 * 1024 * 1024,
});

// Three 3-second highlights: canvas, error state, disabled state. Start on the
// product itself, so GitHub also has a useful first frame before animation.
await ffmpeg(['-i', source, '-filter_complex', [
  '[0:v]split=3[a][b][c]',
  '[a]trim=start=5:end=8,setpts=PTS-STARTPTS[canvas]',
  '[b]trim=start=11:end=14,setpts=PTS-STARTPTS[error]',
  '[c]trim=start=17:end=20,setpts=PTS-STARTPTS[disabled]',
  '[canvas][error][disabled]concat=n=3:v=1:a=0,fps=12,scale=1200:-1:flags=lanczos,split[frames][colors]',
  '[colors]palettegen=max_colors=192:stats_mode=diff[palette]',
  '[frames][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[preview]',
].join(';'), '-map', '[preview]', '-loop', '0', `${output}/storycanvas-preview.gif`]);
await ffmpeg(['-ss', '6', '-i', source, '-frames:v', '1', `${output}/storycanvas-preview.png`]);
await copyFile(source, `${output}/storycanvas-demo.mp4`);
for (const file of ['storycanvas-preview.gif', 'storycanvas-preview.png', 'storycanvas-demo.mp4']) {
  console.log(`${file}: ${((await stat(`${output}/${file}`)).size / 1024).toFixed(0)} KiB`);
}
