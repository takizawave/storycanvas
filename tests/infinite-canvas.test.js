import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutItems, zoomCameraAt, fitCamera, createInfiniteCanvas } from '../src/infinite-canvas.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('layout retains source order and actual dimensions with generous row gaps', () => {
  const input = [{ id: 'a', width: 200, height: 80 }, { id: 'b', width: 340, height: 160 }, { id: 'c', width: 180, height: 50 }];
  const original = structuredClone(input);
  const result = layoutItems(input, { maxWidth: 700, padding: 40, gapX: 60, gapY: 70 });
  assert.deepEqual(result.items.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), [
    { id: 'a', x: 40, y: 40, width: 200, height: 80 },
    { id: 'b', x: 300, y: 40, width: 340, height: 160 },
    { id: 'c', x: 40, y: 270, width: 180, height: 50 },
  ]);
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 680, height: 360 });
  assert.deepEqual(input, original, 'Layout never changes index data');
  assert.deepEqual(layoutItems(input, { maxWidth: 700, padding: 40, gapX: 60, gapY: 70 }), result);
});

test('unknown bounds have defaults and oversized native stories keep their dimensions', () => {
  const result = layoutItems([{ id: 'unknown' }, { id: 'invalid', width: NaN, height: -10 }, { id: 'large', width: 3100, height: 240 }, { id: 'last', width: 70, height: 30 }]);
  assert.equal(result.items[0].width, 220);
  assert.equal(result.items[1].height, 120);
  assert.equal(result.items[2].width, 3100);
  assert.equal(result.items[2].x, 80);
  assert.ok(result.items[3].y >= result.items[2].y + 240 + 80);
  assert.equal(result.bounds.width, 3260);
  assert.deepEqual(layoutItems([]).bounds, { x: 0, y: 0, width: 0, height: 0 });
});

test('a thousand stories remain in non-overlapping deterministic shelves', () => {
  const input = Array.from({ length: 1086 }, (_, index) => ({ id: String(index), width: 75 + index % 7 * 39, height: 32 + index % 11 * 19 }));
  const result = layoutItems(input);
  assert.equal(result.items.length, 1086);
  assert.ok(result.bounds.width <= 2500);
  for (let index = 1; index < result.items.length; index++) {
    const previous = result.items[index - 1];
    const current = result.items[index];
    assert.ok(current.y > previous.y || current.x >= previous.x + previous.width + 72);
  }
  assert.deepEqual(layoutItems(input), result);
});

test('zoom stays anchored under the cursor, including at the scale limits', () => {
  const camera = { x: -800, y: 125, scale: 0.6 };
  const point = { x: 380, y: 210 };
  for (const factor of [2, 0.5, 100, 0.0001]) {
    const next = zoomCameraAt(camera, factor, point);
    near((point.x - next.x) / next.scale, (point.x - camera.x) / camera.scale);
    near((point.y - next.y) / next.scale, (point.y - camera.y) / camera.scale);
    assert.ok(next.scale >= 0.02 && next.scale <= 3);
  }
  assert.equal(zoomCameraAt(camera, 0.0001, point).scale, 0.02);
  assert.equal(zoomCameraAt(camera, 100, point).scale, 3);
});

test('fit includes off-origin bounds and centers them inside the viewport', () => {
  const bounds = { x: -1300, y: 400, width: 2500, height: 12000 };
  const size = { width: 1000, height: 800 };
  const camera = fitCamera(bounds, size, { padding: 40 });
  near((bounds.x + bounds.width / 2) * camera.scale + camera.x, size.width / 2);
  near((bounds.y + bounds.height / 2) * camera.scale + camera.y, size.height / 2);
  near(bounds.height * camera.scale, 720);
  assert.ok(bounds.x * camera.scale + camera.x >= 40);
  assert.ok((bounds.x + bounds.width) * camera.scale + camera.x <= 960);
});

