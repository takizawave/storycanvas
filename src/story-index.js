/** Index adapters for Storybook 5 through current Storybook. */
export function normalizeBaseUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP/HTTPSのStorybookを開いてください。');
  url.search = ''; url.hash = '';
  if (/\/(?:index|iframe)\.html$/.test(url.pathname)) url.pathname = url.pathname.replace(/[^/]+$/, '');
  else if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function normalizeIndex(data, baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const entries = Array.isArray(data) ? data : Object.values(data?.entries || data?.stories || {});
  const partsOf = title => title.split('/').map(part => part.trim()).filter(Boolean);
  const seen = new Set();
  const stories = entries.filter(entry => {
    if (!entry || typeof entry !== 'object' || entry.type === 'docs' || (Array.isArray(entry.tags) && entry.tags.includes('hidden'))) return false;
    const title = entry.title || entry.kind;
    if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 1000 || typeof title !== 'string' || !partsOf(title).length || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  // Only actual, visible story titles establish a parent component. A docs-only
  // category or discarded duplicate must not merge otherwise distinct families.
  const titles = new Set(stories.map(entry => partsOf(entry.title || entry.kind).join('/')));
  const keyOf = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const familyFor = entry => {
    const parts = partsOf(String(entry.title || entry.kind || ''));
    // A package is useful evidence that Button/Black/Fill belongs to Button,
    // while Form/Form group is a category followed by a different component.
    const packageName = typeof entry.importPath === 'string' ? entry.importPath.match(/(?:^|\/)(?:packages|components)\/([^/]+)\//)?.[1] : '';
    const packageKey = packageName ? keyOf(packageName) : '';
    const packageDepth = packageKey ? parts.findIndex(part => keyOf(part) === packageKey) : -1;
    if (packageDepth >= 0) return parts.slice(0, packageDepth + 1);
    for (let length = 1; length < parts.length; length++) {
      if (titles.has(parts.slice(0, length).join('/'))) return parts.slice(0, length);
    }
    return parts;
  };
  const groups = new Map();
  for (const entry of stories) {
    const id = entry.id;
    const title = entry.title || entry.kind;
    const parts = partsOf(title);
    const family = familyFor(entry);
    const groupId = family.join('/');
    const variantPath = parts.slice(family.length);
    const name = String(entry.name || entry.story || id.split('--').pop());
    const preview = new URL('iframe.html', base);
    preview.searchParams.set('id', id); preview.searchParams.set('viewMode', 'story');
    const source = new URL(base); source.searchParams.set('path', `/story/${id}`);
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, title: family.at(-1), category: family.slice(0, -1).join('/') || 'Components', stories: [], docsIds: [], axes: [] });
    groups.get(groupId).stories.push({ id, name, title, variantPath, displayName: [...variantPath, name].join(' / '), variantProperties: {}, url: source.href, previewUrl: preview.href });
  }
  for (const entry of entries) {
    if (entry?.type !== 'docs' || typeof entry.id !== 'string') continue;
    const group = groups.get(familyFor(entry).join('/'));
    if (group) group.docsIds.push(entry.id);
  }
  for (const group of groups.values()) {
    const depth = Math.max(...group.stories.map(story => story.variantPath.length));
    for (let level = 0; level < depth; level++) {
      const key = `path${level}`;
      const values = [...new Set(group.stories.map(story => story.variantPath[level] || 'Base'))];
      const lower = values.map(value => value.toLowerCase());
      const label = lower.every(value => ['fill', 'outline'].includes(value)) ? 'Treatment'
        : lower.every(value => ['xxs','xs','s','m','l','xl','xxl'].includes(value)) ? 'Size'
        : level === 0 ? 'Style' : level === 1 ? 'Type' : 'Examples';
      group.axes.push({key, label, values, source:'hierarchy'});
      for (const story of group.stories) story.variantProperties[key] = story.variantPath[level] || 'Base';
    }
  }
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

export async function loadStoryIndex({baseUrl, fetchImpl = globalThis.fetch, legacyLoader, signal} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const diagnostics = [];
  for (const filename of ['index.json', 'stories.json']) {
    try {
      const timeout = AbortSignal.timeout(7000);
      const response = await fetchImpl(new URL(filename, base).href, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) { diagnostics.push(`${filename}: ${response.status}`); continue; }
      const data = await response.json();
      const groups = normalizeIndex(data, base);
      if (groups.length) return { groups, baseUrl: base, source: filename };
      diagnostics.push(`${filename}: no stories`);
    } catch (error) { if (signal?.aborted) throw error; diagnostics.push(`${filename}: ${error.message}`); }
  }
  if (legacyLoader) {
    const data = await legacyLoader();
    const groups = normalizeIndex(data, base);
    if (groups.length) return { groups, baseUrl: base, source: 'Storybook runtime' };
  }
  throw new Error('Storybookの一覧を取得できませんでした。Storyが表示されるまで待ってから、もう一度開いてください。\n' + diagnostics.join(' / '));
}

export function initialStoryId(input) {
  const url = new URL(input);
  return url.searchParams.get('id') || url.searchParams.get('path')?.replace(/^\/(story|docs)\//, '') || '';
}

export function resolveInitialStoryId(groups, requestedId) {
  const all = groups.flatMap(group => group.stories);
  if (all.some(story => story.id === requestedId)) return requestedId;
  const group = groups.find(group => group.docsIds?.includes(requestedId));
  const prefix = typeof requestedId === 'string' ? requestedId.split('--')[0] : '';
  const matchingStories = (group?.stories || all).filter(story => prefix && story.id.startsWith(`${prefix}--`));
  // A merged family can contain many separate docs pages. Prefer the requested
  // page's own stories before selecting a default from another variant path.
  const candidates = matchingStories.length ? matchingStories : group?.stories || [];
  return (candidates.find(story => /^(default|basic)$/i.test(story.name)) || candidates[0] || all[0])?.id;
}
