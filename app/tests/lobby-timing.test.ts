import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sentenceAt, sentenceCues } from '../src/lobby-timing';

const manifest = JSON.parse(readFileSync(new URL('../public/greeting.json', import.meta.url), 'utf8'));
for (const voice of manifest.voices) {
  test(`${voice.name}: bundled recording and every sentence match the transcript`, () => {
    assert.ok(existsSync(fileURLToPath(new URL(`../public${voice.file}`, import.meta.url))));
    const cues = sentenceCues(manifest.text, voice.words);
    assert.equal(cues.length, 2);
    assert.equal(cues.map(c => c.text).join(' '), manifest.text);
    assert.equal(sentenceAt(cues, 0), 0);
    assert.equal(sentenceAt(cues, cues[1].start - 0.001), 0);
    assert.equal(sentenceAt(cues, cues[1].start), 1);
    assert.equal(sentenceAt(cues, cues[1].start + 1), 1);
    // Seeking backward restores the first sentence; it doesn't rely on a timer.
    assert.equal(sentenceAt(cues, 1), 0);
  });
}
test('reject mismatched or non-monotonic timing instead of highlighting the wrong text', () => {
  assert.deepEqual(sentenceCues('Hello world.', [{w:'Hello',t:0}]), []);
  assert.deepEqual(sentenceCues('Hello world.', [{w:'Hello',t:1},{w:'world.',t:0}]), []);
  assert.deepEqual(sentenceCues('Hello world.', [{w:'Hello',t:0},{w:'other.',t:1}]), []);
  assert.equal(sentenceAt([], 2), -1);
});

import { recordedSentenceCues } from '../src/lobby-timing';
const sample = JSON.parse(readFileSync(new URL('../public/paper-sample.json', import.meta.url), 'utf8'));
for (const voice of sample.voices) {
  test(`${voice.name}: measured manuscript sentence boundaries support forward and backward seeking`, () => {
    assert.ok(existsSync(fileURLToPath(new URL(`../public${voice.file}`, import.meta.url))));
    const cues = recordedSentenceCues(sample.text, voice.sentences, voice.duration);
    assert.equal(cues.length, 5);
    for (let i = 0; i < cues.length; i++) {
      assert.equal(sentenceAt(cues, cues[i].start), i);
      assert.equal(sentenceAt(cues, cues[i].end - .001), i);
    }
    assert.equal(sentenceAt(cues, cues[1].start), 1);
    assert.equal(sentenceAt(cues, 0), 0);
    assert.equal(sentenceAt(cues, voice.duration), -1);
    assert.deepEqual(recordedSentenceCues('Wrong text.', voice.sentences, voice.duration), []);
    assert.deepEqual(recordedSentenceCues(sample.text, voice.sentences, 1), []);
  });
}


test('the offline sample preserves the exact recorded transcript', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const fallback = html.match(/id="introText">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(fallback, 'the book must contain text before its recording loads');
  assert.equal(fallback.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), sample.text);
  assert.equal((fallback.match(/<p>/g) ?? []).length, 2);
});
