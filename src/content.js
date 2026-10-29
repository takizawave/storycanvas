import { loadStoryIndex, initialStoryId, resolveInitialStoryId } from './story-index.js';
import { mountLibrary } from './library-ui.js';
import { captureStory, svgToPng } from './exporter.js';
import { storyRuntimeAction } from './story-runtime.js';
import { watchLibraryBrand } from './library-brand.js';

const propertyStates = new WeakMap();
const languageStorageKey = 'story-library-language';
const initialLanguage = globalThis.__storyLibraryInitialLanguageV1;
delete globalThis.__storyLibraryInitialLanguageV1;
let currentLanguage = initialLanguage === 'en' ? 'en' : 'ja';
const text = (japanese, english) => currentLanguage === 'en' ? english : japanese;
let languageSave = Promise.resolve();

function saveLanguage(language) {
  currentLanguage = language === 'en' ? 'en' : 'ja';
  const value = currentLanguage;
  languageSave = languageSave.then(async () => {
    try {
      if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [languageStorageKey]: value });
      else localStorage.setItem(languageStorageKey, value);
    } catch { /* A temporary setting still works when storage is unavailable. */ }
  });
}

const SESSION = '__storyLibrarySessionV1';
if (globalThis[SESSION]) {
  globalThis[SESSION].destroy();
  delete globalThis[SESSION];
} else {
  startLibrary();
}

async function startLibrary() {
  const previousFocus = document.activeElement;
  const abort = new AbortController();
  const splash = document.createElement('div');
  splash.id = 'story-library-loading';
  const shadow = splash.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483647;background:rgba(247,249,246,.97);display:grid;place-items:center;font:14px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;color:#223d33}.panel{width:440px;max-width:85vw}.logo{font-size:32px;color:#285743}h2{font-size:25px;letter-spacing:-.8px;margin:12px 0}p{color:#68756e;white-space:pre-wrap}button{background:#244e40;color:white;border:0;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer;margin:15px 8px 0 0}button.secondary{background:#e8ede7;color:#40554a}</style><div class="panel"><div class="logo">◈</div><h2></h2><p role="status"></p><button class="secondary"></button></div>`;
  document.documentElement.append(splash);
  let library;
  let splashError;
  let languageRevision = 0;
  const renderSplash = () => {
    splash.lang = currentLanguage;
    shadow.querySelector('h2').textContent = splashError
      ? text('Storybookを読み込めませんでした', 'Could not load Storybook')
      : text('ライブラリをひらいています', 'Opening your library');
    shadow.querySelector('p').textContent = splashError
      ? text(splashError, 'Could not read this Storybook. Wait for its stories to finish loading, then try again.')
      : text('Storybookからコンポーネントとバリエーションを読み込み中…', 'Loading components and variations from Storybook…');
    shadow.querySelector('.secondary').textContent = text('閉じる', 'Close');
    const retry = shadow.querySelector('[data-retry]');
    if (retry) retry.textContent = text('もう一度試す', 'Try again');
  };
  const applyLanguage = value => {
    if (abort.signal.aborted) return;
    languageRevision++;
    currentLanguage = value === 'en' ? 'en' : 'ja';
    renderSplash();
    library?.setLanguage(currentLanguage);
  };
  const storageChanged = (changes, area) => {
    if (area === 'local' && changes[languageStorageKey]) applyLanguage(changes[languageStorageKey].newValue);
  };
  const storage = globalThis.chrome?.storage;
  if (storage?.onChanged) storage.onChanged.addListener(storageChanged);
  else window.addEventListener('storage', event => {
    if (event.key === languageStorageKey) applyLanguage(event.newValue);
  }, { signal: abort.signal });
  const cleanup = () => {
    abort.abort();
    storage?.onChanged?.removeListener(storageChanged);
    splash.remove(); library?.destroy(); delete globalThis[SESSION]; previousFocus?.focus?.();
  };
  globalThis[SESSION] = { destroy: cleanup };
  shadow.querySelector('button').onclick = cleanup;
  renderSplash();
  const languageReady = (async () => {
    if (['ja', 'en'].includes(initialLanguage)) return;
    const revision = languageRevision;
    try {
      const saved = storage?.local ? (await storage.local.get(languageStorageKey))[languageStorageKey] : localStorage.getItem(languageStorageKey);
      if (revision === languageRevision) applyLanguage(saved);
    } catch { /* Keep Japanese when no language preference can be loaded. */ }
  })();
  try {
    const [data] = await Promise.all([loadStoryIndex({baseUrl: location.href, legacyLoader: () => readLegacy(abort.signal), signal: abort.signal}), languageReady]);
    if (abort.signal.aborted) return;
    splash.remove();
    const knownTitle = /spectrum-web-components/.test(location.pathname) ? 'Adobe Spectrum' : /govuk-react/.test(location.pathname) ? 'GOV.UK React' : /chakra/i.test(location.hostname) ? 'Chakra UI' : '';
    const title = document.querySelector('meta[name="story-library-title"]')?.content || knownTitle || document.title.replace(/\s*[-|–]\s*Storybook.*$/i, '').replace(/^Storybook$/, '') || new URL(data.baseUrl).hostname;
    let sourceLinks = [];
    try {
      const links = JSON.parse(document.querySelector('meta[name="story-library-sources"]')?.content || '[]');
      if (Array.isArray(links)) sourceLinks = links.slice(0, 10).filter(link => typeof link.title === 'string' && new URL(link.url, location.href).origin === location.origin);
    } catch { /* Optional development source switcher. */ }
    library = mountLibrary({ ...data, title, sourceLinks, language: currentLanguage, onLanguageChange: language => { languageRevision++; saveLanguage(language); }, initialStoryId: resolveInitialStoryId(data.groups, initialStoryId(location.href)), onClose: cleanup, onExport: exportStory, onProperties: editProperties, onActions: readActions });
    watchLibraryBrand(document, library.setBrandSources, { signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) return;
    splashError = error.message;
    const retry = document.createElement('button'); retry.dataset.retry = '';
    retry.onclick = () => { cleanup(); startLibrary(); };
    shadow.querySelector('.panel').append(retry);
    renderSplash();
  }
}

async function editProperties({story, frame, operation = 'read', updatedArgs}) {
  if (!frame?.name || !frame.isConnected) throw new Error(text('プレビューの読み込み後にお試しください。', 'Wait for the preview to load, then try again.'));
  const request = {frameName:frame.name, storyId:story.id, operation, updatedArgs};
  let result;
  if (globalThis.chrome?.runtime?.id) result = await chrome.runtime.sendMessage({type:'STORY_PROPERTIES',request});
  else result = await storyRuntimeAction(request, frame.contentWindow);
  if (!result?.matched || result.error) throw new Error(result?.error || text('Propertiesを読み込めませんでした。', 'Could not load properties.'));
  propertyStates.set(frame, result);
  return result;
}

async function readActions({story, frame, operation = 'read-actions'}) {
  if (!frame?.name || !frame.isConnected) throw new Error(text('プレビューの読み込み後にお試しください。', 'Wait for the preview to load, then try again.'));
  const request = { frameName: frame.name, storyId: story.id, operation };
  const result = globalThis.chrome?.runtime?.id
    ? await chrome.runtime.sendMessage({ type: 'STORY_PROPERTIES', request })
    : await storyRuntimeAction(request, frame.contentWindow);
  if (!result?.matched || result.error) throw new Error(result?.error || text('Actionsを取得できませんでした。', 'Could not load actions.'));
  return result;
}

async function readLegacy(signal) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (signal?.aborted) return [];
    if (globalThis.chrome?.runtime?.id) {
      const result = await chrome.runtime.sendMessage({type:'READ_LEGACY_INDEX'});
      if (result?.stories?.length) return result.stories;
    } else {
      // Development harness only. Installed extension uses isolated MAIN-world bridge above.
      const windows = [window, ...Array.from(document.querySelectorAll('iframe')).map(frame => { try { return frame.contentWindow; } catch { return null; } })];
      for (const candidate of windows) {
        try { const stories = candidate?.__STORYBOOK_CLIENT_API__?.raw(); if (stories?.length) return stories; } catch { /* cross-origin frame */ }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 650));
  }
  return [];
}

