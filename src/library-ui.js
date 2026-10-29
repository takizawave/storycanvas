import styles from './library.css'
import { layoutItems, createInfiniteCanvas } from './infinite-canvas.js'
import { snapshotPreview } from './preview-snapshot.js'
import { detectStoryExamples } from './story-examples.js'
import { brandImageUrl } from './library-brand.js'
import { normalizeLibraryLanguage, translateLibrary } from './library-i18n.js'
import { createStoryView } from './story-view.js'

const INSTANCE_PADDING = 16

const icons = {
  library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  master: '<path d="m12 1 5 5-5 5-5-5Zm-6 6 5 5-5 5-5-5Zm12 0 5 5-5 5-5-5Zm-6 6 5 5-5 5-5-5Z"/>',
  variant: '<path d="m12 3 9 9-9 9-9-9Z"/>',
  component: '<path d="m12 2 4 4-4 4-4-4ZM6 8l4 4-4 4-4-4Zm12 0 4 4-4 4-4-4Zm-6 6 4 4-4 4-4-4Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 9.6l6.3-.9Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M14 3h7v7m0-7-10 10"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m2 10a4.2 4.2 0 0 0 6 0l4-4a4.2 4.2 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.91)"/>',
  figma: '<path d="M12 12a4 4 0 1 0 0-8H8a4 4 0 0 0 0 8h4Zm0 0H8a4 4 0 0 0 0 8 4 4 0 0 0 4-4V4m0 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  cursor: '<path d="m5 3 14 9-7 1-3 7-4-17Z"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-3l2 2Z"/>',
  selection: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  panels: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m8-16v16"/>',
}
const icon = (name, cls = '') => `<svg class="sl-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.component}</svg>`
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const shortTitle = (title) => String(title || 'Component').split('/').filter(Boolean).at(-1)?.trim() || 'Component'
const storyLabel = (story) => story.displayName || story.name
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
function colorInputValue(value) {
  if (typeof value !== 'string' || !CSS.supports('color', value)) return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.fillStyle = value
  return /^#[\da-f]{6}$/i.test(context.fillStyle) ? context.fillStyle : null
}
function measureRenderedContent(root, doc) {
  const boxes = []
  const seen = new WeakSet()
  let visited = 0
  const painted = value => value && !['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(value)
  const add = rect => { if (rect.width > 0 && rect.height > 0) boxes.push(rect) }
  function visit(node) {
    if (seen.has(node) || ++visited > 2200) return
    seen.add(node)
    if (node.nodeType === 3) {
      if (!node.textContent.trim()) return
      const range = doc.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) add(rect)
      return
    }
    if (node.nodeType !== 1 || ['STYLE', 'SCRIPT', 'LINK', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName)) return
    const style = doc.defaultView.getComputedStyle(node)
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return
    const presentationRoot = node === root || node.localName === 'sp-theme'
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && painted(style[`border${side}Color`]))
    if (!presentationRoot && (painted(style.backgroundColor) || painted(style.backgroundImage) || hasBorder || painted(style.boxShadow) || ['svg', 'img', 'canvas', 'video', 'input', 'textarea', 'select'].includes(node.localName))) add(node.getBoundingClientRect())
    if (node.localName === 'svg') return
    const assigned = node.localName === 'slot' ? node.assignedNodes?.({ flatten: true }) : null
    const children = assigned?.length ? assigned : (node.shadowRoot || node).childNodes
    for (const child of children) visit(child)
  }
  visit(root)
  if (!boxes.length) return null
  return { left: Math.min(...boxes.map(box => box.left)), top: Math.min(...boxes.map(box => box.top)), right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) }
}
const safeUrl = (value, base) => {
  try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : '' } catch { return '' }
}

