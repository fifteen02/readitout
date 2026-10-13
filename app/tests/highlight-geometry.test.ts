import assert from "node:assert/strict";
import test from "node:test";
import { alignHighlightBoxes, padHighlightBottom } from "../src/highlight-geometry";

const line = { x: .12, y: .28, w: .72, h: .026 };
test("removes legacy focus padding without moving the saved annotation", () => {
  const box = { x: .115, y: .277, w: .73, h: .04 };
  const before = { ...box };
  assert.deepEqual(alignHighlightBoxes([box], [line]), [line]);
  assert.deepEqual(box, before);
});
test("retains a partial selection's horizontal range", () => {
  const box = { x: .2, y: .277, w: .3, h: .04 };
  assert.deepEqual(alignHighlightBoxes([box], [line]), [{ ...line, x: .2, w: .3 }]);
});
test("splits paragraph bounds into lines without painting the gap or adjacent column", () => {
  const next = { ...line, y: .32, w: .5 };
  const otherColumn = { ...line, x: .9, w: .08 };
  const result = alignHighlightBoxes([{ x: .115, y: .277, w: .73, h: .075 }], [line, next, otherColumn]);
  assert.equal(result.length, 2);
  assert.equal(result[0].y, line.y);
  assert.equal(result[1].y, next.y);
  assert.ok(result[0].y + result[0].h < result[1].y);
});
test("keeps unmatched bounds on pages without selectable text", () => {
  assert.deepEqual(alignHighlightBoxes([line], []), [line]);
});
test("keeps a rotated partial selection short while snapping its cross-line width", () => {
  const run = { x: .4, y: .2, w: .03, h: .6, vertical: true };
  const selection = { x: .395, y: .35, w: .04, h: .1 };
  const aligned = alignHighlightBoxes([selection], [run]);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].x, .4);
  assert.equal(aligned[0].w, .03);
  assert.equal(aligned[0].y, .35);
  assert.ok(Math.abs(aligned[0].h - .1) < .00001);
});


test("duplicate range rectangles paint one coat per line", () => {
  const result = alignHighlightBoxes([line, { ...line }], [line]);
  assert.equal(result.length, 1);
  assert.ok(Math.abs(result[0].w - line.w) < 1e-10);
});
test("overlapping partial ranges merge without filling an unselected gap", () => {
  const result = alignHighlightBoxes([
    { ...line, x: .2, w: .2 }, { ...line, x: .3, w: .2 }, { ...line, x: .6, w: .1 }
  ], [line]);
  assert.equal(result.length, 2);
  assert.equal(result[0].x, .2);
  assert.ok(Math.abs(result[0].w - .3) < 1e-10);
  assert.equal(result[1].x, .6);
});
test("a bridging rectangle merges both neighbours irrespective of range order", () => {
  const result = alignHighlightBoxes([
    { ...line, x: .2, w: .1 }, { ...line, x: .4, w: .1 }, { ...line, x: .3, w: .1 }
  ], [line]);
  assert.equal(result.length, 1);
  assert.ok(Math.abs(result[0].w - .3) < 1e-10);
});

test("descender padding preserves selection width and leaves space before the next line", () => {
  const before = { ...line };
  const next = { ...line, y: line.y + line.h + .004 };
  const padded = padHighlightBottom(line, [line, next]);
  assert.ok(padded.h > line.h);
  assert.ok(padded.y + padded.h < next.y);
  assert.equal(padded.x, line.x);
  assert.equal(padded.w, line.w);
  assert.deepEqual(line, before);
  assert.deepEqual(padHighlightBottom(line, []), line);
  assert.deepEqual(padHighlightBottom(line, [{...line, vertical:true}]), line);
});
