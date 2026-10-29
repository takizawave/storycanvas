import { storyRuntimeAction } from './story-runtime.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_LIBRARY' && !sender.tab && Number.isInteger(message.tabId)) {
    (async () => {
      if (['ja', 'en'].includes(message.language)) {
        try { await chrome.storage.local.set({ 'story-library-language': message.language }); }
        catch { /* Opening a library should still work if saving fails. */ }
        await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          func: language => { globalThis.__storyLibraryInitialLanguageV1 = language; },
          args: [message.language],
        });
      }
      await chrome.scripting.executeScript({ target: { tabId: message.tabId }, files: ['content.js'] });
      return { ok: true };
    })().then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'READ_LEGACY_INDEX' && sender.tab?.id) {
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, allFrames: true }, world: 'MAIN', func: readLegacyStories })
      .then(results => sendResponse({ stories: results.flatMap(item => item.result || []) }), error => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'STORY_PROPERTIES' && sender.tab?.id) {
    const request = message.request;
    if (!request || !/^story-library-inspector-[\w-]+$/.test(request.frameName || '') || typeof request.storyId !== 'string' || !['read','update','reset','read-actions','clear-actions'].includes(request.operation)) {
      sendResponse({ error: 'Invalid Storybook property request.' });
      return;
    }
    chrome.scripting.executeScript({ target: {tabId:sender.tab.id, allFrames:true}, world:'MAIN', func:storyRuntimeAction, args:[request] })
      .then(results => sendResponse(results.find(item => item.result?.matched)?.result || {error:'選択したプレビューが見つかりません。読み込み後にもう一度お試しください。'}), error => sendResponse({error:error.message}));
    return true;
  }
});

// Runs inside Storybook's own JavaScript realm. Only serializable story metadata leaves it.
function readLegacyStories() {
  const candidates = [];
  const safeCall = (value, method, ...args) => { try { return value?.[method]?.(...args); } catch { return null; } };
  const client = window.__STORYBOOK_CLIENT_API__;
  candidates.push(safeCall(client, 'raw'));
  const store = window.__STORYBOOK_STORY_STORE__ || window.__STORYBOOK_PREVIEW__?.storyStore;
  candidates.push(safeCall(store, 'extract'), safeCall(store, 'getStoriesJsonData')?.stories);
  for (const value of candidates) {
    if (!value || typeof value !== 'object') continue;
    const stories = Object.values(value).filter(story => story && typeof story.id === 'string' && (story.kind || story.title));
    if (stories.length) return stories.map(story => ({ id: story.id, title: String(story.title || story.kind), name: String(story.name || story.story || story.id), type: 'story' }));
  }
  return [];
}