// Small DOM fakes exercise controller state and listeners without adding a DOM
// dependency. Browser integration exercises actual pointer propagation.
function surface() {
  const win = new EventTarget();
  win.performance = { now: () => 1000 };
  const doc = new EventTarget();
  doc.defaultView = win;
  const viewport = new EventTarget();
  Object.assign(viewport, { ownerDocument: doc, style: { cursor: '', touchAction: '', userSelect: '' }, clientWidth: 1000, clientHeight: 800, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => ({ left: 10, top: 20 }), contains: value => value === viewport, closest: () => null, getRootNode: () => doc });
  const captures = new Set();
  const children = new Set();
  doc.createElement = () => ({ style: {}, dataset: {}, setAttribute() {}, remove() { children.delete(this); } });
  viewport.appendChild = child => { children.add(child); return child; };
  viewport.focus = () => { doc.activeElement = viewport; viewport.focusCount = (viewport.focusCount || 0) + 1; };
  viewport.setPointerCapture = id => captures.add(id);
  viewport.hasPointerCapture = id => captures.has(id);
  viewport.releasePointerCapture = id => captures.delete(id);
  doc.activeElement = viewport;
  const world = { style: { transform: 'initial', transformOrigin: '', willChange: '' } };
  const emit = (target, type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  return { viewport, world, doc, win, emit, captures, children };
}

test('controller pans unbounded, focuses, resizes and restores DOM styles on destroy', () => {
  const fixture = surface();
  const changes = [];
  const controller = createInfiniteCanvas({ ...fixture, onChange: camera => changes.push(camera) });
  controller.setCamera({ x: -100000, y: 80000, scale: 0.5 });
  assert.deepEqual(controller.getCamera(), { x: -100000, y: 80000, scale: 0.5 });
  controller.focus({ x: 200, y: 300, width: 100, height: 200 });
  assert.deepEqual(controller.getCamera(), { x: 375, y: 200, scale: 0.5 });
  fixture.viewport.clientWidth = 1200;
  fixture.emit(fixture.win, 'resize');
  assert.equal(controller.getCamera().x, 475);
  fixture.emit(fixture.viewport, 'wheel', { deltaX: 40, deltaY: -20, deltaMode: 0 });
  assert.deepEqual(controller.getCamera(), { x: 435, y: 220, scale: 0.5 });
  const previous = controller.getCamera();
  controller.fit({ width: 0, height: 0 });
  assert.deepEqual(controller.getCamera(), previous, 'Empty layouts do not change the camera');
  controller.destroy();
  assert.equal(fixture.world.style.transform, 'initial');
  assert.equal(fixture.viewport.style.touchAction, '');
  fixture.emit(fixture.viewport, 'wheel', { deltaX: 200, deltaY: 0 });
  assert.deepEqual(controller.getCamera(), previous);
  assert.ok(changes.length >= 4);
});

test('a real drag suppresses its trailing click but does not suppress the next click', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 22, clientY: 30 });
  assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 }, 'Subthreshold motion is a click');
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 80, clientY: 65 });
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  assert.deepEqual(controller.getCamera(), { x: 60, y: 35, scale: 1 });
  assert.equal(controller.wasDragged(), true);
  assert.equal(fixture.emit(fixture.viewport, 'click').defaultPrevented, true);
  fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 80, clientY: 65 });
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  assert.equal(controller.wasDragged(), false);
  assert.equal(fixture.emit(fixture.viewport, 'click').defaultPrevented, false);
  controller.destroy();
});

test('Space leaves text inputs and native controls usable', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const editable = { isContentEditable: true, closest: () => null };
  const typing = fixture.emit(fixture.doc, 'keydown', { code: 'Space', key: ' ', composedPath: () => [editable] });
  assert.equal(typing.defaultPrevented, false);
  const button = { closest: selector => selector.includes('button') ? button : null };
  const activate = fixture.emit(fixture.doc, 'keydown', { code: 'Space', key: ' ', composedPath: () => [button] });
  assert.equal(activate.defaultPrevented, false);
  const panKey = fixture.emit(fixture.doc, 'keydown', { code: 'Space', key: ' ', composedPath: () => [fixture.viewport] });
  assert.equal(panKey.defaultPrevented, true);
  assert.equal(fixture.viewport.style.cursor, 'grab');
  fixture.emit(fixture.win, 'blur');
  assert.equal(fixture.viewport.style.cursor, '');
  controller.destroy();
});

