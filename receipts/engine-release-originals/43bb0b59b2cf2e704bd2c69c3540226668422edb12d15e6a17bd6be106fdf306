import test from 'node:test';
import assert from 'node:assert/strict';
import {createProducer,createTaskScheduler,CAPACITY,RGBA_BYTES} from '../htdocs/games/arcade/worker-stream-producer.mjs';
import {createConsumer} from '../htdocs/games/arcade/worker-stream-consumer.mjs';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
import {exactModuleSource} from './arcade-runtime-module-loader.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyStreamingMigration} from './worker-streaming-history.mjs';
import {verifyPackage} from '../htdocs/games/arcade/package.mjs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const pins=JSON.parse(readFileSync(new URL('./arcade-runtime-source-pins.json',import.meta.url))).files;
function lab(audioSamples=1600){
 let sequence=0,taskId=0,frames=0,cycles=0;const tasks=new Map(),messages=[],samples=[],buttons=Array(16).fill(false);
 const machine={setButton(p,b,v){buttons[(p-1)*8+b]=v;},frame(){samples.push([...buttons]);return {state:{frames:++frames,cycles:cycles+=29781}};},getRGBA(b){return new Uint8ClampedArray(b||new ArrayBuffer(RGBA_BYTES));},takeAudio(){return new Float32Array(audioSamples);}};
 const producer=createProducer({machine,schedule:f=>{tasks.set(++taskId,f);return taskId;},cancel:id=>tasks.delete(id),post:(m,t)=>messages.push(structuredClone(m,{transfer:t||[]}))});
 const send=(type,extra={},transfer=[])=>producer.receive(structuredClone({type,epoch,seq:++sequence,...extra},{transfer}));
 let epoch=1;const consumer=createConsumer({send});
 function sync(){consumer.reset(epoch);send('sync');assert.equal(messages.shift().type,'synced');}
 function step(){assert(tasks.size);const [id,f]=tasks.entries().next().value;tasks.delete(id);f();}
 function drain(){while(messages.length){const m=messages.shift();if(m.type==='error')throw Error(m.message);consumer.accept(m);}}
 sync();return {producer,consumer,tasks,messages,samples,send,step,drain,sync,nextEpoch(){epoch++;sync();}};
}
test('one grant produces several ordered transferable frames, idles, recycles and resumes',()=>{
 const l=lab();assert.equal(l.consumer.grant(.012,.08),4);
 for(let i=0;i<4;i++)l.step();assert.equal(l.tasks.size,0);assert.equal(l.messages.length,4);
 const frames=[...l.messages];l.drain();assert.equal(l.consumer.snapshot().queued,4);
 assert.equal(l.producer.snapshot().outstanding,4);
 for(const f of frames)l.consumer.recycle(f);
 assert.equal(l.producer.snapshot().outstanding,4,'Returns wait for the next grant');
 assert.equal(l.consumer.snapshot().pendingReturns,4);
 assert.equal(l.consumer.grant(.012,.08),4);
 for(const f of frames)assert.equal(f.rgba.byteLength,0,'Grant transfers every returned buffer');
 assert.equal(l.producer.snapshot().outstanding,0);
 assert.equal(l.consumer.snapshot().grantMessages,2);
 assert.equal(l.consumer.snapshot().returnedBuffers,4);
 l.step();assert.equal(l.tasks.size,1);
 l.send('stop');assert.equal(l.tasks.size,0);assert.equal(l.producer.snapshot().credits,0);
});
test('capacity includes grants, in flight and page queues; violations stop visibly',()=>{
 const l=lab(960);l.consumer.grant(0,.2);l.step();const first=l.messages.shift();l.consumer.accept(first);
 for(let i=0;i<4;i++)l.consumer.grant(0,.2);
 assert.equal(l.producer.snapshot().credits+1,CAPACITY);
 for(let i=1;i<CAPACITY;i++)l.step();l.drain();assert.equal(l.consumer.snapshot().queued,16);assert.equal(l.consumer.grant(0,.2),0);
 l.consumer.recycle(first);
 assert.equal(l.consumer.grant(.195,.2),0);
 assert.equal(l.consumer.grant(.155,.2),1,'The only free physical slot wakes the idle producer');
 assert.equal(first.rgba.byteLength,0,'Single-slot return transfers ownership');
 l.step();l.drain();assert.equal(l.consumer.snapshot().queued,16);
 assert.equal(l.producer.snapshot().outstanding,16);assert.equal(l.tasks.size,0);
 l.send('grant',{count:2});assert.equal(l.messages.at(-1).type,'error');assert(l.producer.snapshot().failed);assert.equal(l.tasks.size,0);
});
test('all 16 ownership returns transfer atomically; a seventeenth reservation fails',()=>{
 const l=lab(960);l.consumer.grant(0,.2);l.step();const first=l.messages.shift();l.consumer.accept(first);
 while(l.consumer.grant(0,.2)){}
 while(l.tasks.size)l.step();const frames=[first,...l.messages.splice(0)];
 for(const f of frames.slice(1))l.consumer.accept(f);
 assert.equal(frames.length,16);assert.equal(l.producer.snapshot().outstanding,16);
 for(const f of frames)l.consumer.recycle(f);
 assert.equal(l.consumer.snapshot().pendingReturns,16);
 assert.equal(l.consumer.grant(0,.2),4);
 assert.equal(l.consumer.snapshot().pendingReturns,0);assert.equal(l.producer.snapshot().outstanding,0);
 for(const f of frames){assert.equal(f.rgba.byteLength,0);assert.equal(f.audio.byteLength,0);}
 assert.equal(l.producer.snapshot().credits,4);l.producer.dispose();
 const b=lab(960);b.consumer.grant(0,.2);b.step();const f=b.messages.shift();b.consumer.accept(f);
 while(b.consumer.grant(0,.2)){}
 assert.equal(b.producer.snapshot().credits+b.producer.snapshot().outstanding,16);
 b.send('grant',{count:1,returns:[]});assert(b.producer.snapshot().failed);
 assert.match(b.messages.at(-1).message,/Credit overflow/);assert.equal(b.tasks.size,0);
});
test('yield between frames preserves taps, aggregate source OR and independent P2',()=>{
 const l=lab();l.consumer.input('local',0,true,1);l.consumer.input('remote',0,true,1);l.consumer.input('local',0,false,1);
 l.consumer.input('tap',1,true,2);l.consumer.input('tap',1,false,2);l.consumer.grant(0,.08);l.step();
 assert(l.samples[0][0]);assert(l.samples[0][9]);
 l.consumer.input('remote',0,false,1);l.step();assert(!l.samples[1][0]);assert(!l.samples[1][9]);
 l.drain();assert.equal(l.consumer.snapshot().appliedSeq,6);
});
test('epoch release cancels scheduled production, drops old ownership and rejects stale frames',()=>{
 const l=lab();l.consumer.grant(0,.08);l.step();const stale=l.messages.shift();l.nextEpoch();assert.equal(l.tasks.size,0);
 assert(!l.consumer.accept(stale));l.consumer.recycle(stale);assert.equal(l.producer.snapshot().outstanding,0);
 l.consumer.grant(0,.08);l.producer.dispose();assert.equal(l.tasks.size,0);
});
test('foreign ownership and malformed frames fail visibly without scheduling more work',()=>{
 const l=lab();l.consumer.grant(0,.08);l.step();const frame=l.messages.shift();
 assert.throws(()=>l.consumer.accept({...frame,at:1}),/Malformed/);
 l.send('grant',{count:2,returns:[{id:frame.id+100,rgba:frame.rgba.buffer,audio:frame.audio.buffer}]});
 assert(l.producer.snapshot().failed);assert.equal(l.tasks.size,0);assert.match(l.messages.at(-1).message,/ownership/);
});
test('MessageChannel scheduler yields, cancels queued callbacks and closes both ports',()=>{
 const deliveries=[];let closes=0;
 class Channel{constructor(){this.port1={onmessage:null,close(){closes++;}};this.port2={postMessage:id=>deliveries.push(()=>this.port1.onmessage?.({data:id})),close(){closes++;}};}}
 const scheduler=createTaskScheduler(Channel),seen=[];
 const first=scheduler.schedule(()=>seen.push('cancelled'));
 scheduler.cancel(first);scheduler.schedule(()=>seen.push('next'));
 assert.deepEqual(seen,[],'Scheduling must yield to a later task');
 deliveries.shift()();assert.deepEqual(seen,[]);
 deliveries.shift()();assert.deepEqual(seen,['next']);
 scheduler.schedule(()=>seen.push('disposed'));scheduler.dispose();
 deliveries.shift()();assert.deepEqual(seen,['next']);assert.equal(closes,2);
 assert.throws(()=>scheduler.schedule(()=>{}),/disposed/);
});
test('stop invalidates a callback already removed from the injectable task queue',()=>{
 const l=lab();l.consumer.grant(0,.08);
 const callback=l.tasks.values().next().value;
 l.send('stop');callback();assert.equal(l.samples.length,0);assert.equal(l.tasks.size,0);
 l.nextEpoch();l.consumer.grant(0,.08);callback();assert.equal(l.samples.length,0);
 l.step();assert.equal(l.samples.length,1);l.producer.dispose();
});
test('invalid final return rejects the entire grant without partially releasing leases',()=>{
 const l=lab();l.consumer.grant(0,.08);l.step();l.step();
 const [a,b]=l.messages.splice(0);
 const before=l.producer.snapshot();
 l.send('grant',{count:2,returns:[{id:a.id,rgba:a.rgba.buffer,audio:a.audio.buffer},{id:b.id+100,rgba:b.rgba.buffer,audio:b.audio.buffer}]});
 assert(l.producer.snapshot().failed);
 assert.equal(l.producer.snapshot().outstanding,before.outstanding,'No partial ownership commit');
 assert.equal(l.tasks.size,0);assert.match(l.messages.at(-1).message,/ownership/);
});
test('steady production returns all buffers exclusively in grant messages',()=>{
 const l=lab();let frames=0;
 for(let batch=0;batch<20;batch++){
  assert.equal(l.consumer.grant(.012,.08),4);
  for(let i=0;i<4;i++)l.step();
  const received=l.messages.splice(0);
  for(const frame of received){assert.equal(frame.type,'frame');l.consumer.accept(frame);l.consumer.recycle(frame);frames++;}
  assert.equal(l.tasks.size,0,'No scheduled production while backpressured');
 }
 const s=l.consumer.snapshot();assert.equal(frames,80);assert.equal(s.grantMessages,20);
 assert.equal(s.returnedBuffers,76);assert.equal(s.pendingReturns,4);
 assert.equal(l.producer.snapshot().outstanding,4);
 l.producer.dispose();
});
test('duplicate recycle and edge overflow are visible errors',()=>{
 const l=lab();l.consumer.grant(0,.08);l.step();const f=l.messages.shift();l.consumer.accept(f);l.consumer.recycle(f);
 assert.throws(()=>l.consumer.recycle(f),/Duplicate/);
 const b=lab();for(let i=0;i<33;i++)b.consumer.input('tap',0,i%2===0,1);
 assert(b.producer.snapshot().failed);assert.match(b.messages.at(-1).message,/overflow/);assert.equal(b.tasks.size,0);
});
test('watchdog detects outstanding production and cancels after pause',async()=>{
 const h=await runtimeHarness(resolve(sourceRoot,'htdocs/games/contra/host-runtime.mjs')),r=h.runtime;
 await r.reset();const w=h.workers[0];w.receive({type:'ready'});r.start(false);
 const barrier=w.sent.findLast(m=>m.type==='sync');w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
 assert(r.snapshot().stream.credits>0);
 const watchdog=[...h.timerDelays].find(([,ms])=>ms===120000);assert(watchdog);
 h.fireTimer(watchdog[0]);assert.match(r.snapshot().message,/Frame worker timed out/);assert(w.dead);
 await r.dispose();assert.equal(h.timers.size,0);
 const p=await runtimeHarness(resolve(sourceRoot,'htdocs/games/contra/host-runtime.mjs'));
 await p.runtime.reset();const pw=p.workers[0];pw.receive({type:'ready'});p.runtime.start(false);
 let sync=pw.sent.findLast(m=>m.type==='sync');pw.receive({type:'synced',epoch:sync.epoch,seq:sync.seq});
 const old=[...p.timerDelays].find(([,ms])=>ms===120000);assert(old);
 const queued=p.timers.get(old[0]);p.runtime.pause();sync=pw.sent.findLast(m=>m.type==='sync');
 pw.receive({type:'synced',epoch:sync.epoch,seq:sync.seq});queued();
 assert(!pw.dead);assert(!p.runtime.snapshot().running);assert.equal(p.timers.size,0);
 await p.runtime.dispose();
});
test('watchdog cancels when all granted work arrives and the page holds capacity',async()=>{
 const h=await runtimeHarness(resolve(sourceRoot,'htdocs/games/contra/host-runtime.mjs')),r=h.runtime;
 await r.reset();const w=h.workers[0];w.receive({type:'ready'});r.start(false);
 const barrier=w.sent.findLast(m=>m.type==='sync');w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
 const duration=1/60.0988;let id=0;
 while(r.snapshot().stream.credits>0){
  assert(++id<=CAPACITY);
  w.receive({type:'frame',epoch:barrier.epoch,id,produced:id,at:(id-1)*duration,duration,rgba:new Uint8ClampedArray(RGBA_BYTES),audio:new Float32Array(),frames:id,cycles:id*29781,inputSeq:0,appliedSeq:0});
 }
 assert(r.snapshot().running);assert(r.snapshot().stream.queued>0);
 assert(![...h.timerDelays.values()].includes(120000),'No watchdog when no producer work is outstanding');
 await r.dispose();assert.equal(h.timers.size,0);
});
for(const game of ['megaman','adventure-island-2','castlevania','ikari-warriors','bionic-commando','zelda','contra'])test(game+' host release barrier, independent updates, reset and disposal',async()=>{
 const h=await runtimeHarness(resolve(sourceRoot,'htdocs/games/'+game+'/host-runtime.mjs')),r=h.runtime;
 await r.reset();const w=h.workers[0];w.receive({type:'ready'});r.start(false);
 assert(w.url.endsWith('/'+game+'/worker.mjs'));
 assert.equal(w.sent.filter(m=>m.type==='grant').length,0,'No production before release acknowledgement');
 let barrier=w.sent.findLast(m=>m.type==='sync');assert(barrier);
 w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
 assert(w.sent.some(m=>m.type==='grant'&&m.count>1));
 const before=w.sent.length;r.input('tap',0,true);r.input('tap',0,false);
 assert.deepEqual(w.sent.slice(before).filter(m=>m.type==='input').map(m=>m.pressed),[true,false]);
 r.input('local',1,true);r.input('remote:peer',1,true);r.clearRemote();assert(r.held(1));
 assert(w.sent.some(m=>m.type==='input'&&m.source==='remote1:remote:peer'&&!m.pressed));
 r.pause();assert(!r.held(1));barrier=w.sent.findLast(m=>m.type==='sync');
 const grants=w.sent.filter(m=>m.type==='grant').length;r.start(false);
 assert.equal(w.sent.filter(m=>m.type==='grant').length,grants);
 w.receive({type:'synced',epoch:barrier.epoch-1,seq:barrier.seq});
 assert.equal(w.sent.filter(m=>m.type==='grant').length,grants);
 w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
 assert(w.sent.filter(m=>m.type==='grant').length>grants);
 await r.reset();assert(w.dead);await r.dispose();assert(h.workers.every(x=>x.dead));assert.equal(h.timers.size,0);assert.equal(h.rafs.size,0);
});
test('current packages cover authored modules and migration rejects current and historical tampering',async()=>{
 const read=p=>readFileSync(resolve(sourceRoot,p)),hash=b=>createHash('sha256').update(b).digest('hex');
 const migration=verifyStreamingMigration(read);
 const rows=JSON.parse(read('htdocs/games/arcade/catalog.json'));
 for(const row of rows){
  const p=await verifyPackage(JSON.parse(read('htdocs'+row.manifest)),row.artifactDigest);
  for(const name of ['host','producer','consumer'])assert(p.files['/games/arcade/worker-stream-'+name+'.mjs']);
  for(const [url,pin] of Object.entries(p.files)){const bytes=read('htdocs'+url);assert.equal(bytes.length,pin.bytes,url);assert.equal(hash(bytes),pin.sha256,url);}
 }
 const changed=Object.keys(migration.changes)[0];
 for(const path of ['htdocs/games/arcade/worker-stream-producer.mjs','htdocs/games/netplay/catalog.json',migration.changes[changed].original,'tests/worker-streaming-migration.json']){
  assert.throws(()=>verifyStreamingMigration(p=>{const bytes=Buffer.from(read(p));if(p===path)bytes[0]^=1;return bytes;}),path);
 }
});
// Execute the exact authored Zelda worker and codec; only its engine is a fake.
async function batteryWorker(){
 let id=0,frames=0;const tasks=new Map(),messages=[],ram=new Uint8Array(8192);
 const machine={setButton(){},frame(){return {state:{frames:++frames,cycles:frames*29781}};},getRGBA(b){return new Uint8ClampedArray(b||new ArrayBuffer(RGBA_BYTES));},takeAudio(){return new Float32Array(1600);},exportBattery(){return ram.slice();},importBattery(v){ram.set(v);}};
 class Channel{constructor(){this.port1={onmessage:null,close(){}};this.port2={postMessage:k=>{tasks.set(++id,()=>this.port1.onmessage?.({data:k}));},close(){tasks.clear();}};}}
 const context=vm.createContext({machine,MessageChannel:Channel,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,TextEncoder,TextDecoder,btoa,atob,
  postMessage:(m,t)=>messages.push(structuredClone(m,{transfer:t||[]})),setTimeout:f=>{tasks.set(++id,f);return id;},clearTimeout:k=>tasks.delete(k)});
 const modules=new Map();
 function get(file){
  if(modules.has(file))return modules.get(file);
  const fake=file===resolve(sourceRoot,'htdocs/games/zelda/composition-entry.mjs');
  const text=fake?'export const createMachine=()=>globalThis.machine;':exactModuleSource(sourceRoot,file,pins).text;
  const m=new vm.SourceTextModule(text,{context,identifier:pathToFileURL(file).href,importModuleDynamically(){throw Error('Dynamic imports disabled');}});modules.set(file,m);return m;
 }
 const main=get(resolve(sourceRoot,'htdocs/games/zelda/worker.mjs'));
 await main.link((specifier,parent)=>{assert.match(specifier,/^\.\.?\/[A-Za-z0-9_./-]+\.mjs$/);return get(resolve(dirname(fileURLToPath(parent.identifier)),specifier));});
 for(const m of modules.values())assert(!m.hasTopLevelAwait());await main.evaluate({timeout:2000});
 return {messages,tasks,ram,send:d=>context.onmessage({data:structuredClone(d)}),step(){const [k,f]=tasks.entries().next().value;tasks.delete(k);f();}};
}
test('grant rounding, outstanding reservations and a single free slot remain live',()=>{
 const l=lab();
 assert.equal(l.consumer.grant(.012,.08),4);
 assert.equal(l.consumer.grant(.012,.08),1,'Round deficit up instead of losing a frame to floor/min2');
 assert.equal(l.consumer.grant(.012,.08),0,'Outstanding credits are reserved exactly once');
 for(let i=0;i<5;i++)l.step();l.drain();
 assert.equal(l.consumer.grant(.084,.2),4);
 assert.equal(l.consumer.grant(.084,.2),3);
 assert.equal(l.consumer.grant(.084,.2),0,'Existing credits reserve the remaining target exactly once');
 for(let i=0;i<7;i++)l.step();
 const frames=l.messages.splice(0);for(const f of frames)l.consumer.accept(f);
 assert.equal(l.consumer.snapshot().queued,12);
 assert.equal(l.consumer.grant(.2,.2),0,'Extra physical slots do not raise the media target');
 l.consumer.recycle(frames[0]);
 assert.equal(l.consumer.grant(.19,.2),1,'One-frame deficit must wake an idle producer');
 assert.equal(frames[0].audio.byteLength,0,'Single grant retains transfer ownership');
 l.step();assert.equal(l.tasks.size,0);l.drain();
 assert.equal(l.consumer.snapshot().queued,12);
 assert.equal(l.producer.snapshot().outstanding,12);
 l.producer.dispose();l.consumer.reset(-1);assert.equal(l.consumer.grant(0,.08),0);
});
test('credit target retains an absolute time cap even after arbitrarily long starvation',()=>{
 const l=lab();assert.equal(l.consumer.grant(-100,100),4);
 assert.equal(l.consumer.grant(-100,100),4);assert.equal(l.consumer.grant(-100,100),4);assert.equal(l.consumer.grant(-100,100),1);assert.equal(l.consumer.grant(-100,100),0);
 // Initial nominal duration rounds 200ms up to 13 frame reservations.
 assert.equal(l.producer.snapshot().credits,13);
 for(let i=0;i<13;i++)l.step();l.drain();
 assert.equal(l.tasks.size,0);assert.equal(l.consumer.snapshot().queued,13);
 assert.equal(l.consumer.grant(.2,100),0,'High caller target retains absolute 200ms cap');
 l.nextEpoch();assert.equal(l.consumer.snapshot().queued,0);assert.equal(l.consumer.snapshot().credits,0);
 assert.equal(l.consumer.grant(.079,.08),1,'A sub-frame target deficit is live');
 l.step();l.drain();assert.equal(l.tasks.size,0);l.producer.dispose();
});
async function audioScheduleLab(){
 const h=await runtimeHarness(resolve(sourceRoot,'htdocs/games/contra/host-runtime.mjs')),r=h.runtime;
 await r.reset();const w=h.workers[0];w.receive({type:'ready'});r.start();
 await Promise.resolve();await Promise.resolve();
 const ac=h.contexts[0],starts=[],stops=[];
 ac.createBuffer=(channels,n,rate)=>({channels,n,rate,data:Array.from({length:channels},()=>new Float32Array(n)),getChannelData(ch){return this.data[ch];}});
 ac.createBufferSource=()=>({connect(){},disconnect(){},stop(at){stops.push(at);},start(at){starts.push({at,buffer:this.buffer});}});
 const barrier=w.sent.findLast(m=>m.type==='sync');w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
 let id=0;const duration=800/48000;
 function frame(){const audio=new Float32Array(1600);for(let i=0;i<audio.length;i++)audio[i]=(i%19-9)/16;
  const expected=audio.slice();id++;
  w.receive({type:'frame',epoch:barrier.epoch,id,produced:id,at:(id-1)*duration,duration,rgba:new Uint8ClampedArray(RGBA_BYTES),audio,frames:id,cycles:id*29781,inputSeq:0,appliedSeq:0});
  assert(r.snapshot().running,r.snapshot().message);
  const b=starts.at(-1).buffer;assert.equal(b.rate,48000);assert.equal(b.n,800);
  for(let i=0;i<800;i++){assert.equal(b.data[0][i],expected[2*i]);assert.equal(b.data[1][i],expected[2*i+1]);}
  const end=starts.at(-1).at+duration;
  // Present eligible frames so this test respects bounded transport ownership.
  const [raf,callback]=h.rafs.entries().next().value;h.rafs.delete(raf);callback(1000+ac.currentTime*1000);
  return end;
 }
 return {h,r,w,ac,starts,stops,frame};
}
test('positive sub-3ms lead schedules exact contiguous PCM; real underruns recover once',async()=>{
 const l=await audioScheduleLab();
 try{
  assert.equal(l.r.snapshot().bufferTarget,.08);
  let end=l.frame();
  for(const lead of [.0029,.001,.0001,0]){l.ac.currentTime=end-lead;const previous=end;end=l.frame();assert.equal(l.starts.at(-1).at,previous,'Queued PCM must retain its exact previous end');assert.equal(l.r.snapshot().bufferTarget,.08,'Nonnegative lead never adapts');}
  for(const late of [.001,10,.002,.1,.003,1,2,3]){
   const target=l.r.snapshot().bufferTarget;
   l.ac.currentTime=end+late;const now=l.ac.currentTime;end=l.frame();
   assert.equal(l.starts.at(-1).at,now+.012,'Recovery adds only the bounded startup lead');
   assert.equal(l.r.snapshot().bufferTarget,Math.min(.2,target+.02),'Only true underruns grow lead by 20ms up to 200ms');
   const adapted=l.r.snapshot().bufferTarget;
   const previous=end;end=l.frame();assert.equal(l.starts.at(-1).at,previous,'Recovery does not rebase every queued frame');
   assert.equal(l.r.snapshot().bufferTarget,adapted,'Queued recovery frames do not adapt again');
  }
 }finally{await l.r.dispose();}
 assert.equal(l.h.timers.size,0);assert.equal(l.h.rafs.size,0);assert(l.w.dead);
});
test('audio clock conversion, pause barrier and reset preserve scheduling lifecycle',async()=>{
 const l=await audioScheduleLab();
 try{
  l.frame();l.ac.currentTime=.001;
  l.ac.state='suspended';l.ac.onstatechange();l.ac.state='running';l.ac.onstatechange();
  assert(l.r.snapshot().running);assert(l.starts.length>=2,'Gesture clock conversion reschedules future queued PCM');
  const before=l.starts.length;l.r.pause();assert(l.stops.length);assert(!l.r.snapshot().running);
  const barrier=l.w.sent.findLast(m=>m.type==='sync');
  l.r.start(false);const grants=l.w.sent.filter(m=>m.type==='grant').length;
  l.w.receive({type:'synced',epoch:barrier.epoch-1,seq:barrier.seq});
  assert.equal(l.w.sent.filter(m=>m.type==='grant').length,grants);
  l.w.receive({type:'synced',epoch:barrier.epoch,seq:barrier.seq});
  assert(l.w.sent.filter(m=>m.type==='grant').length>grants);assert.equal(l.starts.length,before,'Pause discards prior-epoch queued audio');
  await l.r.reset();assert(l.w.dead);assert.equal(l.r.snapshot().stream.credits,0);
 }finally{await l.r.dispose();}
 assert.equal(l.h.timers.size,0);assert.equal(l.h.rafs.size,0);
});
test('actual Zelda worker imports saved RAM before ready, exports periodically and flushes paused',async()=>{
 const w=await batteryWorker();assert.equal(w.messages.shift().type,'battery-await-init');
 w.send({type:'battery-init',record:null});assert.equal(w.messages.shift().type,'ready');
 w.ram.fill(37);w.send({type:'battery-flush',request:1});const saved=w.messages.shift();assert.equal(saved.type,'battery-data');assert.equal(saved.request,1);
 const restored=await batteryWorker();restored.messages.length=0;restored.send({type:'battery-init',record:saved.record});assert.equal(restored.messages.shift().type,'ready');assert(restored.ram.every(v=>v===37));
 let periodic=0;
 let seq=0;const send=(type,extra={})=>w.send({type,epoch:1,seq:++seq,...extra});send('sync');assert.equal(w.messages.shift().type,'synced');
 let returns=[];
 for(let n=0;n<15;n++){
  send('grant',{count:4,returns});returns=[];for(let i=0;i<4;i++)w.step();
  for(const d of w.messages.splice(0))if(d.type==='frame')returns.push({id:d.id,rgba:d.rgba.buffer,audio:d.audio.buffer});else{periodic++;assert.equal(d.type,'battery-data');assert.equal(d.request,0);assert.equal(n,14);}
 }
 assert.equal(periodic,1);assert.equal(w.tasks.size,0);send('sync');w.messages.length=0;
 w.send({type:'battery-flush',request:2});assert.equal(w.messages.shift().request,2);assert.equal(w.tasks.size,0);
});
