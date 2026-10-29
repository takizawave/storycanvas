/**
 * Executed in the selected preview's MAIN world by chrome.scripting.
 * Keep every helper inside this function: Chrome serializes the function itself.
 */
export async function storyRuntimeAction(request = {}, runtime = window) {
  const { frameName, storyId, operation = 'read' } = request;
  if (typeof frameName !== 'string' || !frameName || frameName.length > 1500 || runtime.name !== frameName) return null;
  const fail = (message, code = 'RUNTIME_UNAVAILABLE') => ({ matched: true, storyId, error: message, code, available: false, unavailable: true, canUpdate: false });
  if (typeof storyId !== 'string' || !storyId || storyId.length > 1000 || !['read', 'update', 'reset', 'read-actions', 'clear-actions'].includes(operation)) return fail('Invalid preview request.', 'INVALID_REQUEST');
  if (new URL(runtime.location.href).searchParams.get('id') !== storyId) return fail('The selected preview has changed. Select the story again.', 'STORY_MISMATCH');
  const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const isKey = key => typeof key === 'string' && key.length > 0 && key.length <= 200 && !unsafeKeys.has(key);
  const primitive = value => value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  const safeValue = (value, depth = 0, seen = new WeakSet()) => {
    if (primitive(value)) return typeof value === 'string' ? value.slice(0, 20000) : value;
    if (!value || typeof value !== 'object' || depth >= 5 || seen.has(value) || value.$$typeof || typeof value.nodeType === 'number') return undefined;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== runtime.Object?.prototype && Object.getPrototypeOf(value) !== null) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 200) return undefined;
      const values = value.map(item => safeValue(item, depth + 1, seen));
      seen.delete(value);
      return values.some(item => item === undefined) ? undefined : values;
    }
    const result = {};
    for (const key of Object.keys(value).slice(0, 200)) {
      if (!isKey(key)) continue;
      let next;
      try { next = safeValue(value[key], depth + 1, seen); } catch { continue; }
      if (next !== undefined) result[key] = next;
    }
    seen.delete(value);
    return result;
  };
  const optionsFrom = definition => {
    const explicit = definition.options || definition.control?.options;
    if (Array.isArray(explicit)) return explicit.filter(primitive).slice(0, 100);
    if (explicit && typeof explicit === 'object') return Object.values(explicit).filter(primitive).slice(0, 100);
    const type = definition.type || definition;
    if (type.name === 'enum' && Array.isArray(type.value)) {
      const values = type.value.map(item => {
        if (primitive(item)) return item;
        if (item && Object.prototype.hasOwnProperty.call(item, 'value')) {
          const raw = item.value;
          if (typeof raw !== 'string') return primitive(raw) ? raw : undefined;
          if (/^(['"]).*\1$/.test(raw)) return raw.slice(1, -1);
          if (raw === 'true' || raw === 'false') return raw === 'true';
          if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
        }
        return undefined;
      });
      if (values.length && values.every(primitive)) return values.slice(0, 100);
    }
    const summary = typeof type.name === 'string' && type.name.includes('|') ? type.name : definition.table?.type?.summary;
    if (typeof summary === 'string' && summary.includes('|') && summary.length < 2000) {
      const parts = summary.split('|').map(item => item.trim());
      if (parts.every(item => /^(['"])[^'"]*\1$/.test(item))) return parts.map(item => item.slice(1, -1)).slice(0, 100);
    }
    return undefined;
  };
  const bounded = promise => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Storybook is still loading. Try again shortly.')), 7000);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  try {
    const preview = runtime.__STORYBOOK_PREVIEW__;
    // Modern versions expose storyStore as a compatibility proxy; storyStoreValue
    // is the live store, while Storybook 6/7 use storyStore directly.
    let store;
    try { store = preview?.storyStoreValue || preview?.storyStore || runtime.__STORYBOOK_STORY_STORE__; } catch { store = runtime.__STORYBOOK_STORY_STORE__; }
    if (preview?.storeInitializationPromise) await bounded(preview.storeInitializationPromise);
    if (!store) {
      try { store = preview?.storyStoreValue || preview?.storyStore || runtime.__STORYBOOK_STORY_STORE__; } catch { /* Legacy stories may expose metadata only. */ }
    }
    const render = preview?.currentRender?.id === storyId ? preview.currentRender : preview?.storyRenders?.find(item => item.id === storyId);
    let story = render?.story;
    if (!story && typeof store?.loadStory === 'function') story = await bounded(store.loadStory({ storyId }));
    if (!story && typeof preview?.loadStory === 'function') story = await bounded(preview.loadStory({ storyId }));
    if (!story && typeof store?.fromId === 'function') story = await bounded(Promise.resolve(store.fromId(storyId)));
    if (!story) {
      const raw = runtime.__STORYBOOK_CLIENT_API__?.raw?.();
      story = Array.isArray(raw) ? raw.find(item => item.id === storyId) : undefined;
    }
    if (!story) return fail('This Storybook does not expose component properties.');
    if (story.id && story.id !== storyId) return fail('The selected preview has changed.', 'STORY_MISMATCH');
    let context;
    try { context = typeof store?.getStoryContext === 'function' ? await bounded(Promise.resolve(store.getStoryContext(story))) : undefined; } catch { /* Older stories still expose args directly. */ }
    const getArgs = () => {
      try { if (typeof store?.args?.get === 'function') return store.args.get(storyId) || {}; } catch { /* Fall back to the prepared story. */ }
      return context?.args || story.args || story.initialArgs || {};
    };
    const initialArgs = story.initialArgs || context?.initialArgs || story.args || {};
    const rawArgTypes = story.argTypes || context?.argTypes || {};
    const channel = runtime.__STORYBOOK_ADDONS_CHANNEL__ || preview?.channel || runtime.__STORYBOOK_ADDONS_PREVIEW?.getChannel?.();
    if (operation === 'read-actions' || operation === 'clear-actions') {
      if (runtime.name !== frameName || new URL(runtime.location.href).searchParams.get('id') !== storyId) return fail('The selected preview has changed.', 'STORY_MISMATCH');
      // Observe only outbound addon actions from this preview. A channel.on()
      // listener also receives transported events from the original manager.
      const stateKey = '__STORY_LIBRARY_ACTIONS_V1__';
      let state = runtime[stateKey];
      if (state && (state.frameName !== frameName || state.storyId !== storyId || state.channel !== channel)) {
        if (state.channel?.emit === state.wrapper) state.channel.emit = state.original;
        state = undefined;
      }
      if (!state && typeof channel?.emit === 'function') {
        state = { frameName, storyId, channel, original: channel.emit, events: [], names: [], sequence: 0, observed: false };
        const selected = () => runtime.name === frameName && new URL(runtime.location.href).searchParams.get('id') === storyId;
        const serializeAction = input => {
          let remaining = 10000, entries = 150;
          const seen = new WeakSet();
          const text = value => {
            const result = String(value).slice(0, Math.max(0, Math.min(2000, remaining)));
            remaining -= result.length;
            return result;
          };
          const copy = (value, depth = 0) => {
            if (remaining <= 0 || entries-- <= 0) return '[Truncated]';
            if (primitive(value)) return typeof value === 'string' ? text(value) : value;
            if (typeof value === 'bigint') return text(value);
            if (!value || typeof value !== 'object') return undefined;
            if (seen.has(value)) return '[Circular]';
            if (depth >= 4) return '[Truncated]';
            if (value.$$typeof) return '[React element]';
            seen.add(value);
            let result;
            if (typeof value.nodeType === 'number') {
              // Do not traverse DOM trees or return potentially sensitive form values.
              result = { element: text(value.nodeName || 'Element') };
              if (value.id) result.id = text(value.id);
            } else if (runtime.Event && value instanceof runtime.Event) {
              result = {};
              for (const key of ['type', 'bubbles', 'cancelable', 'defaultPrevented', 'key', 'code', 'button', 'buttons', 'clientX', 'clientY', 'detail', 'target']) {
                const item = copy(value[key], depth + 1);
                if (item !== undefined) result[key] = item;
              }
            } else if (Array.isArray(value)) {
              result = value.slice(0, 20).map(item => copy(item, depth + 1) ?? null);
              if (value.length > 20) result.push('[Truncated]');
            } else {
              result = {};
              // Accessor properties can invoke application code. Only copy data.
              for (const key of Object.keys(value).slice(0, 30)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!isKey(key) || !descriptor || !('value' in descriptor)) continue;
                remaining -= key.length;
                const item = copy(descriptor.value, depth + 1);
                if (item !== undefined) result[key] = item;
              }
            }
            seen.delete(value);
            return result;
          };
          return copy(input) ?? null;
        };
        const captured = state;
        captured.wrapper = function (...emitted) {
          try {
            const payload = emitted[1];
            if (selected() && emitted[0] === 'storybook/actions/action-event' && payload?.data && typeof payload.data.name === 'string' && Object.prototype.hasOwnProperty.call(payload.data, 'args')) {
              const name = payload.data.name.slice(0, 200);
              // Addon versions collapse a single argument to its raw value.
              const args = serializeAction(Array.isArray(payload.data.args) ? payload.data.args : [payload.data.args]);
              captured.events.unshift({ id: `${storyId}:${++captured.sequence}`, name, args, time: Date.now() });
              captured.events.length = Math.min(30, captured.events.length);
              captured.observed = true;
              if (name && !captured.names.includes(name) && captured.names.length < 50) captured.names.push(name);
            }
          } catch { /* Observation must never change the story's event behavior. */ }
          return Reflect.apply(captured.original, this, emitted);
        };
        try {
          Object.defineProperty(runtime, stateKey, { value: captured, configurable: true, writable: true });
          channel.emit = captured.wrapper;
        } catch { state = undefined; }
      }
      const actionNames = [];
      const addName = name => { if (typeof name === 'string' && name && actionNames.length < 50 && !actionNames.includes(name.slice(0, 200))) actionNames.push(name.slice(0, 200)); };
      const disabled = story.parameters?.actions?.disable === true;
      if (!disabled) {
        for (const [key, definition] of Object.entries(rawArgTypes).slice(0, 200)) {
          if (definition?.action) addName(typeof definition.action === 'string' ? definition.action : key);
        }
        for (const [key, value] of Object.entries(getArgs()).slice(0, 200)) if (typeof value === 'function' && value.isAction === true) addName(rawArgTypes[key]?.action || key);
        const handles = story.parameters?.actions?.handles;
        if (Array.isArray(handles)) for (const handle of handles.slice(0, 50)) addName(handle);
      }
      const configured = actionNames.length > 0;
      for (const name of state?.names || []) addName(name);
      if (operation === 'clear-actions' && state) state.events.length = 0;
      const listening = !!state && channel?.emit === state.wrapper;
      return { matched: true, storyId, actionsAvailable: listening && (actionNames.length > 0 || state.observed), listening, configured, actionNames, actions: listening ? state.events.slice() : [], source: 'Storybook Actions' };
    }
    const argTypes = {};
    for (const key of Object.keys(rawArgTypes).slice(0, 200)) {
      if (!isKey(key)) continue;
      const definition = rawArgTypes[key];
      if (!definition || typeof definition !== 'object') continue;
      const normalized = {};
      for (const field of ['name', 'description', 'type', 'control', 'table', 'if']) {
        const value = safeValue(definition[field]);
        if (value !== undefined) normalized[field] = value;
      }
      if (typeof normalized.control === 'string') normalized.control = { type: normalized.control };
      let options = optionsFrom(definition);
      if (!options?.length) options = optionsFrom(story.component?.__docgenInfo?.props?.[key] || {});
      if (options?.length) normalized.options = options;
      // Keep component internals visible as metadata, but never send live React
      // elements, functions, refs, or their object internals across the bridge.
      const live = getArgs()[key];
      if (live !== undefined && safeValue(live) === undefined) normalized.readOnly = true;
      argTypes[key] = normalized;
    }
    const localUpdate = typeof store?.args?.update === 'function' && typeof render?.rerender === 'function';
    const channelUpdate = typeof channel?.emit === 'function' && Object.keys(argTypes).length > 0;
    const canUpdate = Object.keys(argTypes).length > 0 && !!(localUpdate || channelUpdate);
    if (operation !== 'read') {
      if (!canUpdate) return fail('This Storybook does not support editable properties.');
      let updates = {};
      if (operation === 'reset') {
        for (const key of new Set([...Object.keys(initialArgs), ...Object.keys(getArgs())])) {
          if (isKey(key)) updates[key] = initialArgs[key];
        }
      } else {
        if (!request.updatedArgs || typeof request.updatedArgs !== 'object' || Array.isArray(request.updatedArgs) || Object.keys(request.updatedArgs).length > 40) return fail('Invalid property values.', 'INVALID_ARGS');
        for (const key of Object.keys(request.updatedArgs)) {
          if (!isKey(key) || !Object.prototype.hasOwnProperty.call(argTypes, key) || argTypes[key].readOnly || rawArgTypes[key].control === false || rawArgTypes[key].table?.disable) return fail('This property cannot be edited.', 'INVALID_ARGS');
          const value = safeValue(request.updatedArgs[key]);
          if (value === undefined || JSON.stringify(value).length > 20000) return fail('This property value cannot be serialized.', 'INVALID_ARGS');
          const control = argTypes[key].control?.type || argTypes[key].type?.name;
          if (control === 'boolean' && typeof value !== 'boolean') return fail('Expected a boolean property value.', 'INVALID_ARGS');
          if (['number', 'range'].includes(control) && (typeof value !== 'number' || !Number.isFinite(value))) return fail('Expected a numeric property value.', 'INVALID_ARGS');
          if (['text', 'color'].includes(control) && typeof value !== 'string') return fail('Expected a text property value.', 'INVALID_ARGS');
          if (argTypes[key].options?.length) {
            const values = Array.isArray(value) ? value : [value];
            if (!values.every(item => argTypes[key].options.some(option => Object.is(item, option)))) return fail('Choose one of the property options supplied by this Storybook.', 'INVALID_ARGS');
          }
          updates[key] = value;
        }
      }
      if (localUpdate) {
        // This store and render belong only to the named library iframe. Updating
        // them directly avoids broadcasting updateStoryArgs to the original manager.
        store.args.update(storyId, updates);
        await bounded(Promise.resolve(render.rerender()));
      } else {
        // Compatibility path for versions that expose a channel but no render API.
        const done = new Promise(resolve => {
          const listener = event => {
            if (event?.storyId !== storyId) return;
            cleanup(); resolve();
          };
          const cleanup = () => { clearTimeout(timer); channel.off?.('storyArgsUpdated', listener); channel.removeListener?.('storyArgsUpdated', listener); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, 1200);
          channel.on?.('storyArgsUpdated', listener);
        });
        if (operation === 'reset') channel.emit('resetStoryArgs', { storyId });
        else channel.emit('updateStoryArgs', { storyId, updatedArgs: updates });
        await done;
      }
      try { if (typeof store?.getStoryContext === 'function') context = store.getStoryContext(story); } catch { /* Args store remains primary. */ }
    }
    const args = {}, defaults = {}, omittedArgs = [];
    for (const [key, value] of Object.entries(getArgs()).slice(0, 200)) {
      if (!isKey(key)) continue;
      const safe = safeValue(value);
      if (safe !== undefined) args[key] = safe;
      else omittedArgs.push(key);
    }
    for (const [key, value] of Object.entries(initialArgs).slice(0, 200)) {
      if (!isKey(key)) continue;
      const safe = safeValue(value);
      if (safe !== undefined) defaults[key] = safe;
    }
    return { matched: true, storyId, args, initialArgs: defaults, argTypes, omittedArgs, available: Object.keys(argTypes).length > 0, unavailable: Object.keys(argTypes).length === 0, canUpdate, source: 'Storybook runtime' };
  } catch (error) {
    return fail(String(error?.message || error).slice(0, 1000));
  }
}
