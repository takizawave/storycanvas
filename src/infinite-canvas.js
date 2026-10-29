const DEFAULT_MIN_SCALE = 0.02;
const DEFAULT_MAX_SCALE = 3;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Deterministic shelves in source order. Native dimensions are never scaled. */
export function layoutItems(items, {
  maxWidth = 2500, gapX = 72, gapY = 80, padding = 80,
  defaultWidth = 220, defaultHeight = 120,
} = {}) {
  maxWidth = positive(maxWidth, 2500);
  gapX = Math.max(0, finite(gapX, 72));
  gapY = Math.max(0, finite(gapY, 80));
  padding = Math.max(0, finite(padding, 80));
  defaultWidth = positive(defaultWidth, 220);
  defaultHeight = positive(defaultHeight, 120);
  const usableWidth = Math.max(1, maxWidth - padding * 2);
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let rowCount = 0;
  let right = 0;
  let bottom = 0;
  const placed = items.map(item => {
    const width = positive(item.width, defaultWidth);
    const height = positive(item.height, defaultHeight);
    if (rowCount && x + width > padding + usableWidth) {
      x = padding;
      y += rowHeight + gapY;
      rowHeight = 0;
      rowCount = 0;
    }
    const result = { ...item, x, y, width, height };
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
    x += width + gapX;
    rowHeight = Math.max(rowHeight, height);
    rowCount += 1;
    return result;
  });
  return {
    items: placed,
    bounds: { x: 0, y: 0, width: placed.length ? right + padding : 0, height: placed.length ? bottom + padding : 0 },
  };
}

/** Change scale while keeping the world coordinate beneath a viewport point. */
export function zoomCameraAt(camera, factor, point, { minScale = DEFAULT_MIN_SCALE, maxScale = DEFAULT_MAX_SCALE } = {}) {
  const previousScale = positive(camera.scale, 1);
  const scale = clamp(previousScale * positive(factor, 1), minScale, maxScale);
  const ratio = scale / previousScale;
  const x = finite(point?.x);
  const y = finite(point?.y);
  return { x: x - (x - finite(camera.x)) * ratio, y: y - (y - finite(camera.y)) * ratio, scale };
}

/** Camera for a whole world rectangle, subject to the configured zoom limits. */
export function fitCamera(bounds, size, { padding = 64, minScale = DEFAULT_MIN_SCALE, maxScale = DEFAULT_MAX_SCALE } = {}) {
  const width = positive(bounds?.width, 1);
  const height = positive(bounds?.height, 1);
  const viewportWidth = Math.max(1, finite(size?.width, 1));
  const viewportHeight = Math.max(1, finite(size?.height, 1));
  padding = Math.max(0, finite(padding, 64));
  const scale = clamp(Math.min(Math.max(1, viewportWidth - padding * 2) / width, Math.max(1, viewportHeight - padding * 2) / height), minScale, maxScale);
  return {
    x: viewportWidth / 2 - (finite(bounds?.x) + width / 2) * scale,
    y: viewportHeight / 2 - (finite(bounds?.y) + height / 2) * scale,
    scale,
  };
}

/**
 * The world is positioned with translate(x,y) scale(scale); its children use
 * world coordinates. Camera points passed to zoomBy are viewport-local pixels.
 * onChange receives a fresh {x,y,scale} when the camera changes. Pointer/Space/Z
 * gestures can be disabled with isEnabled; programmatic camera APIs still work.
 */
