import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindPullCord } from '../src/pull-cord';

class Button extends EventTarget {
  captured: number | null = null;
  setPointerCapture(id: number) { this.captured = id; }
  hasPointerCapture(id: number) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}
function setup() {
  const button = new Button(), host = new EventTarget();
  let toggles = 0, distance = 0;
  bindPullCord(button as unknown as HTMLButtonElement, host, () => toggles++, value => distance = value);
  const send = (type: string, props = {}) => button.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, detail: 1, ...props
  }));
  return { button, host, send, get toggles() { return toggles; }, get distance() { return distance; } };
}
test('downward pull changes mode once, even when followed by a native click', () => {
  const s = setup(); s.send('pointerdown'); s.send('pointermove', {clientY: 40});
  assert.equal(s.distance, 28);
  s.send('pointerup', {clientY: 40}); s.send('click');
  assert.equal(s.toggles, 1); assert.equal(s.distance, 0); assert.equal(s.button.captured, null);
});
test('tap and keyboard work without dragging', () => {
  const s = setup(); s.send('pointerdown'); s.send('pointerup'); s.send('click');
  s.send('click', {detail: 0}); assert.equal(s.toggles, 2);
});
test('short, upward and sideways drags do not change the reading mode', () => {
  for (const [x,y] of [[0,12],[0,-30],[60,30]]) {
    const s = setup(); s.send('pointerdown'); s.send('pointerup', {clientX:x,clientY:y}); s.send('click');
    assert.equal(s.toggles, 0);
  }
});
test('interrupted pulls reset and the next pull works', () => {
  for (const interruption of ['pointercancel','lostpointercapture','blur','Escape']) {
    const s = setup(); s.send('pointerdown'); s.send('pointermove', {clientY:40});
    if (interruption === 'blur') s.host.dispatchEvent(new Event('blur'));
    else if (interruption === 'Escape') s.send('keydown', {key:'Escape'});
    else s.send(interruption);
    assert.equal(s.distance,0); assert.equal(s.toggles,0); assert.equal(s.button.captured,null);
    s.send('pointerdown'); s.send('pointerup',{clientY:30}); assert.equal(s.toggles,1);
    s.send('click',{detail:0}); assert.equal(s.toggles,2);
  }
});
test('another pointer cannot steal, cancel or complete the active pull', () => {
  const s=setup(); s.send('pointerdown');
  s.send('pointerdown',{pointerId:2,isPrimary:false}); s.send('pointermove',{pointerId:2,clientY:100});
  s.send('pointercancel',{pointerId:2}); s.send('pointerup',{pointerId:2,clientY:100});
  assert.equal(s.button.captured,1); assert.equal(s.toggles,0);
  s.send('pointerup',{clientY:24}); assert.equal(s.toggles,1);
});

test('a fresh tap immediately after a pull is not swallowed', () => {
  const s=setup(); s.send('pointerdown'); s.send('pointerup',{clientY:30}); s.send('click');
  s.send('pointerdown'); s.send('pointerup'); s.send('click');
  assert.equal(s.toggles,2);
});

test('tap and drag identify their activation so only a tap adds an automatic tug', () => {
  const button = new Button(), gestures: string[] = [];
  bindPullCord(button as unknown as HTMLButtonElement, new EventTarget(), value => gestures.push(value), () => {});
  button.dispatchEvent(Object.assign(new Event('click'), {detail:0}));
  button.dispatchEvent(Object.assign(new Event('pointerdown'), {pointerId:1, isPrimary:true, button:0, clientX:0, clientY:0}));
  button.dispatchEvent(Object.assign(new Event('pointerup'), {pointerId:1, clientX:0, clientY:30}));
  assert.deepEqual(gestures,['press','pull']);
});
