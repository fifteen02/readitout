import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionPopoverPosition } from '../src/selection-popover';

const anchor = { left: 200, top: 600, bottom: 624, width: 100 };
const size = { width: 351, height: 125 };

test('keyboard shrinking the viewport brings the entire toolbar above its bottom edge', () => {
  const full = selectionPopoverPosition(anchor, size, { left: 0, top: 0, width: 375, height: 812 });
  const keyboard = selectionPopoverPosition(anchor, size, { left: 0, top: 0, width: 375, height: 380 });
  assert.equal(full.top, 467);
  assert.equal(keyboard.top + size.height, 372);
  assert.ok(keyboard.left >= 8 && keyboard.left + size.width <= 367);
});

test('panned visual viewport uses its visible origin when selection is off screen', () => {
  const position = selectionPopoverPosition({ ...anchor, left: 0, top: 20, bottom: 40 }, size,
    { left: 100, top: 300, width: 375, height: 380 });
  assert.deepEqual(position, { left: 108, top: 308 });
});

test('a selection at the top opens below and stays inside the right edge', () => {
  const position = selectionPopoverPosition({ left: 360, top: 20, bottom: 44, width: 10 }, size,
    { left: 0, top: 0, width: 375, height: 812 });
  assert.deepEqual(position, { left: 16, top: 52 });
});
