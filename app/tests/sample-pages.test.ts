import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePageAt } from '../src/sample-pages';

test('wrapped sentence fragments map to complete leaves, including backwards', () => {
  assert.equal(samplePageAt(0, 304, 4), 0);
  assert.equal(samplePageAt(305, 304, 4), 1);
  assert.equal(samplePageAt(620, 304, 4), 2);
  assert.equal(samplePageAt(10, 304, 4), 0);
  assert.equal(samplePageAt(-2, 304, 4), 0);
  assert.equal(samplePageAt(2000, 304, 4), 3);
});
