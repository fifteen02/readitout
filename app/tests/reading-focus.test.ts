import assert from "node:assert/strict";
import test from "node:test";
import { createReadingFocus, type LineRect } from "../src/reading-focus";

globalThis.cancelAnimationFrame = () => {};
globalThis.window = { matchMedia: () => ({ matches: true }) } as unknown as Window & typeof globalThis;

const line = (text: string, top = 20): LineRect => ({ text, top, left: 10, width: 100, height: 20 });
function layer() {
  const classes = new Set<string>();
  const band = { style: {}, classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
    toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name)
  }};
  return { band, classes, element: { querySelector: () => band, getBoundingClientRect: () => ({ top: 0, left: 0 }) } as unknown as HTMLElement };
}

test("opening another document releases the old focus page and selects its new text", () => {
  const focus = createReadingFocus({ getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement);
  const old = layer();
  focus.registerPage(2, old.element, [line("Old document")]);
  focus.setEnabled(true);
  assert.equal(focus.current()?.text, "Old document");
  focus.clearPages();
  assert.equal(focus.current(), null);
  assert.equal(old.classes.has("show"), false);
  const fresh = layer();
  focus.registerPage(1, fresh.element, [line("New document")]);
  assert.equal(focus.current()?.page, 1);
  assert.equal(focus.current()?.text, "New document");
});

test("page rebuild waits for replacement geometry and clamps a shorter line list", () => {
  const focus = createReadingFocus({ getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement);
  focus.registerPage(1, layer().element, [line("First"), line("Second", 50)]);
  focus.setEnabled(true);
  focus.focusAtPoint(1, 55);
  focus.clearPages(true);
  assert.equal(focus.current(), null);
  focus.registerPage(1, layer().element, [line("Replacement")]);
  assert.equal(focus.current()?.text, "Replacement");
});

test("line navigation skips blank pages in both directions and ignores clicks on them", () => {
  const focus = createReadingFocus({ scrollTop: 0, getBoundingClientRect: () => ({ top: 0, height: 600 }) } as unknown as HTMLElement);
  focus.registerPage(1, layer().element, [line("Before the blank page")]);
  focus.registerPage(2, layer().element, []);
  focus.registerPage(3, layer().element, [line("After the blank page")]);
  focus.setEnabled(true);
  focus.move(1);
  assert.equal(focus.current()?.page, 3);
  assert.equal(focus.current()?.text, "After the blank page");
  focus.focusAtPoint(2, 50);
  assert.equal(focus.current()?.page, 3);
  focus.move(-1);
  assert.equal(focus.current()?.page, 1);
  assert.equal(focus.current()?.text, "Before the blank page");
});
