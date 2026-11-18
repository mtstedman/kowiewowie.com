import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
import {loadExactModule} from './arcade-runtime-module-loader.mjs';
const root=new URL('../',import.meta.url),sourceRoot=fileURLToPath(root);
const files=JSON.parse(readFileSync(new URL('./arcade-runtime-source-pins.json',import.meta.url),'utf8')).files;
const filename=p=>fileURLToPath(new URL(p,root));
const fixture=n=>'tests/fixtures/arcade-runtime-module/'+n+'.mjs';
const rows=JSON.parse(readFileSync(new URL('htdocs/games/arcade/catalog.json',root),'utf8'));
const turn=()=>new Promise(setImmediate);
async function quiescent(h){
 await h.runtime.dispose();await h.runtime.dispose();
 assert(h.workers.every(w=>w.dead));assert.equal(h.timers.size,0);assert.equal(h.rafs.size,0);
 assert.equal(h.timerDelays.size,0);
}
for(const name of ['standalone','wrapped'])test('generic '+name+' fixture preserves async lifecycle and context isolation',{timeout:5000},async()=>{
 const a=await runtimeHarness(filename(fixture(name))),b=await runtimeHarness(filename(fixture(name)));
 for(const h of [a,b]){
  const r=h.runtime;assert.equal(r.instance,1);await r.reset();assert.equal(h.workers.length,1);await r.start();
  assert.equal(h.timers.size,1);const firstTimer=[...h.timers.keys()][0];
  r.input('held',0,true);assert(r.held(0));r.pause();assert(!r.held(0));
  await r.reset();assert(h.workers[0].dead);assert.equal(h.workers.length,2);
  assert(!h.timers.has(firstTimer),'Reset must cancel the previous timer before replacing its handle');assert.equal(h.timers.size,1);assert.equal(h.timerDelays.size,1);
  await quiescent(h);assert.equal(h.audioCloses(),1);await r.reset();await r.start();assert.equal(h.workers.length,2);
  assert.equal(h.timers.size,0);assert.equal(h.rafs.size,0);assert.equal(h.audioCloses(),1);assert(r.snapshot().closed);assert(!r.snapshot().running);
 }
 if(name==='wrapped'){assert.equal(a.runtime.marker.count,1);assert.notEqual(a.runtime.marker,b.runtime.marker);}
});

test('exact module loader rejects corruption, unpinned dependencies and external specifiers',{timeout:5000},async()=>{
 const load=(name,pins=files)=>loadExactModule(filename(fixture(name)),{context:vm.createContext({}),sourceRoot,pins});
 const bad={...files,[fixture('shared')]:{...files[fixture('shared')],sha256:'0'.repeat(64)}};
 await assert.rejects(load('wrapped',bad),/SHA256/);
 const missing={...files};delete missing[fixture('shared')];await assert.rejects(load('wrapped',missing),/Unpinned/);
 await assert.rejects(load('external'),/relative module imports/);
 await assert.rejects(load('escape'),/escapes source root/);
 await assert.rejects(load('top-await'),/Top-level await/);
 const dyn=await load('dynamic');await assert.rejects(dyn.namespace.run(),/Dynamic imports/);
 const c=await load('cycle-a');assert.equal(c.namespace.read(),7);
});

test('catalog save facades use actual codec and base lifecycle, flush before termination and restore every byte',{timeout:15000},async()=>{
 let modular=0,standalone=0;
 for(const row of rows){
  const path=filename('htdocs/games/'+row.id+'/host-runtime.mjs'),h=await runtimeHarness(path),r=h.runtime;
  if(!h.battery){standalone++;await quiescent(h);continue;}
  modular++;assert(h.sourceRecords.length>1);await r.reset();const w=h.workers[0];assert(w.initialized);
  assert.equal(w.sent.filter(m=>m.type==='battery-init').length,1);w.receive({type:'ready'});r.start();
  assert(r.input('key',0,true));assert(r.held(0));r.pause();assert(!r.held(0));
  const expected=Uint8Array.from({length:h.battery.bytes},(_,i)=>(i*37+19)&255);w.ram.set(expected);
  await r.reset();assert(w.dead);assert.equal(h.workers.length,2);assert(r.snapshot().loading);
  const w2=h.workers[1];assert(w2.initialized);assert.deepEqual(w2.ram,expected);
  const flush=h.trace.findIndex(e=>e.worker===0&&e.event==='receive'&&e.type==='battery-data');
  const terminated=h.trace.findIndex(e=>e.worker===0&&e.event==='terminate');assert(flush>=0&&terminated>flush);
  assert.equal(h.battery.codec.decodeRAM(JSON.parse(h.storage.getItem(h.battery.codec.storageKey))).length,h.battery.bytes);
  await quiescent(h);assert.equal(h.audioCloses(),1);
  const fresh=await runtimeHarness(path,{storage:h.storage});await fresh.runtime.reset();assert.deepEqual(fresh.workers[0].ram,expected);await quiescent(fresh);
  const record=h.battery.codec.encodeRAM(expected);record.identity.rom_sha256='0'.repeat(64);h.storage.setItem(h.battery.codec.storageKey,JSON.stringify(record));
  await assert.rejects(runtimeHarness(path,{storage:h.storage}),/identity/);
 }
 assert(modular>0,'Catalog must exercise an actual modular save facade');assert(standalone>0,'Catalog must retain standalone coverage');
});

test('save flush cannot terminate early; failures and timeouts reject while resources are released',{timeout:15000},async()=>{
 let covered=0;
 for(const row of rows){
  const path=filename('htdocs/games/'+row.id+'/host-runtime.mjs');
  const probe=await runtimeHarness(path),hasSave=!!probe.battery;await quiescent(probe);if(!hasSave)continue;covered++;
  const h=await runtimeHarness(path,{flushMode:'manual'});await h.runtime.reset();const w=h.workers[0];
  const disposing=h.runtime.dispose();let settled=false;disposing.then(()=>{settled=true;},()=>{settled=true;});await turn();
  assert.equal(w.pending.length,1);assert(!w.dead);assert(!settled);w.replyFlush();await disposing;await quiescent(h);
  const timeout=await runtimeHarness(path,{flushMode:'manual'});await timeout.runtime.reset();
  const rejected=assert.rejects(timeout.runtime.dispose(),/timed out/);await turn();
  const id=[...timeout.timerDelays].find(([,ms])=>ms===4000)?.[0];assert.notEqual(id,undefined);timeout.fireTimer(id);await rejected;
  assert(timeout.workers.every(x=>x.dead));assert.equal(timeout.timers.size,0);assert.equal(timeout.rafs.size,0);
  const broken=await runtimeHarness(path,{flushMode:'error'});await broken.runtime.reset();await assert.rejects(broken.runtime.dispose(),/save|Save/);
  assert(broken.workers.every(x=>x.dead));assert.equal(broken.timers.size,0);assert.equal(broken.rafs.size,0);
  const quota=await runtimeHarness(path,{storage:{getItem:()=>null,setItem(k){if(k.startsWith('romjs-battery/'))throw Error('QuotaExceededError');}}});
  await quota.runtime.reset();await assert.rejects(quota.runtime.dispose(),/QuotaExceededError/);
  assert(quota.workers.every(x=>x.dead));assert.equal(quota.timers.size,0);assert.equal(quota.rafs.size,0);
 }
 assert(covered>0);
});