test('IME composition and modified Space do not activate temporary hand mode', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const card = { closest: selector => selector === '[data-story]' ? card : null };
  for (const modifier of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    const event = fixture.emit(fixture.doc, 'keydown', { code: 'Space', key: ' ', composedPath: () => [fixture.viewport], ...modifier });
    assert.equal(event.defaultPrevented, false, JSON.stringify(modifier));
    assert.equal(fixture.viewport.style.cursor, '');
    fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30, composedPath: () => [card] });
    fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 80, clientY: 90 });
    fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
    assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 }, `No Space pan: ${JSON.stringify(modifier)}`);
  }
  const plain = fixture.emit(fixture.doc, 'keydown', { code: 'Space', key: ' ', composedPath: () => [fixture.viewport] });
  assert.equal(plain.defaultPrevented, true, 'Unmodified Space still activates temporary hand mode');
  assert.equal(fixture.viewport.style.cursor, 'grab');
  controller.destroy();
});

test('select focuses cards without dragging; hand pans cards and suppresses even unmoved taps', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const card = { closest: selector => selector === '[data-story]' ? card : null };
  const down = () => fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 30, clientY: 40, composedPath: () => [card] });
  assert.equal(controller.getTool(), 'select');
  down();
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 80, clientY: 100 });
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 });
  assert.equal(fixture.viewport.focusCount, 1);
  assert.equal(fixture.captures.size, 0);
  assert.equal(fixture.emit(fixture.viewport, 'click', { composedPath: () => [card] }).defaultPrevented, false);

  assert.equal(controller.setTool('hand'), 'hand');
  assert.equal(controller.getTool(), 'hand');
  assert.equal(fixture.viewport.style.cursor, 'grab');
  assert.equal(controller.setTool('invalid'), 'hand');
  down();
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  assert.equal(controller.wasDragged(), true, 'A hand-tool tap must not select the card');
  for (const type of ['click', 'dblclick']) assert.equal(fixture.emit(fixture.viewport, type, { composedPath: () => [card] }).defaultPrevented, true);
  down();
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 80, clientY: 100 });
  assert.deepEqual(controller.getCamera(), { x: 50, y: 60, scale: 1 });
  assert.equal(fixture.viewport.style.cursor, 'grabbing');
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  controller.setTool('select');
  down();
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
  assert.equal(fixture.emit(fixture.viewport, 'click', { composedPath: () => [card] }).defaultPrevented, false);
  controller.destroy();
});

test('hand and Space never capture native controls or suppress their click', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  controller.setTool('hand');
  fixture.emit(fixture.doc, 'keydown', { code: 'Space', composedPath: () => [fixture.viewport] });
  const button = { closest: selector => selector.includes('button') ? button : null };
  for (const pointerType of ['mouse', 'touch']) {
    const down = fixture.emit(fixture.viewport, 'pointerdown', { pointerType, button: 0, pointerId: 1, clientX: 20, clientY: 30, composedPath: () => [button] });
    assert.equal(down.defaultPrevented, false);
    assert.equal(fixture.captures.size, 0);
    assert.equal(fixture.viewport.focusCount, undefined);
    assert.equal(fixture.emit(fixture.viewport, 'click', { composedPath: () => [button] }).defaultPrevented, false);
  }
  const wheel = fixture.emit(fixture.viewport, 'wheel', { deltaY: 100, composedPath: () => [button] });
  assert.equal(wheel.defaultPrevented, false);
  assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 });
  controller.destroy();
});

