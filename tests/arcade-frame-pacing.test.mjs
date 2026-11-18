import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePacer} from '../htdocs/games/arcade/frame-pacing.mjs';
import {createSnesRuntime} from '../htdocs/games/arcade/snes-runtime.mjs';

function bounded(draws){
 for(let i=0;i<draws.length;i++)assert(draws.filter(t=>t>draws[i]-1000+1e-7&&t<=draws[i]).length<=60,'More than sixty actual draws in a rolling second');
 assert.equal(new Set(draws).size,draws.length,'Multiple draws at one display callback');
}
test('presentation pacing bounds real draws on 60/120/144/240 Hz displays without reducing 30 Hz',()=>{
 for(const hz of [30,60,120,144,240]){const p=createFramePacer(),draws=[];for(let i=0;i<hz*5;i++){const t=i*1000/hz;if(p.take(t))draws.push(t);assert(p.snapshot(t).fps<=60);}bounded(draws);assert(draws.length>=Math.min(hz,60)*5-4,`${hz} Hz output should remain near its supported rate: ${draws.length}`);}
});
test('missed display deadlines and lifecycle restarts do not accumulate catch-up draws',()=>{
 const p=createFramePacer(),draws=[];for(let i=0;i<60;i++){const t=i*1000/120;if(p.take(t))draws.push(t);}
 assert(p.take(1000));draws.push(1000);for(const t of [1000,1001,1008,1016])assert.equal(p.take(t),false,'Stall earned a catch-up draw');
 for(let i=1;i<120;i++){const t=1000+i*1000/120;if(t<1016)continue;if(p.take(t))draws.push(t);}
 p.resetClock();if(p.take(1999))draws.push(1999);for(let i=0;i<120;i++){const t=2000+i*1000/120;if(p.take(t))draws.push(t);}bounded(draws);
 // A meter sample may run after a vsync timestamp without moving its clock.
 const q=createFramePacer();q.take(0);q.snapshot(20);assert.equal(q.take(16.7),true);
});

function environment(){
 let now=0,raf=null,worker,context;const draws=[],audio=[],slots=new Map();
 const keys=['Worker','AudioContext','indexedDB','requestAnimationFrame','cancelAnimationFrame','performance'];const before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 class W{constructor(){worker=this;this.frames=0;}postMessage(r){let result;if(r.op==='init')result={fps:60.0988};else if(r.op==='frame'){result={width:1,height:1,rgba:new Uint8Array([++this.frames%256,0,0,255]),audio:new Int16Array(1600),frame:this.frames};}else if(r.op==='battery')result={data:new Uint8Array(1)};else throw Error(r.op);queueMicrotask(()=>this.onmessage?.({data:{id:r.id,result}}));}terminate(){this.onmessage=null;}}
 class A{constructor(){context=this;this.sampleRate=48000;this.destination={};this.state='running';}get currentTime(){return now/1000;}createGain(){return {connect(){},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}};}async resume(){}async close(){}createBuffer(channels,length){return {length,getChannelData:()=>new Float32Array(length)};}createBufferSource(){return {connect(){},disconnect(){},stop(){},start(at){audio.push({at,samples:this.buffer.length*2});}};}}
 const db={open(){const r={};queueMicrotask(()=>{r.result={close(){},transaction(){const tx={objectStore(){return {get(key){const req={result:slots.get(key)};queueMicrotask(()=>tx.oncomplete());return req;},put(value,key){const req={result:key};queueMicrotask(()=>{slots.set(key,value);tx.oncomplete();});return req;}};}};return tx;}};r.onsuccess();});return r;}};
 Object.assign(globalThis,{Worker:W,AudioContext:A,indexedDB:db,requestAnimationFrame:cb=>{raf=cb;return 1;},cancelAnimationFrame:()=>{raf=null;},performance:{now:()=>now}});
 const canvas={width:1,height:1,getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){draws.push(now);}})};
 return {canvas,draws,audio,setTime(t){now=t;},tick(t){now=t;const cb=raf;raf=null;cb?.(t);},restore(){for(const [k,v]of Object.entries(before))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}};
}
async function settle(){for(let i=0;i<40;i++)await Promise.resolve();}
test('SNES actual canvas writes remain capped through high-refresh callbacks and a stall while all PCM is scheduled',async()=>{
 const env=environment(),r=createSnesRuntime({canvas:env.canvas,config:{},packageId:'pacing-regression'});
 try{await r.load();await r.start();await settle();for(let i=1;i<=720;i++){const t=i*1000/144;if(t>=2000&&t<2200)continue;env.tick(t);await settle();}
  bounded(env.draws);assert(env.draws.length>270&&env.draws.length<=300);assert.equal(env.audio.length,r.snapshot().generatedFrames);assert.equal(env.audio.reduce((n,a)=>n+a.samples,0),r.snapshot().audioSamples);assert(r.snapshot().queuedFrames<=8);const atStall=env.draws.filter(t=>t>=2200&&t<2216);assert(atStall.length<=1);const meter=/([\d.]+) FPS/.exec(r.snapshot().message);assert(meter&&Number(meter[1])<=60);
  await r.dispose();
 }finally{env.restore();}
});

