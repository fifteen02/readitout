import assert from 'node:assert/strict';
import test from 'node:test';
import { paragraphStarts, type TextLine } from '../src/read-markers';
const line = (text: string, y: number, font = 20): TextLine => ({text,y,flow:y,font,x:0,w:400,angle:0});
test('generous body leading stays together and paragraph gaps remain separate', () => {
  const groups = paragraphStarts([
    line('The lighthouse had been dark before it was',0),
    line('her problem. She passed it every morning,',32),
    line('and stopped to look.',64),
    line('Her father would have called this a symptom.',116),
    line('He had a whole vocabulary for it.',148),
  ]);
  assert.equal(groups.length,2);
  assert.equal(groups[0].text,'The lighthouse had been dark before it was her problem. She passed it every morning, and stopped to look.');
  assert.equal(groups[0].lines.length,3);
});
test('compact leading, headings and orientation changes retain boundaries', () => {
  const groups = paragraphStarts([
    line('Chapter One',0,32),line('First line',35),line('Second line',59),
    line('New paragraph',99),line('Last line',123),
    {...line('Rotated',147),angle:Math.PI/2},
  ]);
  assert.deepEqual(groups.map(g=>g.lines.length),[1,2,2,1]);
});
test('empty and single-line pages remain readable',()=>{
  assert.deepEqual(paragraphStarts([]),[]);
  assert.equal(paragraphStarts([line('A complete single line.',0)]).length,1);
});
