import assert from 'node:assert/strict';
import test from 'node:test';
import { audioProgress } from '../src/playback-progress';
test('reports only known audio progress, bounded to the current segment', () => {
  assert.equal(audioProgress(null), null);
  assert.equal(audioProgress({duration:NaN,currentTime:0}), null);
  assert.equal(audioProgress({duration:Infinity,currentTime:1}), null);
  assert.equal(audioProgress({duration:0,currentTime:0}), null);
  assert.equal(audioProgress({duration:10,currentTime:3.5}), 35);
  assert.equal(audioProgress({duration:10,currentTime:12}), 100);
  assert.equal(audioProgress({duration:10,currentTime:-1}), 0);
});
