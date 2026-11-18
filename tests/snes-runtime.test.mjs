import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {BrowserSnesRunner,sha256,fetchPinned} from '../htdocs/games/engines/snes/runner.mjs';
import {SnesGamepads} from '../htdocs/games/arcade/snes-input.mjs';
const require=createRequire(import.meta.url),factory=require('../htdocs/games/engines/snes/posse-snes.cjs');
const wasm=fs.readFileSync(new URL('../htdocs/games/engines/snes/posse-snes.wasm',import.meta.url));
function fixture(){const rom=Buffer.alloc(0x8000,0xea),h=0x7fc0;rom.fill(0,h,h+64);rom.write('SNES CONTROLLER TEST  ',h);rom[h+21]=0x20;rom[h+22]=2;rom[h+23]=5;rom[h+24]=1;rom[h+25]=1;rom.writeUInt16LE(0x8000,h+60);rom.set([0x78,0xd8,0xa9,1,0x8d,0x16,0x40,0xa9,0,0x8d,0x16,0x40,0xa2,0,0xad,0x16,0x40,0x29,1,0x9f,0,0,0x70,0xad,0x17,0x40,0x29,1,0x9f,0x10,0,0x70,0xe8,0xe0,16,0xd0,0xe9,0x4c,2,0x80]);rom.writeUInt16LE(65535,h+28);const sum=rom.reduce((a,b)=>(a+b)&65535,0);rom.writeUInt16LE(sum^65535,h+28);rom.writeUInt16LE(sum,h+30);return rom;}
async function runner(){const rom=fixture(),hash=await sha256(rom),core=await factory({wasmBinary:wasm,print(){},printErr(){}});return BrowserSnesRunner.create({rom:{path:'/games/test.sfc',bytes:rom.length,sha256:hash},metadata:{romSha256:hash,romBytes:rom.length,ramBytes:2048,nvramBytes:2048,region:'ntsc'},core:{wasm:{sha256:await sha256(wasm)}}},{rom,core});}
async function ports(r){for(let i=0;i<3;i++)r.step();const b=await r.battery();return [Array.from(b.data.slice(0,16)),Array.from(b.data.slice(16,32))];}
const bits=mask=>[...Array.from({length:12},(_,i)=>(mask>>i)&1),0,0,0,0];
test('browser runner two physical ports, owned outputs, native checkpoints and independent instances',async()=>{const a=await runner(),b=await runner();try{a.input(1,1|16|1024);a.input(2,8|128|256);assert.deepEqual(await ports(a),[bits(1041),bits(392)]);assert.deepEqual(await ports(b),[bits(0),bits(0)]);const state=await a.save(),frame=a.step(),video=frame.rgba.slice(),audio=frame.audio.slice();await b.load(state);assert.deepEqual(b.step(),frame);a.step();assert.deepEqual(frame.rgba,video);assert.deepEqual(frame.audio,audio);a.input(1,0);a.input(2,0);assert.deepEqual(await ports(a),[bits(0),bits(0)]);await a.load(state);assert.deepEqual(await ports(a),[bits(1041),bits(392)]);const corrupt={...state,data:state.data.slice()};corrupt.data[16]^=1;corrupt.sha256=await sha256(corrupt.data);const before=await a.save();await assert.rejects(a.load(corrupt),/rejected/);assert.deepEqual(await a.save(),before);await assert.rejects(a.load({...state,romSha256:'0'.repeat(64)}),/identity/);}finally{a.dispose();b.dispose();}});
test('browser core fetch rejects changed and oversized bytes before evaluation',async()=>{const data=new Uint8Array([1,2,3]),pin={path:'/games/test.wasm',bytes:3,sha256:await sha256(data)};let requested;assert.deepEqual(await fetchPinned(pin,{fetcher:async url=>{requested=url;return new Response(data);}}),data);assert.doesNotThrow(()=>new URL(requested),'Blob-worker fetch must receive an absolute module-origin URL');await assert.rejects(fetchPinned({...pin,sha256:'0'.repeat(64)},{fetcher:async()=>new Response(data)}),/integrity/);await assert.rejects(fetchPinned({...pin,bytes:2},{fetcher:async()=>new Response(data)}),/size/);});
test('standard gamepads route separate seats and release on disconnect/disable',()=>{let devices=[0,1].map(index=>({index,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))}));const events=[],pads=new SnesGamepads({read:()=>devices,status(){},press:(source,button,seat)=>events.push(['press',source,button,seat]),release:(source,seat)=>events.push(['release',source,seat])});devices[0].buttons[0].pressed=true;devices[1].buttons[1].pressed=true;pads.poll(true);assert.deepEqual(events,[['press','g:0:0',0,1],['press','g:1:8',8,2]]);events.length=0;pads.poll(true,false);assert.deepEqual(events,[['release','g:1:8',2]]);events.length=0;pads.poll(false);assert.deepEqual(events,[['release','g:0:0',1]]);events.length=0;pads.poll(true);assert.equal(events.length,0,'held buttons remain blocked until release');devices[0].buttons[0].pressed=false;pads.poll(true);devices[0].buttons[0].pressed=true;pads.poll(true);assert.deepEqual(events,[['press','g:0:0',0,1]]);});

