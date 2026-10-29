const button = document.querySelector('#open');
const status = document.querySelector('#status');
const languageSwitch = document.querySelector('.language-switch');
const languageButtons = [...document.querySelectorAll('[data-language]')];
const storageKey = 'story-library-language';
const messages = {
  ja: {
    headingFirst: 'Storybookを、',
    headingSecond: 'デザインのライブラリに。',
    descriptionFirst: 'コンポーネントとバリエーションを一覧で。',
    descriptionSecond: '選んだデザインを、そのまま次のアイデアへ。',
    open: 'このStorybookを展開',
    examples: '公開ライブラリで試す',
    formats: 'Figma / SVG / PNG / HTML / リンク',
    language: '表示言語',
    loading: 'ライブラリを開いています…',
    invalidPage: 'Storybookのページを開いてからお試しください。',
    failed: 'ライブラリを開けませんでした。ページを再読み込みして、もう一度お試しください。',
  },
  en: {
    headingFirst: 'Turn Storybook into',
    headingSecond: 'your design library.',
    descriptionFirst: 'Browse components and their variations.',
    descriptionSecond: 'Bring the design you choose into your next idea.',
    open: 'Open this Storybook',
    examples: 'Try a public library',
    formats: 'Figma / SVG / PNG / HTML / Link',
    language: 'Interface language',
    loading: 'Opening the library…',
    invalidPage: 'Open a Storybook page, then try again.',
    failed: 'The library could not be opened. Reload the page, then try again.',
  },
};
let language = 'ja';
let statusKey = '';
let languageRevision = 0;
let languageSave = Promise.resolve();
try { if ((localStorage.getItem(storageKey) || localStorage.getItem('story-library-popup-language')) === 'en') language = 'en'; }
catch { /* Language switching still works when storage is unavailable. */ }
const languageReady = (async () => {
  const revision = languageRevision;
  try {
    const saved = await globalThis.chrome?.storage?.local?.get(storageKey);
    if (revision === languageRevision && ['ja', 'en'].includes(saved?.[storageKey])) {
      language = saved[storageKey];
      renderLanguage();
    }
  } catch { /* Use the local preference if extension storage is unavailable. */ }
})();

function saveLanguage(value) {
  try { localStorage.setItem(storageKey, value); }
  catch { /* Extension storage can still persist the setting. */ }
  languageSave = languageSave.then(async () => {
    try { await globalThis.chrome?.storage?.local?.set({ [storageKey]: value }); }
    catch { /* The popup still works with its local preference. */ }
  });
}

function renderLanguage() {
  document.documentElement.lang = language;
  const text = messages[language];
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = text[element.dataset.i18n];
  languageSwitch.setAttribute('aria-label', text.language);
  for (const item of languageButtons) item.setAttribute('aria-pressed', String(item.dataset.language === language));
  status.textContent = text[statusKey] || '';
}

function setStatus(key, error = false) {
  statusKey = key;
  status.textContent = messages[language][key] || '';
  status.className = error ? 'error' : '';
}

for (const item of languageButtons) item.addEventListener('click', () => {
  languageRevision++;
  language = item.dataset.language;
  saveLanguage(language);
  renderLanguage();
});
renderLanguage();

button.addEventListener('click', async () => {
  button.disabled = true;
  setStatus('loading');
  try {
    await languageReady;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) {
      setStatus('invalidPage', true);
      button.disabled = false;
      return;
    }
    await languageSave;
    const response = await chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY', tabId: tab.id, language });
    if (!response?.ok) throw new Error(response?.error || 'Could not open the library.');
    window.close();
  } catch { setStatus('failed', true); button.disabled = false; }
});
