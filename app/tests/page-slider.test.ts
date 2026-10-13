import assert from 'node:assert/strict';
import test from 'node:test';
import { trackPageSliderDrag } from '../src/page-slider';

function pointer(target: EventTarget, type: string, id = 1, primary = true, button = 0) {
  target.dispatchEvent(Object.assign(new Event(type), {pointerId:id, isPrimary:primary, button}));
}

for (const interruption of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'change']) {
  test(`page tracking resumes after ${interruption}, and the next drag works`, () => {
    const slider = new EventTarget();
    const root = new EventTarget();
    const states: boolean[] = [];
    const cleanup = trackPageSliderDrag(slider, root, value => states.push(value));
    pointer(slider, 'pointerdown');
    const target = ['lostpointercapture', 'change'].includes(interruption) ? slider : root;
    pointer(target, interruption);
    assert.deepEqual(states, [true, false]);
    pointer(slider, 'pointerdown', 2);
    pointer(root, 'pointerup', 2);
    assert.deepEqual(states, [true, false, true, false]);
    cleanup();
  });
}

test('another pointer and non-primary buttons cannot steal or end the active drag', () => {
  const slider = new EventTarget();
  const root = new EventTarget();
  const states: boolean[] = [];
  const cleanup = trackPageSliderDrag(slider, root, value => states.push(value));
  pointer(slider, 'pointerdown', 1, true, 2);
  pointer(slider, 'pointerdown', 2, false);
  assert.deepEqual(states, []);
  pointer(slider, 'pointerdown', 3);
  pointer(slider, 'pointerdown', 4);
  pointer(root, 'pointercancel', 4);
  pointer(root, 'pointerup', 4);
  assert.deepEqual(states, [true]);
  pointer(root, 'pointerup', 3);
  assert.deepEqual(states, [true, false]);
  cleanup();
});

test('keyboard changes do not start a drag; cleanup ends a drag and detaches listeners', () => {
  const slider = new EventTarget();
  const root = new EventTarget();
  const states: boolean[] = [];
  const cleanup = trackPageSliderDrag(slider, root, value => states.push(value));
  slider.dispatchEvent(new Event('change'));
  assert.deepEqual(states, []);
  pointer(slider, 'pointerdown');
  cleanup();
  pointer(slider, 'pointerdown', 2);
  pointer(root, 'pointerup', 2);
  assert.deepEqual(states, [true, false]);
});