test('dispose waits for an in-flight battery write and pause wins over delayed audio resume',async()=>{
 const {createSnesRuntime}=await import('../htdocs/games/arcade/snes-runtime.mjs');
 const savedGlobals=Object.fromEntries(['Worker','AudioContext','indexedDB','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,globalThis[k]]));
 const slots=new Map();let worker,context;
 class FakeWorker {
  constructor(url){worker=this;this.bootstrap=url;this.terminated=false;this.batteryRequests=[];}
  postMessage(request){if(request.op==='init')queueMicrotask(()=>this.onmessage({data:{id:request.id,result:{fps:60}}}));else if(request.op==='battery')this.batteryRequests.push(request);else throw Error('Unexpected test request '+request.op);}
  battery(record){const request=this.batteryRequests.shift();assert(request);this.onmessage({data:{id:request.id,result:record}});}
  terminate(){this.terminated=true;}
 }
 class FakeAudio {
  constructor(){context=this;this.currentTime=0;this.sampleRate=48000;this.destination={};}
  createGain(){return {connect(){},disconnect(){}};}
  resume(){return new Promise(resolve=>{this.finishResume=resolve;});}
  async close(){}
 }
 const fakeDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={objectStore(){return {get(key){const req={result:slots.get(key)};queueMicrotask(()=>tx.oncomplete());return req;},put(value,key){const req={result:key};queueMicrotask(()=>{slots.set(key,value);tx.oncomplete();});return req;}};}};return tx;}};request.onsuccess();});return request;}};
 globalThis.Worker=FakeWorker;globalThis.AudioContext=FakeAudio;globalThis.indexedDB=fakeDB;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const runtime=createSnesRuntime({canvas:{getContext:()=>({})},config:{},packageId:'lifecycle-test'});
 try{
  await runtime.load();assert.equal(new URL(worker.bootstrap).protocol,'blob:','Worker must inherit arcade CSP');await assert.rejects(fetch(worker.bootstrap),/fetch failed/,'Initialized worker bootstrap was not revoked');const start=runtime.start();runtime.pause();context.finishResume();await start;
  assert.equal(runtime.snapshot().running,false,'Delayed audio resume restarted a paused game');
  assert.equal(worker.batteryRequests.length,1);
  let disposed=false;const disposal=runtime.dispose().then(()=>{disposed=true;});
  await Promise.resolve();await Promise.resolve();assert.equal(worker.terminated,false,'Worker terminated before save response');assert.equal(disposed,false);
  const record={format:'posse-snes-battery/1',data:new Uint8Array([23,42])};worker.battery(record);await disposal;
  assert.deepEqual(slots.get('lifecycle-test:battery'),record);assert.equal(worker.terminated,true);assert.equal(disposed,true);
 }finally{for(const [key,value]of Object.entries(savedGlobals))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
