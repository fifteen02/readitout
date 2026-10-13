import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechBuffer } from '../src/speech-buffer';
import { pcmToWav } from '../src/kokoro-audio';
import { chunkText } from '../src/audio-playback';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('fills four ahead without waiting for playback, stays bounded and ordered', async () => {
  const items = Array.from({length:12}, (_, n) => ({text:`Passage ${n}`, page:1}));
  const generated: string[] = [];
  const buffer = new SpeechBuffer(async () => items.shift() ?? null, async item => {
    generated.push(item.text); return new Blob([item.text]);
  });
  const first = await buffer.take(); await flush();
  assert.equal(first?.item.text, 'Passage 0');
  assert.equal(generated.length, 5, 'current plus four upcoming generated before onended');
  assert.equal(buffer.upcoming().length, 4);
  assert.equal(await (await first!.audio).blob!.text(), 'Passage 0');
  for (let n=1; n<12; n++) {
    const entry = await buffer.take();
    assert.equal(entry?.item.text, `Passage ${n}`);
    assert.equal(await (await entry!.audio).blob!.text(), `Passage ${n}`);
    assert.ok(buffer.upcoming().length <= 4);
  }
  assert.equal(await buffer.take(), null);
  buffer.dispose();
});

test('cancelling current speech preserves upcoming audio; dispose cancels the rest', async () => {
  const signals: AbortSignal[] = [];
  const items = Array.from({length:8}, (_, n) => ({text:String(n)}));
  const buffer = new SpeechBuffer(async () => items.shift() ?? null, (item, signal) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      if (item.text === '1') resolve(new Blob(['next']));
      else signal.addEventListener('abort', () => reject(new DOMException('Cancelled','AbortError')), {once:true});
    });
  });
  const first = await buffer.take(); await flush();
  first!.controller.abort();
  assert.equal((await first!.audio).error instanceof DOMException, true);
  assert.equal(signals[1].aborted, false);
  const second = await buffer.take();
  assert.equal(await (await second!.audio).blob!.text(), 'next');
  buffer.dispose();
  assert.ok(signals.filter((_, n) => n !== 1).every(signal => signal.aborted));
  assert.equal(await buffer.take(), null);
});

test('late page extraction after disposal cannot generate audio', async () => {
  let complete!: (item: {text:string}) => void;
  let generated = 0;
  const buffer = new SpeechBuffer(() => new Promise(resolve => complete = resolve), async () => {
    generated++; return new Blob();
  });
  const taking = buffer.take(); buffer.dispose(); complete({text:'late page'});
  assert.equal(await taking, null);
  assert.equal(generated, 0);
  assert.deepEqual(buffer.upcoming(), []);
});

test('future extraction and synthesis failures wait for their turn', async () => {
  let n=0;
  const buffer = new SpeechBuffer(async () => {
    if (n++ === 0) return {text:'first'};
    throw Error('page unavailable');
  }, async () => new Blob(['first']));
  assert.equal(await (await (await buffer.take())!.audio).blob!.text(), 'first');
  await assert.rejects(buffer.take(), /page unavailable/);
  const failed = new SpeechBuffer(async () => ({text:'bad'}), async () => {throw Error('synthesis failed');}, 1);
  assert.match(String((await (await failed.take())!.audio).error), /synthesis failed/);
  failed.dispose();
});

test('bounded speech units preserve every word and page/marker metadata', () => {
  const text = 'A short opening. ' + Array(100).fill('lighthouse').join(' ') + '.';
  const units = chunkText(text, {page:3,markerId:'3:1'});
  assert.equal(units.map(item=>item.text).join(' '), text);
  assert.ok(units.every(item=>item.text.length <= 350 && item.page === 3 && item.markerId === '3:1'));
});

test('ready audio is available without waiting for a slow future page extraction', async () => {
  let n=0;
  let release!:()=>void;
  const buffer=new SpeechBuffer(async()=>{
    if(n++===0) return {text:'Ready now.'};
    await new Promise<void>(resolve=>release=resolve);return null;
  },async()=>new Blob(['audio']));
  const first=await buffer.take();
  assert.equal(first?.item.text,'Ready now.');
  assert.equal(await (await first!.audio).blob!.text(),'audio');
  buffer.dispose();release();
});

test('unsupported unbroken text reaches the normal playback error path', () => {
  const text='x'.repeat(351);
  assert.deepEqual(chunkText(text,{page:1}),[{page:1,text}]);
});