test('disabled gestures leave native events alone and cancellation clears drag, Space and captures', () => {
  const fixture = surface();
  let active = false;
  const controller = createInfiniteCanvas({ ...fixture, isEnabled: () => active });
  assert.equal(fixture.viewport.style.touchAction, '');
  const wheel = fixture.emit(fixture.viewport, 'wheel', { deltaY: 100, ctrlKey: true });
  const key = fixture.emit(fixture.doc, 'keydown', { code: 'Space', composedPath: () => [fixture.viewport] });
  const down = fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(wheel.defaultPrevented || key.defaultPrevented || down.defaultPrevented, false);
  assert.equal(fixture.viewport.focusCount, undefined);
  active = true;
  fixture.emit(fixture.doc, 'keydown', { code: 'Space', composedPath: () => [fixture.viewport] });
  fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.deepEqual([...fixture.captures], [1]);
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 70, clientY: 80 });
  active = false;
  controller.cancelInteraction();
  assert.equal(fixture.captures.size, 0);
  assert.equal(fixture.viewport.style.cursor, '');
  assert.equal(fixture.viewport.style.userSelect, '');
  assert.equal(fixture.viewport.style.touchAction, '');
  assert.equal(controller.wasDragged(), false);
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
  assert.deepEqual(controller.getCamera(), { x: 50, y: 50, scale: 1 });
  active = true;
  const card = { closest: selector => selector === '[data-story]' ? card : null };
  fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30, composedPath: () => [card] });
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
  assert.deepEqual(controller.getCamera(), { x: 50, y: 50, scale: 1 }, 'Space must not remain stuck after cancellation');
  controller.reset();
  assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 });
  controller.destroy();
});

test('touch pans with one finger and pinches around the moving midpoint without a release jump', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  controller.setCamera({ x: 30, y: -20, scale: 0.5 });
  const touch = (type, id, x, y) => fixture.emit(type === 'pointerdown' ? fixture.viewport : fixture.doc, type, { pointerType: 'touch', button: 0, pointerId: id, clientX: x, clientY: y });
  touch('pointerdown', 1, 110, 120);
  assert.equal(fixture.captures.size, 0, 'An unmoved touch keeps the card as its click target');
  touch('pointermove', 1, 140, 140);
  assert.deepEqual(controller.getCamera(), { x: 60, y: 0, scale: 0.5 });
  touch('pointerdown', 2, 240, 140);
  assert.deepEqual([...fixture.captures].sort(), [1, 2]);
  touch('pointermove', 2, 340, 140);
  assert.deepEqual(controller.getCamera(), { x: -10, y: -120, scale: 1 });
  near((230 - controller.getCamera().x) / controller.getCamera().scale, (180 - 60) / 0.5);
  near((120 - controller.getCamera().y) / controller.getCamera().scale, 120 / 0.5);
  touch('pointerup', 1, 140, 140);
  assert.deepEqual(controller.getCamera(), { x: -10, y: -120, scale: 1 });
  touch('pointermove', 2, 360, 155);
  assert.deepEqual(controller.getCamera(), { x: 10, y: -105, scale: 1 });
  touch('pointerup', 2, 360, 155);
  assert.equal(fixture.captures.size, 0);
  assert.equal(controller.wasDragged(), true);
  controller.destroy();
});

test('pinch obeys zoom limits while retaining its midpoint anchor', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas({ ...fixture, minScale: 0.2, maxScale: 2 });
  const touch = (type, id, x) => fixture.emit(type === 'pointerdown' ? fixture.viewport : fixture.doc, type, { pointerType: 'touch', button: 0, pointerId: id, clientX: x, clientY: 120 });
  touch('pointerdown', 1, 110);
  touch('pointerdown', 2, 210);
  touch('pointermove', 2, 1110);
  assert.equal(controller.getCamera().scale, 2);
  near((600 - controller.getCamera().x) / 2, 150);
  near((100 - controller.getCamera().y) / 2, 100);
  touch('pointermove', 2, 110);
  assert.equal(controller.getCamera().scale, 0.2);
  near((100 - controller.getCamera().x) / 0.2, 150);
  controller.destroy();
});

