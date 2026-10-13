import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceNoticeSurface } from '../src/voice-notice-surface';

function setup(reduced = false) {
  const animations: {frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancelled: boolean; cancel: () => void}[] = [];
  let focused = false;
  const portrait = {getBoundingClientRect: () => ({left: 20, top: 760, width: 36, height: 36})};
  const anchor = {querySelector: () => portrait, getBoundingClientRect: () => ({left: 16}), focus: () => { focused = true; }};
  Object.assign(globalThis, {innerWidth: 390, innerHeight: 844, window: {addEventListener() {}}, document: {activeElement: {}}, matchMedia: () => ({matches: reduced})});
  const notice = {
    hidden: true, inert: false, style: {}, contains: () => true,
    getBoundingClientRect: () => ({left: 16, top: 500}),
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const animation = {frames, options, finished, finish, cancelled: false, cancel() { this.cancelled = true; }};
      animations.push(animation); return animation;
    }
  };
  const player = {querySelector: () => anchor, getBoundingClientRect: () => ({top: 740})};
  const surface = createVoiceNoticeSurface(notice as unknown as HTMLElement, player as unknown as HTMLElement);
  return {surface, notice, animations, focused: () => focused};
}

test('positions above playback and returns to the portrait, then hides and restores focus', async () => {
  const f = setup(); f.surface.show();
  assert.deepEqual(f.notice.style, {width: '358px', left: '16px', bottom: '116px', maxHeight: '712px'});
  f.surface.hide(true);
  assert.equal(f.notice.hidden, false); assert.equal(f.notice.inert, true); assert.equal(f.focused(), true);
  assert.match(String(f.animations[0].frames[1].transform), /translate\(22px, 278px\)/);
  f.surface.hide(true); assert.equal(f.animations.length, 1);
  f.animations[0].finish(); await Promise.resolve();
  assert.equal(f.notice.hidden, true);
});

test('new preparation cancels return and stale completion cannot hide the new notice', async () => {
  const f = setup(); f.surface.show(); f.surface.hide(true); f.surface.show();
  assert.equal(f.animations[0].cancelled, true); assert.equal(f.notice.inert, false);
  f.animations[0].finish(); await Promise.resolve(); assert.equal(f.notice.hidden, false);
});

test('reduced motion fades without spatial movement', () => {
  const f = setup(true); f.surface.show(); f.surface.hide(true);
  assert.deepEqual(f.animations[0].frames, [{opacity: 1}, {opacity: 0}]);
  assert.equal(f.animations[0].options.duration, 120);
});

test('cancellation hides immediately without a success animation', () => {
  const f = setup(); f.surface.show(); f.surface.hide(false);
  assert.equal(f.notice.hidden, true); assert.equal(f.animations.length, 0);
});
