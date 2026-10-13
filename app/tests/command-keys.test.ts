import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCommandKeys } from '../src/command-keys';

function palette() {
  const input = new EventTarget();
  const actions: (number | string)[] = [];
  bindCommandKeys(input as HTMLInputElement, {
    move: delta => actions.push(delta), run: () => actions.push('run'), close: () => actions.push('close')
  });
  return { actions, key(key: string, composition = {}) {
    const event = Object.assign(new Event('keydown', {cancelable: true}), {key, ...composition});
    let stopped = false;
    event.stopPropagation = () => { stopped = true; };
    input.dispatchEvent(event);
    return {event, stopped};
  }};
}

for (const composition of [{isComposing: true}, {isComposing: false, keyCode: 229}]) {
  test(`candidate keys cannot navigate, execute or dismiss commands (${JSON.stringify(composition)})`, () => {
    const p = palette();
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) {
      const result = p.key(key, composition);
      assert.equal(result.event.defaultPrevented, false);
      assert.equal(result.stopped, true);
    }
    assert.deepEqual(p.actions, []);
    p.key('Enter');
    assert.deepEqual(p.actions, ['run']);
  });
}

test('ordinary navigation, execution, dismissal and Tab stay within the palette', () => {
  const p = palette();
  for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape']) {
    const result = p.key(key);
    assert.equal(result.event.defaultPrevented, true);
    assert.equal(result.stopped, true);
  }
  assert.deepEqual(p.actions, [1, -1, 'run', 'close']);
});

test('normal typing and the palette toggle shortcut remain available', () => {
  const p = palette();
  for (const key of ['a', 'k', 'Backspace']) {
    const result = p.key(key);
    assert.equal(result.event.defaultPrevented, false);
    assert.equal(result.stopped, false);
  }
  assert.deepEqual(p.actions, []);
});