/** Mount the designer library. The original Storybook page is left intact. */
export function mountLibrary({ groups = [], baseUrl, title = 'Storybook', sourceLinks = [], initialStoryId, language = 'ja', onLanguageChange = () => {}, onClose = () => {}, onExport, onProperties, onActions }) {
  let currentLanguage = normalizeLibraryLanguage(language)
  const t = (key, values = {}) => translateLibrary(key, currentLanguage, values)
  // Explicit text/attribute bindings update only library chrome. Comments keep
  // layout and selectors unchanged, and never touch Storybook iframe contents.
  const binding = (key, values = {}) => JSON.stringify({ key, values })
  const tx = (key, values = {}) => `<!--sl-i18n:${encodeURIComponent(binding(key, values))}-->${esc(t(key, values))}<!--/sl-i18n-->`
  const ta = (attribute, key, values = {}) => `${attribute}="${esc(t(key, values))}" data-sl-i18n-${attribute}="${esc(binding(key, values))}"`
  function setText(element, key, values = {}) {
    if (!element) return
    element.dataset.slI18nText = binding(key, values)
    element.textContent = t(key, values)
  }
  function setAttributeText(element, attribute, key, values = {}) {
    element.setAttribute(`data-sl-i18n-${attribute}`, binding(key, values))
    element.setAttribute(attribute, t(key, values))
  }
  function localize(container) {
    const comments = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
    while (comments.nextNode()) {
      const marker = comments.currentNode
      if (!marker.data.startsWith('sl-i18n:')) continue
      const { key, values } = JSON.parse(decodeURIComponent(marker.data.slice(8)))
      const text = t(key, values)
      if (marker.nextSibling?.nodeType === Node.TEXT_NODE) marker.nextSibling.textContent = text
      else marker.after(document.createTextNode(text))
    }
    for (const element of container.querySelectorAll('[data-sl-i18n-text],[data-sl-i18n-title],[data-sl-i18n-aria-label],[data-sl-i18n-placeholder]')) {
      for (const attribute of ['text', 'title', 'aria-label', 'placeholder']) {
        const raw = element.getAttribute(`data-sl-i18n-${attribute}`)
        if (!raw) continue
        const { key, values } = JSON.parse(raw)
        if (attribute === 'text') element.textContent = t(key, values)
        else element.setAttribute(attribute, t(key, values))
      }
    }
  }
  function setLanguage(nextLanguage) {
    currentLanguage = normalizeLibraryLanguage(nextLanguage)
    host.lang = currentLanguage
    localize(shadow)
    shadow.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === currentLanguage)))
  }
  const sourceUrl = safeUrl(baseUrl || location.href, location.href)
  const sourceHost = new URL(sourceUrl || location.href).hostname
  const cleanGroups = groups.filter(group => group?.stories?.length).map(group => ({ ...group, id: String(group.id), stories: group.stories.map(story => ({ ...story, id: String(story.id) })) }))
  const byGroup = new Map(cleanGroups.map(group => [group.id, group]))
  const byStory = new Map(cleanGroups.flatMap(group => group.stories.map(story => [story.id, { story, group }])))
  const initial = byStory.get(initialStoryId) || byStory.values().next().value
  const storageKey = `story-library:favorites:${sourceHost}`
  let favorites
  try { favorites = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')) } catch { favorites = new Set() }
  let selectedId = initial?.story.id
  let selectedExampleKey = ''
  let view = initial?.group.id || 'all'
  let query = ''
  let destroyed = false
  let exportBusy = false
  let menuOpen = false
  let zoomMenuOpen = false
  let toastTimer
  let modal = null
  let modalReturnFocus = null
  let expandedRecord = null
  let previewSerial = 0
  const mountId = Math.random().toString(36).slice(2)
  const propertyOverrides = new Map()
  const previewCache = new Map()
  const storyExamples = new Map()
  let examplesRenderQueued = false
  const viewCameras = new Map()
  let canvasLayout = { items: [], bounds: { x: 0, y: 0, width: 1, height: 1 } }
  let layoutFrame = 0
  let visibilityFrame = 0
  let camera
  let fittedFrame = null
  let applyingFrameFit = false
  const previewRecords = new Map()
  const pendingPreviews = new Set()
  const cleanupFns = []
  const canvasToolsMarkup = `<div class="sl-canvas-tools" role="group" data-canvas-no-pan ${ta('aria-label', 'キャンバスツール')}><button data-canvas-tool="select" aria-pressed="true" ${ta('title', '選択ツール (V)')} ${ta('aria-label', '選択ツール')}>${icon('cursor')}</button><button data-canvas-tool="hand" aria-pressed="false" ${ta('title', '手のひらツール (H)')} ${ta('aria-label', '手のひらツール')}>${icon('hand')}</button><span></span><button data-action="toggle-panels" aria-pressed="false" ${ta('title', 'パネルを表示・非表示 (⌘ / Ctrl＋\\)')} ${ta('aria-label', 'パネルを表示・非表示')}>${icon('panels')}</button><button data-action="shortcuts" ${ta('title', 'キーボードショートカット (?)')} ${ta('aria-label', 'キーボードショートカット')}>?</button></div>`
  const canvasControlsMarkup = `<div class="sl-canvas-controls" role="group" data-canvas-no-pan ${ta('aria-label', 'キャンバスの表示')}><button data-action="zoom-out" ${ta('title', '縮小')} ${ta('aria-label', '縮小')}>−</button><button data-action="zoom-reset" class="sl-zoom-value" ${ta('title', '100%で表示 (⇧0)')}>100%</button><button data-action="zoom-menu" aria-expanded="false" aria-controls="sl-zoom-menu" ${ta('title', 'ズームメニュー')} ${ta('aria-label', 'ズームメニュー')}>${icon('down')}</button><button data-action="zoom-in" ${ta('title', '拡大')} ${ta('aria-label', '拡大')}>＋</button><span></span><button data-action="zoom-fit" ${ta('title', '全体を表示 (⇧1)')} ${ta('aria-label', '全体を表示')}>${icon('expand')}</button><button data-action="zoom-selection" ${ta('title', '選択範囲にズーム (⇧2)')} ${ta('aria-label', '選択範囲を表示')}>${icon('selection')}</button><div class="sl-zoom-menu" id="sl-zoom-menu" role="group" ${ta('aria-label', 'ズーム倍率')} hidden>${[.25, .5, 1, 2, 3].map(scale => `<button data-zoom="${scale}">${scale * 100}%</button>`).join('')}<button data-action="zoom-menu-fit"><span>${tx('全体を表示')}</span><kbd>⇧1</kbd></button><button data-action="zoom-menu-selection"><span>${tx('選択範囲にズーム')}</span><kbd>⇧2</kbd></button></div></div>`
  const host = document.createElement('div')
  host.id = 'story-library-host'
  host.setAttribute('data-story-library', '')
  host.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;z-index:2147483646!important;display:block!important;visibility:visible!important;opacity:1!important;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${styles}</style><div class="sl-app" role="dialog" aria-modal="true" aria-label="Story Library"><header class="sl-header"><a class="sl-brand" href="#" ${ta('aria-label', 'Story Library ホーム')}><span class="sl-brandmark">${icon('library')}</span><span>Story Library</span></a><div class="sl-header-divider"></div><span class="sl-project">${esc(title || 'Storybook')}</span><span class="sl-connected"><i></i>${tx('Storybook に接続中')}</span><div class="sl-header-actions"><div class="sl-segmented sl-mode-toggle" role="group" ${ta('aria-label', '表示モード')}><button data-display-mode="story" aria-pressed="false">Story</button><button data-display-mode="canvas" aria-pressed="true">Canvas</button></div><div class="sl-segmented sl-language-toggle" role="group" ${ta('aria-label', '表示言語')}><button data-language="ja" aria-pressed="${currentLanguage === 'ja'}" lang="ja">日本語</button><button data-language="en" aria-pressed="${currentLanguage === 'en'}" lang="en">English</button></div><button class="sl-help sl-text-button" data-action="help">${icon('info')}${tx('使い方')}</button><a class="sl-source-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Storybook${icon('external')}</a><span class="sl-header-divider"></span><button class="sl-icon-button sl-close" data-action="close" ${ta('title', 'ライブラリを閉じる')} ${ta('aria-label', 'ライブラリを閉じる')}>${icon('close')}</button></div></header><div class="sl-layout"><aside class="sl-sidebar" ${ta('aria-label', 'コンポーネントナビゲーション')}><div class="sl-workspace"><span class="sl-workspace-icon">${icon('component')}</span><span><strong>${esc(title || 'Storybook')}</strong></span><span class="sl-workspace-dot"></span></div><label class="sl-search">${icon('search')}<input type="search" ${ta('placeholder', 'コンポーネントを検索')} ${ta('aria-label', 'コンポーネントを検索')} autocomplete="off"><kbd>⌘ K</kbd></label><nav class="sl-primary-nav"><button data-view="all">${icon('library')}<span>${tx('すべてのコンポーネント')}</span><em>${cleanGroups.length}</em></button><button data-view="favorites">${icon('star')}<span>${tx('お気に入り')}</span><em data-favorite-count>${favorites.size}</em></button></nav><div class="sl-nav-divider"></div><div class="sl-component-nav" role="navigation" ${ta('aria-label', 'コンポーネント一覧')}></div><div class="sl-sidebar-footer"><span class="sl-live-dot"></span><span>${tx('実際の Story をプレビュー')}</span>${icon('info')}</div></aside><main class="sl-main"><div class="sl-main-heading"></div><div class="sl-canvas" tabindex="0" ${ta('aria-label', 'コンポーネントキャンバス')}><div class="sl-canvas-world"><div class="sl-grid sl-variant-grid"></div></div>${canvasToolsMarkup}${canvasControlsMarkup}</div><footer class="sl-canvas-footer"><span class="sl-result-count"></span><span>${tx('Space＋ドラッグで移動')} <span class="sl-footer-dot">·</span> ${tx('⌘ / Ctrl＋スクロールでズーム')}</span><span class="sl-canvas-label">${tx('INFINITE CANVAS')}</span></footer></main><aside class="sl-inspector" ${ta('aria-label', '選択したコンポーネント')}></aside></div><div class="sl-toast" role="status" aria-live="polite"></div><div class="sl-modal-root"></div></div>`
  host.lang = currentLanguage
  document.documentElement.append(host)
  const app = shadow.querySelector('.sl-app')
  const nav = shadow.querySelector('.sl-component-nav')
  const mainHeading = shadow.querySelector('.sl-main-heading')
  const canvas = shadow.querySelector('.sl-canvas')
  const grid = shadow.querySelector('.sl-grid')
  const world = shadow.querySelector('.sl-canvas-world')
  const inspector = shadow.querySelector('.sl-inspector')
  const searchInput = shadow.querySelector('.sl-search input')
  const shortcutKeys = { 'zoom-fit': 'Shift+1', 'zoom-selection': 'Shift+2', 'zoom-reset': 'Shift+0', 'zoom-in': '+', 'zoom-out': '-', 'shortcuts': 'Shift+/', 'toggle-panels': 'Meta+\\ Control+\\' }
  for (const [action, keys] of Object.entries(shortcutKeys)) shadow.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-keyshortcuts', keys)
  shadow.querySelector('[data-canvas-tool="select"]').setAttribute('aria-keyshortcuts', 'V')
  shadow.querySelector('[data-canvas-tool="hand"]').setAttribute('aria-keyshortcuts', 'H')
  const storyView = createStoryView({ host, app, layout: shadow.querySelector('.sl-layout'), header: shadow.querySelector('.sl-header'), onChange: mode => { closeModal(); setMenu(false); setZoomMenu(false); camera?.cancelInteraction(); if (mode === 'canvas') canvas.focus({ preventScroll: true }) } })
  const previouslyFocused = document.activeElement
  const project = shadow.querySelector('.sl-project')
  const sourceIdentity = document.createElement('div')
  sourceIdentity.className = 'sl-source-identity'
  project.before(sourceIdentity)
  const sourceLogo = document.createElement('span')
  sourceLogo.className = 'sl-source-logo'
  sourceLogo.hidden = true
  sourceIdentity.append(sourceLogo, project)
  const workspaceLogo = shadow.querySelector('.sl-workspace-icon')
  const fallbackLogo = workspaceLogo.innerHTML
  let brandVersion = 0
  let cancelBrandImage = () => {}
  function setBrandSources(sources = []) {
    const version = ++brandVersion
    cancelBrandImage()
    const candidates = [...new Set(sources.map(source => brandImageUrl(source, sourceUrl)).filter(Boolean))].slice(0, 6)
    sourceLogo.hidden = true
    sourceLogo.replaceChildren()
    workspaceLogo.classList.remove('sl-has-brand-logo')
    workspaceLogo.innerHTML = fallbackLogo
    let index = 0
    function next() {
      if (destroyed || version !== brandVersion || index >= candidates.length) return
      const image = new Image()
      image.className = 'sl-library-logo'
      image.alt = ''
      image.referrerPolicy = 'no-referrer'
      image.decoding = 'async'
      let timeout
      const cancel = () => { clearTimeout(timeout); image.onload = null; image.onerror = null }
      cancelBrandImage = cancel
      image.onerror = () => { cancel(); next() }
      image.onload = () => {
        cancel()
        if (destroyed || version !== brandVersion || !image.naturalWidth) return
        workspaceLogo.replaceChildren(image)
        workspaceLogo.classList.add('sl-has-brand-logo')
        sourceLogo.replaceChildren(image.cloneNode())
        sourceLogo.hidden = false
      }
      timeout = setTimeout(() => { cancel(); next() }, 3500)
      image.src = candidates[index++]
    }
    next()
  }
  cleanupFns.push(() => { brandVersion++; cancelBrandImage() })
  if (sourceLinks.length > 1) {
    const sourceSelect = document.createElement('select')
    sourceSelect.className = 'sl-source-select'
    setAttributeText(sourceSelect, 'aria-label', 'ライブラリを切り替え')
    for (const source of sourceLinks) {
      const url = safeUrl(source.url, sourceUrl)
      if (!url || new URL(url).origin !== location.origin) continue
      const option = document.createElement('option')
      option.value = url
      option.textContent = String(source.title).slice(0, 80)
      option.selected = source.title === title
      sourceSelect.append(option)
    }
    if (sourceSelect.options.length > 1) shadow.querySelector('.sl-project').replaceWith(sourceSelect)
    sourceSelect.addEventListener('change', () => location.assign(sourceSelect.value))
  }

  const toast = (message, isError = false, values = {}) => {
    if (destroyed) return
    const element = shadow.querySelector('.sl-toast')
    element.className = `sl-toast sl-show${isError ? ' sl-toast-error' : ''}`
    element.innerHTML = `${icon(isError ? 'info' : 'check')}<span>${tx(message, values)}</span>`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => element.classList.remove('sl-show'), isError ? 6500 : 3500)
  }

  // Keep a bounded number of live Storybooks. Rendered previews remain visible
  // as cached vectors when their iframe is released, including at overview zoom.
  camera = createInfiniteCanvas({ viewport: canvas, world, minScale: 0.005, isEnabled: () => !destroyed && !modal && storyView.getMode() === 'canvas', onChange: next => {
    if (!applyingFrameFit) fittedFrame = null
    shadow.querySelector('.sl-zoom-value').textContent = `${next.scale < .1 ? (next.scale * 100).toFixed(1) : Math.round(next.scale * 100)}%`
    canvas.style.backgroundPosition = `${next.x}px ${next.y}px`
    canvas.style.backgroundSize = `${Math.max(7, 16 * next.scale)}px ${Math.max(7, 16 * next.scale)}px`
    scheduleVisibility()
  } })
  cleanupFns.push(() => camera.destroy())

  function setCanvasTool(tool) {
    camera.setTool(tool)
    canvas.dataset.canvasTool = camera.getTool()
    shadow.querySelectorAll('[data-canvas-tool]').forEach(button => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.canvasTool === camera.getTool()))
    })
  }

  function setZoomMenu(open, returnFocus = false) {
    zoomMenuOpen = open
    const menu = shadow.querySelector('.sl-zoom-menu')
    if (!menu) return
    menu.hidden = !open
    const trigger = shadow.querySelector('[data-action="zoom-menu"]')
    trigger.setAttribute('aria-expanded', String(open))
    menu.querySelectorAll('[data-zoom]').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.zoom) - camera.getCamera().scale) < .001)))
    if (open) { setMenu(false); menu.querySelector('button')?.focus() }
    else if (returnFocus) trigger.focus()
  }

  function togglePanels() {
    const hidden = app.classList.toggle('sl-panels-hidden')
    for (const panel of [shadow.querySelector('.sl-sidebar'), inspector]) {
      panel.inert = hidden
      panel.setAttribute('aria-hidden', String(hidden))
    }
    shadow.querySelector('[data-action="toggle-panels"]').setAttribute('aria-pressed', String(hidden))
    canvas.focus({ preventScroll: true })
  }

  function zoomSelection() {
    const record = [...previewRecords.values()].find(record => !record.pinned && isSelectedPreview(record))
    if (record?.position) fitFrame(record)
  }

  function fitFrame(record) {
    fittedFrame = record
    applyingFrameFit = true
    try { camera.fit(record.position, { padding: 80 }) }
    finally { applyingFrameFit = false }
  }

  function clearSelection() {
    fittedFrame = null
    selectedId = undefined
    selectedExampleKey = ''
    grid.querySelectorAll('.sl-selected').forEach(card => { card.classList.remove('sl-selected'); card.setAttribute('aria-selected', 'false') })
    app.classList.remove('sl-inspector-open')
    renderInspector()
    updateVisibility()
    canvas.focus({ preventScroll: true })
  }

  function moveSelection(key) {
    const records = [...previewRecords.values()].filter(record => !record.pinned && record.position && grid.contains(record.element))
    const selected = records.find(isSelectedPreview)
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
    const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
    const point = record => ({ x: record.position.x + record.position.width / 2, y: record.position.y + record.position.height / 2 })
    const origin = selected && point(selected)
    const candidates = selected ? records.filter(record => record !== selected).map(record => {
      const p = point(record), dx = p.x - origin.x, dy = p.y - origin.y
      const forward = (horizontal ? dx : dy) * direction, sideways = Math.abs(horizontal ? dy : dx)
      return { record, forward, score: forward + sideways * 3 }
    }).filter(candidate => candidate.forward > 1).sort((a, b) => a.score - b.score).map(candidate => candidate.record) : records
    const next = candidates[0]
    if (next) selectStory(next.story.id, { focusCard: true, exampleKey: next.exampleKey })
  }

  function stepFrame(direction) {
    // DOM order matches the layout, including examples discovered after mount.
    const records = [...grid.querySelectorAll('.sl-card .sl-preview')]
      .map(element => previewRecords.get(element.dataset.previewId))
      .filter(record => record?.position && !record.pinned)
    if (!records.length) return
    const index = records.findIndex(isSelectedPreview)
    const nextIndex = index < 0 ? (direction > 0 ? 0 : records.length - 1) : (index + direction + records.length) % records.length
    const next = records[nextIndex]
    setZoomMenu(false)
    setMenu(false)
    selectStory(next.story.id, { exampleKey: next.exampleKey })
    next.element.closest('.sl-card').focus({ preventScroll: true })
    fitFrame(next)
  }

  function panByKey(key, fast) {
    const distance = fast ? 160 : 40
    const current = camera.getCamera()
    camera.setCamera({
      x: current.x + (key === 'ArrowLeft' ? distance : key === 'ArrowRight' ? -distance : 0),
      y: current.y + (key === 'ArrowUp' ? distance : key === 'ArrowDown' ? -distance : 0),
    })
  }

  function openExportMenu() {
    if (!selectedId) return
    if (app.classList.contains('sl-panels-hidden')) togglePanels()
    app.classList.add('sl-inspector-open')
    setZoomMenu(false)
    setMenu(true)
    inspector.querySelector('.sl-copy-menu button')?.focus()
  }

  function scheduleVisibility() {
    cancelAnimationFrame(visibilityFrame)
    visibilityFrame = requestAnimationFrame(updateVisibility)
  }

  function updateVisibility() {
    if (destroyed || !camera) return
    const { x, y, scale } = camera.getCamera()
    const left = (-x - 180) / scale, top = (-y - 180) / scale
    const right = (canvas.clientWidth - x + 180) / scale, bottom = (canvas.clientHeight - y + 180) / scale
    pendingPreviews.clear()
    for (const record of previewRecords.values()) {
      if (record.pinned) continue
      const item = record.position
      record.visible = !!item && item.x < right && item.x + item.width > left && item.y < bottom && item.y + item.height > top
      if (!record.visible) { if (record.frame) unloadPreview(record); continue }
      if (!record.failed && !record.frame && (!record.snapshot || isSelectedPreview(record))) pendingPreviews.add(record)
    }
    drainPreviews()
  }

  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame)
    layoutFrame = requestAnimationFrame(layoutCanvas)
  }

  const previewKey = (storyId, exampleKey = '') => `${storyId}::${exampleKey}`
  const isSelectedPreview = record => record.story.id === selectedId && (record.exampleKey || '') === selectedExampleKey
  function previewRoot(record) {
    const doc = record.frame?.contentDocument
    const root = doc?.querySelector('#storybook-root, #root') || doc?.body
    if (!root || !record.exampleKey) return root
    return detectStoryExamples(root, { familyTitle: byStory.get(record.story.id)?.group.title }).find(example => example.key === record.exampleKey)?.element
  }

  function discoverExamples(record, root) {
    if (record.exampleKey || storyExamples.has(record.story.id)) return
    const examples = detectStoryExamples(root, { familyTitle: byStory.get(record.story.id)?.group.title })
    if (examples.length < 2) return
    storyExamples.set(record.story.id, examples.map(({ key, label }) => ({ key, label })))
    if (selectedId === record.story.id && !selectedExampleKey) selectedExampleKey = examples[0].key
    if (examplesRenderQueued) return
    examplesRenderQueued = true
    setTimeout(() => {
      examplesRenderQueued = false
      if (destroyed) return
      const previous = camera.getCamera()
      renderCanvas()
      if (!fittedFrame) camera.setCamera(previous)
      if ((currentInspectorRecord()?.exampleKey || '') !== selectedExampleKey) renderInspector()
      updateVisibility()
    }, 120)
  }

  function layoutCanvas() {
    if (destroyed) return
    const records = [...grid.querySelectorAll('.sl-card .sl-preview')].map(element => previewRecords.get(element.dataset.previewId)).filter(Boolean)
    const anchor = records.find(record => record.visible && isSelectedPreview(record)) || records.find(record => record.visible && record.bounds)
    const previousPosition = anchor?.position
    const families = new Map()
    for (const record of records) {
      const group = byStory.get(record.story.id).group
      if (!families.has(group.id)) families.set(group.id, [])
      const bounds = record.bounds
      families.get(group.id).push({ id: record.id, width: bounds ? Math.max(100, Math.min(450, bounds.right - bounds.left) + INSTANCE_PADDING * 2) : 240, height: (bounds ? Math.min(700, Math.max(20, bounds.bottom - bounds.top)) + INSTANCE_PADDING * 2 : 130) + 24 })
    }
    const columns = [32, 32, 32]
    const items = []
    let right = 1, bottom = 1
    for (const [groupId, members] of families) {
      const local = layoutItems(members, { maxWidth: byGroup.has(view) ? Math.max(580, canvas.clientWidth - 80) : 1000, gapX: 32, gapY: 32, padding: 40 })
      const column = byGroup.has(view) ? 0 : columns.indexOf(Math.min(...columns))
      const x = byGroup.has(view) ? 32 : 32 + column * 1072
      const y = columns[column]
      const width = Math.max(220, local.bounds.width), height = local.bounds.height + 24
      columns[column] = y + height + 72
      for (const item of local.items) items.push({ ...item, x: x + item.x, y: y + 24 + item.y })
      const frame = [...grid.querySelectorAll('.sl-master-frame')].find(element => element.dataset.masterGroup === groupId)
      if (frame) frame.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;`
      right = Math.max(right, x + width + 32)
      bottom = Math.max(bottom, y + height + 32)
    }
    canvasLayout = { items, bounds: { x: 0, y: 0, width: right, height: bottom } }
    for (const item of canvasLayout.items) {
      const record = previewRecords.get(item.id)
      if (!record) continue
      record.position = item
      const card = record.element.closest('.sl-card')
      card.style.left = `${item.x}px`
      card.style.top = `${item.y}px`
      card.style.width = `${item.width}px`
      record.element.style.height = `${Math.max(20, item.height - 24)}px`
      fitPreview(record)
    }
    // A cold Story can grow after its real dimensions arrive. Keep the frame
    // fitted until the user moves/zooms the camera or chooses another frame.
    if (fittedFrame?.position && records.includes(fittedFrame) && isSelectedPreview(fittedFrame)) {
      fitFrame(fittedFrame)
    } else if (anchor?.position && previousPosition) {
      const { x, y, scale } = camera.getCamera()
      const dx = previousPosition.x - anchor.position.x, dy = previousPosition.y - anchor.position.y
      if (dx || dy) camera.setCamera({ x: x + dx * scale, y: y + dy * scale, scale })
    }
    grid.style.width = `${canvasLayout.bounds.x + canvasLayout.bounds.width}px`
    grid.style.height = `${canvasLayout.bounds.y + canvasLayout.bounds.height}px`
    scheduleVisibility()
  }

  function focusStory(storyId) {
    const record = [...previewRecords.values()].find(record => !record.pinned && record.story.id === storyId && (!selectedExampleKey || record.exampleKey === selectedExampleKey))
    if (record?.position) camera.focus(record.position)
    scheduleVisibility()
  }

  function snapshotRecord(record) {
    if (!record.frame || !record.ready || record.snapshot || record.snapshotFailed || record.snapshotTimer || record.snapshotBusy || record.propertySyncPromise || record.propertySyncFailed) return
    const frame = record.frame
    const revision = record.snapshotRevision || 0
    record.snapshotTimer = setTimeout(async () => {
      record.snapshotTimer = null
      if (record.frame !== frame || destroyed || revision !== (record.snapshotRevision || 0) || record.propertySyncPromise) return
      record.snapshotBusy = true
      try {
        const root = previewRoot(record)
        if (!root) throw new Error('Preview document unavailable')
        const bounds = record.bounds
        const tightBounds = bounds ? { ...bounds, right: Math.min(bounds.right, bounds.left + 450), bottom: Math.min(bounds.bottom, bounds.top + 700) } : undefined
        const snapshot = await snapshotPreview(root, { storyId: record.story.id, tightBounds })
        if (destroyed || record.frame !== frame || revision !== (record.snapshotRevision || 0) || record.propertySyncPromise) return
        record.snapshot = snapshot
        previewCache.set(previewKey(record.story.id, record.exampleKey), { bounds: record.bounds, snapshot })
        let image = record.element.querySelector('.sl-preview-snapshot')
        if (!image) { image = document.createElement('img'); image.className = 'sl-preview-snapshot'; image.alt = ''; image.draggable = false; record.element.prepend(image) }
        image.src = snapshot.src
        image.hidden = !!record.frame
        if (!isSelectedPreview(record)) unloadPreview(record)
      } catch {
        if (record.frame === frame && !destroyed && revision === (record.snapshotRevision || 0) && !record.propertySyncPromise) {
          record.snapshotFailed = true
          if (!isSelectedPreview(record)) {
            record.failed = true
            unloadPreview(record)
            setPreviewState(record, 'error', '選択するとライブプレビューを開けます')
          }
        }
      }
      finally {
        record.snapshotBusy = false
        if (!record.snapshot && (record.frame !== frame || revision !== (record.snapshotRevision || 0))) snapshotRecord(record)
        drainPreviews()
      }
    }, 450)
  }

  function invalidateSnapshot(record) {
    record.snapshotRevision = (record.snapshotRevision || 0) + 1
    clearTimeout(record.snapshotTimer)
    record.snapshotTimer = null
    record.snapshot = null
    record.snapshotFailed = false
    record.element.querySelector('.sl-preview-snapshot')?.remove()
    previewCache.delete(previewKey(record.story.id, record.exampleKey))
  }

  function setPreviewState(record, state, message) {
    record.element.dataset.state = state
    const status = record.element.querySelector('.sl-preview-status')
    if (status) {
      status.innerHTML = state === 'error' ? `${icon('info')}<span>${tx(message || 'プレビューを読み込めませんでした')}</span><button class="sl-preview-retry" data-retry="${record.id}">${icon('refresh')}${tx('再読み込み')}</button>` : `<span class="sl-spinner"></span><span>${tx('Story を読み込み中')}</span>`
    }
  }

  function inspectPreview(record) {
    if (!record.frame || !record.element.isConnected) return
    if (!record.pinned && record.propertySyncFailed) {
      setPreviewState(record, 'error', 'Properties をキャンバスに反映できませんでした')
      return
    }
    try {
      const doc = record.frame.contentDocument
      if (!doc || !doc.body) return
      const errorVisible = doc.body.classList.contains('sb-show-errordisplay') || doc.body.classList.contains('sb-show-nopreview') || [...doc.querySelectorAll('.sb-errordisplay, .sb-nopreview, #error-message')].some(node => node.getBoundingClientRect().height > 0 && doc.defaultView.getComputedStyle(node).display !== 'none')
      if (errorVisible) {
        if (!record.pinned) { record.failed = true; unloadPreview(record); drainPreviews() }
        setPreviewState(record, 'error', 'この Story は表示できません')
        record.ready = false
        return
      }
      const storyRoot = doc.querySelector('#storybook-root, #root') || doc.body
      discoverExamples(record, storyRoot)
      const root = previewRoot(record)
      if (!root) return
      const boxes = Array.from(root.children).filter(node => !['STYLE', 'SCRIPT', 'LINK'].includes(node.tagName)).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      if (!boxes.length && !root.textContent?.trim()) return
      const sampleBox = record.exampleKey && !/^H[1-6]$/.test(root.tagName) ? root.getBoundingClientRect() : null
      const bounds = sampleBox?.width && sampleBox?.height ? { left: sampleBox.left, top: sampleBox.top, right: sampleBox.right, bottom: sampleBox.bottom } : measureRenderedContent(root, doc) || (boxes.length ? { left: Math.min(...boxes.map(box => box.left)), top: Math.min(...boxes.map(box => box.top)), right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) } : { left: 0, top: 0, right: 450, bottom: 360 })
      const resized = !record.bounds || JSON.stringify(record.bounds) !== JSON.stringify(bounds)
      if (resized && !record.pinned) invalidateSnapshot(record)
      record.bounds = bounds
      if (resized && !record.pinned) scheduleLayout()
      record.ready = true
      clearTimeout(record.timeout)
      setPreviewState(record, 'ready')
      fitPreview(record)
      if (record.pinned) { readProperties(record); startActions(record) }
      else { restoreCanvasProperties(record); snapshotRecord(record) }
    } catch {
      // Cross-origin sources can still render; fitting falls back to the viewport.
      record.ready = true
      clearTimeout(record.timeout)
      setPreviewState(record, 'ready')
      fitPreview(record)
      if (record.pinned) { readProperties(record); startActions(record) }
      else { restoreCanvasProperties(record); snapshotRecord(record) }
    }
  }

  function fitPreview(record) {
    const bounds = record.bounds || { left: 0, top: 0, right: 450, bottom: 360 }
    if (record.frame) record.frame.style.clipPath = record.exampleKey ? `inset(${Math.max(0, bounds.top)}px ${Math.max(0, 450 - bounds.right)}px ${Math.max(0, 720 - bounds.bottom)}px ${Math.max(0, bounds.left)}px)` : ''
    if (!record.pinned && grid.classList.contains('sl-variant-grid') && record.bounds) {
      const rawWidth = Math.max(24, Math.min(450, bounds.right - bounds.left))
      const rawHeight = Math.max(20, Math.min(700, bounds.bottom - bounds.top))
      const width = rawWidth + INSTANCE_PADDING * 2
      const scale = 1
      const card = record.element.closest('.sl-card')
      card.style.setProperty('--sl-preview-width', `${Math.ceil(width)}px`)
      card.style.setProperty('--sl-preview-height', `${Math.ceil(rawHeight * scale + INSTANCE_PADDING * 2)}px`)
      record.element.style.width = `${Math.ceil(width)}px`
      if (record.frame) record.frame.style.transform = `translate(${INSTANCE_PADDING - bounds.left * scale}px, ${INSTANCE_PADDING - bounds.top * scale}px) scale(${scale})`
      return
    }
    if (!record.frame) return
    const width = record.element.clientWidth
    const height = record.element.clientHeight
    const contentWidth = Math.max(32, Math.min(450, bounds.right - bounds.left))
    const contentHeight = Math.max(24, Math.min(700, bounds.bottom - bounds.top))
    const padding = record.pinned ? 24 : 36
    const scale = Math.min(1, (width - padding) / contentWidth, (height - padding) / contentHeight)
    record.frame.style.transform = `translate(${Math.round((width - contentWidth * scale) / 2 - bounds.left * scale)}px, ${Math.round((height - contentHeight * scale) / 2 - bounds.top * scale)}px) scale(${Math.max(0.1, scale)})`
  }

  function loadPreview(record) {
    if (record.frame || destroyed || !record.element.isConnected) return
    pendingPreviews.delete(record)
    record.ready = false
    record.appliedOverrideSignature = null
    record.propertySyncFailed = false
    record.actionsStarted = false
    record.actionsState = undefined
    record.actionsRendered = null
    setPreviewState(record, 'loading')
    const frame = document.createElement('iframe')
    frame.name = `story-library-inspector-${mountId}-${record.pinned ? '' : 'grid-'}${record.id}`
    setAttributeText(frame, 'title', 'livePreviewTitle', { title: record.story.title || record.story.name, name: record.story.name })
    frame.tabIndex = record.pinned ? 0 : -1
    frame.setAttribute('data-story-id', record.story.id)
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    frame.style.cssText = 'width:450px;height:720px;'
    record.frame = frame
    const snapshot = record.element.querySelector('.sl-preview-snapshot')
    if (snapshot) snapshot.hidden = true
    frame.addEventListener('load', () => {
      if (!record.frame) return
      try { frame.contentDocument?.addEventListener('keydown', event => { if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) handleKey(event) }) } catch {}
      try {
        const doc = frame.contentDocument
        if (doc?.head && !doc.querySelector('[data-story-library-preview-style]')) {
          const style = doc.createElement('style')
          style.dataset.storyLibraryPreviewStyle = ''
          style.textContent = 'html,body{background:transparent!important}body{overflow:hidden!important}'
          doc.head.append(style)
        }
      } catch {}
      inspectPreview(record)
      record.settleTimers = [150, 600, 1600, 3500].map(delay => setTimeout(() => inspectPreview(record), delay))
    })
    frame.addEventListener('error', () => setPreviewState(record, 'error'))
    frame.src = safeUrl(record.story.previewUrl || `iframe.html?id=${encodeURIComponent(record.story.id)}&viewMode=story`, sourceUrl)
    record.element.prepend(frame)
    fitPreview(record)
    record.timeout = setTimeout(() => {
      if (!record.ready) {
        if (!record.pinned) { record.failed = true; unloadPreview(record); drainPreviews() }
        setPreviewState(record, 'error', 'Story の読み込みに時間がかかっています')
      }
    }, 20000)
  }

  function unloadPreview(record) {
    clearTimeout(record.actionsTimer)
    record.actionsEpoch = (record.actionsEpoch || 0) + 1
    clearTimeout(record.timeout)
    clearTimeout(record.snapshotTimer)
    record.snapshotTimer = null
    record.snapshotRevision = (record.snapshotRevision || 0) + 1
    record.appliedOverrideSignature = null
    record.pendingPropertySync = null
    record.settleTimers?.forEach(clearTimeout)
    record.frame?.remove()
    record.frame = null
    record.ready = !!record.snapshot
    record.propertiesRequested = false
    record.propertyEpoch = (record.propertyEpoch || 0) + 1
    const image = record.element.querySelector('.sl-preview-snapshot')
    if (image) image.hidden = false
    setPreviewState(record, record.snapshot ? 'ready' : 'idle')
  }

  function drainPreviews() {
    if (destroyed) return
    let active = [...previewRecords.values()].filter(record => !record.pinned && record.frame).length
    const { x, y, scale } = camera.getCamera()
    const center = { x: (canvas.clientWidth / 2 - x) / scale, y: (canvas.clientHeight / 2 - y) / scale }
    const distance = record => isSelectedPreview(record) ? -1 : Math.hypot((record.position?.x || 0) - center.x, (record.position?.y || 0) - center.y)
    for (const record of [...pendingPreviews].sort((a,b) => distance(a) - distance(b))) {
      if (active >= 8) break
      if (!record.visible || !record.element.isConnected || record.frame || (record.snapshot && !isSelectedPreview(record))) { pendingPreviews.delete(record); continue }
      loadPreview(record)
      active += 1
    }
  }

  function registerPreview(element, story, pinned = false, exampleKey = '') {
    const id = `preview-${++previewSerial}`
    const cached = !pinned ? previewCache.get(previewKey(story.id, exampleKey)) : null
    const record = { id, element, story, pinned, exampleKey, frame: null, ready: !!cached?.snapshot, bounds: cached?.bounds, snapshot: cached?.snapshot }
    if (cached?.snapshot) {
      const image = document.createElement('img'); image.className = 'sl-preview-snapshot'; image.alt = ''; image.draggable = false; image.src = cached.snapshot.src; element.prepend(image)
      setPreviewState(record, 'ready')
    }
    element.dataset.previewId = id
    previewRecords.set(id, record)
    resizeObserver.observe(element)
    if (pinned) loadPreview(record)
    else scheduleLayout()
    return record
  }

  function removePreviews(container) {
    for (const record of previewRecords.values()) {
      if (!container.contains(record.element)) continue
      resizeObserver.unobserve(record.element)
      unloadPreview(record)
      pendingPreviews.delete(record)
      previewRecords.delete(record.id)
    }
  }

  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const record = previewRecords.get(entry.target.dataset.previewId)
      if (record) fitPreview(record)
    }
  })

  function persistFavorites() {
    try { localStorage.setItem(storageKey, JSON.stringify([...favorites])) } catch { /* Private browsing can disable storage. */ }
    shadow.querySelector('[data-favorite-count]').textContent = favorites.size
  }

  function toggleFavorite(groupId) {
    favorites.has(groupId) ? favorites.delete(groupId) : favorites.add(groupId)
    persistFavorites()
    for (const button of shadow.querySelectorAll('[data-favorite]')) {
      const active = favorites.has(button.dataset.favorite)
      button.classList.toggle('sl-is-favorite', active)
      button.setAttribute('aria-pressed', String(active))
      setAttributeText(button, 'title', active ? 'お気に入りから削除' : 'お気に入りに追加')
      setAttributeText(button, 'aria-label', active ? 'favoriteRemove' : 'favoriteAdd', { name: shortTitle(byGroup.get(button.dataset.favorite)?.title) })
    }
    if (view === 'favorites') renderCanvas()
  }

  function filteredGroups() {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return cleanGroups.filter(group => {
      const haystack = `${group.title} ${group.category || ''} ${group.stories.map(story => `${story.name} ${story.title}`).join(' ')}`.toLowerCase()
      return terms.every(term => haystack.includes(term))
    })
  }

  function renderNav() {
    const available = filteredGroups()
    nav.innerHTML = available.map(group => `<button class="sl-nav-item${view === group.id ? ' sl-active' : ''}" data-group="${esc(group.id)}" ${view === group.id ? 'aria-current="page"' : ''} ${ta('title', 'groupDetails', { name: group.title })}>${icon('component')}<span>${esc(shortTitle(group.title))}</span><small>${group.stories.length}</small></button>`).join('') || `<p class="sl-nav-empty">${tx('一致するコンポーネントがありません')}</p>`
    shadow.querySelectorAll('[data-view]').forEach(button => {
      button.classList.toggle('sl-active', button.dataset.view === view)
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    })
  }

  const previewMarkup = (extra = '') => `<div class="sl-preview ${extra}" data-state="idle"><div class="sl-preview-status"><span class="sl-spinner"></span><span>${tx('Story を読み込み中')}</span></div></div>`
  function cardMarkup({ group, story, example }) {
    const active = selectedId === story.id && selectedExampleKey === (example?.key || '')
    const label = example ? (group.stories.length === 1 ? example.label : `${storyLabel(story)} / ${example.label}`) : storyLabel(story)
    return `<article class="sl-card${active ? ' sl-selected' : ''}" data-story="${esc(story.id)}" data-example="${esc(example?.key || '')}" tabindex="0" ${ta('aria-label', 'cardLabel', { name: shortTitle(group.title), label })} aria-selected="${active}">${previewMarkup()}<div class="sl-card-footer"><div class="sl-card-meta">${icon('variant')}<span class="sl-story-label" title="${esc(label)}">${esc(label)}</span></div><button class="sl-favorite${favorites.has(group.id) ? ' sl-is-favorite' : ''}" data-favorite="${esc(group.id)}" ${ta('aria-label', favorites.has(group.id) ? 'favoriteRemove' : 'favoriteAdd', { name: shortTitle(group.title) })} aria-pressed="${favorites.has(group.id)}">${icon('star')}</button></div></article>`
  }

  function renderCanvas() {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const selectedGroup = byGroup.get(view)
    const records = (selectedGroup ? [selectedGroup] : cleanGroups.filter(group => view !== 'favorites' || favorites.has(group.id))).flatMap(group => group.stories.map(story => ({ group, story }))).filter(({group,story}) => terms.every(term => `${group.title} ${storyLabel(story)}`.toLowerCase().includes(term)))
    const instances = records.flatMap(record => storyExamples.get(record.story.id)?.map(example => ({ ...record, example })) || [record])
    const countLabel = `${tx('storyCount', { count: records.length, unit: records.length === 1 ? 'story' : 'stories' })}${instances.length !== records.length ? ` · ${tx('exampleCount', { count: instances.length, unit: instances.length === 1 ? 'example' : 'examples' })}` : ''}`
    const heading = selectedGroup ? shortTitle(selectedGroup.title) : view === 'favorites' ? 'お気に入り' : 'すべてのコンポーネント'
    mainHeading.innerHTML = `<div class="sl-heading-row">${selectedGroup ? `<button class="sl-back-all" data-action="back-all" ${ta('aria-label', 'すべてのコンポーネントへ戻る')} ${ta('title', 'すべてのコンポーネント')}>${icon('arrow')}</button>` : ''}<h1>${selectedGroup ? esc(heading) : tx(heading)}</h1></div><span class="sl-library-stats">${!selectedGroup ? `${tx('componentCount', { count: new Set(records.map(record => record.group.id)).size, unit: new Set(records.map(record => record.group.id)).size === 1 ? 'component' : 'components' })} · ` : ''}${countLabel}</span>`
    if (!records.length) {
      removePreviews(grid)
      grid.innerHTML = `<div class="sl-empty">${icon(view === 'favorites' ? 'star' : 'search')}<h2>${tx(query ? '一致するコンポーネントがありません' : 'お気に入りはまだありません')}</h2>${query ? `<button class="sl-secondary-button" data-action="clear-search">${tx('検索をクリア')}</button>` : ''}</div>`
      camera.reset()
    } else {
      const frameGroups = [...new Map(records.map(record => [record.group.id, record.group])).values()]
      const masterFrames = frameGroups.map(group => `<section class="sl-master-frame" data-master-group="${esc(group.id)}" ${ta('aria-label', 'componentSet', { name: shortTitle(group.title) })}><div class="sl-master-frame-label">${icon('master', 'sl-master-icon')}<h2>${esc(shortTitle(group.title))}</h2></div><svg class="sl-master-frame-outline" aria-hidden="true"><rect width="100%" height="100%" rx="12" fill="none" stroke="#8A38F5" stroke-width="1" stroke-dasharray="8 6"/></svg></section>`).join('')
      // Keep retained cards in place: detaching/reinserting an iframe reloads
      // its Storybook, even when the same DOM node is reused afterwards.
      const existing = new Map([...grid.querySelectorAll('.sl-card')].map(card => [previewKey(card.dataset.story, card.dataset.example), card]))
      const adopted = []
      const cards = instances.map(instance => {
        const { story, example } = instance
        const key = previewKey(story.id, example?.key)
        let card = existing.get(key)
        if (!card && example === storyExamples.get(story.id)?.[0]) {
          card = existing.get(previewKey(story.id))
          const record = card && previewRecords.get(card.querySelector('.sl-preview').dataset.previewId)
          if (record) {
            invalidateSnapshot(record)
            record.exampleKey = example.key
            record.bounds = null
            card.dataset.example = example.key
            adopted.push(record)
          }
        }
        if (!card) {
          const template = document.createElement('template')
          template.innerHTML = cardMarkup(instance)
          card = template.content.firstElementChild
        } else {
          const active = selectedId === story.id && selectedExampleKey === (example?.key || '')
          const label = example ? (instance.group.stories.length === 1 ? example.label : `${storyLabel(story)} / ${example.label}`) : storyLabel(story)
          card.classList.toggle('sl-selected', active)
          card.setAttribute('aria-selected', String(active))
          setAttributeText(card, 'aria-label', 'cardLabel', { name: shortTitle(instance.group.title), label })
          const title = card.querySelector('.sl-story-label')
          title.textContent = label
          title.title = label
        }
        return card
      })
      const retained = new Set(cards)
      for (const card of existing.values()) if (!retained.has(card)) { removePreviews(card); card.remove() }
      grid.querySelectorAll('.sl-master-frame,.sl-empty').forEach(element => element.remove())
      grid.insertAdjacentHTML('afterbegin', masterFrames)
      let nextCard = null
      for (let index = cards.length - 1; index >= 0; index--) {
        const card = cards[index]
        if (!card.isConnected) {
          grid.insertBefore(card, nextCard)
        }
        nextCard = card
      }
      for (const card of cards) {
        const preview = card.querySelector('.sl-preview')
        if (!preview.dataset.previewId) registerPreview(preview, byStory.get(card.dataset.story).story, false, card.dataset.example)
      }
      for (const record of adopted) if (record.ready) inspectPreview(record)
    }
    shadow.querySelector('.sl-result-count').innerHTML = countLabel
    const selectedFamily = byStory.get(selectedId)?.group
    const variantCount = inspector.querySelector('.sl-variants-section .sl-inspector-section-heading>span')
    if (variantCount && selectedFamily) variantCount.textContent = selectedFamily.stories.reduce((total, item) => total + (storyExamples.get(item.id)?.length || 1), 0)
    layoutCanvas()
    renderNav()
    drainPreviews()
  }

  function selectStory(storyId, { focusCard = false, exampleKey } = {}) {
    if (!byStory.has(storyId)) return
    fittedFrame = null
    const nextExample = exampleKey ?? (selectedId === storyId ? selectedExampleKey : storyExamples.get(storyId)?.[0]?.key || '')
    const changed = selectedId !== storyId || selectedExampleKey !== nextExample
    selectedId = storyId
    selectedExampleKey = nextExample
    app.classList.add('sl-inspector-open')
    grid.querySelectorAll('[data-story]').forEach(card => {
      const active = card.dataset.story === selectedId && (card.dataset.example || '') === selectedExampleKey
      card.classList.toggle('sl-selected', active)
      card.setAttribute('aria-selected', String(active))
      if (active && focusCard) card.focus({ preventScroll: true })
    })
    if (changed || !inspector.querySelector('.sl-inspector-preview')) renderInspector()
    for (const record of previewRecords.values()) {
      if (record.pinned) continue
      if (isSelectedPreview(record)) record.failed = false
      if (!isSelectedPreview(record) && record.frame && (record.snapshot || record.snapshotFailed)) {
        unloadPreview(record)
        if (record.snapshotFailed) { record.failed = true; setPreviewState(record, 'error', '選択するとライブプレビューを開けます') }
      }
    }
    renderNav()
    if (focusCard) focusStory(storyId)
    updateVisibility()
  }

  function variantMarkup(group, story) {
    const count = group.stories.reduce((total, item) => total + (storyExamples.get(item.id)?.length || 1), 0)
    return `<section class="sl-variants-section"><div class="sl-inspector-section-heading"><h3>${icon('master', 'sl-master-icon')}${tx('Variants')}</h3><span>${count}</span></div>${(group.axes || []).map(axis => `<label class="sl-property-row sl-variant-row"><span class="sl-property-label">${esc(axis.label)}</span><span class="sl-property-control"><select data-variant-axis="${esc(axis.key)}" ${ta('aria-label', 'selectAxis', { name: axis.label })}>${axis.values.map(value => `<option value="${esc(value)}"${String(story.variantProperties?.[axis.key] ?? '') === String(value) ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select>${icon('down')}</span></label>`).join('')}<label class="sl-property-row sl-variant-row" for="sl-variant-select"><span class="sl-property-label">Story</span><span class="sl-property-control"><select id="sl-variant-select" ${ta('aria-label', 'バリエーションを選択')}>${group.stories.map(item => `<option value="${esc(item.id)}"${item.id === story.id ? ' selected' : ''}>${esc(storyLabel(item))}</option>`).join('')}</select>${icon('down')}</span></label>${group.axes?.length ? `<p class="sl-section-note">${tx('Story の階層から分類')}</p>` : ''}</section>`
  }

  function currentInspectorRecord() {
    return previewRecords.get(inspector.querySelector('.sl-inspector-preview')?.dataset.previewId)
  }

  function exampleMarkup(story) {
    const examples = storyExamples.get(story.id)
    if (!examples?.length) return ''
    return `<section class="sl-examples-section"><label class="sl-property-row"><span class="sl-property-label">${tx('見本')}</span><span class="sl-property-control"><select id="sl-example-select" ${ta('aria-label', 'Story 内の見本を選択')}>${examples.map(example => `<option value="${esc(example.key)}"${example.key === selectedExampleKey ? ' selected' : ''}>${esc(example.label)}</option>`).join('')}</select>${icon('down')}</span></label></section>`
  }

  // Keep the raw canvas instance in step with its inspector. Only the newest
  // pending state is applied when a previous Storybook update is still running.
  function syncCanvasProperties(record, operation, updatedArgs) {
    if (!onProperties || !record?.frame || !record.ready || destroyed) return Promise.resolve()
    const signature = JSON.stringify(propertyOverrides.get(record.story.id) || {})
    record.pendingPropertySync = { operation, updatedArgs, signature }
    if (record.propertySyncPromise) return record.propertySyncPromise
    record.propertySyncPromise = (async () => {
      while (record.pendingPropertySync && record.frame && record.element.isConnected && !destroyed) {
        const request = record.pendingPropertySync
        record.pendingPropertySync = null
        const frame = record.frame
        invalidateSnapshot(record)
        record.propertySyncFailed = false
        try {
          const result = await onProperties({ story: record.story, frame, operation: request.operation, ...(request.updatedArgs ? { updatedArgs: request.updatedArgs } : {}) })
          if (destroyed || record.frame !== frame) return
          if (result?.error || result?.unavailable) {
            record.propertySyncFailed = true
            setPreviewState(record, 'error', 'Properties をキャンバスに反映できませんでした')
          } else {
            record.appliedOverrideSignature = request.signature
            inspectPreview(record)
            setTimeout(() => { if (record.frame === frame) inspectPreview(record) }, 100)
          }
        } catch {
          if (destroyed || record.frame !== frame) return
          record.propertySyncFailed = true
          setPreviewState(record, 'error', 'Properties をキャンバスに反映できませんでした')
        }
      }
    })().finally(() => {
      record.propertySyncPromise = null
      const pending = record.pendingPropertySync
      if (pending && record.frame && record.ready && record.element.isConnected && !destroyed) syncCanvasProperties(record, pending.operation, pending.updatedArgs)
      else if (record.frame && record.ready && record.element.isConnected && !destroyed && !record.propertySyncFailed) { restoreCanvasProperties(record); snapshotRecord(record) }
    })
    return record.propertySyncPromise
  }

  function restoreCanvasProperties(record) {
    const overrides = propertyOverrides.get(record.story.id)
    if (!overrides || record.propertySyncPromise || record.propertySyncFailed || record.appliedOverrideSignature === JSON.stringify(overrides)) return
    syncCanvasProperties(record, 'update', overrides)
  }

  function propertyDefinition(key, state) {
    const meta = state.argTypes?.[key]
    const value = state.args?.[key]
    const control = typeof meta?.control === 'string' ? { type: meta.control } : meta?.control || {}
    const type = control.type || (typeof meta?.type === 'string' ? meta.type : meta?.type?.name)
    const options = meta?.options || control.options
    const validOptions = Array.isArray(options) && options.every(option => option === null || ['string', 'number', 'boolean'].includes(typeof option))
    const readOnly = !meta || meta.readOnly || state.canUpdate === false || meta.control === false || type === 'object' || type === 'array' || type === 'function' || (value !== null && typeof value === 'object') || typeof value === 'function' || (!validOptions && !['boolean', 'number', 'range', 'text', 'string', 'color'].includes(type))
    return { meta, value, control, type, options, validOptions, readOnly }
  }

  function editableArgs(values, state) {
    return Object.fromEntries(Object.entries(values || {}).filter(([key]) => {
      const { meta, readOnly } = propertyDefinition(key, state)
      return !readOnly && !meta?.table?.disable
    }))
  }

  function propertyField(key, state) {
    const { meta, value, control, type, options, validOptions, readOnly } = propertyDefinition(key, state)
    const changed = !sameValue(value, state.initialArgs?.[key])
    const glyph = type === 'boolean' ? '◐' : type === 'number' || type === 'range' ? '#' : validOptions ? '◇' : type === 'color' ? '◉' : readOnly ? '⌘' : 'T'
    const disabled = state.busy ? ' disabled' : ''
    const description = meta?.description || key
    let input
    if (readOnly) {
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
      input = `<span class="sl-property-readonly" ${value === undefined ? ta('title', '未設定') : `title="${esc(text)}"`}>${value === undefined ? tx('未設定') : esc(text)}</span><span class="sl-readonly-mark" ${ta('title', '読み取り専用')}>—</span>`
    } else if (type === 'boolean') {
      input = `<button class="sl-property-switch${value === true ? ' sl-on' : ''}" role="switch" aria-checked="${value === true}" aria-label="${esc(key)}" data-property="${esc(key)}" data-property-type="boolean"${disabled}><span></span></button><span class="sl-boolean-value">${value === undefined ? tx('未設定') : esc(String(value))}</span>`
    } else if (validOptions) {
      const selectedIndex = options.findIndex(option => sameValue(option, value))
      input = `<select data-property="${esc(key)}" data-property-type="select" aria-label="${esc(key)}"${disabled}>${selectedIndex < 0 ? `<option value="" selected disabled>${value === undefined ? tx('未設定') : esc(String(value))}</option>` : ''}${options.map((option, index) => `<option value="${index}"${index === selectedIndex ? ' selected' : ''}>${esc(control.labels?.[String(option)] || String(option))}</option>`).join('')}</select>${icon('down')}`
    } else if (type === 'number' || type === 'range') {
      input = `<input type="number" data-property="${esc(key)}" data-property-type="number" aria-label="${esc(key)}" value="${esc(value ?? '')}" ${ta('placeholder', '未設定')} step="${esc(Number.isFinite(control.step) ? control.step : 'any')}"${Number.isFinite(control.min) ? ` min="${control.min}"` : ''}${Number.isFinite(control.max) ? ` max="${control.max}"` : ''}${disabled}>`
    } else {
      const color = type === 'color' ? colorInputValue(value) : null
      input = `${color ? `<input type="color" class="sl-property-swatch" data-property="${esc(key)}" data-property-type="string" ${ta('aria-label', 'propertyColor', { name: key })} value="${esc(color)}"${disabled}>` : ''}<input type="text" data-property="${esc(key)}" data-property-type="string" aria-label="${esc(key)}" value="${esc(value ?? '')}" ${ta('placeholder', '未設定')} autocomplete="off"${disabled}>`
    }
    return `<div class="sl-property-row${readOnly ? ' sl-property-locked' : ''}${changed ? ' sl-property-changed' : ''}"><label class="sl-property-label" ${readOnly ? ta('title', 'readonlyDescription', { description }) : `title="${esc(description)}"`}><span class="sl-property-glyph">${glyph}</span><span>${esc(key)}</span>${changed ? `<i class="sl-property-change-dot" ${ta('title', '初期値から変更')}></i>` : ''}</label><div class="sl-property-control${type === 'boolean' && !readOnly ? ' sl-boolean-control' : ''}">${input}</div></div>`
  }

  function renderProperties(record) {
    if (destroyed || record !== currentInspectorRecord()) return
    const section = inspector.querySelector('.sl-properties-section')
    if (!section) return
    const state = record.propertyState || {}
    const keys = [...new Set([...Object.keys(state.argTypes || {}), ...Object.keys(state.args || {})])].filter(key => !state.argTypes?.[key]?.table?.disable)
    const changed = keys.filter(key => !sameValue(state.args?.[key], state.initialArgs?.[key])).length
    const status = state.error ? `<div class="sl-properties-status sl-properties-error" role="status">${icon('info')}<span>${tx(state.error)}</span><button data-action="retry-properties">${tx('再試行')}</button></div>` : state.unavailable ? `<p class="sl-properties-status">${tx('この Story は編集用の Properties を公開していません。')}</p>` : !keys.length ? `<p class="sl-properties-status">${state.busy ? `<span class="sl-spinner"></span>${tx('Properties を読み込み中')}` : tx('この Story に公開された Properties はありません。')}</p>` : ''
    section.setAttribute('aria-busy', String(!!state.busy))
    section.innerHTML = `<div class="sl-inspector-section-heading"><h3>${tx('Properties')}${keys.length ? `<span>${keys.length}</span>` : ''}</h3><button class="sl-property-reset" data-action="reset-properties" ${ta('title', 'Properties を初期値に戻す')} ${ta('aria-label', 'Properties を初期値に戻す')}${state.busy || !changed ? ' disabled' : ''}>${icon('refresh')}${changed ? `<span>${changed}</span>` : ''}</button></div>${keys.map(key => propertyField(key, state)).join('')}${status}${keys.length ? `<p class="sl-properties-caption" role="status">${state.busy ? `<span class="sl-spinner"></span>${tx('反映中…')}` : tx('変更は選択中のプレビューとコピーに反映')}</p>` : ''}`
  }

  async function requestProperties(record, operation = 'read', updatedArgs) {
    if (!record?.frame || !onProperties || record.propertyState?.busy || destroyed) return
    const frame = record.frame
    const epoch = record.propertyEpoch = (record.propertyEpoch || 0) + 1
    record.propertyState = { ...record.propertyState, busy: true, error: null }
    renderProperties(record)
    try {
      let result = await onProperties({ story: record.story, frame, operation, ...(updatedArgs ? { updatedArgs } : {}) })
      if (destroyed || record.frame !== frame || epoch !== record.propertyEpoch) return
      const saved = editableArgs(propertyOverrides.get(record.story.id), result || {})
      if (operation === 'read' && !result?.error && !result?.unavailable && saved && Object.keys(saved).length) {
        result = await onProperties({ story: record.story, frame, operation: 'update', updatedArgs: saved })
        if (destroyed || record.frame !== frame || epoch !== record.propertyEpoch) return
      }
      record.propertyState = { ...(result?.error ? record.propertyState : {}), ...result, busy: false }
      if (result?.args && !result?.error && !result?.unavailable) {
        const overrides = editableArgs(Object.fromEntries(Object.entries(result.args).filter(([key, value]) => !sameValue(value, result.initialArgs?.[key]))), result)
        if (Object.keys(overrides).length) propertyOverrides.set(record.story.id, overrides)
        else propertyOverrides.delete(record.story.id)
        // Mirror only editable changes. Keep the just-edited keys even when
        // they returned to their initial values; never send readonly story args.
        if (operation !== 'read' || Object.keys(overrides).length) {
          for (const key of previewCache.keys()) if (key.startsWith(`${record.story.id}::`)) previewCache.delete(key)
          for (const item of previewRecords.values()) {
            if (item.pinned || item.story.id !== record.story.id) continue
            invalidateSnapshot(item)
            if (!item.frame) { item.ready = false; setPreviewState(item, 'idle') }
          }
          const mirrors = [...previewRecords.values()].filter(item => !item.pinned && item.story.id === record.story.id && item.ready && item.frame)
          const editedKeys = Object.fromEntries(Object.keys(updatedArgs || {}).filter(key => Object.prototype.hasOwnProperty.call(result.args, key)).map(key => [key, result.args[key]]))
          const mirrorArgs = operation === 'reset' ? undefined : { ...overrides, ...editableArgs(editedKeys, result) }
          record.propertyState.busy = mirrors.length > 0
          await Promise.all(mirrors.map(item => syncCanvasProperties(item, operation === 'reset' ? 'reset' : 'update', mirrorArgs)))
          if (destroyed || record.frame !== frame || epoch !== record.propertyEpoch) return
          record.propertyState.busy = false
          scheduleVisibility()
        }
      }
      if (operation !== 'read' && !result?.error) {
        inspectPreview(record)
        setTimeout(() => inspectPreview(record), 120)
      }
    } catch (error) {
      if (destroyed || record.frame !== frame || epoch !== record.propertyEpoch) return
      record.propertyState = { ...record.propertyState, busy: false, error: error?.message || 'Properties を取得できませんでした。' }
    }
    renderProperties(record)
  }

  function readProperties(record) {
    if (record.propertiesRequested || record !== currentInspectorRecord()) return
    record.propertiesRequested = true
    if (!onProperties) {
      record.propertyState = { unavailable: true }
      renderProperties(record)
      return
    }
    requestProperties(record)
  }

  function renderActions(record) {
    if (destroyed || record !== currentInspectorRecord()) return
    const section = inspector.querySelector('.sl-actions-section')
    if (!section) return
    const state = record.actionsState || {}
    const events = Array.isArray(state.actions) ? state.actions.slice(0, 30) : []
    const signature = JSON.stringify([state.actionsAvailable, state.listening, state.error, state.clearing, events])
    if (record.actionsRendered === signature) return
    record.actionsRendered = signature
    const status = state.error ? `<p class="sl-actions-status" data-state="error">${tx(state.error)} <button data-action="retry-actions">${tx('再試行')}</button></p>`
      : state.actionsAvailable === false && !state.listening ? `<p class="sl-actions-status">${tx('この Story では Actions を取得できません。')}</p>`
      : state.actionsAvailable === undefined ? `<p class="sl-actions-status">${tx('読み込み中…')}</p>`
      : !events.length ? `<p class="sl-actions-status">${tx('記録されたイベントはありません。')}</p>` : ''
    section.innerHTML = `<div class="sl-inspector-section-heading"><h3>${tx('Actions')}${events.length ? `<span>${events.length}</span>` : ''}</h3><button class="sl-actions-clear" data-action="clear-actions" ${ta('aria-label', 'Actions の履歴をクリア')} ${ta('title', '履歴をクリア')}${!events.length || state.clearing ? ' disabled' : ''}>${icon('close')}</button></div>${status}${events.length ? `<ol class="sl-actions-list">${events.map(event => {
      const date = new Date(event.time)
      const time = Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour12: false }) : ''
      return `<li class="sl-action-event"><div class="sl-action-event-heading"><strong>${event.name ? esc(event.name) : tx('Event')}</strong><time>${esc(time)}</time></div><pre class="sl-action-args">${esc(JSON.stringify(event.args ?? [], null, 2).slice(0, 4000))}</pre></li>`
    }).join('')}</ol>` : ''}`
  }

  function scheduleActions(record) {
    clearTimeout(record.actionsTimer)
    if (destroyed || record !== currentInspectorRecord() || !record.frame || (record.actionsState?.actionsAvailable === false && !record.actionsState?.listening) || record.actionsState?.error) return
    record.actionsTimer = setTimeout(() => {
      if (document.hidden || !inspector.getClientRects().length) scheduleActions(record)
      else requestActions(record)
    }, 1500)
  }

  async function requestActions(record, operation = 'read-actions') {
    if (!onActions || !record?.frame || destroyed || record !== currentInspectorRecord()) return
    if (record.actionsBusy) { if (operation === 'clear-actions') record.pendingActionsOperation = operation; return }
    clearTimeout(record.actionsTimer)
    const frame = record.frame
    const epoch = record.actionsEpoch = (record.actionsEpoch || 0) + 1
    record.actionsBusy = true
    if (operation === 'clear-actions') { record.actionsState = { ...record.actionsState, clearing: true }; renderActions(record) }
    try {
      const result = await onActions({ story: record.story, frame, operation })
      if (destroyed || record.frame !== frame || epoch !== record.actionsEpoch || record !== currentInspectorRecord()) return
      record.actionsState = result
      renderActions(record)
    } catch (error) {
      if (destroyed || record.frame !== frame || epoch !== record.actionsEpoch || record !== currentInspectorRecord()) return
      record.actionsState = { ...record.actionsState, clearing: false, error: error?.message || 'Actions を取得できませんでした。' }
      renderActions(record)
    } finally {
      record.actionsBusy = false
      if (record.frame === frame && epoch === record.actionsEpoch) {
        const pending = record.pendingActionsOperation
        record.pendingActionsOperation = null
        if (pending) requestActions(record, pending)
        else scheduleActions(record)
      }
    }
  }

  function startActions(record) {
    if (!onActions || record.actionsStarted || record !== currentInspectorRecord()) return
    record.actionsStarted = true
    requestActions(record)
  }

  function updateProperty(target) {
    const record = currentInspectorRecord()
    if (!record || record.propertyState?.busy) return
    const key = target.dataset.property
    let value = target.value
    if (target.dataset.propertyType === 'boolean') value = record.propertyState?.args?.[key] !== true
    if (target.dataset.propertyType === 'number') {
      if (!target.value.trim() || !target.checkValidity()) { renderProperties(record); return }
      value = Number(target.value)
    }
    if (target.dataset.propertyType === 'select') {
      const meta = record.propertyState?.argTypes?.[key]
      value = (meta?.options || meta?.control?.options)?.[Number(target.value)]
    }
    requestProperties(record, 'update', { [key]: value })
  }

  function selectVariantAxis(key, value) {
    const { group, story } = byStory.get(selectedId)
    const candidates = group.stories.filter(item => String(item.variantProperties?.[key] ?? '') === value)
    candidates.sort((a, b) => {
      const score = item => (item.name === story.name ? 2 : 0) + (group.axes || []).reduce((sum, axis) => sum + (item.variantProperties?.[axis.key] === story.variantProperties?.[axis.key] ? 3 : 0), 0)
      return score(b) - score(a)
    })
    if (candidates[0]) { selectStory(candidates[0].id); focusStory(candidates[0].id) }
  }

  function renderInspector() {
    closeModal()
    const current = currentInspectorRecord()
    if (current?.story.id === selectedId) {
      // Examples are crops of the same running Story. Switching the crop
      // must not restart the iframe, Properties bridge or Actions history.
      current.exampleKey = selectedExampleKey
      const examples = storyExamples.get(selectedId)
      inspector.querySelector('.sl-selected-heading p').textContent = examples?.find(example => example.key === selectedExampleKey)?.label || storyLabel(current.story)
      inspector.querySelector('.sl-examples-section')?.remove()
      inspector.querySelector('.sl-variants-section').insertAdjacentHTML('afterend', exampleMarkup(current.story))
      if (current.ready) inspectPreview(current)
      return
    }
    removePreviews(inspector)
    menuOpen = false
    const selected = byStory.get(selectedId)
    if (!selected) { inspector.innerHTML = `<div class="sl-inspector-empty">${tx('コンポーネントを選択すると、詳細が表示されます。')}</div>`; return }
    const { story, group } = selected
    inspector.innerHTML = `<div class="sl-inspector-title"><span>${tx('Design')}</span><span class="sl-inspector-chip">${tx('COMPONENT')}</span><button class="sl-icon-button sl-inspector-dismiss" data-action="hide-inspector" ${ta('aria-label', 'インスペクターを閉じる')}>${icon('close')}</button></div><div class="sl-inspector-body"><div class="sl-selected-heading"><div class="sl-component-symbol sl-master-symbol">${icon('master', 'sl-master-icon')}</div><button class="sl-favorite sl-inspector-favorite${favorites.has(group.id) ? ' sl-is-favorite' : ''}" data-favorite="${esc(group.id)}" ${ta('aria-label', 'お気に入りを切り替え')} aria-pressed="${favorites.has(group.id)}">${icon('star')}</button><h2>${esc(shortTitle(group.title))}</h2><p>${esc(storyExamples.get(story.id)?.find(example => example.key === selectedExampleKey)?.label || storyLabel(story))}</p></div><div class="sl-inspector-preview-wrap">${previewMarkup('sl-inspector-preview')}<button class="sl-expand-preview sl-icon-button" data-action="expand" ${ta('aria-label', 'プレビューを拡大')} ${ta('title', 'プレビューを拡大')}>${icon('expand')}</button><span class="sl-preview-live"><i></i>${tx('LIVE')}</span></div>${variantMarkup(group, story)}${exampleMarkup(story)}<section class="sl-properties-section" ${ta('aria-label', 'Properties')}><div class="sl-inspector-section-heading"><h3>${tx('Properties')}</h3></div><p class="sl-properties-status"><span class="sl-spinner"></span>${tx('Properties を読み込み中')}</p></section>${onActions ? `<section class="sl-actions-section" ${ta('aria-label', 'Actions')}><div class="sl-inspector-section-heading"><h3>${tx('Actions')}</h3></div><p class="sl-actions-status">${tx('読み込み中…')}</p></section>` : ''}<div class="sl-export-section"><div class="sl-section-label">${tx('デザインに取り込む')}</div><div class="sl-copy-row"><button class="sl-primary-button" data-export="figma">${icon('figma')}<span>${tx('Figma 用データをコピー')}</span></button><button class="sl-copy-options" data-action="copy-menu" ${ta('aria-label', 'コピー形式を選択')} aria-expanded="false">${icon('down')}</button><div class="sl-copy-menu" hidden>${[['figma', 'Figma 用データをコピー', 'figma'], ['svg', 'SVG をコピー', 'copy'], ['png', 'PNG をコピー', 'copy'], ['html', 'HTML をコピー', 'copy'], ['link', 'Story のリンクをコピー', 'link']].map(([format, label, glyph]) => `<button data-export="${format}">${icon(glyph)}${tx(label)}</button>`).join('')}</div></div><p class="sl-copy-hint">${tx('コピーして同梱の Figma プラグインへ。')}</p><div class="sl-format-actions"><button data-export="svg">${icon('copy')}SVG</button><button data-export="png">${icon('copy')}PNG</button><button data-export="html">${icon('copy')}HTML</button></div><button class="sl-download-button" data-export="download-svg">${icon('download')}${tx('SVG ファイルを保存')}</button></div><p class="sl-export-warnings" role="status" hidden></p><div class="sl-source-section"><div class="sl-section-label">${tx('SOURCE')}</div><dl><div><dt>${tx('ライブラリ')}</dt><dd title="${esc(title)}">${esc(title || sourceHost)}</dd></div><div><dt>${tx('コンポーネント')}</dt><dd title="${esc(group.title)}">${esc(shortTitle(group.title))}</dd></div><div><dt>Story</dt><dd title="${esc(story.name)}">${esc(story.name)}</dd></div></dl><a class="sl-open-story" href="${esc(safeUrl(story.url || `?path=/story/${story.id}`, sourceUrl))}" target="_blank" rel="noopener noreferrer">${tx('Storybook で開く')}${icon('external')}</a></div></div>`
    inspector.querySelector('[data-action="expand"]').setAttribute('aria-keyshortcuts', 'Enter Shift+Space')
    inspector.querySelector('[data-action="copy-menu"]').setAttribute('aria-keyshortcuts', 'Meta+Shift+E Control+Shift+E')
    inspector.querySelectorAll('[data-export="png"]').forEach(button => button.setAttribute('aria-keyshortcuts', 'Meta+Shift+C Control+Shift+C'))
    registerPreview(inspector.querySelector('.sl-inspector-preview'), story, true, selectedExampleKey)
  }

  async function exportStory(format) {
    if (exportBusy || !onExport) return
    const selected = byStory.get(selectedId)
    if (!selected) return
    const preview = inspector.querySelector('.sl-inspector-preview')
    const record = previewRecords.get(preview?.dataset.previewId)
    if (record?.propertyState?.busy && format !== 'link') {
      toast('Properties の反映が完了してからコピーできます', true)
      return
    }
    if (format !== 'link' && (!record?.frame || !record.ready)) {
      toast('プレビューの読み込み完了後にコピーできます', true)
      return
    }
    exportBusy = true
    setMenu(false)
    inspector.querySelectorAll('[data-export]').forEach(button => { button.disabled = true })
    const buttonText = inspector.querySelector('.sl-primary-button span')
    setText(buttonText, '準備しています…')
    try {
      const result = await onExport({ story: selected.story, frame: record?.frame, root: record && previewRoot(record), exampleLabel: storyExamples.get(selectedId)?.find(example => example.key === selectedExampleKey)?.label, format })
      const warnings = inspector.querySelector('.sl-export-warnings')
      if (warnings) { warnings.hidden = !result?.warnings?.length; warnings.textContent = result?.warnings?.join(' / ') || '' }
      toast(result?.message || (format === 'download-svg' ? 'SVG ファイルを保存しました' : format === 'link' ? 'Story のリンクをコピーしました' : format === 'figma' ? 'Figma 用データをコピーしました。同梱プラグインに貼り付けてください' : 'copiedFormat'), false, { format: format.toUpperCase() })
    } catch (error) {
      toast(error?.message || 'コピーできませんでした。もう一度お試しください', true)
    } finally {
      exportBusy = false
      if (!destroyed) {
        inspector.querySelectorAll('[data-export]').forEach(button => { button.disabled = false })
        const currentButtonText = inspector.querySelector('.sl-primary-button span')
        setText(currentButtonText, 'Figma 用データをコピー')
      }
    }
  }

  function setMenu(open, returnFocus = false) {
    menuOpen = open
    const menu = inspector.querySelector('.sl-copy-menu')
    const trigger = inspector.querySelector('[data-action="copy-menu"]')
    if (menu) menu.hidden = !open
    trigger?.setAttribute('aria-expanded', String(open))
    if (returnFocus) trigger?.focus()
  }

  function closeModal() {
    if (!modal) return
    if (expandedRecord) {
      const wrap = expandedRecord.element.closest('.sl-inspector-preview-wrap')
      wrap?.classList.remove('sl-expanded-inspector-preview')
      if (wrap) wrap.style.cssText = ''
      if (expandedRecord.frame) expandedRecord.frame.style.width = '450px'
      const record = expandedRecord
      expandedRecord = null
      inspectPreview(record)
    }
    modal.remove()
    modal = null
    camera?.cancelInteraction()
    modalReturnFocus?.focus?.()
    modalReturnFocus = null
  }

  function showModal(kind) {
    closeModal()
    setZoomMenu(false)
    setMenu(false)
    modalReturnFocus = shadow.activeElement
    const root = shadow.querySelector('.sl-modal-root')
    modal = document.createElement('div')
    modal.className = 'sl-modal-backdrop'
    if (kind === 'shortcuts') {
      const groups = [
        ['移動とズーム', [['選択ツール', 'V'], ['手のひらツール', 'H'], ['押している間だけ移動', 'Space + drag'], ['次のフレームにズーム', 'N / End'], ['前のフレームにズーム', '⇧ N / Home'], ['全体を表示', '⇧ 1'], ['選択範囲にズーム', '⇧ 2'], ['100%で表示', '⇧ 0 / ⌘・Ctrl 0'], ['拡大・縮小', '+ / −'], ['クリックで拡大', 'Z + click'], ['クリックで縮小', 'Alt Z + click'], ['範囲を囲んでズーム', 'Z + drag'], ['キャンバスを大きく移動', '⇧ ← ↑ ↓ →']]],
        ['選択とプレビュー', [['隣のコンポーネントを選択', '← ↑ ↓ →'], ['プレビューを開く', 'Enter / ⇧ Space'], ['選択解除・操作を戻す', 'Esc'], ['選択をFigma用にコピー', '⌘ / Ctrl C'], ['選択をPNGでコピー', '⌘ / Ctrl ⇧ C'], ['書き出し形式を選択', '⌘ / Ctrl ⇧ E']]],
        ['表示と検索', [['検索', '⌘ / Ctrl K・F'], ['パネルを表示・非表示', '⌘ / Ctrl \\・.'], ['キーボードショートカット', '?']]],
      ]
      modal.innerHTML = `<section class="sl-modal sl-shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="sl-shortcuts-title"><button class="sl-icon-button sl-modal-close" data-action="close-modal" ${ta('aria-label', '閉じる')}>${icon('close')}</button><h2 id="sl-shortcuts-title">${tx('キーボードショートカット')}</h2><p>${tx('キャンバスをすばやく操作')}</p><div class="sl-shortcuts-groups">${groups.map(([heading, rows]) => `<section><h3 class="sl-shortcuts-heading">${tx(heading)}</h3><ul class="sl-shortcut-list">${rows.map(([label, keys]) => `<li><span>${tx(label)}</span><kbd>${esc(keys)}</kbd></li>`).join('')}</ul></section>`).join('')}</div><p class="sl-shortcuts-note">${tx('入力中はショートカットが無効になります。')}</p></section>`
    } else if (kind === 'help') {
      modal.innerHTML = `<section class="sl-modal sl-help-modal" role="dialog" aria-modal="true" aria-labelledby="sl-help-title"><button class="sl-icon-button sl-modal-close" data-action="close-modal" ${ta('aria-label', '閉じる')}>${icon('close')}</button><div class="sl-help-symbol">${icon('component')}</div><h2 id="sl-help-title">${tx('使い方')}</h2><ol><li><span>01</span><div><strong>${tx('見つける')}</strong><p>${tx('すべてのコンポーネントを一覧で見渡し、左の名前から詳細ページへ。')}</p></div></li><li><span>02</span><div><strong>${tx('試す')}</strong><p>${tx('ドラッグで移動、⌘ / Ctrl＋スクロールでズーム。右側で実物を操作できます。')}</p></div></li><li><span>03</span><div><strong>${tx('コピーする')}</strong><p>${tx('Figma 用データをコピーし、同梱プラグインへ貼り付け。SVG 保存・PNG・HTML も選べます。')}</p></div></li></ol><div class="sl-help-note">${tx('Figma 用データは同梱の Story Library Import プラグインで取り込めます。SVG は保存して Figma にドラッグできます。Storybook の動作や Figma のバリアント設定はコピーされません。')}</div><div class="sl-help-shortcuts"><span><kbd>⌘ / Ctrl</kbd> <kbd>K</kbd> ${tx('検索')}</span><button data-action="shortcuts"><kbd>?</kbd> ${tx('ショートカットを見る')}</button></div><button class="sl-primary-button" data-action="close-modal">${tx('ライブラリを見る')}${icon('arrow')}</button></section>`
    } else {
      const selected = byStory.get(selectedId)
      if (!selected) return
      const { story, group } = selected
      modal.innerHTML = `<section class="sl-modal sl-preview-modal" role="dialog" aria-modal="true" aria-labelledby="sl-expanded-title"><header><div>${icon('component')}<h2 id="sl-expanded-title">${esc(shortTitle(group.title))}<span>/ ${esc(storyLabel(story))}</span></h2><span class="sl-preview-live"><i></i>${tx('LIVE')}</span></div><button class="sl-icon-button" data-action="close-modal" ${ta('aria-label', '閉じる')}>${icon('close')}</button></header><div class="sl-expanded-preview-placeholder"></div><footer>${tx('Properties の変更を保ったまま、実際のコンポーネントを操作できます。')}</footer></section>`
    }
    root.append(modal)
    camera?.cancelInteraction()
    if (kind === 'preview') {
      expandedRecord = currentInspectorRecord()
      const wrap = expandedRecord?.element.closest('.sl-inspector-preview-wrap')
      const placeholder = modal.querySelector('.sl-expanded-preview-placeholder')
      if (wrap && placeholder) {
        const bounds = placeholder.getBoundingClientRect()
        wrap.classList.add('sl-expanded-inspector-preview')
        wrap.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;`
        inspectPreview(expandedRecord)
      }
    }
    modal.querySelector('button')?.focus()
  }

  function navigate(nextView) {
    fittedFrame = null
    viewCameras.set(view, camera.getCamera())
    const changed = nextView !== view
    view = nextView
    query = ''
    searchInput.value = ''
    if (byGroup.has(nextView)) {
      const group = byGroup.get(nextView)
      const story = group.stories.find(story => story.id === selectedId) || group.stories[0]
      if (selectedId !== story.id) selectedExampleKey = storyExamples.get(story.id)?.[0]?.key || ''
      selectedId = story.id
      renderInspector()
    }
    renderCanvas()
    const savedCamera = viewCameras.get(view)
    if (changed && savedCamera) camera.setCamera(savedCamera)
    else if (!changed && byGroup.has(view)) focusStory(selectedId)
    else camera.reset()
    updateVisibility()
    canvas.focus({ preventScroll: true })
  }

  const handleClick = (event) => {
    if (zoomMenuOpen && !event.target.closest('.sl-canvas-controls')) setZoomMenu(false)
    const target = event.target.closest('button, a, .sl-card, .sl-modal-backdrop')
    if (!target) { if (menuOpen) setMenu(false); if (canvas.contains(event.target) && !event.target.closest('[data-canvas-no-pan]') && camera.getTool() === 'select' && !camera.wasDragged()) clearSelection(); return }
    if (target.dataset.canvasTool) { setCanvasTool(target.dataset.canvasTool); canvas.focus({ preventScroll: true }); return }
    if (target.dataset.zoom) { camera.zoomBy(Number(target.dataset.zoom) / camera.getCamera().scale); setZoomMenu(false); canvas.focus({ preventScroll: true }); return }
    if (target.dataset.language) {
      const next = normalizeLibraryLanguage(target.dataset.language)
      if (next !== currentLanguage) { setLanguage(next); onLanguageChange(next) }
      return
    }
    if (target.dataset.displayMode) { storyView.setMode(target.dataset.displayMode); return }
    if (target.classList.contains('sl-brand')) { event.preventDefault(); navigate('all'); return }
    if (target.dataset.favorite) { toggleFavorite(target.dataset.favorite); return }
    if (target.dataset.retry) {
      const record = previewRecords.get(target.dataset.retry)
      if (record) { record.failed = false; record.snapshotFailed = false; unloadPreview(record); if (record.pinned) loadPreview(record); else updateVisibility() }
      return
    }
    if (target.dataset.export) { exportStory(target.dataset.export); return }
    if (target.dataset.propertyType === 'boolean') { updateProperty(target); return }
    if (target.dataset.view) { navigate(target.dataset.view); return }
    if (target.dataset.group || target.dataset.openGroup) { navigate(target.dataset.group || target.dataset.openGroup); return }
    if (target.dataset.story) { selectStory(target.dataset.story, { exampleKey: target.dataset.example }); return }
    switch (target.dataset.action) {
      case 'back-all': navigate('all'); break
      case 'close': destroy(); onClose(); break
      case 'help': showModal('help'); break
      case 'shortcuts': showModal('shortcuts'); break
      case 'toggle-panels': togglePanels(); break
      case 'hide-inspector': app.classList.remove('sl-inspector-open'); break
      case 'expand': showModal('preview'); break
      case 'close-modal': closeModal(); break
      case 'copy-menu': setMenu(!menuOpen); break
      case 'clear-search': query = ''; searchInput.value = ''; renderCanvas(); camera.reset(); searchInput.focus(); break
      case 'zoom-in': camera.zoomBy(1.25); canvas.focus({ preventScroll: true }); break
      case 'zoom-out': camera.zoomBy(0.8); canvas.focus({ preventScroll: true }); break
      case 'zoom-reset': camera.zoomBy(1 / camera.getCamera().scale); canvas.focus({ preventScroll: true }); break
      case 'zoom-menu-fit':
      case 'zoom-fit': camera.fit(canvasLayout.bounds); setZoomMenu(false); canvas.focus({ preventScroll: true }); break
      case 'zoom-menu-selection':
      case 'zoom-selection': zoomSelection(); setZoomMenu(false); canvas.focus({ preventScroll: true }); break
      case 'zoom-menu': setZoomMenu(!zoomMenuOpen); break
      case 'reset-properties': requestProperties(currentInspectorRecord(), 'reset'); break
      case 'retry-properties': requestProperties(currentInspectorRecord()); break
      case 'clear-actions': requestActions(currentInspectorRecord(), 'clear-actions'); break
      case 'retry-actions': requestActions(currentInspectorRecord()); break
      default: if (target === modal) closeModal(); else if (menuOpen) setMenu(false)
    }
  }

  const handleKey = (event) => {
    if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return
    const path = event.composedPath()
    const target = path[0]
    const key = event.key
    const modifier = event.metaKey || event.ctrlKey
    const editable = target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
    const fromPreview = target?.ownerDocument && target.ownerDocument !== document
    const consume = () => { event.preventDefault(); event.stopPropagation() }
    if (storyView.getMode() === 'story') {
      if (path.includes(host) && key === 'Escape') { consume(); destroy(); onClose() }
      return
    }
    // A live component owns its keyboard. Only an expanded preview's close
    // gesture is forwarded from its document to the library.
    if (fromPreview) {
      if (key === 'Escape' && modal && !editable) { consume(); closeModal() }
      return
    }
    if (!path.includes(host)) return
    if (key === 'Escape') {
      if (modal) { consume(); closeModal(); return }
      if (zoomMenuOpen) { consume(); setZoomMenu(false, true); return }
      if (menuOpen) { consume(); setMenu(false, true); return }
      if (editable) { target.blur(); canvas.focus({ preventScroll: true }); return }
      consume()
      camera.cancelInteraction()
      if (camera.getTool() === 'hand') { setCanvasTool('select'); canvas.focus({ preventScroll: true }) }
      else if (selectedId) clearSelection()
      return
    }
    if (key === 'Tab') {
      const scope = modal || app
      const focusable = [...scope.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex="0"]')].filter(element => element.checkVisibility() && !element.closest('[inert]'))
      const first = focusable[0], last = focusable.at(-1), active = shadow.activeElement
      if (event.shiftKey && (active === first || !scope.contains(active))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus() }
      return
    }
    if (modal || editable || event.altKey) return
    const lower = key.toLowerCase()
    if (modifier && !event.shiftKey && (lower === 'k' || lower === 'f')) {
      consume()
      if (app.classList.contains('sl-panels-hidden')) togglePanels()
      searchInput.focus(); searchInput.select(); return
    }
    if (modifier && !event.shiftKey && (key === '\\' || key === '.')) { consume(); togglePanels(); return }
    const inCanvas = path.includes(canvas)
    const onControl = !!target?.closest?.('button, a, summary, [role="button"]')
    if (modifier && lower === 'c' && inCanvas && !onControl && selectedId && !String(shadow.getSelection?.() || document.getSelection() || '')) { consume(); exportStory(event.shiftKey ? 'png' : 'figma'); return }
    if (modifier && event.shiftKey && lower === 'e' && inCanvas && !onControl && selectedId) { consume(); openExportMenu(); return }
    if (event.shiftKey && !modifier && ['Digit0', 'Digit1', 'Digit2'].includes(event.code)) {
      consume()
      setZoomMenu(false)
      if (event.code === 'Digit1') camera.fit(canvasLayout.bounds)
      else if (event.code === 'Digit2') zoomSelection()
      else camera.zoomBy(1 / camera.getCamera().scale)
      return
    }
    if (modifier && !event.shiftKey && key === '0') { consume(); camera.zoomBy(1 / camera.getCamera().scale); return }
    if (['+', '=', '-', '−', '_'].includes(key)) { consume(); camera.zoomBy(['+', '='].includes(key) ? 1.25 : .8); return }
    if (modifier) return
    if (key === '?' || (event.shiftKey && event.code === 'Slash')) { consume(); showModal('shortcuts'); return }
    if (!event.shiftKey && (lower === 'v' || lower === 'h')) { consume(); setCanvasTool(lower === 'h' ? 'hand' : 'select'); canvas.focus({ preventScroll: true }); return }
    if (!inCanvas || onControl) return
    if (lower === 'n' || (!event.shiftKey && (key === 'Home' || key === 'End'))) { consume(); stepFrame(event.shiftKey || key === 'Home' ? -1 : 1); return }
    if (key.startsWith('Arrow')) {
      consume()
      if (event.shiftKey || !grid.querySelector('.sl-card.sl-selected')) panByKey(key, event.shiftKey)
      else moveSelection(key)
      return
    }
    if (key === 'Enter' || (event.shiftKey && (key === ' ' || event.code === 'Space'))) {
      const card = target?.closest?.('.sl-card')
      if (card) selectStory(card.dataset.story, { exampleKey: card.dataset.example })
      if (selectedId) { consume(); showModal('preview') }
    }
  }

  app.addEventListener('click', handleClick)
  app.addEventListener('dblclick', event => {
    const card = event.target.closest('.sl-card')
    if (card && camera.getTool() !== 'hand' && !camera.wasDragged() && !event.target.closest('button')) {
      selectStory(card.dataset.story, { exampleKey: card.dataset.example })
      if (byGroup.has(view)) showModal('preview')
      else navigate(byStory.get(card.dataset.story).group.id)
    }
  })
  app.addEventListener('change', event => {
    const target = event.target
    if (target.id === 'sl-variant-select') { selectStory(target.value); focusStory(target.value) }
    else if (target.id === 'sl-example-select') { selectStory(selectedId, { exampleKey: target.value }); focusStory(selectedId) }
    else if (target.dataset.variantAxis) selectVariantAxis(target.dataset.variantAxis, target.value)
 else if (target.dataset.property) updateProperty(target)
  })
  searchInput.addEventListener('input', event => { query = event.target.value; if (query && byGroup.has(view)) view = 'all'; renderCanvas(); camera.reset() })
  document.addEventListener('keydown', handleKey, true)
  cleanupFns.push(() => document.removeEventListener('keydown', handleKey, true))

  function destroy() {
    if (destroyed) return
    destroyed = true
    cancelAnimationFrame(layoutFrame)
    cancelAnimationFrame(visibilityFrame)
    resizeObserver.disconnect()
    for (const record of previewRecords.values()) unloadPreview(record)
    previewRecords.clear()
    pendingPreviews.clear()
    cleanupFns.forEach(cleanup => cleanup())
    clearTimeout(toastTimer)
    host.remove()
    previouslyFocused?.focus?.({ preventScroll: true })
  }

  renderCanvas()
  renderInspector()
  focusStory(selectedId)
  setCanvasTool('select')
  canvas.focus({ preventScroll: true })
  return { destroy, host, setBrandSources, setLanguage, setMode: storyView.setMode }
}
