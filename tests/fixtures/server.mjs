import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { index } from './stories.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/index.json' || pathname === '/nested/storybook/index.json') {
      response.writeHead(200, { 'content-type': types['.json'] });
      response.end(JSON.stringify(index));
      return;
    }
    if (pathname.endsWith('.json')) { response.writeHead(404); response.end('Not found'); return; }
    const filename = pathname.split('/').pop() || 'index.html';
    if (!['index.html', 'iframe.html', 'stories.js'].includes(filename)) { response.writeHead(404); response.end('Not found'); return; }
    try {
      response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'text/plain' });
      response.end(await readFile(path.join(directory, filename)));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startFixtureServer();
  console.log(fixture.baseUrl);
}
