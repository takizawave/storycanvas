import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real request handler without opening a port, building files, or
// accessing public Storybooks. Only its startup imports are replaced.
const source = (await readFile(new URL('../scripts/dev.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');

async function proxy(fetchImpl) {
  let handler;
  const context = vm.createContext({
    http: { createServer(next) { handler = next; return { listen() {} }; } },
    readFile,
    build: async () => {},
    process: { env: {} },
    URL, Buffer, AbortSignal,
    fetch: fetchImpl,
    console: { log() {} },
  });
  await vm.runInContext(`(async () => {\n${source}\n})()`, context);
  return async (url = '/runtime.shared.js') => {
    const result = {};
    await handler({ method: 'GET', url }, {
      writeHead(status, headers) { result.status = status; result.headers = headers; },
      end(body) { result.body = String(body); },
    });
    return result;
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function upstream(status = 200, body = 'bundle', type = 'text/javascript') {
  return { status, headers: new Map([['content-type', type]]), arrayBuffer: async () => Buffer.from(body) };
}

test('parallel cold previews share the complete download and warm previews reuse it', async () => {
  const body = deferred();
  let fetches = 0;
  const request = await proxy(async () => {
    fetches++;
    return { ...upstream(), arrayBuffer: () => body.promise };
  });
  const requests = Array.from({ length: 5 }, () => request());
  assert.equal(fetches, 1, 'all cold requests must share the upstream fetch');
  // Headers alone must not release the cache entry while its body is pending.
  await Promise.resolve();
  requests.push(request());
  assert.equal(fetches, 1);
  body.resolve(Buffer.from('shared bundle'));
  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 200);
    assert.equal(response.body, 'shared bundle');
    assert.equal(response.headers['content-type'], 'text/javascript');
  }
  for (const response of await Promise.all(Array.from({ length: 5 }, () => request()))) assert.equal(response.body, 'shared bundle');
  assert.equal(fetches, 1, 'successful responses remain cached');
});

for (const failure of ['fetch', 'body', 'status']) {
  test(`${failure} failures are shared with waiting previews and evicted for retry`, async () => {
    const first = deferred();
    let fetches = 0;
    const request = await proxy(async () => {
      fetches++;
      if (fetches > 1) return upstream(200, 'recovered');
      if (failure === 'body') return { ...upstream(), arrayBuffer: () => first.promise };
      return first.promise;
    });
    const requests = Array.from({ length: 5 }, () => request());
    assert.equal(fetches, 1);
    if (failure === 'status') first.resolve(upstream(503, 'unavailable'));
    else first.reject(new Error('upstream failed'));
    const responses = await Promise.all(requests);
    for (const response of responses) {
      assert.equal(response.status, failure === 'status' ? 503 : 502);
      assert.match(response.body, failure === 'status' ? /unavailable/ : /upstream failed/);
    }
    assert.equal(fetches, 1);
    assert.equal((await request()).body, 'recovered');
    assert.equal(fetches, 2, 'the next request retries the failed asset');
    assert.equal((await request()).body, 'recovered');
    assert.equal(fetches, 2, 'a successful retry is cached');
  });
}

test('different asset URLs keep independent cache entries', async () => {
  const urls = [];
  const request = await proxy(async url => { urls.push(url.href); return upstream(200, url.href); });
  const responses = await Promise.all([request('/a.js'), request('/b.js'), request('/a.js?v=2')]);
  assert.equal(urls.length, 3);
  assert.deepEqual(responses.map(response => response.body), [
    'https://chakra-ui.netlify.app/a.js',
    'https://chakra-ui.netlify.app/b.js',
    'https://chakra-ui.netlify.app/a.js?v=2',
  ]);
});
