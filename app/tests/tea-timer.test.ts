import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPomodoro } from '../src/pomodoro';

test('tea follows elapsed time, pauses, empties at a boundary, and refills on start/reset', () => {
  class Element extends EventTarget {
    textContent = ''; value = ''; hidden = false; title = ''; open = false;
    showModal() { this.open = true; }
    close() { this.open = false; }
    attributes = new Map<string, string>(); properties = new Map<string, string>(); classes = new Set<string>();
    options = ['1', '15', '25', '45', '60', 'custom', 'off'].map(value => ({value}));
    classList = { toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name) };
    style = { setProperty: (name: string, value: string) => this.properties.set(name, value) };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    querySelector() { return {textContent: '', hidden: true}; }
    contains() { return false; }
    focus() {}
    click() { this.dispatchEvent(new Event('click')); }
  }
  const ids = ['pomodoro','pomoTime','pomoLabel','pomoToggle','pomoReset','pomoLength','pomoFocusMin','pomoBreakMin','pomoSound','pomoSoundPreview','teaTimer','teaControls','teaCaption','teaAnnouncement','teaClose','teaComplete','teaCompleteTitle','teaCompleteDescription','teaCompleteStart','teaCompleteLater'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const el = (id: string) => elements.get(id)!;
  el('pomoSound').value = 'off';
  let now = 0, sequence = 0;
  const timers = new Map<number, () => void>();
  const doc = Object.assign(new EventTarget(), { hidden: false, activeElement: null, getElementById: (id: string) => el(id) });
  const originals = {document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, now: Date.now};
  Object.assign(globalThis, {document: doc, window: {setInterval: (fn: () => void) => {timers.set(++sequence, fn); return sequence;}, clearInterval: (id: number) => timers.delete(id)}, localStorage: {getItem: () => null, setItem: () => {}}});
  Date.now = () => now;
  // Simulate long gaps between callbacks, as happens in a background tab.
  const advance = (ms: number) => { now += ms; [...timers.values()].forEach(fn => fn()); };
  try {
    initPomodoro();
    el('pomoLength').value = '1'; el('pomoLength').dispatchEvent(new Event('change'));
    assert.equal(el('pomodoro').properties.get('--tea-level'), '1');
    el('pomoToggle').click(); advance(30000);
    assert.equal(el('pomoTime').textContent, '0:30');
    assert.equal(el('pomodoro').properties.get('--tea-level'), '0.5');
    el('pomoToggle').click(); advance(60000);
    assert.equal(el('pomoTime').textContent, '0:30');
    assert.equal(el('teaCaption').textContent, 'Paused');
    el('pomoToggle').click(); advance(31000);
    assert.equal(el('teaCaption').textContent, 'Break ready');
    assert.equal(el('pomodoro').properties.get('--tea-level'), '0');
    assert.match(el('teaAnnouncement').textContent, /Reading session complete/);
    assert.equal(el('teaComplete').open, true);
    assert.equal(el('teaCompleteTitle').textContent, 'Time for a break');
    el('teaCompleteLater').click();
    assert.equal(el('teaComplete').open, false);
    assert.equal(el('teaCaption').textContent, 'Break ready');
    advance(60000);
    assert.equal(el('pomoTime').textContent, '3:00');
    el('pomoToggle').click();
    assert.equal(el('pomodoro').properties.get('--tea-level'), '1');
    assert.equal(el('teaCaption').textContent, 'Break time');
    advance(180000);
    assert.equal(el('teaComplete').open, true);
    assert.equal(el('teaCompleteTitle').textContent, 'Your break is complete');
    assert.equal(el('teaCompleteStart').textContent, 'Start reading timer');
    el('teaCompleteStart').click();
    assert.equal(el('teaComplete').open, false);
    assert.equal(el('teaCaption').textContent, 'Reading time');
    advance(60000);
    assert.equal(el('teaComplete').open, true);
    el('pomoReset').click();
    assert.equal(el('teaComplete').open, false);
    assert.equal(el('pomoTime').textContent, '1:00');
    assert.equal(el('teaCaption').textContent, 'Tea timer');
    assert.equal(timers.size, 0);
  } finally { Object.assign(globalThis, {document: originals.document, window: originals.window, localStorage: originals.localStorage}); Date.now = originals.now; }
});
