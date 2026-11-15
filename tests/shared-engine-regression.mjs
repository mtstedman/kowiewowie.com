import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifySharedEngineMigration} from './shared-engine-history.mjs';
import './shared-engine-construction-test.mjs';
import './shared-engine-emission-test.mjs';
import {verifyInertBank} from './shared-engine-construction.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(join(root,p));
const json=p=>JSON.parse(read(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const pin=b=>({bytes:b.length,sha256:hash(b)});
const audit=json('compatibility-audit.json');assert.equal(audit.length,7);
const removed=new Set(json('receipts/legacy-removals.json').files);
const integrity=json('receipts/integrity.json');
const sourcePins=json('receipts/source-pins.json').files;
for(const path of removed)assert.ok(!Object.hasOwn(integrity.files,path),'Removed original restored: '+path);
for(const path of ['README.md','identity.json','emission-findings-02.json'])assert.ok(!Object.hasOwn(integrity.files,path),'Authoring context emitted: '+path);
const client=json('htdocs/games/netplay/catalog.json');
assert.deepEqual(client,json('includes/api/classes/netplay-catalog.json'));
assert.ok(read('includes/api/classes/NetplayPolicy.php').toString().includes("private const DIGEST='"+hash(read('includes/api/classes/netplay-catalog.json'))+"'"));
assert.ok(read('includes/api/classes/NetplayPolicy.php').toString().includes("self::deny('binding_changed',409)"));
const {validateManifest,verifyPackage}=await import('../htdocs/games/arcade/package.mjs');
for(const g of audit){
 const base='htdocs/games/'+g.id+'/',envelope=json(base+'game-package.json'),m=envelope.manifest;
 validateManifest(m);assert.equal(hash(canonical(m)),envelope.artifactDigest);assert.equal(m.format,'game-package/1');assert.equal(m.hostApi,1);
 assert.equal(client.packages[g.id].artifactDigest,envelope.artifactDigest);
 assert.equal(client.packages[g.id].capabilities.nativePlayers,g.nativePlayers);
 assert.equal(client.packages[g.id].capabilities.play,g.play==='host-p1-guest-p2'?'independent':g.play);
 const legacyKey=base+'network-package.json';
 assert.equal(existsSync(join(root,legacyKey)),g.legacyNetworkEnvelope,'Legacy envelope presence preserved');
 if(g.legacyNetworkEnvelope){
  const legacy=json(legacyKey);assert.equal(legacy.artifactDigest,envelope.artifactDigest);assert.deepEqual(legacy.binding,client.packages[g.id]);assert.ok(sourcePins[legacyKey]);
 }
 const originalClient=JSON.parse(read('receipts/shared-engine-originals/'+sourcePins['htdocs/games/netplay/catalog.json'].sha256));
 assert.deepEqual({...client.packages[g.id],artifactDigest:g.previousArtifactDigest},originalClient.packages[g.id],'Authoritative network policy preserved');
 for(const [path,expected]of Object.entries(m.files))assert.deepEqual(pin(read('htdocs'+path)),expected,path);
 const sidecar=json(base+'composition.json');assert.equal(sidecar.format,'nes-composition/1');
 assert.ok(!Object.hasOwn(sidecar.moduleGraph,'/games/arcade/package.mjs'));
 assert.ok(!Object.hasOwn(sidecar.moduleGraph,'/games/arcade/authenticated-loader.mjs'));
 const active=new Set(),done=new Set();function visit(path){assert.ok(!active.has(path),'Executable cycle');if(done.has(path))return;active.add(path);for(const e of sidecar.moduleGraph[path])visit(e.target);active.delete(path);done.add(path);}visit(m.entry);
 for(const r of Object.values(sidecar.binding))assert.deepEqual(m.files[r.path],{bytes:r.bytes,sha256:r.sha256});
 const manifest=json('htdocs'+sidecar.binding.engineManifest.path);
 assert.equal(manifest.abi,g.abi);assert.deepEqual(manifest.capabilities.mapper,g.requirements.mapper);
 for(const [path,expected]of Object.entries(manifest.files))assert.deepEqual(pin(read('htdocs'+path)),expected,path);
 for(const [path,edges]of Object.entries(sidecar.moduleGraph)){
  assert.ok(!removed.has('htdocs'+path),'Removed original in active graph: '+path);
  const source=read('htdocs'+path).toString();assert.ok(m.files[path]);
  for(const e of edges){assert.equal(source.slice(e.start,e.end),e.original);assert.ok(sidecar.moduleGraph[e.target]);assert.ok(m.files[e.target]);assert.ok(!removed.has('htdocs'+e.target),'Removed dependency in active graph: '+e.target);}
 }
 for(const [path,expected]of Object.entries(g.cartridgeFiles)){
  assert.deepEqual(pin(read(path)),expected,path);
  if(path.split('/').at(-1).startsWith('bank-')){
   verifyInertBank(read(path).toString(),path);
   const name=path.split('/').at(-1),originals=Object.keys(sourcePins).filter(p=>p.startsWith(base)&&p.endsWith('/'+name));
   assert.equal(originals.length,1,'Unique original bank pin: '+path);
   assert.deepEqual(pin(read(path)),sourcePins[originals[0]],'Original bank bytes preserved: '+path);
  }
  if(!path.split('/').at(-1).startsWith('bank-')&&!path.endsWith('/cartridge.mjs')&&!path.endsWith('/source.nes')){
   const text=read(path).toString();assert.ok(!text.includes('/games/engines/')&&!text.includes('../engines/')&&!text.includes('instantiateMachine')&&!text.includes('new WebAssembly.'),path);
  }
 }
 const engine=await import(pathToFileURL(join(root,'htdocs'+Object.values(json('htdocs/games/engines/nes/registry.json').selections).find(s=>s.manifest.path===sidecar.binding.engineManifest.path).entry.path)));
 const cartridge=await import(pathToFileURL(join(root,base+'cartridge/entry.mjs')));
 assert.throws(()=>engine.createMachine({...cartridge,requirements:{...cartridge.requirements,abi:'unsupported/0'}}),/UNSUPPORTED_ENGINE_ABI/);
 const composition=await import(pathToFileURL(join(root,base+'composition-entry.mjs')));
 assert.deepEqual(composition.metadata,cartridge.metadata);
 const composed=composition.createMachine();assert.equal(composed.checkInterpreterGuard(),true);composed.dispose?.();
 const a=engine.createMachine(cartridge),b=engine.createMachine(cartridge);
 assert.notEqual(a,b);assert.deepEqual(a.getState(),b.getState());assert.equal(a.checkInterpreterGuard(),true);
 const initial=b.getState(),frame=b.getFrame(),memory=b.readMemory(0,32);
 a.setButton(1,0,true);a.step();assert.deepEqual(b.getState(),initial);assert.deepEqual(b.getFrame(),frame);assert.deepEqual(b.readMemory(0,32),memory);
 a.reset();assert.deepEqual(a.getState(),b.getState());
 const returned=a.getFrame();returned.fill(0);assert.deepEqual(a.getFrame(),b.getFrame());
 if(g.board.battery){const battery=a.exportBattery();assert.equal(battery.length,8192);battery[0]^=255;a.importBattery(battery);assert.notDeepEqual(a.exportBattery(),b.exportBattery());assert.throws(()=>a.importBattery(new Uint8Array(8191)));}
 a.dispose?.();b.dispose?.();
 const bad=structuredClone(envelope);bad.manifest.files[m.entry].sha256='0'.repeat(64);
 await assert.rejects(()=>verifyPackage(bad,envelope.artifactDigest));
 await assert.rejects(()=>verifyPackage(envelope,g.previousArtifactDigest));
}
const contraBank=await import('../htdocs/games/contra/cartridge/bank-0.mjs');
const contraJSR=contraBank.default[32800];
assert.deepEqual(contraJSR[0],[32,157,237]);assert.equal(contraJSR[2],0);assert.equal(contraJSR[3],2);
assert.ok(contraJSR[1].toString().includes('c.q(32802,237)'),'Deferred operand fetch retained');
const registry=json('htdocs/games/engines/nes/registry.json');
for(const selected of Object.values(registry.selections)){
 const em=json('htdocs'+selected.manifest.path);
 for(const [path,expected]of Object.entries(em.files)){
  const text=read('htdocs'+path).toString();assert.deepEqual(pin(read('htdocs'+path)),expected);
  for(const id of audit.map(g=>g.id))assert.ok(!text.includes('/games/'+id+'/'),'Engine contains game path');
  assert.ok(!text.includes('89232edf4f9b52e3cb872094bc78973de080befca2ddea893b6e936066514d4e'));
  if(text.includes('new WebAssembly.Module')){
   assert.ok(text.indexOf('new WebAssembly.Module')<text.indexOf('export function instantiate'));
   const factory=await import(pathToFileURL(join(root,'htdocs'+path)));
   const first=factory.instantiate([]).createOwnedExports(),second=factory.instantiate([]).createOwnedExports();
   assert.notEqual(first.memory,second.memory);assert.notEqual(first.memory.buffer,second.memory.buffer);
   new Uint8Array(first.memory.buffer)[0]^=255;assert.notEqual(new Uint8Array(first.memory.buffer)[0],new Uint8Array(second.memory.buffer)[0]);
  }
 }
}
verifySharedEngineMigration();
const secondRoot=process.argv[2];assert.ok(secondRoot,'Supply independently assembled compatible second engine release directory');
const secondAudit=JSON.parse(readFileSync(join(resolve(secondRoot),'compatibility-audit.json')));
for(const g of audit){
 const next=secondAudit.find(x=>x.id===g.id);assert.ok(next);assert.deepEqual(next.cartridgeFiles,g.cartridgeFiles,g.id+' cartridge inventory must be release independent');
 for(const path of Object.keys(g.cartridgeFiles))assert.deepEqual(read(path),readFileSync(join(resolve(secondRoot),path)),path);
 assert.notEqual(next.engineManifest.sha256,g.engineManifest.sha256);assert.notEqual(next.artifactDigest,g.artifactDigest);
}
console.log(JSON.stringify({status:'passed',games:audit.length,checks:['package closure','composition binding','both network catalogs','independent machine state','reset','battery','ABI rejection','Wasm instance isolation and shared compile location','two-release cartridge byte identity','successor history']}));