test('startup reserve waits for actual next audio, not merely queued synthesis', async () => {
  const items = [{text:'First.'},{text:'Longer second.'}];
  let complete!: (blob: Blob) => void;
  const buffer = new SpeechBuffer(async()=>items.shift() ?? null, async item =>
    item.text === 'First.' ? new Blob(['first']) : new Promise<Blob>(resolve=>complete=resolve));
  await (await buffer.take())!.audio;
  let ready=false;
  const reserve=buffer.prepareAhead().then(()=>{ready=true;});
  await flush(); assert.equal(ready,false);
  complete(new Blob(['second'])); await reserve;
  assert.equal(await (await (await buffer.take())!.audio).blob!.text(),'second');
  buffer.dispose();
});

test('stop releases startup reserve even if synthesis has not settled', async () => {
  let n=0;
  const buffer=new SpeechBuffer(async()=>n++<2?{text:String(n)}:null,
    async item=>item.text==='1'?new Blob():new Promise<Blob>(()=>{}));
  await (await buffer.take())!.audio;
  const reserve=buffer.prepareAhead();
  buffer.dispose(); await reserve;
});

const wav = (seconds: number) => new Blob([pcmToWav([new Float32Array(seconds * 24000)])]);

test('duration reserve waits for twenty seconds and counts only completed audio', async () => {
  const items = Array.from({length: 8}, (_, n) => ({text: String(n)}));
  const complete = new Map<string, (blob: Blob) => void>();
  const buffer = new SpeechBuffer(async () => items.shift() ?? null, item => new Promise(resolve => complete.set(item.text, resolve)));
  const first = await buffer.take(); await flush();
  complete.get('0')!(wav(5)); await first!.audio;
  let started = false;
  const reserve = buffer.prepareAhead(first!.seconds).then(() => { started = true; });
  complete.get('2')!(wav(5)); await flush();
  assert.equal(buffer.readySeconds(), 0, 'cannot count audio beyond a pending gap');
  complete.get('1')!(wav(5)); await flush();
  assert.equal(buffer.readySeconds(), 10);
  assert.equal(started, false, 'fifteen seconds total is below target');
  complete.get('3')!(wav(5)); await reserve;
  assert.equal(buffer.currentSeconds + buffer.readySeconds(), 20);
  buffer.dispose();
});

test('short sentences expand the reserve and speed changes the required duration', async () => {
  const items = Array.from({length: 50}, (_, n) => ({text: String(n)}));
  const buffer = new SpeechBuffer(async () => items.shift() ?? null, async () => wav(2));
  const first = await buffer.take(); await first!.audio;
  await buffer.prepareAhead(first!.seconds, 2);
  assert.ok(buffer.currentSeconds + buffer.readySeconds() >= 40);
  buffer.dispose();
});

test('short remaining documents start fully buffered below target', async () => {
  const items = [{text:'one'}, {text:'two'}];
  const buffer = new SpeechBuffer(async () => items.shift() ?? null, async () => wav(2));
  const first = await buffer.take(); await first!.audio;
  await buffer.prepareAhead(first!.seconds);
  assert.equal(buffer.currentSeconds + buffer.readySeconds(), 4);
  buffer.dispose();
});

test('invalid duration cannot make startup scan the remaining document forever', async () => {
  let extracted = 0;
  const buffer = new SpeechBuffer(async () => ({text: String(++extracted)}), async () => new Blob(['invalid audio']));
  const first = await buffer.take(); await first!.audio;
  try {
    await assert.rejects(buffer.prepareAhead(first!.seconds), /no playable audio/i);
    assert.ok(extracted <= 5, 'keep the initial bounded lookahead');
  } finally { buffer.dispose(); }
});

test('a zero-duration future unit fails reserve instead of expanding indefinitely', async () => {
  let extracted = 0;
  const buffer = new SpeechBuffer(async () => ({text: String(++extracted)}), async item => item.text === '1' ? wav(2) : wav(0));
  const first = await buffer.take(); await first!.audio;
  try {
    await assert.rejects(buffer.prepareAhead(first!.seconds), /no playable audio/i);
    assert.ok(extracted <= 5);
  } finally { buffer.dispose(); }
});

test('a current unit that fills the duration target starts without waiting for the next unit', async () => {
  let n = 0;
  const buffer = new SpeechBuffer(async () => n++ < 2 ? {text: String(n)} : null,
    async item => item.text === '1' ? wav(25) : new Promise<Blob>(() => {}));
  const first = await buffer.take(); await first!.audio;
  let ready = false;
  const reserve = buffer.prepareAhead(first!.seconds).then(() => { ready = true; });
  try {
    await flush();
    assert.equal(ready, true, '25 seconds already exceeds the advertised 20-second target');
  } finally { buffer.dispose(); await reserve; }
});
