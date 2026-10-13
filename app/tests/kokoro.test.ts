import assert from 'node:assert/strict';
import test from 'node:test';
import { splitKokoroText, pcmToWav } from '../src/kokoro-audio';
import type { KokoroState } from '../src/browser-kokoro';

test('Kokoro splitting preserves every word and bounds long sentences', () => {
  const text = 'A sentence. ' + Array(150).fill('lighthouse').join(' ') + '. Another sentence!';
  const parts = splitKokoroText(text);
  assert.equal(parts.join(' '), text);
  assert.ok(parts.every(part => part.length <= 350));
  assert.deepEqual(splitKokoroText('   '), []);
  assert.throws(() => splitKokoroText('x'.repeat(351)), /long word/);
});
test('concatenated PCM produces a valid mono WAV with exact sample duration', () => {
  const wav = pcmToWav([new Float32Array([0, 1]), new Float32Array([-1, .5])]);
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24,true), 24000);
  assert.equal(view.getUint16(22,true), 1);
  assert.equal(view.getUint32(40,true), 8);
  assert.equal(view.getInt16(46,true), 32767);
  assert.equal(view.getInt16(48,true), -32768);
});

test('worker download cancellation, stale replies, generation abort, and retry', async () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: {data: unknown}) => void) | undefined;
    onerror: (() => void) | undefined;
    sent: {id: number; type: string}[] = [];
    terminated = false;
    constructor() { FakeWorker.instances.push(this); }
    postMessage(data: {id:number; type:string}) { this.sent.push(data); }
    terminate() { this.terminated = true; }
    respond(data: unknown) { this.onmessage?.({data}); }
  }
  const values = new Map<string,string>();
  Object.assign(globalThis, {Worker: FakeWorker, localStorage:{getItem:(k:string)=>values.get(k)||null, setItem:(k:string,v:string)=>values.set(k,v)}});
  const api = await import('../src/browser-kokoro');
  let observed: KokoroState = {phase:'idle', message:''};
  const unsubscribe = api.onKokoroState(state => observed = state);
  const first = api.prepareBrowserKokoro();
  const rejected = assert.rejects(first, {name:'AbortError'});
  const old = FakeWorker.instances.at(-1)!;
  old.respond({type:'model-status', stage:'downloading', message:'Downloading reading voice…', progress:42.5});
  assert.equal(observed.phase, 'loading');
  assert.equal(observed.progress, 42.5);
  old.respond({type:'model-status', stage:'downloading', message:'Downloading reading voice…', progress:102});
  assert.equal(observed.progress, 100);
  old.respond({type:'model-status', stage:'preparing', message:'Preparing your reading voice…', progress:NaN});
  assert.equal(observed.stage, 'preparing');
  assert.equal(observed.progress, undefined);
  api.cancelBrowserKokoro(); await rejected;
  assert.ok(old.terminated);
  assert.equal(observed.phase, 'idle');
  assert.equal(observed.stage, undefined);
  const retry = api.prepareBrowserKokoro();
  const current = FakeWorker.instances.at(-1)!;
  old.respond({type:'model-status', stage:'downloading', message:'Stale progress', progress:95});
  old.respond({type:'ready'}); assert.equal(observed.phase, 'loading');
  assert.equal(observed.stage, 'checking');
  current.respond({type:'ready'}); current.respond({id:current.sent[0].id});
  await retry; assert.equal(api.browserKokoroEnabled(), true);
  assert.equal(observed.phase, 'ready');
  assert.equal(observed.progress, undefined);
  current.respond({type:'status', message:'Preparing speech on this device… 1/2'});
  assert.equal(observed.phase, 'ready');
  assert.match(observed.message, /Voice ready/);
  const controller = new AbortController();
  const generation = api.generateBrowserSpeech('A passage.', 'af_heart', controller.signal);
  const sibling = api.generateBrowserSpeech('Already buffering.', 'af_heart');
  const siblingId = current.sent.at(-1)!.id;
  const aborted = assert.rejects(generation, {name:'AbortError'});
  controller.abort(); await aborted; assert.equal(current.terminated, false, 'utterance cancellation keeps the warmed model');
  assert.equal(current.sent.at(-1)?.type, 'cancel');
  current.respond({id:siblingId, buffer:pcmToWav([new Float32Array([0,.5])])});
  assert.equal((await sibling).size,48,'cancelling foreground work preserves pending lookahead');
  const speech = api.generateBrowserSpeech('A passage.', 'af_heart');
  assert.equal(observed.phase, 'ready', 'generation resumes without reloading the model');
  const next = FakeWorker.instances.at(-1)!;
  next.respond({type:'ready'});
  assert.equal(next, current);
  next.respond({id:next.sent.at(-1)!.id, buffer:pcmToWav([new Float32Array([0,.5])])});
  const blob = await speech;
  assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 48);
  api.cancelBrowserKokoro(); unsubscribe();
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(api.generateBrowserSpeech('A passage.', 'af_heart', alreadyCancelled.signal), {name:'AbortError'});
  const readState = api.onKokoroState(value => assert.equal(value.phase, 'idle', 'an already-aborted request must not start loading'));
  readState();
});
