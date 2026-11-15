import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {Catalog,verifyPackage,canonical,playDescription,validateManifest} from '../htdocs/games/arcade/package.mjs';
import {GameHost} from '../htdocs/games/arcade/host.mjs';
import {hostAdapter,createBridge,invitationMessage} from '../htdocs/games/arcade/session-bridge.mjs';
import {validateBinding,assignment,zero} from '../htdocs/games/netplay/policy.mjs';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),hash=b=>createHash('sha256').update(b).digest('hex');
const plan=json('tests/cartridge-library-plan.json'),rows=json('htdocs/games/arcade/catalog.json'),net=json('htdocs/games/netplay/catalog.json');
const packages=await Promise.all(rows.map(r=>verifyPackage(json('htdocs'+r.manifest),r.artifactDigest)));
test('exact preservation, authoritative package digests and matched catalogs',()=>{
 assert.deepEqual(read('htdocs/games/netplay/catalog.json'),read('includes/api/classes/netplay-catalog.json'));
 assert(read('includes/api/classes/NetplayPolicy.php').toString().includes("DIGEST='"+hash(read('htdocs/games/netplay/catalog.json'))+"'"));
 for(const [p,r] of Object.entries(plan.preserved)){const b=read(p);assert.equal(b.length,r.bytes,p);assert.equal(hash(b),r.sha256,p);}
 for(const r of plan.originalRows){const migration=plan.identityMigrations.find(x=>x.id===r.id);assert.deepEqual(rows.find(x=>x.id===r.id),migration?{...r,artifactDigest:migration.after}:r);}
 for(const p of packages){for(const [u,r] of Object.entries(p.files)){const b=read('htdocs'+u);assert.equal(b.length,r.bytes,u);assert.equal(hash(b),r.sha256,u);}const b=validateBinding(net.packages[p.id]);assert.equal(b.artifactDigest,p.artifactDigest);assert.equal(b.capabilities.nativePlayers,p.capabilities.nativePlayers);assert.equal(b.inputsDigest,hash(canonical(p.inputs.map(({id,label,kind})=>({id,label,kind})))));}
 const c=new Catalog();packages.forEach(p=>c.register(p));for(const p of packages){const r=c.route('/games/arcade/?package='+p.id);assert.equal(r.id,p.id);assert.equal(r.canonical,null);assert.equal(new URL(c.route(p.route).canonical,'https://fixture.invalid').pathname,'/games/arcade/');}
});
test('shared-copy identity migrations change only the declared shared dependency and derived metadata',()=>{
 for(const x of plan.identityMigrations){const p=packages.find(p=>p.id===x.id),{artifactDigest,...m}=p,old=structuredClone(x.original_manifest);assert(x.shared_changes.length>0);
 assert.equal(hash(canonical(old)),x.before);assert.equal(artifactDigest,x.after);assert.notEqual(x.before,x.after);for(const {member:u,after:shared_after,before:shared_before} of x.shared_changes){assert.deepEqual(old.files[u],shared_before);assert.deepEqual(m.files[u],shared_after);old.files[u]=shared_after;}assert.deepEqual(m,old);
 const prefix='htdocs'+p.route,n=json(prefix+'network-package.json'),outer=json(prefix+'manifest.json'),bi=json(prefix+'bundle-inputs.json');assert.equal(n.artifactDigest,x.after);assert.deepEqual(n.binding,net.packages[p.id]);assert.equal(outer.artifactDigest,x.after);
 for(const [name,r] of Object.entries(bi)){const b=read(prefix+name);assert.equal(b.length,r.bytes);assert.equal(hash(b),r.sha256);}
 for(const [name,r] of Object.entries(outer.files)){const b=read(prefix+name);assert.equal(b.length,r.bytes);assert.equal(hash(b),r.sha256);}
 }
});
test('per-game 256 MiB contract remains enforced independently of aggregate capacity',()=>{
 const m=structuredClone(plan.identityMigrations[0].original_manifest),r={bytes:67108864,sha256:'a'.repeat(64)};m.files={[m.entry]:{...r},[m.route+'part2.mjs']:{...r},[m.route+'part3.mjs']:{...r},[m.route+'part4.mjs']:{...r}};validateManifest(m);m.files[m.route+'overflow.mjs']={bytes:1,sha256:'b'.repeat(64)};assert.throws(()=>validateManifest(m),/ceiling/);
});
test('real bridge initial and updated invitation copy follows verified solo, simultaneous and alternating capabilities',{timeout:5000},async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({setAttribute(){},pause(){},remove(){},srcObject:null})}});
 try{for(const mode of ['solo','simultaneous','alternating']){const c={verified:true,evidence:'Synthetic capability test',nativePlayers:mode==='solo'?1:2,mode,play:mode==='solo'?'shared-hero':'host-p1-guest-p2',watch:true};const m=structuredClone(plan.identityMigrations[0].original_manifest);m.capabilities=c;const d=hash(canonical(m)),p=await verifyPackage({manifest:m,artifactDigest:d},d);const text=invitationMessage(p);assert.match(text,mode==='solo'?/share this hero/:mode==='alternating'?/take turns/:/join the game/);if(mode!=='solo')assert.doesNotMatch(text,/hero/);
 const bridge=createBridge(p,{},null);try{assert.equal(bridge.provider.getState().message,text);await bridge.attach({bindSession:()=>({}),getState:()=>({})});assert.equal(bridge.provider.getState().message,text);await bridge.end();assert.equal(bridge.provider.getState().message,text);assert.equal(bridge.provider.sendInput({role:'spectator',pressed:true}),false);}finally{await bridge.dispose();}
 }}finally{if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;}
});
function fixtureAdapter(p,held){let closed=false;return {version:1,packageId:p.id,artifactDigest:p.artifactDigest,load(){},start(){},pause(){},resume(){},reset(){held.clear();},dispose(){closed=true;held.clear();},input(e){if(closed)return false;if(e.pressed)held.set(e.source,e);else held.delete(e.source);return true;},releaseAll(){held.clear();},releaseSources(sources){for(const s of sources)held.delete(s);},snapshot:()=>({ready:!closed,running:!closed,loading:false,closed}),surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:'CANVAS'},audio:{kind:'web-audio',getNodes:()=>({context:null,node:null})}})};}
for(const p of packages.filter(p=>plan.newIds.includes(p.id)))test(p.id+': real host/bridge port assignment, spectator denial, release and reload',{timeout:5000},async()=>{
 const b=validateBinding(net.packages[p.id]),catalog=new Catalog(),held=new Map();catalog.register(p);const h=new GameHost(catalog,{loader:async()=>({version:1,createAdapter:()=>fixtureAdapter(p,held)})});
 await h.load(p.id,{solo:true});const state={role:'host',phase:'active',epoch:1,reconnect:'none',watch:'available',play:'available',message:'Synthetic authority test'};
 const provider={version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>state,subscribe:()=>()=>{},inviteWatch(){},invitePlay(){},sendInput(){return false;},releaseInputs(){},enableAudio(){},getMedia(){throw Error('Host only');},dispose(){}};
 const lease=h.bindSession(provider),adapter=hostAdapter(p,b,lease,()=>state,()=>h.snapshot().runtime);
 const a={protocol:3,catalog:b.catalog,binding:b.version,packageId:p.id,artifactDigest:p.artifactDigest,inputsDigest:b.inputsDigest,inputProfile:b.inputProfile,compatibility:b.compatibility,participant:'1'.repeat(32),participant_role:'play',session:'2'.repeat(32),player:b.players.remote,capabilities:{video:true,audio:true,input:true}};
 adapter.admit(a);assert(h.input({control:'a',source:'host-a',pressed:true}));adapter.remote(a.participant,a.session,a.player,{...zero(b),right:true});
 assert.equal(held.get('local:host-a').seat,1);const remote=held.get('remote:'+a.participant+':right');assert(remote);assert.equal(remote.seat,p.capabilities.nativePlayers===2?2:1);
 assert.throws(()=>adapter.remote(a.participant,'3'.repeat(32),a.player,zero(b)));assert.throws(()=>adapter.remote(a.participant,a.session,b.players.remote+'-forged',zero(b)));
 const watch={...a,participant:'4'.repeat(32),participant_role:'watch',player:null,capabilities:{video:true,audio:true,input:false}};assignment(b,watch);assert.throws(()=>adapter.admit(watch));assert.equal(lease.input({control:'a',source:'watcher',pressed:true,seat:1,epoch:1,role:'spectator'}),false);
 adapter.remove(a.participant);assert.equal(held.size,1);assert(held.has('local:host-a'));await h.unload();assert.equal(held.size,0);assert.equal(h.input({control:'a',source:'old',pressed:true}),false);await h.load(p.id,{solo:true});assert(h.input({control:'a',source:'new',pressed:true}));await h.dispose();assert.equal(held.size,0);
 if(p.capabilities.mode==='alternating')assert.match(playDescription(p),/take turns/);else if(p.capabilities.mode==='simultaneous')assert.match(playDescription(p),/play together/);else assert.match(playDescription(p),/same character/);
});
for(const id of plan.newIds)test(id+': preserved frame-sampled input and lifecycle wrapper',async()=>{
 const g=plan.games.find(g=>g.slug===id),path='htdocs/games/'+id+'/'+(g.battery?'host-runtime-base.mjs':'host-runtime.mjs');
 const f=await runtimeHarness(fileURLToPath(new URL(path,root))),r=f.runtime;await r.reset();const w=f.workers[0];w.receive({type:'ready'});await r.start(false);assert(r.input('local:held',0,true));assert(r.input('remote:p2',7,true,2));r.clearRemote();assert(r.held(0));await r.pause();assert(!r.held(0));await r.dispose();assert(w.dead);assert.equal(f.rafs.size,0);assert.equal(f.timers.size,0);
});
for(const g of plan.games.filter(g=>g.battery)){
 const prefix='htdocs/games/'+g.slug+'/';
 const codec=await import(new URL(prefix+'battery-codec.mjs',root));const {createPersistentRuntime}=await import(new URL(prefix+'battery-client.mjs',root));
 test(g.slug+': save codec rejects identity, version, length and byte corruption',()=>{
  const valid=codec.encodeRAM(new Uint8Array(8192).fill(23));assert.deepEqual(codec.decodeRAM(valid),new Uint8Array(8192).fill(23));
  for(const change of [v=>v.format='bad',v=>v.identity.version++,v=>v.identity.rom_sha256='f'.repeat(64),v=>v.identity.mapping_identity='e'.repeat(64),v=>v.identity.mapper=99,v=>v.identity.ram_bytes=1,v=>v.data.pop(),v=>v.data.push(0),v=>v.data[0]=-1,v=>v.data[0]=256,v=>v.data[0]=1.5,v=>v.extra=true]){const v=structuredClone(valid);change(v);assert.throws(()=>codec.validateRecord(v));}
  const map=new Map(),s={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};codec.writeSave(s,valid);assert.deepEqual(codec.readSave(s),valid);assert.throws(()=>codec.writeSave({setItem(){throw Error('QuotaExceededError');}},valid));
 });
 test(g.slug+': graceful unload/reload and reset flush before terminating; invalid saves cannot launch a worker',{timeout:8000},async()=>{
  const saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},workers=[];let restored=[];
  class Worker{constructor(){this.dead=false;this.data=new Uint8Array(8192);workers.push(this);queueMicrotask(()=>this.onmessage?.({data:{type:'battery-await-init'}}));}postMessage(d){assert(!this.dead);if(d.type==='battery-init'){if(d.record)this.data.set(codec.decodeRAM(d.record));restored.push(this.data[0]);queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}else if(d.type==='battery-flush')queueMicrotask(()=>this.onmessage?.({data:{type:'battery-data',request:d.request,record:codec.encodeRAM(this.data)}}));}terminate(){this.dead=true;}}
  const baseFactory=({WorkerClass})=>{let w=null,closed=false;return {reset(){w?.terminate();w=new WorkerClass('synthetic',{type:'module'});},pause(){},start(){},input(){return !closed;},dispose(){closed=true;w?.terminate();},snapshot:()=>({ready:!!w,running:!closed,loading:false,closed})};};
  const make=()=>createPersistentRuntime({root:{}},baseFactory,{NativeWorker:Worker,storage});let r=make();await r.reset();await new Promise(setImmediate);workers.at(-1).data[0]=91;await r.dispose();assert(workers.every(w=>w.dead));r=make();await r.reset();await new Promise(setImmediate);assert.equal(restored.at(-1),91);workers.at(-1).data[0]=37;await r.reset();await new Promise(setImmediate);assert.equal(restored.at(-1),37);await r.dispose();assert(workers.every(w=>w.dead));
  const count=workers.length;saved.set(codec.storageKey,JSON.stringify({format:'wrong'}));assert.throws(make);assert.equal(workers.length,count);
 });
 test(g.slug+': worker persistence handshake, independent ports and release on malformed input',()=>{
  const source=read(prefix+'worker.mjs').toString().split('\n').filter(line=>!line.startsWith('import ')).join('\n');
  function instance(){const messages=[],ports=[Array(8).fill(false),Array(8).fill(false)],ram=new Uint8Array(8192);let frames=0;const seen=[];const machine={exportBattery:()=>ram.slice(),importBattery:b=>ram.set(b),setButton:(p,b,v)=>{ports[p-1][b]=v;},frame(){seen.push(ports.map(p=>p.slice()));ram[0]=77;return {state:{frames:++frames,cycles:frames*29780}};},getRGBA:()=>new Uint8ClampedArray(245760),takeAudio:()=>new Float32Array()};const context=vm.createContext({createMachine:()=>machine,encodeRAM:codec.encodeRAM,decodeRAM:codec.decodeRAM,postMessage:d=>messages.push(d),Uint8Array,Uint8ClampedArray,Float32Array});vm.runInContext(source,context,{timeout:1000});return {messages,ports,ram,seen,send:d=>{context.d=d;vm.runInContext('onmessage({data:d})',context,{timeout:1000});}};}
  let f=instance();assert.equal(f.messages[0].type,'battery-await-init');f.send({type:'battery-init',record:null});assert.equal(f.messages.at(-1).type,'ready');f.send({type:'sync',epoch:1,seq:1});const a=Array(8).fill(false),b=Array(8).fill(false);a[0]=true;b[7]=true;f.send({type:'frame',epoch:1,seq:2,buttons:a,buttons2:b});assert.deepEqual(f.seen[0],[a,b]);assert(f.ports.every(p=>p.every(v=>!v)));f.send({type:'battery-flush',request:1});const record=f.messages.at(-1).record;assert.equal(record.data[0],77);f=instance();f.send({type:'battery-init',record});assert.equal(f.ram[0],77);f.send({type:'sync',epoch:1,seq:1});f.send({type:'frame',epoch:1,seq:2,buttons:[true],buttons2:b});assert.equal(f.messages.at(-1).type,'error');assert(f.ports.every(p=>p.every(v=>!v)));
 });
}
test('accessor-only fixture preserves CPU/mapper/volatile RAM and copies both directions',async()=>{
 const {createMachine}=await import('./fixtures/cartridge-battery-accessors.mjs');const m=createMachine(),before=m.getState();const bytes=new Uint8Array(8192).fill(19);m.importBattery(bytes);bytes[0]=7;assert.equal(m.exportBattery()[0],19);const exported=m.exportBattery();exported[0]=2;assert.equal(m.exportBattery()[0],19);assert.deepEqual(m.getState(),before);for(const x of [new Uint8Array(8191),new Uint8Array(8193),Array(8192).fill(0)])assert.throws(()=>m.importBattery(x));
});
