import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { initAnnotationModal, type ModalEls } from '../src/annotation-modal';
import type { Annotation, AppState } from '../src/types';

class Control extends EventTarget {
  hidden = false;
  value = '';
  querySelectorAll() { return []; }
  contains() { return false; }
  children: Control[] = [];
  replaceChildren(...children: Control[]) { this.children = children; }
  focus() { (document as unknown as { activeElement: Element }).activeElement = this as unknown as Element; }
}

function setup(t: TestContext, text = '') {
  const doc = Object.assign(new EventTarget(), {
    body: { classList: { remove() {} } },
    activeElement: null as unknown as Element,
    createElement: () => new Control(),
    querySelector: () => null,
    getElementById: () => null,
  });
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const globals = {
    document: doc,
    window: {
      setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: (id: number) => timers.delete(id),
    },
    CSS: { escape: (s: string) => s },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const anno: Annotation = {
    id: 'highlight-1', type: 'highlight', page: 1, x: 0, y: 0, w: 10, h: 10,
    quote: 'A passage worth revisiting.', text, tags: ['review'], color: '#72d6a3',
    createdAt: '2026-10-11', updatedAt: '2026-10-11',
  };
  const state = { annotations: [anno], selectedId: anno.id } as AppState;
  const controls = Object.fromEntries(['overlay', 'meta', 'dot', 'quoteEl', 'colors', 'textarea', 'tags', 'suggest', 'saveBtn', 'deleteBtn', 'closeBtn'].map(key => [key, new Control()]));
  let deletes = 0;
  let saved: Annotation[] | undefined;
  initAnnotationModal(controls as unknown as ModalEls, state, {
    save: () => { saved = structuredClone(state.annotations); },
    renderList() {}, recolor() {},
    remove: () => { deletes++; state.annotations = []; state.selectedId = null; },
  });
  return {
    controls, state, anno, timers, doc,
    get deletes() { return deletes; }, get saved() { return saved; },
    escape(composition: { isComposing?: boolean; keyCode?: number } = {}) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', ...composition });
      doc.dispatchEvent(event);
      return event;
    },
  };
}

test('Escape preserves an existing highlight with tags and no comment', t => {
  const f = setup(t);
  assert.equal(f.escape().defaultPrevented, true);
  assert.equal(f.controls.overlay.hidden, true);
  assert.equal(f.deletes, 0);
  assert.deepEqual(f.state.annotations, [f.anno]);
  assert.deepEqual(f.anno.tags, ['review']);
});

test('clearing a comment and immediately escaping saves the empty comment, not a deletion', t => {
  const f = setup(t, 'Previous feedback');
  f.controls.textarea.value = '';
  f.controls.textarea.dispatchEvent(new Event('input'));
  assert.equal(f.timers.size, 1);
  f.escape();
  assert.equal(f.deletes, 0);
  assert.equal(f.saved?.[0].text, '');
  assert.equal(f.saved?.[0].quote, f.anno.quote);
  assert.equal(f.timers.size, 0);
});

test('Escape flushes pending tag edits when the comment is empty', t => {
  const f = setup(t);
  f.controls.tags.value = 'opening, character';
  f.controls.tags.dispatchEvent(new Event('input'));
  f.escape();
  assert.deepEqual(f.saved?.[0].tags, ['opening', 'character']);
  assert.equal(f.saved?.[0].color, '#72d6a3');
  assert.equal(f.deletes, 0);
});

test('Escape outside the editor leaves annotation state alone', t => {
  const f = setup(t);
  f.controls.overlay.hidden = true;
  assert.equal(f.escape().defaultPrevented, false);
  assert.equal(f.deletes, 0);
});

test('the explicit Delete action still removes the annotation', t => {
  const f = setup(t);
  f.controls.deleteBtn.dispatchEvent(new Event('click'));
  assert.equal(f.deletes, 1);
  assert.equal(f.controls.overlay.hidden, true);
  assert.deepEqual(f.state.annotations, []);
});


test('adding a suggested tag moves focus to Tags after removing the suggestion', t => {
  const f = setup(t);
  f.state.annotations.push({ ...f.anno, id: 'other-highlight', tags: ['character'] });
  f.controls.tags.value = 'review';
  f.controls.tags.dispatchEvent(new Event('input'));
  const suggestion = f.controls.suggest.children[0];
  assert.ok(suggestion);
  suggestion.focus();
  suggestion.dispatchEvent(new Event('click'));
  assert.deepEqual(f.anno.tags, ['review', 'character']);
  assert.equal(f.controls.tags.value, 'review, character');
  assert.equal(f.controls.suggest.children.length, 0);
  assert.equal(f.doc.activeElement, f.controls.tags);
  f.escape();
  assert.deepEqual(f.saved?.[0].tags, ['review', 'character']);
});

for (const composition of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
  test(`composition Escape leaves the note editor open (${JSON.stringify(composition)})`, t => {
    const f = setup(t, 'Original note');
    f.controls.textarea.value = '日本語のメモ';
    f.controls.textarea.dispatchEvent(new Event('input'));
    assert.equal(f.escape(composition).defaultPrevented, false);
    assert.equal(f.controls.overlay.hidden, false);
    assert.equal(f.timers.size, 1);
    assert.equal(f.saved, undefined);
    assert.equal(f.deletes, 0);
    assert.equal(f.escape().defaultPrevented, true);
    assert.equal(f.controls.overlay.hidden, true);
    assert.equal(f.saved?.[0].text, '日本語のメモ');
  });
}

test('composition keys in the editor do not bubble to reader shortcuts or suppress native input', t => {
  const f = setup(t);
  for (const key of ['Enter', 'Escape', 'Tab']) {
    const event = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { key, isComposing: true });
    let stopped = false;
    event.stopPropagation = () => { stopped = true; };
    f.controls.overlay.dispatchEvent(event);
    assert.equal(stopped, true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(f.controls.overlay.hidden, false);
  }
});


test('Escape in the editor saves and closes without reaching reader shortcuts', t => {
  const f = setup(t, 'Before');
  f.controls.textarea.value = 'After';
  f.controls.textarea.dispatchEvent(new Event('input'));
  let stopped = false;
  const event = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), {
    key: 'Escape', stopPropagation: () => { stopped = true; }
  });
  f.controls.overlay.dispatchEvent(event);
  assert.equal(stopped, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.controls.overlay.hidden, true);
  assert.equal(f.saved?.[0].text, 'After');
  assert.equal(f.timers.size, 0);
  assert.equal(f.deletes, 0);
});
