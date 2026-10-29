// Local previews of the real public Storybooks using the extension bundle.
// An HTTP proxy is only used by this development server; the extension works in place.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const port = Number(process.env.STORY_LIBRARY_PORT || 4173);
const sources = [
  {prefix:'/spectrum-web-components/', root:'/spectrum-web-components/storybook/', origin:'https://opensource.adobe.com', title:'Adobe Spectrum', story:'/story/button-black-fill--primary'},
  {prefix:'/govuk-react/', root:'/govuk-react/', origin:'https://govuk-react.github.io', title:'GOV.UK React', story:'/docs/form-group--docs'},
  {prefix:'/', root:'/', origin:'https://chakra-ui.netlify.app', title:'Chakra UI', story:'/story/heading--default'},
];
const sourceOptions = JSON.stringify(sources.map(source => ({title:source.title,url:`${source.root}?path=${encodeURIComponent(source.story)}`}))).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const cache = new Map();
await build({entryPoints:['src/content.js'],outfile:'dist/content.js',bundle:true,format:'iife',target:'chrome120',loader:{'.css':'text'}});
const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/__library/content.js') {
    response.writeHead(200, {'content-type':'text/javascript; charset=utf-8'});
    response.end(await readFile('dist/content.js')); return;
  }
  try {
    const source = sources.find(source => url.pathname.startsWith(source.prefix));
    const remote = new URL(url.pathname + url.search, source.origin);
    const key = remote.href;
    let pending = cache.get(key);
    if (!pending) {
      // Preview frames share bundles. Cache the pending download as well as its
      // result so a cold group of frames makes only one upstream request.
      pending = (async () => {
        const upstream = await fetch(remote, { signal:AbortSignal.timeout(30000) });
        const item = { status:upstream.status, type:upstream.headers.get('content-type') || 'application/octet-stream', body:Buffer.from(await upstream.arrayBuffer()) };
        if (item.status !== 200) cache.delete(key);
        return item;
      })().catch(error => { cache.delete(key); throw error; });
      cache.set(key, pending);
    }
    const item = await pending;
    let body = item.body;
    if (item.type.includes('text/html') && [source.root, source.root+'index.html'].includes(url.pathname)) {
      body = Buffer.from(body.toString().replace('</head>', `<meta name="story-library-title" content="${source.title}"><meta name="story-library-sources" content="${sourceOptions}"></head>`).replace('</body>', '<script src="/__library/content.js" defer></script></body>'));
    }
    response.writeHead(item.status, {'content-type':item.type, 'cache-control':'no-cache'});
    response.end(body);
  } catch (error) {
    response.writeHead(502, {'content-type':'text/plain; charset=utf-8'});
    response.end(`Storybook preview could not be loaded: ${error.message}`);
  }
});
server.listen(port,'127.0.0.1',() => console.log(`storycanvas · live previews\nChakra: http://127.0.0.1:${port}/?path=/story/accordion--default\nSpectrum: http://127.0.0.1:${port}/spectrum-web-components/storybook/?path=/story/button-black-fill--primary\nGOV.UK: http://127.0.0.1:${port}/govuk-react/?path=/docs/form-group--docs\nCtrl+C to stop`));