test('pointer cancellation clears every touch and accepts a fresh gesture', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const touch = (type, id, x, y = 120) => fixture.emit(type === 'pointerdown' ? fixture.viewport : fixture.doc, type, { pointerType: 'touch', button: 0, pointerId: id, clientX: x, clientY: y });
  touch('pointerdown', 1, 110);
  touch('pointerdown', 2, 210);
  touch('pointermove', 2, 310);
  const before = controller.getCamera();
  touch('pointercancel', 1, 110);
  assert.equal(fixture.captures.size, 0);
  touch('pointermove', 2, 600);
  assert.deepEqual(controller.getCamera(), before);
  touch('pointerdown', 3, 210);
  touch('pointermove', 3, 220, 140);
  assert.deepEqual(controller.getCamera(), { ...before, x: before.x + 10, y: before.y + 20 });
  controller.destroy();
});

test('camera no-op updates do not rewrite transforms or notify listeners', () => {
  const fixture = surface();
  const changes = [];
  const controller = createInfiniteCanvas({ ...fixture, onChange: value => changes.push(value) });
  assert.equal(changes.length, 1, 'The initial camera is applied once');
  controller.setCamera({});
  controller.reset();
  controller.zoomBy(1);
  assert.equal(changes.length, 1);
  controller.setCamera({ x: 25 });
  controller.setCamera({ x: 25 });
  assert.equal(changes.length, 2);
  assert.equal(fixture.world.style.transform, 'translate(25px, 0px) scale(1)');
  controller.destroy();
});

test('held Z zooms at the clicked point, Alt reverses it and the original tool is restored', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const card = { closest: selector => selector === '[data-story]' ? card : null };
  controller.setTool('hand');
  controller.setCamera({ x: -80, y: 40, scale: 0.5 });
  const initial = controller.getCamera();
  fixture.emit(fixture.doc, 'keydown', { key: 'z', code: 'KeyZ', composedPath: () => [fixture.viewport] });
  assert.equal(fixture.viewport.style.cursor, 'zoom-in');
  const clickZoom = () => {
    fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 310, clientY: 220, composedPath: () => [card] });
    fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
    assert.equal(fixture.emit(fixture.viewport, 'click', { composedPath: () => [card] }).defaultPrevented, true);
  };
  clickZoom();
  assert.equal(controller.getCamera().scale, 0.625);
  near((300 - controller.getCamera().x) / controller.getCamera().scale, (300 - initial.x) / initial.scale);
  near((200 - controller.getCamera().y) / controller.getCamera().scale, (200 - initial.y) / initial.scale);
  fixture.emit(fixture.doc, 'keydown', { key: 'Alt', altKey: true, composedPath: () => [fixture.viewport] });
  assert.equal(fixture.viewport.style.cursor, 'zoom-out');
  clickZoom();
  assert.deepEqual(controller.getCamera(), initial);
  fixture.emit(fixture.doc, 'keyup', { key: 'Alt' });
  assert.equal(fixture.viewport.style.cursor, 'zoom-in');
  fixture.emit(fixture.doc, 'keyup', { key: 'z', code: 'KeyZ' });
  assert.equal(fixture.viewport.style.cursor, 'grab');
  assert.equal(controller.getTool(), 'hand');
  assert.equal(fixture.captures.size, 0);
  controller.destroy();
});

test('Z marquee fits the selected world rectangle in either drag direction without selecting cards', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  controller.setCamera({ x: 30, y: 20, scale: 0.5 });
  fixture.emit(fixture.doc, 'keydown', { key: 'z', code: 'KeyZ', composedPath: () => [fixture.viewport] });
  fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 4, clientX: 310, clientY: 220 });
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 99, clientX: 20, clientY: 30, buttons: 1 });
  assert.equal(fixture.children.size, 0, 'Another pointer cannot move the marquee');
  fixture.emit(fixture.doc, 'pointermove', { pointerId: 4, clientX: 110, clientY: 120, buttons: 1 });
  assert.deepEqual(controller.getCamera(), { x: 30, y: 20, scale: 0.5 }, 'The camera remains stable while the area is chosen');
  const [marquee] = fixture.children;
  assert.deepEqual([marquee.style.left, marquee.style.top, marquee.style.width, marquee.style.height], ['100px', '100px', '200px', '100px']);
  fixture.emit(fixture.doc, 'pointerup', { pointerId: 4 });
  assert.deepEqual(controller.getCamera(), fitCamera({ x: 140, y: 160, width: 400, height: 200 }, { width: 1000, height: 800 }, { padding: 24 }));
  assert.equal(fixture.children.size, 0);
  assert.equal(fixture.captures.size, 0);
  assert.equal(fixture.emit(fixture.viewport, 'click').defaultPrevented, true);
  controller.destroy();
});