test('NES actual canvas writes use the same ceiling while streaming audio and recycling bounded worker buffers',async()=>{
 const {createRuntime}=await import('../htdocs/games/arcade/worker-stream-host.mjs');
 const env=environment(),keys=['window','document','localStorage','ImageData'],before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));let machineFrames=0,producedAudioSamples=0;
 class StreamWorker {
  constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));this.frames=0;this.time=0;this.id=0;this.inputSeq=0;}
  postMessage(r){if(r.type==='sync'){this.epoch=r.epoch;this.time=0;this.id=0;this.inputSeq=0;queueMicrotask(()=>this.onmessage?.({data:{type:'synced',epoch:r.epoch,seq:r.seq}}));}
   else if(r.type==='input')this.inputSeq=r.inputSeq;
   else if(r.type==='grant')for(let i=0;i<r.count;i++){const audio=new Float32Array(1600),d={type:'frame',epoch:this.epoch,id:++this.id,produced:++this.frames,at:this.time,duration:audio.length/96000,rgba:new Uint8ClampedArray(256*240*4),audio,frames:++machineFrames,cycles:machineFrames*29830,inputSeq:this.inputSeq,appliedSeq:this.inputSeq};producedAudioSamples+=audio.length;this.time+=d.duration;queueMicrotask(()=>this.onmessage?.({data:d}));}}
  terminate(){this.onmessage=null;}
 }
 globalThis.window={AudioContext:globalThis.AudioContext};globalThis.document={hidden:false,hasFocus:()=>true};globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.ImageData=class{constructor(bytes,width,height){this.data=bytes;this.width=width;this.height=height;}};
 const context=env.canvas.getContext();context.clearRect=()=>{};env.canvas.getContext=()=>context;env.canvas.dataset={};const nodes=new Map([['#nes-screen',env.canvas]]);const root={querySelector(id){if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,value:'2',dataset:{}});return nodes.get(id);}};
 const r=createRuntime({root,WorkerClass:StreamWorker,workerURL:'test-worker'});
 try{r.reset();await settle();r.start();await settle();for(let i=1;i<=720;i++){const t=i*1000/144;if(t>=2000&&t<2200)continue;env.tick(t);await settle();}
  bounded(env.draws);assert(env.draws.length>260&&env.draws.length<=300,`Observed NES frames: ${env.draws.length}`);assert(r.snapshot().stream.queued<=16);assert(env.audio.length>0);assert.equal(env.audio.reduce((n,a)=>n+a.samples,0),producedAudioSamples,'Native PCM was discarded or scheduled twice');const meter=/([\d.]+) FPS/.exec(r.snapshot().message);assert(meter&&Number(meter[1])<=60);await r.dispose();
 }finally{await r.dispose();for(const [k,v]of Object.entries(before))if(v===undefined)delete globalThis[k];else globalThis[k]=v;env.restore();}
});