export function createInfiniteCanvas({ viewport, world, onChange = () => {}, isEnabled = () => true, minScale = DEFAULT_MIN_SCALE, maxScale = DEFAULT_MAX_SCALE }) {
  if (!viewport || !world) throw new TypeError('An infinite canvas requires a viewport and world element.');
  minScale = positive(minScale, DEFAULT_MIN_SCALE);
  maxScale = Math.max(minScale, positive(maxScale, DEFAULT_MAX_SCALE));
  const doc = viewport.ownerDocument;
  const win = doc.defaultView;
  const originalStyles = {
    transform: world.style.transform,
    transformOrigin: world.style.transformOrigin,
    willChange: world.style.willChange,
    touchAction: viewport.style.touchAction,
    cursor: viewport.style.cursor,
    userSelect: viewport.style.userSelect,
  };
  const removers = [];
  let camera = { x: 0, y: 0, scale: 1 };
  let destroyed = false;
  let tool = 'select';
  let spaceHeld = false;
  let zoomHeld = false;
  let altHeld = false;
  let zoomMarquee = null;
  let pointerInside = false;
  let drag = null;
  const touches = new Map();
  let renderedCamera = false;
  let suppressClickUntil = 0;
  let previousSize = { width: viewport.clientWidth, height: viewport.clientHeight };
  const now = () => win.performance?.now?.() ?? Date.now();
  const getCamera = () => ({ ...camera });
  const size = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
  const center = () => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
  const eventTarget = event => event.composedPath?.()[0] || event.target;
  const closest = (target, selector) => target?.closest?.(selector);
  const isEditable = target => !!(target?.isContentEditable || closest(target, 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
  const isNativeControl = target => !!closest(target, 'a, button, summary, [role="button"], [data-canvas-no-pan]');
  const enabled = () => !destroyed && !!isEnabled();
  const wasDragged = () => enabled() && now() < suppressClickUntil;
  const pointerPoint = event => {
    const rect = viewport.getBoundingClientRect();
    return { x: finite(event.clientX) - rect.left - viewport.clientLeft, y: finite(event.clientY) - rect.top - viewport.clientTop };
  };

  function listen(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    removers.push(() => target.removeEventListener(name, callback, options));
  }

  function updateCursor() {
    const active = enabled();
    viewport.style.cursor = !active ? originalStyles.cursor
      : drag?.kind === 'zoom' ? drag.zoomOut ? 'zoom-out' : 'zoom-in'
      : spaceHeld ? drag?.moved ? 'grabbing' : 'grab'
      : zoomHeld ? altHeld ? 'zoom-out' : 'zoom-in'
      : drag?.moved ? 'grabbing' : tool === 'hand' ? 'grab' : originalStyles.cursor;
    viewport.style.userSelect = active && drag ? 'none' : originalStyles.userSelect;
    viewport.style.touchAction = active ? 'none' : originalStyles.touchAction;
  }

  function setCamera(next) {
    if (destroyed) return getCamera();
    const nextCamera = {
      x: finite(next?.x, camera.x),
      y: finite(next?.y, camera.y),
      scale: clamp(positive(next?.scale, camera.scale), minScale, maxScale),
    };
    if (renderedCamera && nextCamera.x === camera.x && nextCamera.y === camera.y && nextCamera.scale === camera.scale) return getCamera();
    camera = nextCamera;
    renderedCamera = true;
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    onChange(getCamera());
    return getCamera();
  }

  function zoomBy(factor, point = center()) {
    return setCamera(zoomCameraAt(camera, factor, point, { minScale, maxScale }));
  }

  function focus(bounds) {
    if (!bounds) return getCamera();
    const point = center();
    return setCamera({
      x: point.x - (finite(bounds.x) + Math.max(0, finite(bounds.width)) / 2) * camera.scale,
      y: point.y - (finite(bounds.y) + Math.max(0, finite(bounds.height)) / 2) * camera.scale,
    });
  }

  function fit(bounds, options = {}) {
    if (!bounds || !positive(bounds.width, 0) || !positive(bounds.height, 0)) return getCamera();
    return setCamera(fitCamera(bounds, size(), { ...options, minScale, maxScale }));
  }

  function releasePointer(pointerId) {
    try { if (viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId); } catch { /* Already released by the browser. */ }
  }

  function capturePointer(pointerId) {
    try { viewport.setPointerCapture?.(pointerId); } catch { /* Document listeners provide a fallback. */ }
  }

  function removeZoomMarquee() {
    zoomMarquee?.remove();
    zoomMarquee = null;
  }

  function drawZoomMarquee() {
    if (!drag || drag.kind !== 'zoom' || drag.zoomOut || !drag.moved) return;
    if (!zoomMarquee) {
      zoomMarquee = doc.createElement('div');
      zoomMarquee.setAttribute('aria-hidden', 'true');
      zoomMarquee.dataset.canvasZoomMarquee = '';
      Object.assign(zoomMarquee.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2', border: '1px solid #a66cff', background: '#8a38f51a', boxSizing: 'border-box' });
      viewport.appendChild(zoomMarquee);
    }
    Object.assign(zoomMarquee.style, {
      left: `${Math.min(drag.start.x, drag.end.x)}px`,
      top: `${Math.min(drag.start.y, drag.end.y)}px`,
      width: `${Math.abs(drag.end.x - drag.start.x)}px`,
      height: `${Math.abs(drag.end.y - drag.start.y)}px`,
    });
  }

  function finishZoom(ended) {
    const width = Math.abs(ended.end.x - ended.start.x);
    const height = Math.abs(ended.end.y - ended.start.y);
    if (!ended.zoomOut && ended.moved && width >= 4 && height >= 4) {
      const origin = ended.camera;
      fit({
        x: (Math.min(ended.start.x, ended.end.x) - origin.x) / origin.scale,
        y: (Math.min(ended.start.y, ended.end.y) - origin.y) / origin.scale,
        width: width / origin.scale,
        height: height / origin.scale,
      }, { padding: 24 });
    } else {
      zoomBy(ended.zoomOut ? 1 / 1.25 : 1.25, ended.start);
    }
  }

  function rebaseTouches() {
    drag = {
      kind: 'touch',
      camera: getCamera(),
      points: [...touches].map(([id, point]) => ({ id, ...point })),
      moved: !!drag?.moved || touches.size > 1,
      suppressTap: !!drag?.suppressTap || spaceHeld || tool === 'hand',
    };
  }

  function endDrag(event) {
    if (!enabled()) { cancelInteraction(); return; }
    if (!drag) return;
    const pointerId = event?.pointerId;
    if (drag.kind === 'touch') {
      if (!touches.has(pointerId)) return;
      touches.delete(pointerId);
      releasePointer(pointerId);
      if (touches.size) {
        rebaseTouches();
        updateCursor();
        return;
      }
    } else if (pointerId !== undefined && pointerId !== drag.pointerId) return;
    if (drag.moved || drag.suppressTap) suppressClickUntil = now() + 400;
    const ended = drag;
    drag = null;
    removeZoomMarquee();
    if (ended.kind !== 'touch') releasePointer(ended.pointerId);
    if (ended.kind === 'zoom') finishZoom(ended);
    updateCursor();
  }

  function cancelInteraction() {
    const pointerIds = [...touches.keys()];
    if (drag && drag.kind !== 'touch') pointerIds.push(drag.pointerId);
    if (drag?.moved || drag?.suppressTap) suppressClickUntil = now() + 400;
    drag = null;
    touches.clear();
    spaceHeld = false;
    zoomHeld = false;
    altHeld = false;
    removeZoomMarquee();
    pointerIds.forEach(releasePointer);
    if (!enabled()) suppressClickUntil = 0;
    updateCursor();
  }

  function setTool(next) {
    if (destroyed || !['select', 'hand'].includes(next) || next === tool) return tool;
    cancelInteraction();
    tool = next;
    updateCursor();
    return tool;
  }

  world.style.transformOrigin = '0 0';
  world.style.willChange = 'transform';
  updateCursor();

  listen(viewport, 'wheel', event => {
    if (!enabled()) { cancelInteraction(); return; }
    const target = eventTarget(event);
    if (isEditable(target) || isNativeControl(target)) return;
    event.preventDefault();
    if (drag) return;
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, viewport.clientHeight) : 1;
    const dx = finite(event.deltaX) * multiplier;
    const dy = finite(event.deltaY) * multiplier;
    if (event.ctrlKey || event.metaKey) {
      zoomBy(Math.exp(clamp(-dy * 0.003, -4, 4)), pointerPoint(event));
    } else {
      const horizontal = event.shiftKey && dx === 0;
      setCamera({ x: camera.x - (horizontal ? dy : dx), y: camera.y - (horizontal ? 0 : dy) });
    }
  }, { passive: false });

  listen(viewport, 'pointerenter', () => { pointerInside = true; });
  listen(viewport, 'pointerleave', () => { pointerInside = false; });
  listen(viewport, 'pointerdown', event => {
    if (!enabled()) { cancelInteraction(); return; }
    const touch = event.pointerType === 'touch';
    if (drag && (!touch || drag.kind !== 'touch')) return;
    // A new deliberate click must not be mistaken for the preceding drag's
    // synthetic click, even if the user clicks again immediately.
    if (!drag) suppressClickUntil = 0;
    const target = eventTarget(event);
    if (isEditable(target) || isNativeControl(target) || (event.button !== 0 && event.button !== 1)) return;
    if (zoomHeld && !spaceHeld && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
    if (touch && touches.size >= 2) return;
    event.preventDefault();
    // Keep shortcuts on the canvas after interacting with a non-native card.
    // Preventing the pointerdown default keeps the browser from refocusing it.
    viewport.focus?.({ preventScroll: true });
    const blank = !closest(target, '[data-story]');
    if (!touch && event.button === 0 && zoomHeld && !spaceHeld) {
      const start = pointerPoint(event);
      drag = { kind: 'zoom', pointerId: event.pointerId, start, end: start, camera: getCamera(), zoomOut: !!event.altKey || altHeld, moved: false, suppressTap: true };
    } else if (touch) {
      touches.set(event.pointerId, pointerPoint(event));
      rebaseTouches();
    } else {
      if (event.button !== 1 && !spaceHeld && tool !== 'hand' && !blank) return;
      drag = { kind: 'mouse', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y, moved: false, suppressTap: spaceHeld || tool === 'hand' || event.button === 1 };
    }
    // Preserve the original card as a touch tap's click target. Explicit
    // capture starts only after panning or a second finger makes it a gesture.
    if (!touch) capturePointer(event.pointerId);
    else if (touches.size > 1) touches.forEach((_, id) => capturePointer(id));
    updateCursor();
  });

  listen(doc, 'pointermove', event => {
    if (!enabled()) { cancelInteraction(); return; }
    if (!drag) return;
    if (drag.kind === 'zoom') {
      if (event.pointerId !== drag.pointerId) return;
      if (event.buttons === 0) { cancelInteraction(); return; }
      const point = pointerPoint(event);
      drag.end = { x: clamp(point.x, 0, viewport.clientWidth), y: clamp(point.y, 0, viewport.clientHeight) };
      if (!drag.moved && Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) < 4) return;
      drag.moved = true;
      event.preventDefault();
      drawZoomMarquee();
      updateCursor();
      return;
    }
    if (drag.kind === 'touch') {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, pointerPoint(event));
      const [first, second] = drag.points;
      const nextFirst = touches.get(first.id);
      if (second) {
        const nextSecond = touches.get(second.id);
        const start = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const next = { x: (nextFirst.x + nextSecond.x) / 2, y: (nextFirst.y + nextSecond.y) / 2 };
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const nextDistance = Math.hypot(nextSecond.x - nextFirst.x, nextSecond.y - nextFirst.y);
        const zoomed = zoomCameraAt(drag.camera, Math.max(Number.EPSILON, nextDistance / Math.max(1, distance)), start, { minScale, maxScale });
        event.preventDefault();
        setCamera({ ...zoomed, x: zoomed.x + next.x - start.x, y: zoomed.y + next.y - start.y });
      } else {
        const dx = nextFirst.x - first.x, dy = nextFirst.y - first.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        capturePointer(event.pointerId);
        event.preventDefault();
        setCamera({ x: drag.camera.x + dx, y: drag.camera.y + dy });
      }
      updateCursor();
      return;
    }
    if (event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    event.preventDefault();
    setCamera({ x: drag.x + dx, y: drag.y + dy });
    updateCursor();
  }, { passive: false });
  listen(doc, 'pointerup', endDrag);
  const cancelPointer = event => { if (touches.has(event.pointerId) || drag?.pointerId === event.pointerId) cancelInteraction(); };
  listen(doc, 'pointercancel', cancelPointer);
  listen(viewport, 'lostpointercapture', cancelPointer);
  const suppressClick = event => {
    const target = eventTarget(event);
    if (!enabled() || isEditable(target) || isNativeControl(target)) return;
    if (zoomHeld && !spaceHeld && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
    if (!wasDragged() && !zoomHeld && !((tool === 'hand' || spaceHeld) && closest(target, '[data-story]'))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  listen(viewport, 'click', suppressClick, true);
  listen(viewport, 'dblclick', suppressClick, true);
  listen(viewport, 'auxclick', event => {
    if (event.button === 1) suppressClick(event);
  }, true);

  listen(doc, 'keydown', event => {
    const isSpace = event.code === 'Space' || event.key === ' ';
    const isZoom = event.code === 'KeyZ' || event.key?.toLowerCase() === 'z';
    const isAlt = event.key === 'Alt';
    if (!isSpace && !isZoom && !(isAlt && zoomHeld)) return;
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.shiftKey || (isSpace && event.altKey)) return;
    if (!enabled()) { cancelInteraction(); return; }
    const target = eventTarget(event);
    const active = viewport.getRootNode?.().activeElement || doc.activeElement;
    if (isEditable(target) || isNativeControl(target) || (!pointerInside && !viewport.contains(active))) return;
    if (isZoom && (event.repeat || drag)) return;
    event.preventDefault();
    if (isSpace) spaceHeld = true;
    else {
      if (isZoom) zoomHeld = true;
      altHeld = isAlt || !!event.altKey;
    }
    updateCursor();
  }, true);
  listen(doc, 'keyup', event => {
    const isSpace = event.code === 'Space' || event.key === ' ';
    const isZoom = event.code === 'KeyZ' || event.key?.toLowerCase() === 'z';
    if (event.key === 'Alt') { altHeld = false; updateCursor(); return; }
    if (!isSpace && !isZoom) return;
    if (enabled() && (isSpace ? spaceHeld : zoomHeld) && !isEditable(eventTarget(event)) && !isNativeControl(eventTarget(event))) event.preventDefault();
    if (isSpace) spaceHeld = false;
    else {
      zoomHeld = false;
      altHeld = false;
      if (drag?.kind === 'zoom') cancelInteraction();
    }
    updateCursor();
  }, true);
  listen(win, 'blur', cancelInteraction);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancelInteraction(); });

  const onResize = () => {
    if (destroyed) return;
    const next = size();
    if (previousSize.width > 0 && previousSize.height > 0 && next.width > 0 && next.height > 0 && (next.width !== previousSize.width || next.height !== previousSize.height)) {
      // Preserve the world point at the center when the inspector or window
      // changes the viewport dimensions.
      const old = previousSize;
      previousSize = next;
      setCamera({ x: camera.x + (next.width - old.width) / 2, y: camera.y + (next.height - old.height) / 2 });
    } else previousSize = next;
  };
  const observer = win.ResizeObserver ? new win.ResizeObserver(onResize) : null;
  if (observer) observer.observe(viewport);
  else listen(win, 'resize', onResize);
  setCamera(camera);

  function destroy() {
    if (destroyed) return;
    cancelInteraction();
    destroyed = true;
    observer?.disconnect();
    removers.forEach(remove => remove());
    world.style.transform = originalStyles.transform;
    world.style.transformOrigin = originalStyles.transformOrigin;
    world.style.willChange = originalStyles.willChange;
    viewport.style.touchAction = originalStyles.touchAction;
    viewport.style.cursor = originalStyles.cursor;
    viewport.style.userSelect = originalStyles.userSelect;
    suppressClickUntil = 0;
  }

  return { getCamera, setCamera, focus, fit, zoomBy, reset: () => setCamera({ x: 0, y: 0, scale: 1 }), setTool, getTool: () => tool, cancelInteraction, destroy, wasDragged };
}
