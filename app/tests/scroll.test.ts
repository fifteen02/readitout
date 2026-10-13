import assert from "node:assert/strict";
import test from "node:test";
import { visiblePage } from "../src/scroll";

const bounds = (top: number, bottom: number) => ({ top, bottom, height: bottom - top });
const page = (n: number, top: number, bottom: number) => ({ dataset: { page: String(n) }, getBoundingClientRect: () => bounds(top, bottom) });
const viewer = { getBoundingClientRect: () => bounds(0, 800), querySelectorAll: () => [page(1, 100, 350), page(2, 380, 630)] } as unknown as HTMLElement;
const focus = (top: number, bottom: number, shown = true) => ({ page: 1, band: { classList: { contains: () => shown }, getBoundingClientRect: () => bounds(top, bottom) } as unknown as HTMLElement });

test("visible focused line owns the page counter even when another page crosses the viewport centre", () => {
  assert.equal(visiblePage(viewer, 1, focus(280, 300)), 1);
});

test("scrolling away from Focus or hiding its band restores normal visible-page tracking", () => {
  assert.equal(visiblePage(viewer, 1, focus(-40, -20)), 2);
  assert.equal(visiblePage(viewer, 1, focus(810, 830)), 2);
  assert.equal(visiblePage(viewer, 1, focus(280, 300, false)), 2);
  assert.equal(visiblePage(viewer, 1), 2);
});
