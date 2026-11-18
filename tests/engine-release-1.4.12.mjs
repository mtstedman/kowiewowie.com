// Explicit later execution only. Usage: node <this-file> <runner.mjs> <original-input.json>
// For a neutral probe, put a unique comment INSIDE instantiate(imports), retaining behavior.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,existsSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const runner=resolve(process.argv[2]||''),input=JSON.parse(readFileSync(resolve(process.argv[3]||''),'utf8'));
const root=resolve(input.root),out=resolve(input.output_directory);
const read=(r,p)=>readFileSync(join(r,p));
const json=(r,p)=>JSON.parse(read(r,p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function files(r,d=''){const result=[];for(const e of readdirSync(join(r,d),{withFileTypes:true})){const p=d?d+'/'+e.name:e.name;assert.ok(!e.isSymbolicLink());if(e.isDirectory())result.push(...files(r,p));else {assert.ok(e.isFile());result.push(p);}}return result.sort();}
// Exercise the exact preflight walker without importing or executing the assembler.
const assemblerText=readFileSync(runner,'utf8'),walkerStart=assemblerText.indexOf('function references(v){'),walkerEnd=assemblerText.indexOf('\nfor(const p of seeds)need(p);',walkerStart);
assert.ok(walkerStart>=0&&walkerEnd>walkerStart);
const discovered=new Set(),discover=Function('need','web','obj',assemblerText.slice(walkerStart,walkerEnd)+';return references;')(p=>{assert.equal(typeof p,'string');assert.ok(!p.includes('"')&&!p.split('/').includes('..'));discovered.add(p);},p=>{assert.ok(p.startsWith('/games/'));return 'htdocs'+p;},v=>v!==null&&typeof v==='object'&&!Array.isArray(v));
const target='/games/engines/nes/probe/common/'+'a'.repeat(64)+'.mjs',entry='/games/probe/composition-entry.mjs',original='receipts/engine-release-originals/'+'b'.repeat(64),probePin={bytes:1,sha256:'b'.repeat(64)};
discover({format:'nes-composition/1',moduleGraph:{[entry]:[{start:10,end:100,original:'"../../common/'+'a'.repeat(64)+'.mjs"',target}]}});
assert.deepEqual([...discovered].sort(),['htdocs'+entry,'htdocs'+target].sort(),'Import original source text must not become a dependency');
discover({format:'nes-engine-maintenance-history/1',changes:{'current.json':{before:probePin,after:probePin,original}},added:{'added.json':probePin}});
assert.ok(discovered.has(original),'History originals remain mandatory');assert.ok(discovered.has('current.json'));assert.ok(discovered.has('added.json'));
// Exercise actual preflight with an authenticated retained package and a current dependency.
const preflightStart=assemblerText.indexOf('// Collect mandatory dependencies before history verification or output mutation.'),preflightEnd=assemblerText.indexOf("ok(equal(paths.slice().sort(),Object.keys(inventory.files).sort())",preflightStart);
assert.ok(preflightStart>=0&&preflightEnd>preflightStart);
const fixture=new Map(),fixtureSeeds=['htdocs/games/engines/nes/registry.json','htdocs/games/arcade/catalog.json','htdocs/games/netplay/catalog.json','includes/api/classes/netplay-catalog.json','includes/api/classes/NetplayPolicy.php','compatibility-audit.json','tests/arcade-runtime-source-pins.json','tests/shared-engine-history.mjs','receipts/shared-engine-migration.json'];
for(const p of fixtureSeeds)fixture.set(p,Buffer.from('{}'));
const fixturePackage='htdocs/games/probe/game-package.json',retained='tests/migration-originals/game-package.json',removed='/games/probe/removed-engine.mjs',current='/games/probe/current.mjs';
fixture.set('htdocs/games/arcade/catalog.json',Buffer.from('[]'));
fixture.set('htdocs/games/engines/nes/registry.json',Buffer.from(JSON.stringify({format:'nes-engine-registry/1',package:{path:fixturePackage,...probePin}})));
fixture.set(fixturePackage,Buffer.from(JSON.stringify({manifest:{format:'game-package/1',files:{[current]:probePin}}})));
fixture.set('htdocs'+current,Buffer.from('x'));
fixture.set(retained,Buffer.from(JSON.stringify({manifest:{format:'game-package/1',files:{[removed]:probePin}}})));
fixture.set('receipts/shared-engine-migration.json',Buffer.from(JSON.stringify({changes:{[fixturePackage]:{before:probePin,after:probePin,original:retained}},deleted:{}})));
const runPreflight=Function('present','source','decode','obj','web','key','ok','HISTORY_HEAD',assemblerText.slice(preflightStart,preflightEnd)+';return required;');
function fixturePreflight(){return runPreflight(new Set(fixture.keys()),p=>{assert.ok(fixture.has(p),p);return fixture.get(p);},b=>b.toString(),v=>v!==null&&typeof v==='object'&&!Array.isArray(v),p=>'htdocs'+p,p=>{assert.equal(typeof p,'string');return p;},(v,m)=>{if(!v)throw Error(m);},'receipts/engine-maintenance-history.json');}
const fixtureRequired=fixturePreflight();assert.ok(fixtureRequired.has(retained));assert.ok(!fixtureRequired.has('htdocs'+removed),'Retained historical package must not seed former executable dependencies');
fixture.delete('htdocs'+current);assert.throws(fixturePreflight,e=>e.message==='Missing mandatory source dependencies: '+JSON.stringify(['htdocs'+current]),'Current package dependencies remain mandatory');
const beforeFiles=files(root),afterFiles=files(out);
const protectedPaths=beforeFiles.filter(p=>p.split('/').includes('cartridge')||/\.(nes|rom)$/i.test(p)||/(^|\/)bank-[^/]+$/.test(p));
assert(protectedPaths.every(p=>afterFiles.includes(p)),'Existing cartridge members must remain');
for(const p of protectedPaths)assert.deepEqual(read(root,p),read(out,p),p);
const old=json(root,'htdocs/games/engines/nes/registry.json'),next=json(out,'htdocs/games/engines/nes/registry.json');
assert.notEqual(next.release,old.release);
for(const p of beforeFiles.filter(p=>p.startsWith('htdocs/games/engines/nes/')&&p!=='htdocs/games/engines/nes/registry.json'))assert.deepEqual(read(root,p),read(out,p),p);
const catalog=json(out,'htdocs/games/arcade/catalog.json'),client=json(out,'htdocs/games/netplay/catalog.json');
function pinnedRecords(items){const result=new Map();for(const item of items||[]){const bytes=readFileSync(resolve(item.path));assert.equal(hash(bytes),item.sha256);const record=JSON.parse(bytes);assert.ok(!result.has(record.package.id));result.set(record.package.id,record);}return result;}
const qualificationRecords=pinnedRecords(input.qualifications),bindingRepairRecords=pinnedRecords(input.binding_repairs);
assert.deepEqual(read(out,'htdocs/games/netplay/catalog.json'),read(out,'includes/api/classes/netplay-catalog.json'));
assert.ok(read(out,'includes/api/classes/NetplayPolicy.php').toString().includes("private const DIGEST='"+hash(read(out,'includes/api/classes/netplay-catalog.json'))+"'"));
let affected=0,loadedEdits=0,legacyPresent=0,legacyAbsent=0;
for(const e of input.edits){if(!e.path.includes('/common/'))continue;const oldFactory=await import(pathToFileURL(join(root,'htdocs'+e.path)).href);const newURL='/games/engines/nes/'+input.release+'/common/'+e.sha256+'.mjs';assert.equal(hash(read(out,'htdocs'+newURL)),e.sha256);const newFactory=await import(pathToFileURL(join(out,'htdocs'+newURL)).href);assert.notEqual(Function.prototype.toString.call(newFactory.instantiate),Function.prototype.toString.call(oldFactory.instantiate),'Neutral probe must change bytes INSIDE instantiate to prove loaded code changed');loadedEdits++;}
assert.ok(loadedEdits>0||input.admissions?.length||input.qualifications?.length||input.binding_repairs?.length,'Supply a neutral shared factory edit, admission, binding repair, or qualification');
for(const row of catalog){const p='htdocs'+row.manifest;
if(!existsSync(join(root,p))){assert(input.admissions?.length);const fresh=json(out,p);assert.equal(fresh.artifactDigest,row.artifactDigest);for(const [url,pin]of Object.entries(fresh.manifest.files)){const b=read(out,'htdocs'+url);assert.equal(b.length,pin.bytes);assert.equal(hash(b),pin.sha256);}const m=await import(pathToFileURL(join(out,dirname(p),'composition-entry.mjs')));const machine=m.createMachine();machine.step();machine.dispose?.();continue;}
const before=json(root,p),after=json(out,p),base=dirname(p),side=json(out,base+'/composition.json'),prior=json(root,base+'/composition.json');assert.notEqual(after.artifactDigest,before.artifactDigest);assert.equal(hash(canonical(after.manifest)),after.artifactDigest);assert.equal(row.artifactDigest,after.artifactDigest);assert.equal(client.packages[row.id].artifactDigest,after.artifactDigest);
if(qualificationRecords.has(row.id)){const q=qualificationRecords.get(row.id);assert.equal(q.package.artifactDigest,before.artifactDigest);assert.equal(before.manifest.capabilities.verified,false);assert.deepEqual(before.manifest.capabilities.evidence,[]);assert.equal(after.manifest.capabilities.verified,true);assert.equal(after.manifest.capabilities.evidence,q.capabilities.evidence);for(const k of ['nativePlayers','mode','play','watch'])assert.equal(after.manifest.capabilities[k],before.manifest.capabilities[k]);qualificationRecords.delete(row.id);}
if(bindingRepairRecords.has(row.id)){const r=bindingRepairRecords.get(row.id);assert.equal(r.package.artifactDigest,before.artifactDigest);assert.equal(after.manifest.capabilities.verified,false);assert.equal(client.packages[row.id].version,'game-network-binding/1');assert.equal(client.packages[row.id].packageId,row.id);bindingRepairRecords.delete(row.id);}const legacyPath=base+'/network-package.json',hasLegacy=existsSync(join(root,legacyPath));assert.equal(existsSync(join(out,legacyPath)),hasLegacy,'Optional legacy envelope presence changed');
assert.deepEqual(read(root,base+'/netplay-binding.mjs'),read(out,base+'/netplay-binding.mjs'));
if(hasLegacy){legacyPresent++;const priorLegacy=json(root,legacyPath),legacy=json(out,legacyPath);assert.equal(legacy.artifactDigest,after.artifactDigest);assert.deepEqual(legacy.binding,client.packages[row.id]);const extras=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='binding'&&k!=='artifactDigest'));assert.deepEqual(extras(legacy),extras(priorLegacy));}else legacyAbsent++;
for(const [url,pin]of Object.entries(after.manifest.files)){const b=read(out,'htdocs'+url);assert.equal(b.length,pin.bytes);assert.equal(hash(b),pin.sha256);}
const em=json(out,'htdocs'+side.binding.engineManifest.path),oldEM=json(root,'htdocs'+prior.binding.engineManifest.path);const impacted=oldEM.graph.nodes.some(n=>input.edits.some(e=>e.path.endsWith('/common/'+n.factory+'.mjs')));
assert.notEqual(side.binding.engineManifest.sha256,prior.binding.engineManifest.sha256);
const entry=next.selections[canonical(side.requirements)].entry.path;
const engine=await import(pathToFileURL(join(out,'htdocs'+entry)).href),cartridge=await import(pathToFileURL(join(out,base,'cartridge/entry.mjs')).href);
assert.throws(()=>engine.createMachine({...cartridge,requirements:{...cartridge.requirements,abi:'unsupported/0'}}),/UNSUPPORTED_ENGINE_ABI/);
const composed=await import(pathToFileURL(join(out,base,'composition-entry.mjs')).href);
const a=composed.createMachine(),b=engine.createMachine(cartridge);assert.deepEqual(a.getState(),b.getState());assert.equal(a.checkInterpreterGuard(),true);assert.equal(b.checkInterpreterGuard(),true);a.step();b.step();assert.deepEqual(a.getState(),b.getState());a.dispose?.();b.dispose?.();if(impacted)affected++;
}
assert.ok(affected>0||input.admissions?.length||input.qualifications?.length||input.binding_repairs?.length,'Edit must affect an actually composed engine or perform an authenticated metadata transition');assert.equal(qualificationRecords.size,0);assert.equal(bindingRepairRecords.size,0);
assert.ok(legacyPresent>0&&legacyAbsent>0,'Integration fixture must cover both present and intentionally absent optional legacy envelopes');
const history=await import(pathToFileURL(join(out,'tests/shared-engine-history.mjs')).href);
history.verifySharedEngineMigration();history.sharedEngineHistoricalRead();
const headDocument=json(out,'receipts/engine-maintenance-history.json');
const priorHistory=await import(pathToFileURL(join(out,headDocument.base.path)).href);
const priorView=history.releasePriorView();priorHistory.verifySharedEngineMigration(priorView.read,priorView.exists);
assert.throws(()=>history.verifySharedEngineMigration(p=>p===history.maintenanceHead.path?Buffer.from('{}'):read(out,p),p=>existsSync(join(out,p))),/history receipt mismatch/);
for(const [p,expected]of Object.entries(json(out,'tests/arcade-runtime-source-pins.json').files)){const b=read(out,p);assert.equal(b.length,expected.bytes,p);assert.equal(hash(b),expected.sha256,p);}
const audit=json(out,'compatibility-audit.json');
for(const row of catalog){const a=audit.find(a=>a.id===row.id),base=dirname('htdocs'+row.manifest),side=json(out,base+'/composition.json');assert.equal(a.artifactDigest,row.artifactDigest);assert.deepEqual(a.engineManifest,side.binding.engineManifest);assert.deepEqual(a.requirements,side.requirements);for(const [p,expected]of Object.entries(a.cartridgeFiles)){if(existsSync(join(root,p)))assert.deepEqual(read(root,p),read(out,p));else assert(input.admissions?.length);assert.equal(hash(read(out,p)),expected.sha256);}}
for(const p of beforeFiles.filter(p=>p.startsWith('receipts/')&&p!=='receipts/engine-maintenance-history.json'))assert.deepEqual(read(root,p),read(out,p),p);
assert.deepEqual(read(out,'maintenance/romjs-shared-engine-release-assembler.mjs'),readFileSync(runner));
// Rejection calls never run edited source and must fail before creating their output.
for(const [label,mutate,pattern]of [
['before',v=>{v.edits[0].before_sha256='0'.repeat(64);},/Before hash mismatch/],
['source',v=>{v.source_inventory_sha256='0'.repeat(64);},/Source inventory authentication failed/],
['edit-source',v=>{v.edits[0].sha256='0'.repeat(64);},/Edited source hash mismatch/],
['abi-major',v=>{v.release=(Number(old.release.split('.')[0])+1)+'.0.0';},/compatible semver/]
]){if(!input.edits.length&&['before','edit-source'].includes(label))continue;const v=structuredClone(input);v.output_directory=join(dirname(out),'rejection-'+next.release+'-'+label);assert.ok(!existsSync(v.output_directory));mutate(v);const r=spawnSync(process.execPath,[runner],{input:JSON.stringify(v),encoding:'utf8',timeout:120000,maxBuffer:1048576});assert.ifError(r.error);assert.notEqual(r.status,0,label);assert.match(r.stderr,pattern);assert.ok(!existsSync(v.output_directory),'Rejected input created output');}
// Omit several mandatory files from a virtual source tree and its authenticated inventory.
// Keep original inventory separately to cover stale inventories as well as regenerated ones.
const missingTemp=mkdtempSync(join(tmpdir(),'nes-engine-missing-'));
const migration=json(root,'receipts/shared-engine-migration.json'),historyOriginal=Object.values(migration.changes)[0]?.original;assert.equal(typeof historyOriginal,'string');
const missingPaths=['htdocs/games/netplay/catalog.json','includes/api/classes/netplay-catalog.json','includes/api/classes/NetplayPolicy.php',historyOriginal,...catalog.slice(0,2).map(row=>dirname('htdocs'+row.manifest)+'/netplay-binding.mjs')].sort();
const missingRoot=join(missingTemp,'source');mkdirSync(missingRoot);
for(const p of beforeFiles){if(missingPaths.includes(p))continue;const target=join(missingRoot,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,read(root,p),{flag:'wx'});}
for(const stale of [false,true]){const v=structuredClone(input);v.root=missingRoot;v.output_directory=join(missingTemp,stale?'stale-output':'current-output');
if(!stale){const inv={format:'nes-release-source/1',files:Object.fromEntries(files(missingRoot).map(p=>{const b=read(missingRoot,p);return [p,{bytes:b.length,sha256:hash(b)}];}))},bytes=Buffer.from(JSON.stringify(inv));v.source_inventory=join(missingTemp,'inventory.json');writeFileSync(v.source_inventory,bytes,{flag:'wx'});v.source_inventory_sha256=hash(bytes);}
const result=spawnSync(process.execPath,[runner],{input:JSON.stringify(v),encoding:'utf8',timeout:120000,maxBuffer:1048576});assert.ifError(result.error);assert.notEqual(result.status,0);assert.match(result.stderr,/Missing mandatory source dependencies:/);const reported=JSON.parse(result.stderr.trim().split('Missing mandatory source dependencies: ')[1]);for(const p of missingPaths)assert.ok(reported.includes(p),'Missing collective diagnostic: '+p);for(const row of catalog){const p=dirname('htdocs'+row.manifest)+'/network-package.json';if(!existsSync(join(root,p)))assert.ok(!reported.includes(p),'Optional absence reported as mandatory');}assert.ok(!existsSync(v.output_directory),'Preflight failure created output');}
if(process.argv[4]!=='--single'&&input.edits.length){
const temp=mkdtempSync(join(tmpdir(),'nes-engine-successor-')),e=input.edits.find(e=>e.path.includes('/common/'));assert.ok(e);
const currentURL='/games/engines/nes/'+input.release+'/common/'+e.sha256+'.mjs',bytes=read(out,'htdocs'+currentURL),text=bytes.toString();
const parserBytes=readFileSync(input.acorn_module);assert.equal(hash(parserBytes),input.acorn_sha256);const parser=await import('data:text/javascript;base64,'+parserBytes.toString('base64'));
const tree=parser.parse(text,{ecmaVersion:'latest',sourceType:'module'}),fn=tree.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='instantiate').declaration;
const edited=Buffer.from(text.slice(0,fn.body.start+1)+'/* successor neutral probe */'+text.slice(fn.body.start+1)),editFile=join(temp,'factory.mjs');writeFileSync(editFile,edited,{flag:'wx'});
const inventory={format:'nes-release-source/1',files:Object.fromEntries(files(out).map(p=>{const b=read(out,p);return [p,{bytes:b.length,sha256:hash(b)}];}))},inventoryBytes=Buffer.from(JSON.stringify(inventory)),inventoryFile=join(temp,'inventory.json');writeFileSync(inventoryFile,inventoryBytes,{flag:'wx'});
const version=input.release.split('.').map(Number);version[2]++;assert.ok(Number.isSafeInteger(version[2]));
const second={...input,root:out,output_directory:join(temp,'site'),source_inventory:inventoryFile,source_inventory_sha256:hash(inventoryBytes),release:version.join('.'),admissions:[],successors:[],binding_repairs:[],qualifications:[],shell_edits:[],shell_additions:[],support_edits:[],support_additions:[],edits:[{path:currentURL,before_sha256:hash(bytes),file:editFile,sha256:hash(edited)}]},secondInput=join(temp,'input.json');writeFileSync(secondInput,JSON.stringify(second),{flag:'wx'});
const shipped=join(out,'maintenance/romjs-shared-engine-release-assembler.mjs');
const assembled=spawnSync(process.execPath,[shipped],{input:JSON.stringify(second),encoding:'utf8',maxBuffer:1048576});assert.ifError(assembled.error);assert.equal(assembled.status,0,assembled.stderr);
const checked=spawnSync(process.execPath,[join(second.output_directory,'tests/engine-release-'+second.release+'.mjs'),shipped,secondInput,'--single'],{encoding:'utf8',maxBuffer:1048576});assert.ifError(checked.error);assert.equal(checked.status,0,checked.stderr);
console.error('Successive release regression fixtures: '+temp);
}
console.log(JSON.stringify({passed:['successor and prior migration history','current audit and runtime source pins','neutral factory source identity and loaded function body','engine and composed artifact identity','actual engine/composition import and step','all cartridge bytes','historical release bytes','package closures and current catalog equality','optional legacy presence preservation and binding refresh','collective mandatory dependency rejection','before/source/edited-source hash rejection','incompatible release and cartridge ABI rejection'],affected,loadedEdits,legacyPresent,legacyAbsent}));
