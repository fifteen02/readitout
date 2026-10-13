import assert from "node:assert/strict";
import test from "node:test";
import { textRunGeometry } from "../src/text-run-geometry";
import { textLines } from "../src/read-markers";
import type { PdfjsLib } from "../src/lib/pdfjs";
import type { PdfViewport } from "../src/types";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} != ${expected}`);
test("quarter-turn text occupies a vertical box on either side of its baseline", () => {
  const up = textRunGeometry([0, -18, -18, 0, 220, 495], 120);
  near(up.x, 202); near(up.y, 375); near(up.w, 18); near(up.h, 120);
  const down = textRunGeometry([0, 18, 18, 0, 220, 100], 120);
  near(down.x, 220); near(down.y, 100); near(down.w, 18); near(down.h, 120);
});
test("horizontal and half-turn runs keep their full advance bounds", () => {
  const flat = textRunGeometry([18, 0, 0, -18, 40, 100], 120);
  near(flat.x, 40); near(flat.y, 82); near(flat.w, 120); near(flat.h, 18);
  const reverse = textRunGeometry([-18, 0, 0, 18, 220, 100], 120);
  near(reverse.x, 100); near(reverse.y, 100); near(reverse.w, 120); near(reverse.h, 18);
});
test("rotated word fragments form a readable line and separate parallel lines", () => {
  const pdf = { Util: { transform: (_a: number[], b: number[]) => b } } as PdfjsLib;
  const viewport = { transform: [], scale: 1 } as unknown as PdfViewport;
  const run = (str: string, x: number, y: number) => ({ str, width: 40, transform: [0,-18,-18,0,x,y] });
  const lines = textLines(pdf, {items: [run("Second",220,440),run("First",220,495),run("Next line",250,495)]}, viewport);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "First Second");
  near(lines[0].w, 18); near(lines[0].height!, 95);
  assert.equal(lines[1].text, "Next line");
});
