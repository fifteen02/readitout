import assert from 'node:assert/strict';
import test from 'node:test';
import { pcmToWav } from '../src/kokoro-audio';
import { playKokoroChunk } from '../src/audio-playback';
import { readerPlayerActions } from '../src/reader-player';
import type { AppState, ReadItem } from '../src/types';
import type { UI } from '../src/ui';

const flush = () => new Promise(resolve => setImmediate(resolve));
test('real playback pipeline reads ahead across pages and preserves buffered audio when skipping', async () => {
  class WorkerMock {
    static current: WorkerMock;
    onmessage?: (event:{data:unknown})=>void;
    sent: {id:number;type:string;text?:string}[]=[];
    constructor(){WorkerMock.current=this;}
    postMessage(data:{id:number;type:string;text?:string}) {
      this.sent.push(data);
      if(data.type==='generate') setImmediate(()=>this.onmessage?.({data:{id:data.id,buffer:pcmToWav([new Float32Array(5 * 24000)])}}));
    }
    terminate(){}
  }
  class AudioMock {
    static instances: AudioMock[]=[];
    onended?: ()=>void;
    onerror?: ()=>void;
    playbackRate=1;
    duration=5;
    currentTime=0;
    addEventListener(){}
    constructor(public src:string){AudioMock.instances.push(this);}
    play(){return Promise.resolve();}
    pause(){}
  }
  Object.assign(globalThis,{Worker:WorkerMock,Audio:AudioMock,localStorage:{getItem:()=> '1'},
    document:{getElementById:()=>null}});
  const {cancelBrowserKokoro}=await import('../src/browser-kokoro');
  const items: ReadItem[]=[{text:'First.',page:1},{text:'Second.',page:1}];
  const state={pdf:{},chunks:items,reading:true,readHistory:[],currentReadItem:null,
    speechBuffer:null,playToken:0,page:1,readingPage:null,playAbort:null,audio:null} as unknown as AppState;
  const ui={rate:{value:'1'}} as UI;
  let ahead=0;
  const activated:string[]=[];
  const api={state,ui,setStatus:()=>{},speechRequest:()=>({text:'',voice:'af_heart'}),
    nextPage:async(after:number)=>{ahead++;return after===1?[{text:'Third.',page:2},{text:'Fourth.',page:2},{text:'Fifth.',page:2}]:[];},
    stopReading:()=>{state.playToken++;state.reading=false;state.speechBuffer?.dispose();state.speechBuffer=null;},
    activateReadItem:(item:ReadItem,phase:string)=>{state.currentReadItem=item;if(phase==='playing'){state.page=item.page!;activated.push(item.text);}}
  };
  try {
    await playKokoroChunk(api); await flush();
    assert.ok(ahead>0,'next page is extracted while first audio is playing');
    assert.equal(state.page,1,'background extraction does not navigate');
    assert.deepEqual(WorkerMock.current.sent.filter(x=>x.type==='generate').map(x=>x.text),['First.','Second.','Third.','Fourth.','Fifth.']);
    const oldAudio=AudioMock.instances[0];
    const actions=readerPlayerActions(ui,state,()=>{void playKokoroChunk(api);},api.stopReading,()=>{});
    const token=state.playToken;
    actions.skip(-1);
    assert.equal(state.playToken,token,'Previous at first item does not invalidate audio');
    actions.skip(1); await flush(); await flush();
    assert.deepEqual(activated,['First.','Second.']);
    assert.equal(WorkerMock.current.sent.filter(x=>x.type==='generate').length,5,'skip reuses existing lookahead');
    oldAudio.onended?.(); await flush();
    assert.deepEqual(activated,['First.','Second.'],'late ended callback cannot skip an extra passage');
    AudioMock.instances.at(-1)!.onended?.(); await flush(); await flush();
    assert.equal(state.page,2);
    assert.deepEqual(activated,['First.','Second.','Third.']);
    api.stopReading();
    AudioMock.instances.at(-1)!.onended?.(); await flush();
    assert.equal(activated.length,3,'stopped sessions cannot resume from a late event');
  } finally {state.speechBuffer?.dispose();cancelBrowserKokoro();}
});
