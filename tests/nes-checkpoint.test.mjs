import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {encodeCheckpoint,decodeCheckpoint} from '../htdocs/games/arcade/checkpoint-store.mjs';
import {createProducer} from '../htdocs/games/arcade/worker-stream-producer.mjs';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
const registry=JSON.parse(readFileSync(new URL('../htdocs/games/engines/nes/registry.json',import.meta.url)));
const {captureGraph,restoreGraph,wrapCheckpointMachine}=await import(new URL('../htdocs/games/engines/nes/'+registry.release+'/composer.mjs',import.meta.url));
test('checkpoint data preserves cycles, aliases, typed storage and trusted prototypes',()=>{
 class Tile{read(){return this.data[0];}}
 const make=()=>{const tile=new Tile();tile.data=new Uint8Array([7,9]);const root={tile,alias:tile,value:-0,empty:undefined,rows:[]};root.self=root;return root;};
 const source=make();source.rows=[source.tile];const saved=JSON.parse(JSON.stringify(captureGraph(source))),fresh=make();
 const result=restoreGraph(fresh,saved);assert.equal(result,result.self);assert.equal(result.alias,result.tile);assert.equal(result.rows[0],result.tile);assert.equal(result.tile.read(),7);assert(Object.is(result.value,-0));assert.equal(result.empty,undefined);
 const malformed=structuredClone(saved);malformed.nodes.find(n=>n.kind==='Uint8Array').values[0]=256;assert.throws(()=>restoreGraph(make(),malformed),/range/);
 const missing=structuredClone(saved);missing.nodes[0].values=missing.nodes[0].values.filter(([key])=>key!=='value');assert.throws(()=>restoreGraph(make(),missing),/missing field/);
 const prototype=structuredClone(saved);prototype.prototypes[0]='untrusted';assert.throws(()=>restoreGraph(make(),prototype),/prototype/);
});
test('failed hydration and failed state validation leave the running machine intact',()=>{
 const create=()=>{let state={count:1};return {checkpointCapture:()=>state,checkpointRestore:v=>{state=v;},getState(){if(state.count===2)throw Error('invalid state');return {...state};},increment:()=>++state.count};};
 const m=wrapCheckpointMachine(create,{metadata:{romSha256:'rom',mappingIdentity:'map'}},{nodes:[]},'test/1');
 const save=m.exportCheckpoint();m.increment();m.increment();
 const bad=structuredClone(save);bad.state.nodes[0].values[0][1]=2;assert.throws(()=>m.importCheckpoint(bad),/invalid state/);assert.equal(m.getState().count,3);
 assert.throws(()=>m.importCheckpoint({...save,identity:'foreign'}),/different cartridge/);assert.equal(m.getState().count,3);
 m.importCheckpoint(save);assert.equal(m.getState().count,1);assert.equal(m.increment(),2);
});
test('stored saves check their digest before parsing and reject corrupt payloads',async()=>{
 const record={format:'nes-checkpoint/1',identity:'test',state:{frames:12}},stored=await encodeCheckpoint(record);
 assert.deepEqual(await decodeCheckpoint(stored),record);
 await assert.rejects(()=>decodeCheckpoint({...stored,payload:stored.payload+' '}),/damaged/);
 await assert.rejects(()=>decodeCheckpoint(null),/damaged/);
});
test('worker checkpoint errors are recoverable and restored frame counters may go backwards',()=>{
 let frames=10,seq=0,now=0;const posts=[],tasks=new Map();let task=0;
 const machine={setButton(){},getState:()=>({frames}),exportCheckpoint:()=>({frames}),importCheckpoint(v){if(!Number.isSafeInteger(v?.frames))throw Error('bad save');frames=v.frames;},frame(){return {state:{frames:++frames,cycles:frames*29781}};},getRGBA:()=>new Uint8ClampedArray(256*240*4),takeAudio:()=>new Float32Array(1600)};
 const p=createProducer({machine,now:()=>now,post:m=>posts.push(m),schedule:(f,delay)=>{tasks.set(++task,()=>{now+=delay;f();});return task;},cancel:id=>tasks.delete(id)});
 const send=(type,extra={})=>p.receive({type,epoch:1,seq:++seq,...extra});
 send('sync');send('checkpoint-export');assert.deepEqual(posts.at(-1).record,{frames:10});
 send('checkpoint-import',{record:{frames:2}});assert.equal(posts.at(-1).type,'checkpoint');assert.equal(frames,2);
 send('checkpoint-import',{record:{}});assert.equal(posts.at(-1).type,'checkpoint-error');assert.equal(p.snapshot().failed,false);assert.equal(frames,2);
 send('grant',{count:1});const f=tasks.values().next().value;tasks.clear();f();assert.equal(posts.at(-1).type,'frame');assert.equal(posts.at(-1).frames,3);p.dispose();
});
test('host save requests match epoch/sequence, reject stale replies and cancel on reset/dispose',async()=>{
 const h=await runtimeHarness(fileURLToPath(new URL('../htdocs/games/megaman/host-runtime.mjs',import.meta.url)));const r=h.runtime;r.reset();const w=h.workers.at(-1);
 w.onmessage({data:{type:'ready'}});
 const promise=r.exportCheckpoint(),sent=w.sent.at(-1);assert.equal(sent.type,'checkpoint-export');
 w.onmessage({data:{type:'checkpoint',epoch:sent.epoch-1,seq:sent.seq,record:{stale:true}}});
 w.onmessage({data:{type:'checkpoint',epoch:sent.epoch,seq:sent.seq,record:{valid:true}}});assert.deepEqual(await promise,{valid:true});
 const reset=r.exportCheckpoint();const rejection=assert.rejects(reset,/reset/);r.reset();await rejection;
 const next=h.workers.at(-1);next.onmessage({data:{type:'ready'}});
 const pending=r.exportCheckpoint();const cancelled=assert.rejects(pending,/unloaded/);await r.dispose();await cancelled;
});
test('Contra pending DMC completion survives checkpoint without serializing callbacks',async()=>{
 const side=JSON.parse(readFileSync(new URL('../htdocs/games/contra/composition.json',import.meta.url))),engine=JSON.parse(readFileSync(new URL('../htdocs'+side.binding.engineManifest.path,import.meta.url)));
 const node=engine.graph.nodes.find(n=>n.key==='dma.mjs'),{instantiate}=await import(new URL('../htdocs/games/engines/nes/'+registry.release+'/common/'+node.factory+'.mjs',import.meta.url));
 const {createDMA,installDMC}=instantiate([]);
 function make(){let cycle=0,dataBus=0,dmc;const channel={writeReg(){},setEnabled(){},clockDmc(){},nextSample(){},getLengthStatus(){},getIrqStatus(){}};
  const dma=createDMA({cycle:()=>cycle,tick(){dmc.tick();cycle++;},read:a=>a&255,writeCPU(){},writeOam(){},getBus:()=>dataBus,setBus:v=>{dataBus=v;}});dmc=installDMC(channel,dma,()=>cycle);
  return {channel,dma,dmc,capture:()=>({cycle,dataBus,channel,dma:dma.checkpointCapture(),dmc:dmc.checkpointCapture()}),restore(v){cycle=v.cycle;dataBus=v.dataBus;Object.assign(channel,v.channel);dma.checkpointRestore(v.dma,dmc.checkpointRestore(v.dmc));},run(){for(let i=0;i<30;i++)dma.readCPU(0x8000);return {cycle,dataBus,channel:Object.fromEntries(Object.entries(channel).filter(([k,v])=>typeof v!=='function')),dma:dma.snapshot(),stats:dma.stats(),dmc:dmc.snapshot()};}};
 }
 const a=make();a.channel.writeReg(0x4010,0x8f);a.channel.writeReg(0x4015,16);
 const save=JSON.parse(JSON.stringify(captureGraph(a.capture())));assert(a.dmc.snapshot().outstanding);
 const expected=a.run(),b=make();b.restore(restoreGraph(b.capture(),save));assert.deepEqual(b.run(),expected);
});
test('loading a late-game checkpoint starts a fresh speed measurement baseline',async()=>{
 let now=1000;const h=await runtimeHarness(fileURLToPath(new URL('../htdocs/games/megaman/host-runtime.mjs',import.meta.url)),{now:()=>now}),r=h.runtime;
 r.reset();const w=h.workers[0];w.receive({type:'ready'});
 const loading=r.importCheckpoint({}),barrier=w.sent.findLast(m=>m.type==='sync'),request=w.sent.at(-1);
 w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});w.receive({type:'checkpoint',epoch:request.epoch,seq:request.seq,frames:16000});await loading;r.start(false);
 now=2200;const duration=1/60.0988;
 w.receive({type:'frame',epoch:barrier.epoch,id:1,produced:1,at:0,duration,rgba:new Uint8ClampedArray(256*240*4),audio:new Float32Array(),frames:16001,cycles:500000000,inputSeq:0,appliedSeq:0});
 const [key,tick]=h.rafs.entries().next().value;h.rafs.delete(key);tick(2300);
 assert.match(r.snapshot().message,/0% speed/,'Historical CPU cycles must not count as newly executed work');
 await r.dispose();
});
