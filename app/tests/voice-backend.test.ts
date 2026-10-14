import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceBackend, voiceDevice, type VoiceDevice } from '../src/voice-backend';

test('GPU selection requires a usable adapter; missing, null and rejected probes use CPU', async () => {
  assert.equal(await voiceDevice(), 'wasm');
  assert.equal(await voiceDevice({requestAdapter: async () => null}), 'wasm');
  assert.equal(await voiceDevice({requestAdapter: async () => { throw Error('blocked'); }}), 'wasm');
  assert.equal(await voiceDevice({requestAdapter: async () => ({})}), 'webgpu');
});
for (const failure of ['load', 'generate']) test(`GPU ${failure} failure retries on CPU and stays there`, async () => {
  const loaded: VoiceDevice[] = []; const disposed: VoiceDevice[] = [];
  const run = voiceBackend({
    device: async () => 'webgpu',
    load: async device => { loaded.push(device); if (device === 'webgpu' && failure === 'load') throw Error('load'); return device; },
    dispose: async device => { disposed.push(device); }, fallback: () => {},
  });
  assert.equal(await run(async device => { if (device === 'webgpu') throw Error('GPU lost'); return 'audio'; }), 'audio');
  assert.equal(await run(async device => device), 'wasm');
  assert.deepEqual(loaded, ['webgpu', 'wasm']);
  assert.deepEqual(disposed, failure === 'generate' ? ['webgpu'] : []);
});
test('CPU errors propagate without repeated retries', async () => {
  let attempts = 0;
  const run = voiceBackend({device: async () => 'wasm', load: async () => { attempts++; throw Error('offline'); }, dispose: async () => {}, fallback: () => { assert.fail(); }});
  await assert.rejects(run(async () => 'audio'), /offline/);
  assert.equal(attempts, 1);
});
