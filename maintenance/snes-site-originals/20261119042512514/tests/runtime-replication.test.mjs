import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createProducer} from '../htdocs/games/arcade/worker-stream-producer.mjs';
import {replicationSnapshot,validateReplicationSnapshot,hashReplicationState,encodeReplicationState,decodeReplicationState,validateFrameRecords} from '../htdocs/games/arcade/replication-state.mjs';
import {BrowserSnesRunner,sha256} from '../htdocs/games/engines/snes/runner.mjs';

test('canonical checkpoint bytes preserve SNES memory and bind full state, frame, and identity',async()=>{
 const state={format:'posse-snes-browser-state/1',romSha256:'a'.repeat(64),coreSha256:'b'.repeat(64),sampleRate:48000,frame:123,data:new Uint8Array([0,255,128]),pads:[1,2]};
 const snapshot=await replicationSnapshot(123,state),roundTrip=decodeReplicationState(encodeReplicationState(snapshot));
 assert.deepEqual(roundTrip,snapshot);await validateReplicationSnapshot(roundTrip);
 roundTrip.state.data[0]^=1;await assert.rejects(validateReplicationSnapshot(roundTrip),/integrity/);
 assert.throws(()=>validateFrameRecords([{frame:5,pads:[0,0]}],3,255),/nonconsecutive/);
 assert.throws(()=>validateFrameRecords([{frame:4,pads:[256,0]}],3,255),/nonconsecutive/);
 assert.throws(()=>validateFrameRecords(Array(121).fill({frame:4,pads:[0,0]}),3,255),/batch/);
});

test('actual NES producer captures without releasing held inputs and replays both ports to identical full state',async()=>{
 const {createMachine}=await import('../htdocs/games/contra/composition-entry.mjs');
 const host=createMachine(),follower=createMachine(),messages=[],tasks=[];let time=0,seq=0;
 const producer=createProducer({machine:host,post:m=>messages.push(m),now:()=>time,schedule:(fn,delay)=>{tasks.push(()=>{time+=delay;fn();});return tasks.length;},cancel(){}});
 const send=(type,fields={})=>producer.receive({type,epoch:1,seq:++seq,...fields});
 send('sync');send('network-enable',{enabled:true});
 send('input',{inputSeq:1,seat:1,source:'p1',button:7,pressed:true});send('input',{inputSeq:2,seat:2,source:'p2',button:0,pressed:true});
 send('grant',{count:1});tasks.shift()();
 const live=messages.find(m=>m.type==='frame');assert(live);assert.equal(live.frames,1);
 send('network-capture');for(let i=0;i<200&&!messages.some(m=>m.type==='network-result'&&(m.result?.state||m.error));i++)await new Promise(r=>setTimeout(r,5));
 const snapshot=messages.find(m=>m.type==='network-result'&&m.result?.state)?.result;assert(snapshot,JSON.stringify(messages.filter(m=>m.type==='network-result'||m.type==='error')));assert.equal(snapshot.frame,1);
 assert.equal(producer.snapshot().inputSeq,2,'Snapshot altered held-input generation');
 follower.importCheckpoint(snapshot.state);assert.equal(await hashReplicationState(follower.exportCheckpoint()),snapshot.hash);
 const records=[];
 for(let i=0;i<120;i++){
  const pads=[i%20<10?128:0,i%30<15?1:0];for(let p=1;p<=2;p++)for(let b=0;b<8;b++)host.setButton(p,b,Boolean(pads[p-1]&(1<<b)));
  host.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});host.getRGBA();host.takeAudio();records.push({frame:host.getState().frames,pads});
 }
 records.at(-1).hash=await hashReplicationState(host.exportCheckpoint());
 const posts=[],replica=createProducer({machine:follower,post:m=>posts.push(m),now:()=>0});let rseq=0;const request=(type,fields={})=>{const id=++rseq;replica.receive({type,epoch:1,seq:id,...fields});return new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=()=>{const m=posts.find(m=>m.type==='network-result'&&m.seq===id);if(m)return m.error?reject(Error(m.error)):resolve(m.result);if(Date.now()>until)return reject(Error('Replica test timeout'));setTimeout(poll,5);};poll();});};
 replica.receive({type:'sync',epoch:1,seq:++rseq});await request('network-follow',{snapshot});await request('network-replay',{records,catchUp:true});
 assert.equal(posts.filter(m=>m.type==='replica-frame').length,0,'Catch-up rendered intermediate frames');
 assert.equal(await hashReplicationState(follower.exportCheckpoint()),records.at(-1).hash);
 await assert.rejects(request('network-replay',{records:[{frame:122,pads:[0,0],hash:'0'.repeat(64)}],catchUp:true}),/diverged/);
 const recovered=await request('network-follow',{snapshot});assert.equal(recovered.frame,1);
 // These frames already exist in the capped host log. A frozen local clock
 // cannot delay their replay or suppress their normal picture/audio output.
 await request('network-replay',{records,followHost:true});
 assert.equal(posts.filter(m=>m.type==='replica-frame').length,120);
 assert.equal(await hashReplicationState(follower.exportCheckpoint()),records.at(-1).hash);
 await request('network-follow',{snapshot});const beforePreview=posts.length;await request('network-replay',{records,catchUp:true,presentCatchUp:true});const previews=posts.slice(beforePreview).filter(m=>m.type==='replica-frame');assert.equal(previews.length,120);assert(previews.every(m=>m.catchUp&&m.audio.length===0));assert.equal(await hashReplicationState(follower.exportCheckpoint()),records.at(-1).hash);
 producer.dispose();replica.dispose();
});

