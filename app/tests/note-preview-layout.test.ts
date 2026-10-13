import test from 'node:test';
import assert from 'node:assert/strict';
import { notePreviewLayout } from '../src/note-preview-layout';
for (const [width, height, header, player] of [[320,568,116,124],[390,844,116,124],[844,390,104,64]]) {
  test(`long note reserves reading space at ${width}×${height}`, () => {
    const floor = height-player;
    const result = notePreviewLayout({width,ceiling:header,floor,pageLeft:20,pageRight:width-20,anchorTop:header,contentHeight:900});
    assert.equal(result.docked,true);
    assert.equal(result.top+result.height,floor-8);
    assert.ok(result.top>header, 'manuscript retains visible space');
    assert.ok(result.height<=(floor-header)*.45);
    assert.equal(result.width,Math.min(720,width-24));
    assert.ok(result.left >= 12);
  });
}
test('wide margin preview avoids paper and fixed controls',()=>{
  const r=notePreviewLayout({width:1600,ceiling:154,floor:816,pageLeft:400,pageRight:1100,anchorTop:790,contentHeight:900});
  assert.equal(r.docked,false); assert.ok(r.left>1100);
  assert.ok(r.top>=154); assert.ok(r.top+r.height<=816);
});

test('short docked note reserves only its measured content height', () => {
 const r=notePreviewLayout({width:1000,ceiling:154,floor:816,pageLeft:20,pageRight:980,anchorTop:300,contentHeight:108});
 assert.equal(r.docked,true); assert.equal(r.height,108); assert.equal(r.top,700);
});
