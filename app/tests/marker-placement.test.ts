import assert from 'node:assert/strict';
import test from 'node:test';
import { markerPlacement } from '../src/marker-placement';

function clearOfText(left: number, right: number, width: number) {
  const result = markerPlacement(left, right, width);
  assert.ok(result, 'expected usable gutters');
  for (const x of [result.play, result.tag]) {
    assert.ok(x >= 2 && x + 28 <= width - 2, 'control stays inside paper');
    assert.ok(x + 28 <= left - 2 || x >= right + 2, 'control clears text');
  }
  assert.ok(Math.abs(result.play - result.tag) >= 28, 'controls do not overlap');
  return result;
}

test('phone sample puts actions in opposite margins instead of covering prose', () => {
  const placement = clearOfText(32.4, 252.6, 285);
  assert.ok(placement.play < 32.4 && placement.tag > 252.6);
});
test('wide paper preserves the left-hand pair', () => {
  assert.deepEqual(clearOfText(110, 850, 960), {play:40, tag:73});
});
test('uses the right gutter when the left cannot hold one action', () => {
  const placement = clearOfText(12, 200, 285);
  assert.ok(placement.play > 200);
});
test('exact minimum gutters still clear text', () => {
  clearOfText(32, 253, 285);
});
test('does not claim a safe fit on borderless or too-narrow paper', () => {
  assert.equal(markerPlacement(0, 285, 285), null);
  assert.equal(markerPlacement(31.9, 253.1, 285), null);
});
