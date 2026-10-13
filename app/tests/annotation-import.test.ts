import assert from "node:assert/strict";
import test from "node:test";
import { validImportedAnnotations, readAnnotationBackup } from "../src/annotation-import";

const note = { id: "test-note", type: "highlight", page: 1, x: .1, y: .2, w: .5, h: .03,
  text: "Check this sentence", color: "#ffd240", createdAt: "2026-10-10", updatedAt: "2026-10-10" };

test("accepts exported notes and optional fields without changing them", () => {
  const notes = [{ ...note, quote: "A passage", done: false, tags: ["revision"], rects: [{ x: .1, y: .2, w: .5, h: .03 }] }];
  const before = structuredClone(notes);
  assert.equal(validImportedAnnotations(notes, 2), true);
  assert.deepEqual(notes, before);
  assert.equal(validImportedAnnotations([], 2), true);
});

test("rejects malformed content before sidebar string and array operations", () => {
  for (const patch of [{ text: 7 }, { quote: {} }, { tags: "revision" }, { tags: [3] }, { done: "false" }, { id: "" }, { color: null }, { createdAt: 7 }]) {
    assert.equal(validImportedAnnotations([{ ...note, ...patch }], 2), false, JSON.stringify(patch));
  }
});

test("rejects invalid geometry, page targets and duplicate identities as a whole", () => {
  for (const patch of [{ x: NaN }, { w: -1 }, { page: 0 }, { page: 3 }, { page: 1.5 }, { rects: [null] }, { rects: [] }, { rects: [{ x: 0, y: 0, w: Infinity, h: .1 }] }]) {
    assert.equal(validImportedAnnotations([note, { ...note, id: "second", ...patch }], 2), false);
  }
  assert.equal(validImportedAnnotations([note, note], 2), false);
  for (const value of [null, {}, [null]]) assert.equal(validImportedAnnotations(value, 2), false);
});


test("a delayed backup cannot apply after switching documents or starting a newer import", async () => {
  for (const change of ["document", "import"]) {
    let documentVersion = 1, importVersion = 1;
    let finish!: (text: string) => void;
    const pending = readAnnotationBackup({ text: () => new Promise(resolve => { finish = resolve; }) }, 2,
      () => documentVersion === 1 && importVersion === 1);
    if (change === "document") documentVersion++; else importVersion++;
    finish(JSON.stringify({ annotations: [note] }));
    assert.deepEqual(await pending, { kind: "stale" });
  }
});

test("stale read failures do not surface errors in a different document", async () => {
  let current = true;
  let fail!: (error: Error) => void;
  const pending = readAnnotationBackup({ text: () => new Promise((_, reject) => { fail = reject; }) }, 2, () => current);
  current = false;
  fail(new Error("read failed"));
  assert.deepEqual(await pending, { kind: "stale" });
});

test("current imports retain full validation and return their original notes", async () => {
  const read = (text: string) => readAnnotationBackup({ text: async () => text }, 2, () => true);
  assert.deepEqual(await read(JSON.stringify({ annotations: [note] })), { kind: "ready", annotations: [note] });
  for (const value of ["{", "{}", JSON.stringify({ annotations: [{ ...note, page: 3 }] })]) {
    assert.equal((await read(value)).kind, "error");
  }
});


test("an unavailable document does not start reading a backup", async () => {
  let reads = 0;
  const result = await readAnnotationBackup({ text: async () => { reads++; return "{}"; } }, 2, () => false);
  assert.deepEqual(result, { kind: "stale" });
  assert.equal(reads, 0);
});