test('Z, native controls, composition and modified shortcuts remain isolated', () => {
  const fixture = surface();
  const controller = createInfiniteCanvas(fixture);
  const editable = { isContentEditable: true, closest: () => null };
  const button = { closest: selector => selector.includes('button') ? button : null };
  for (const values of [
    { isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true },
    { composedPath: () => [editable] }, { composedPath: () => [button] },
  ]) {
    const event = fixture.emit(fixture.doc, 'keydown', { key: 'z', code: 'KeyZ', composedPath: () => [fixture.viewport], ...values });
    assert.equal(event.defaultPrevented, false);
    assert.equal(fixture.viewport.style.cursor, '');
  }
  for (const [key, code] of [[' ', 'Space'], ['z', 'KeyZ']]) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, code, composedPath: () => [fixture.viewport] });
    event.preventDefault();
    fixture.doc.dispatchEvent(event);
    assert.equal(fixture.viewport.style.cursor, '', 'Already-handled keyboard shortcuts must not activate a tool');
  }
  fixture.emit(fixture.doc, 'keydown', { key: 'z', code: 'KeyZ', altKey: true, composedPath: () => [fixture.viewport] });
  assert.equal(fixture.viewport.style.cursor, 'zoom-out', 'Alt may be held before Z');
  for (const target of [editable, button]) {
    const down = fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 60, composedPath: () => [target] });
    assert.equal(down.defaultPrevented, false);
    assert.equal(fixture.emit(fixture.viewport, 'click', { composedPath: () => [target] }).defaultPrevented, false);
  }
  const modified = fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 60, metaKey: true });
  assert.equal(modified.defaultPrevented, false);
  assert.equal(fixture.captures.size, 0);
  assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 });
  controller.destroy();
});

test('releasing Z, blur, pointer cancellation, stale buttons and disabled canvas cancel a pending marquee', () => {
  for (const reason of ['keyup', 'blur', 'pointercancel', 'stale', 'disabled']) {
    const fixture = surface();
    let active = true;
    const controller = createInfiniteCanvas({ ...fixture, isEnabled: () => active });
    fixture.emit(fixture.doc, 'keydown', { key: 'z', code: 'KeyZ', composedPath: () => [fixture.viewport] });
    fixture.emit(fixture.viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 110, clientY: 120 });
    fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 410, clientY: 320, buttons: 1 });
    assert.equal(fixture.children.size, 1);
    if (reason === 'keyup') fixture.emit(fixture.doc, 'keyup', { key: 'z', code: 'KeyZ' });
    else if (reason === 'blur') fixture.emit(fixture.win, 'blur');
    else if (reason === 'pointercancel') fixture.emit(fixture.doc, 'pointercancel', { pointerId: 1 });
    else if (reason === 'stale') fixture.emit(fixture.doc, 'pointermove', { pointerId: 1, clientX: 450, clientY: 350, buttons: 0 });
    else { active = false; fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 }); }
    fixture.emit(fixture.doc, 'pointerup', { pointerId: 1 });
    assert.deepEqual(controller.getCamera(), { x: 0, y: 0, scale: 1 }, reason);
    assert.equal(fixture.children.size, 0, reason);
    assert.equal(fixture.captures.size, 0, reason);
    assert.equal(fixture.viewport.style.cursor, '', reason);
    assert.equal(fixture.viewport.style.userSelect, '', reason);
    controller.destroy();
  }
});
