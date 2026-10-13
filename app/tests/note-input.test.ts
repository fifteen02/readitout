import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNoteInputKeys } from '../src/note-input';

function editor() {
  const input = Object.assign(new EventTarget(), { value: ' 日本語のメモ ' });
  const submitted: string[] = [];
  let dismissed = false;
  bindNoteInputKeys(input as unknown as HTMLInputElement, text => submitted.push(text), () => { dismissed = true; });
  return { input, submitted, get dismissed() { return dismissed; },
    key(key: string, extra = {}) {
      const event = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { key, ...extra });
      let stopped = false;
      event.stopPropagation = () => { stopped = true; };
      input.dispatchEvent(event);
      return { event, stopped };
    }
  };
}

for (const extra of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
  test(`candidate confirmation and cancellation preserve the draft (${JSON.stringify(extra)})`, () => {
    const f = editor();
    for (const key of ['Enter', 'Escape']) {
      const { event, stopped } = f.key(key, extra);
      assert.equal(event.defaultPrevented, false);
      assert.equal(stopped, true);
      assert.deepEqual(f.submitted, []);
      assert.equal(f.dismissed, false);
      assert.equal(f.input.value, ' 日本語のメモ ');
    }
    f.key('Enter');
    assert.deepEqual(f.submitted, ['日本語のメモ']);
  });
}

test('ordinary Escape dismisses without submitting, while typing remains native', () => {
  const f = editor();
  assert.equal(f.key('a').event.defaultPrevented, false);
  const { event, stopped } = f.key('Escape');
  assert.equal(event.defaultPrevented, true);
  assert.equal(stopped, true);
  assert.equal(f.dismissed, true);
  assert.deepEqual(f.submitted, []);
});

test('ordinary Enter submits a trimmed value once, including empty highlight-only notes', () => {
  const f = editor();
  assert.equal(f.key('Enter').event.defaultPrevented, true);
  f.input.value = '  ';
  f.key('Enter');
  assert.deepEqual(f.submitted, ['日本語のメモ', '']);
  assert.equal(f.dismissed, false);
});
