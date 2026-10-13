import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackMarkdown } from '../src/annotation-export';
import type { Annotation } from '../src/types';
const note = (values: Partial<Annotation>): Annotation => ({id:'a',type:'highlight',page:1,x:.1,y:.2,w:.5,h:.1,text:'Make this quieter.',quote:'A first line.\nAnother line.',color:'#ffd240',createdAt:'',updatedAt:'',...values});
test('readable export keeps done notes, tags and exact multiline passages in page order without changing source order', () => {
  const notes = [note({id:'b',page:3,done:true,tags:['voice']}),note({id:'a',page:1,text:'Check the date.'})];
  const result = feedbackMarkdown({fileName:'My draft.pdf',annotations:notes});
  assert.ok(result.indexOf('Page 1') < result.indexOf('Page 3'));
  assert.match(result,/Page 3 · Done/);
  assert.match(result,/> A first line\.\n> Another line\./);
  assert.match(result,/Tags: voice/);
  assert.match(result,/Check the date\./);
  assert.doesNotMatch(result,/expert editor|Work through every item/);
  assert.deepEqual(notes.map(n=>n.page),[3,1]);
});
test('drawn notes retain location and highlight-only entries remain understandable', () => {
  const result = feedbackMarkdown({fileName:'Draft',annotations:[note({quote:'',text:'',type:'note'})]});
  assert.match(result,/10% across, 20% down/);
  assert.match(result,/Highlight only/);
});
test('empty review exports an explicit empty state', () => {
  assert.match(feedbackMarkdown({fileName:'',annotations:[]}),/Untitled PDF[\s\S]*No notes yet/);
});
