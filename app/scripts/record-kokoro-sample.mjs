// Generate the lobby recording locally. No API keys or speech service required.
import { KokoroTTS } from 'kokoro-js';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const publicDir = new URL('../public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('paper-sample.json', publicDir), 'utf8'));
const original = manifest.voices[0].sentences;
console.log('Loading local Kokoro q8 model…');
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {dtype:'q8', device:'cpu'});
const temp = await mkdtemp(join(tmpdir(), 'readitout-kokoro-'));
try {
  const voices = [];
  for (const [id, name] of [['af_heart', 'Heart'], ['bf_emma', 'Emma']]) {
    const parts = [], sentences = [];
    let samples = 0;
    for (const [i, sentence] of original.entries()) {
      const audio = await tts.generate(sentence.text, {voice:id, speed:0.95});
      const file = join(temp, `${id}-${i}.wav`);
      await writeFile(file, Buffer.from(audio.toWav()));
      parts.push(`file '${file}'`);
      sentences.push({...sentence, start:samples / audio.sampling_rate, end:(samples + audio.audio.length) / audio.sampling_rate});
      samples += audio.audio.length;
      console.log(`${name}: sentence ${i + 1}/${original.length}`);
    }
    const list = join(temp, 'clips.txt');
    await writeFile(list, parts.join('\n'));
    const file = `paper-sample-${id}.mp3`;
    execFileSync('ffmpeg', ['-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c:a','libmp3lame','-q:a','3',new URL(file,publicDir).pathname]);
    voices.push({name, file:`/${file}`, duration:samples/24000, sentences});
  }
  await writeFile(new URL('paper-sample.json',publicDir), JSON.stringify({...manifest, voices,
    model:'onnx-community/Kokoro-82M-v1.0-ONNX', timingSource:'Locally generated Kokoro sentence clips; boundaries measured from 24 kHz PCM sample counts.'},null,2)+'\n');
  console.log('Saved Kokoro lobby recordings and exact sentence boundaries.');
} finally { await rm(temp,{recursive:true,force:true}); }
