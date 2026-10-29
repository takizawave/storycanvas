const MAX_IMAGE_URL = 160000;

export function brandImageUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_IMAGE_URL) return '';
  if (/^data:image\/(?:svg\+xml|png|webp|gif|jpeg|x-icon|vnd\.microsoft\.icon)[;,]/i.test(value)) return value;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// The default Storybook favicon identifies the tool, not the component library.
export function isStorybookIcon(value) {
  let source = value;
  if (/^data:image\/svg\+xml[;,]/i.test(value)) {
    try {
      const comma = value.indexOf(',');
      source = /;base64/i.test(value.slice(0, comma)) ? atob(value.slice(comma + 1)) : decodeURIComponent(value.slice(comma + 1));
    } catch { return false; }
  }
  return /M22\.467\s+147\.762\s+17\.5\s+15\.402/.test(source) && /ff4785/i.test(source);
}

/** Observe the manager's brand area briefly while its React UI mounts. */
export function watchLibraryBrand(doc, onChange, { signal } = {}) {
  const controller = new AbortController();
  const iconSources = [];
  let previous = '';
  let timer;
  let stopped = false;
  const publish = () => {
    if (stopped) return;
    const logos = [...doc.querySelectorAll('.sidebar-header a img, [data-testid="sidebar-header"] a img, [data-testid="storybook-logo"] img, header img[alt*="logo" i]')]
      .filter(image => !/^storybook$/i.test((image.alt || image.closest('a')?.title || '').trim()))
      .map(image => brandImageUrl(image.currentSrc || image.getAttribute('src'), doc.baseURI))
      .filter(source => source && !isStorybookIcon(source));
    const sources = [...new Set([...logos, ...iconSources])].slice(0, 6);
    const signature = JSON.stringify(sources);
    if (signature !== previous) { previous = signature; onChange(sources); }
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(publish, 80);
  });
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  const observationTimer = setTimeout(() => { observer.disconnect(); publish(); }, 10000);
  const stop = () => {
    stopped = true;
    controller.abort();
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(observationTimer);
    signal?.removeEventListener('abort', stop);
  };
  if (signal?.aborted) { stop(); return stop; }
  signal?.addEventListener('abort', stop, { once: true });
  publish();

  const icons = [...doc.querySelectorAll('link[rel]')]
    .filter(link => /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(link.rel))
    .map(link => brandImageUrl(link.getAttribute('href'), doc.baseURI))
    .filter(Boolean).slice(0, 4);
  // Do not guess /favicon.ico: subdirectory Storybooks can share another site's icon.
  Promise.all(icons.map(async source => {
    if (isStorybookIcon(source)) return '';
    if (source.startsWith('data:')) return source;
    try {
      const response = await doc.defaultView.fetch(source, { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
      if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return '';
      if (/svg/i.test(response.headers.get('content-type')) && isStorybookIcon(await response.text())) return '';
      return source;
    } catch {
      // Cross-origin icons may allow <img> display even when CORS blocks inspection.
      return controller.signal.aborted ? '' : source;
    }
  })).then(sources => {
    if (stopped) return;
    iconSources.push(...sources.filter(Boolean));
    publish();
  });
  return stop;
}
