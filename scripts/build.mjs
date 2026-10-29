import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
await mkdir('dist/icons', { recursive: true });
await cp('extension', 'dist', { recursive: true });
await build({ entryPoints: ['src/content.js', 'src/background.js', 'src/popup.js'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120', loader: { '.css': 'text' }, sourcemap: false, logLevel: 'info' });
// Deterministic PNG extension icons, with no native image dependency.
function crc(buffer) { let c=0xffffffff; for(const b of buffer){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
function chunk(type,data){const t=Buffer.from(type);const head=Buffer.alloc(4);head.writeUInt32BE(data.length);const end=Buffer.alloc(4);end.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([head,t,data,end]);}
for (const size of [16,48,128]) {
  const rows=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const nx=x/size,ny=y/size;
    const diamond=Math.abs(nx-.5)+Math.abs(ny-.5);const inner=Math.abs(nx-.5)+Math.abs(ny-.56);
    const light=(diamond<.32&&diamond>.23)||(inner<.21&&inner>.13);
    const color=light?[224,239,183,255]:[28,69,55,255];const i=y*(size*4+1)+1+x*4;rows.set(color,i);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  await writeFile(`dist/icons/icon${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
}
// Keep the previously distributed unpacked folder current as well. Chrome
// continues loading this path after the user installs it from artifacts/.
await cp('dist', 'artifacts/dist', { recursive: true });
console.log('Load unpacked extension: dist/ (also updated artifacts/dist/)');
