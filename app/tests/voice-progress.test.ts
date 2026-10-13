import assert from 'node:assert/strict';
import test from 'node:test';
import {TransferEstimator, speechSecondsLeft} from '../src/voice-progress';
test('does not invent an ETA from a first sample', () => {
  const stats = new TransferEstimator(); stats.sample(100,1000,0);
  assert.deepEqual(stats.read(500), {});
});
test('estimates from measured transfer and suppresses stalled samples', () => {
  const stats = new TransferEstimator(); stats.sample(100,1000,0); stats.sample(300,1000,2000);
  assert.deepEqual(stats.read(2000), {bytesPerSecond:100, secondsLeft:7});
  assert.deepEqual(stats.read(8000), {});
});
test('a restarted download cannot reuse an old speed', () => {
  const stats = new TransferEstimator(); stats.sample(100,1000,0); stats.sample(300,1000,2000);
  stats.sample(0,1000,3000); assert.deepEqual(stats.read(3000), {});
});
test('speech estimates need completed work, including unequal part lengths', () => {
  assert.equal(speechSecondsLeft(0,1000,4000), undefined);
  assert.equal(speechSecondsLeft(250,1000,4000),12);
  assert.equal(speechSecondsLeft(1000,1000,4000),undefined);
});
