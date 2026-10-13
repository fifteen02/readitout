import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReadingPages } from '../src/reading-start';
import type { ReadItem } from '../src/types';

test('changing document or cancelling during extraction cannot start old speech or read another page', async () => {
  let current = true, finish!: (items: ReadItem[]) => void;
  const pages: number[] = [];
  const pending = collectReadingPages(1, 3, page => {
    pages.push(page); return new Promise(resolve => { finish = resolve; });
  }, () => current);
  current = false;
  finish([{page:1, text:'Old manuscript'}]);
  assert.equal(await pending, null);
  assert.deepEqual(pages, [1]);
});

test('stale failures are ignored, current failures remain actionable', async () => {
  let current = true, fail!: (error: Error) => void;
  const pending = collectReadingPages(1, 1, () => new Promise((_, reject) => { fail = reject; }), () => current);
  current = false; fail(new Error('old failure'));
  assert.equal(await pending, null);
  await assert.rejects(collectReadingPages(1, 1, async () => { throw new Error('current failure'); }, () => true), /current failure/);
});

test('current requests preserve page order and skip empty pages', async () => {
  assert.deepEqual(await collectReadingPages(1, 3, async page => page === 2 ? [] : [{page,text:`Page ${page}`}], () => true),
    [{page:1,text:'Page 1'},{page:3,text:'Page 3'}]);
});