async function exportStory({story, frame, format, root: selectedRoot, exampleLabel}) {
  if (format === 'link') { await writeText(story.url); return { message: text('Storyのリンクをコピーしました', 'Story link copied') }; }
  let doc;
  try { doc = frame?.contentDocument; } catch { /* report same-origin limitation */ }
  if (!doc) throw new Error(text('プレビューを読み込んでからコピーしてください。別ドメインのプレビューには対応していません。', 'Wait for the preview before copying. Previews on another domain are not supported.'));
  const root = doc.querySelector('#storybook-root, #root');
  if (!root || !root.children.length || root.hidden || doc.querySelector('.sb-show-errordisplay, .sb-show-nopreview')) throw new Error(text('このStoryのプレビューがまだ表示されていません。読み込み後にもう一度お試しください。', 'This story preview is not ready. Wait for it to load, then try again.'));
  const captureRoot = selectedRoot?.ownerDocument === doc && selectedRoot.isConnected ? selectedRoot : root;
  const result = await captureStory(captureRoot, { name: `${story.title} / ${story.name}${exampleLabel ? ` / ${exampleLabel}` : ''}`, storyUrl: story.url });
  const state = propertyStates.get(frame);
  if (state?.available) result.design.properties = state.args;
  if (story.variantProperties || exampleLabel) result.design.variants = { ...story.variantProperties, ...(exampleLabel ? { Example: exampleLabel } : {}) };
  let message;
  if (format === 'svg') { await writeText(result.svg); message = text('SVGコードをコピーしました', 'SVG code copied'); }
  else if (format === 'html') { await writeText(result.html); message = text('スタイル付きHTMLをコピーしました', 'Styled HTML copied'); }
  else if (format === 'figma') { await writeText(JSON.stringify(result.design)); message = text('Figmaデータをコピーしました。同梱プラグインに貼り付けてください', 'Figma data copied. Paste it into the included plugin.'); }
  else if (format === 'png') {
    const blob = await svgToPng(result.svg, result.width, result.height);
    if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw new Error(text('画像コピーに対応していません。SVG保存をお試しください。', 'Image copying is unavailable. Try saving an SVG instead.'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    message = text('PNG画像をコピーしました', 'PNG image copied');
  } else if (format === 'download-svg') {
    const blob = new Blob([result.svg], {type:'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${story.id.replace(/[^a-z0-9_-]/gi, '-')}.svg`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000); message = text('SVGを保存しました。Figmaにドラッグして配置できます', 'SVG saved. Drag it into Figma to place it.');
  } else throw new Error(text('未対応のコピー形式です。', 'This copy format is not supported.'));
  return {message, warnings:result.warnings};
}

async function writeText(value) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const area = document.createElement('textarea');
    area.value = value; area.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;z-index:2147483647';
    document.documentElement.append(area); area.select();
    const copied = document.execCommand('copy'); area.remove();
    if (!copied) throw new Error(text('クリップボードへの書き込みが許可されませんでした。SVG保存をお試しください。', 'Clipboard access was denied. Try saving an SVG instead.'));
  }
}
