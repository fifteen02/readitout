import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureReadingVoice } from '../src/voice-readiness';

test('first Listen confirms and prepares before allowing playback', async () => {
  const calls: string[]=[];
  const ready=await ensureReadingVoice({enabled:()=>false,isCurrent:()=>true,
    confirm:async()=>{calls.push('confirm');return true;},prepare:async()=>{calls.push('prepare');}});
  if(ready) calls.push('play');
  assert.deepEqual(calls,['confirm','prepare','play']);
});
test('returning users do not see first-use confirmation', async () => {
  assert.equal(await ensureReadingVoice({enabled:()=>true,isCurrent:()=>true,
    confirm:async()=>{throw Error('unexpected dialog');},prepare:async()=>{throw Error('unexpected preparation');}}),true);
});
test('Not now and Escape never download or start playback', async () => {
  assert.equal(await ensureReadingVoice({enabled:()=>false,isCurrent:()=>true,
    confirm:async()=>false,prepare:async()=>{throw Error('unexpected download');}}),false);
});
test('a changed document or cancelled reading request cannot start a late download', async () => {
  let current=true;
  assert.equal(await ensureReadingVoice({enabled:()=>false,isCurrent:()=>current,
    confirm:async()=>{current=false;return true;},prepare:async()=>{throw Error('unexpected download');}}),false);
});
test('cancelling during preparation prevents delayed playback', async () => {
  let current=true;
  assert.equal(await ensureReadingVoice({enabled:()=>false,isCurrent:()=>current,
    confirm:async()=>true,prepare:async()=>{current=false;}}),false);
});
test('download failures propagate instead of starting playback', async () => {
  await assert.rejects(ensureReadingVoice({enabled:()=>false,isCurrent:()=>true,
    confirm:async()=>true,prepare:async()=>{throw Error('network failure');}}),/network failure/);
});
