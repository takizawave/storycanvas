import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const hostname = '127.0.0.1';
const port = 4174;
const routes = new Map([
  ['/', { file: new URL('../demo/index.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  // Keep using the existing recording until a new one is captured.
  ['/storycanvas-demo.mp4', { file: new URL('../artifacts/demo/story-library-demo.mp4', import.meta.url), type: 'video/mp4' }],
  ['/story-library-demo.mp4', { file: new URL('../artifacts/demo/story-library-demo.mp4', import.meta.url), type: 'video/mp4' }],
  ['/poster.jpg', { file: new URL('../artifacts/demo/poster.jpg', import.meta.url), type: 'image/jpeg' }]
]);

function sendText(res, code, text, method = 'GET', extraHeaders = {}) {
  const body = Buffer.from(text);
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...extraHeaders });
  res.end(method === 'HEAD' ? undefined : body);
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed', method, { Allow: 'GET, HEAD' });
    return;
  }
  let route;
  try { route = routes.get(new URL(req.url || '/', `http://${hostname}:${port}`).pathname); }
  catch { sendText(res, 400, 'Bad request', method); return; }
  if (!route) { sendText(res, 404, 'Not found', method); return; }
  let info;
  try { info = await stat(route.file); }
  catch { sendText(res, 404, 'This demo asset is not available yet.', method); return; }
  if (!info.isFile()) { sendText(res, 404, 'Not found', method); return; }
  const headers = {
    'Content-Type': route.type,
    'Cache-Control': 'no-cache',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff'
  };
  let range;
  if (req.headers.range) {
    range = parseRange(req.headers.range, info.size);
    if (!range) {
      sendText(res, 416, 'Range not satisfiable', method, { 'Content-Range': `bytes */${info.size}`, 'Accept-Ranges': 'bytes' });
      return;
    }
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
    headers['Content-Length'] = range.end - range.start + 1;
  } else headers['Content-Length'] = info.size;
  res.writeHead(range ? 206 : 200, headers);
  if (method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(route.file, range || undefined);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

server.on('error', error => {
  console.error(`storycanvas demo could not start: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, hostname, () => {
  console.log(`storycanvas demo: http://${hostname}:${port}`);
});