test('actual SNES independent runners reproduce full native/APU state after two-port frame replay',async()=>{
 const require=createRequire(import.meta.url),factory=require('../htdocs/games/engines/snes/posse-snes.cjs'),wasm=fs.readFileSync(new URL('../htdocs/games/engines/snes/posse-snes.wasm',import.meta.url));
 const source=fs.readFileSync(new URL('../htdocs/games/super-mario-world/host-entry.mjs',import.meta.url),'utf8'),config=JSON.parse(/const config=(.*);/.exec(source)[1]),rom=fs.readFileSync(new URL('../htdocs'+config.rom.path,import.meta.url));
 const make=async()=>BrowserSnesRunner.create(config,{rom,core:await factory({wasmBinary:wasm,print(){},printErr(){}})});
 const a=await make(),b=await make();try{
  for(let i=0;i<15;i++)a.step();const saved=await a.save(),snapshot=await replicationSnapshot(a.frame,saved);await b.load(decodeReplicationState(encodeReplicationState(snapshot)).state);
  for(let i=0;i<120;i++){const pads=[i%10<5?256:0,i%14<7?128:0];for(let p=1;p<=2;p++){a.input(p,pads[p-1]);b.input(p,pads[p-1]);}const x=a.step(),y=b.step();assert.deepEqual(x.audio,y.audio);assert.deepEqual(x.rgba,y.rgba);}
  assert.equal(await hashReplicationState(await a.save()),await hashReplicationState(await b.save()));
 }finally{a.dispose();b.dispose();}
});

test('SNES follower renders without audio permission, never advances autonomously, and never touches battery storage',async()=>{
 const {createSnesRuntime}=await import('../htdocs/games/arcade/snes-runtime.mjs');
 const keys=['Worker','AudioContext','indexedDB','performance','requestAnimationFrame','cancelAnimationFrame'],before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));let now=1000,raf,worker,audio,draws=0;
 class W{constructor(){worker=this;this.sent=[];}postMessage(r){this.sent.push(r.op);queueMicrotask(()=>{let result;if(r.op==='init')result={fps:60};else if(r.op==='network-follow')result={frame:r.snapshot.frame,hash:r.snapshot.hash,picture:r.snapshot.picture};else if(r.op==='network-replay'){this.followHost=r.followHost;for(const record of r.records)this.onmessage({data:{type:'replica-frame',result:{frame:record.frame-1,width:1,height:1,rgba:new Uint8Array([1,2,3,255]),audio:new Int16Array(1600)}}});result={frame:r.records.at(-1).frame,hash:null};}else throw Error('Unexpected replica request '+r.op);this.onmessage({data:{id:r.id,result}});});}terminate(){}}
 class A{constructor(){audio=this;this.state='suspended';this.sampleRate=48000;this.currentTime=0;this.destination={};this.resumes=0;}createGain(){return {connect(){},disconnect(){}};}async resume(){this.resumes++;this.state='running';}async close(){}createBuffer(){throw Error('Audio was scheduled without permission');}}
 Object.assign(globalThis,{Worker:W,AudioContext:A,indexedDB:{open(){throw Error('Replica accessed local save data');}},performance:{now:()=>now},requestAnimationFrame:f=>{raf=f;return 1;},cancelAnimationFrame:()=>{raf=null;}});
 const runtime=createSnesRuntime({replica:true,packageId:'replica-test',config:{},canvas:{getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){draws++;}})}});
 try{
  await runtime.load();assert.equal(runtime.network.status().ready,false);await assert.rejects(runtime.network.push([{frame:1,pads:[0,0]}]),/not ready/);
  await runtime.network.follow({frame:20,hash:'a'.repeat(64),picture:{width:1,height:1,rgba:new Uint8Array([4,5,6,255])}});assert.equal(draws,1,'Paused host checkpoint should show without advancing');assert.equal(audio.resumes,0);
  assert.equal(runtime.input('local',0,true),false);await runtime.network.push([{frame:21,pads:[0,0]}],{followHost:true});assert.equal(worker.followHost,true);now+=100;raf(now);assert.equal(draws,2,'Suspended audio clock blocked follower video');assert.equal(runtime.network.status().frame,21);assert.equal(worker.sent.includes('frame'),false);
  await runtime.network.enableAudio();assert.equal(audio.resumes,1);const stale=runtime.network.follow({frame:30,hash:'b'.repeat(64)});runtime.network.setPaused(true);await assert.rejects(stale,/superseded/);assert.equal(runtime.network.status().running,false,'Late import revived a disconnected follower');await runtime.dispose();assert.equal(worker.sent.includes('battery'),false);
 }finally{for(const[k,v]of Object.entries(before))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});

