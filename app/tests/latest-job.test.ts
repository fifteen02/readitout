import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestJobQueue } from '../src/latest-job';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('slow document cannot overwrite the latest selection; intermediate selection is skipped', async () => {
  const queue = createLatestJobQueue(), read = deferred(), started = deferred();
  const events: string[] = [];
  const first = queue(async current => {
    events.push('first:start'); started.resolve(); await read.promise;
    if (current()) events.push('first:commit');
    events.push('first:finish');
  });
  await started.promise;
  const second = queue(async () => { events.push('second:commit'); });
  const third = queue(async current => { assert.equal(current(), true); events.push('third:commit'); });
  read.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ['first:start', 'first:finish', 'third:commit']);
});

test('failure does not poison later document loads', async () => {
  const queue = createLatestJobQueue();
  await assert.rejects(queue(async () => { throw new Error('bad PDF'); }), /bad PDF/);
  let loaded = false;
  await queue(async current => { loaded = current(); });
  assert.equal(loaded, true);
});