test('NES battery facade handshakes empty state but never reads, writes, or flushes a replica save',async()=>{
 const {createPersistentRuntime}=await import('../htdocs/games/arcade/battery-client.mjs');let native;const sent=[];
 class Worker{constructor(){native=this;queueMicrotask(()=>this.onmessage({data:{type:'battery-await-init'}}));}postMessage(m){sent.push(m);if(m.type==='battery-init')queueMicrotask(()=>this.onmessage({data:{type:'battery-data',record:{untrusted:'private peer battery'}}}));}terminate(){this.terminated=true;}}
 const codec={readSave(){throw Error('Replica read private save');},writeSave(){throw Error('Replica overwrote private save');},validateRecord(){throw Error('Replica attempted battery persistence');}};
 let worker;const base=({WorkerClass})=>({reset(){worker?.terminate();worker=new WorkerClass('test');},pause(){},start(){},input(){},snapshot:()=>({ready:true}),dispose(){worker?.terminate();}});
 const runtime=createPersistentRuntime({replica:true,root:{}},base,codec,{NativeWorker:Worker,storage:{}});
 await runtime.reset();await new Promise(setImmediate);await runtime.dispose();assert.deepEqual(sent,[{type:'battery-init',record:null}]);assert(native.terminated);
});

test('fast checkpoint encoding retains canonical wire bytes for nested arrays, memory and reserved keys',()=>{
 const record={z:[1,null,'z',true,false],memory:new Uint8Array([0,255,128]),array:[{z:2,a:1},[0,3]],empty:undefined};
 assert.equal(new TextDecoder().decode(encodeReplicationState(record)),'{"array":[{"a":1,"z":2},[0,3]],"memory":{"$uint8":"AP+A"},"z":[1,null,"z",true,false]}');
 const reserved=JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
 assert.deepEqual(decodeReplicationState(encodeReplicationState(reserved)),reserved);assert.equal({}.polluted,undefined);
});

test('NES canonical frames survive an input pause but stale pre-load frames cannot enter the restored log',async()=>{
 const {runtimeHarness}=await import('./arcade-runtime-harness.mjs');const {fileURLToPath}=await import('node:url');const h=await runtimeHarness(fileURLToPath(new URL('../htdocs/games/arcade/worker-stream-host.mjs',import.meta.url)));
 const records=[];h.runtime.network.subscribeFrame(r=>records.push(r));h.runtime.reset();const w=h.workers[0];w.receive({type:'ready'});const oldEpoch=w.sent.find(m=>m.type==='sync').epoch;h.runtime.pause();w.receive({type:'network-frame',epoch:oldEpoch,record:{frame:120,pads:[0,0],hash:'a'.repeat(64)}});assert.equal(records.at(-1).frame,120);
 const pending=h.runtime.importCheckpoint({});const rejected=assert.rejects(pending,/unloaded/i);const count=records.length;w.receive({type:'network-frame',epoch:oldEpoch,record:{frame:121,pads:[0,0]}});assert.equal(records.length,count);await h.runtime.dispose();await rejected;
});
