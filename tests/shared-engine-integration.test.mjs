import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifySharedEngineMigration} from './shared-engine-history.mjs';
import {validateManifest,canonical} from '../htdocs/games/arcade/package.mjs';
import './shared-engine-construction-test.mjs';
import './shared-engine-emission-test.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const rows=json('htdocs/games/arcade/catalog.json');

test('current shared-engine packages authenticate complete cartridge, engine and network bindings',()=>{
 const net=json('htdocs/games/netplay/catalog.json');
 assert.deepEqual(net,json('includes/api/classes/netplay-catalog.json'));
 assert(read('includes/api/classes/NetplayPolicy.php').toString().includes("private const DIGEST='"+pin(read('includes/api/classes/netplay-catalog.json')).sha256+"'"));
 for(const row of rows){
  const p=json('htdocs'+row.manifest),m=p.manifest;validateManifest(m);
  assert.equal(pin(Buffer.from(canonical(m))).sha256,row.artifactDigest);assert.equal(p.artifactDigest,row.artifactDigest);
  if(m.capabilities.play!=='none'||m.capabilities.watch)assert.equal(net.packages[row.id].artifactDigest,row.artifactDigest);
  else assert.equal(net.packages[row.id],undefined,'Local-only packages must not advertise a network binding');
  for(const [path,expected]of Object.entries(m.files))assert.deepEqual(pin(read('htdocs'+path)),expected,path);
  if(m.platform!=='NES')continue;
  const base='htdocs/games/'+row.id+'/',composition=json(base+'composition.json'),cart=json(base+'cartridge/cartridge-manifest.json');
  assert.deepEqual(composition.requirements,cart.requirements);
  for(const r of Object.values(composition.binding))assert.deepEqual(m.files[r.path],{bytes:r.bytes,sha256:r.sha256});
  const engine=json('htdocs'+composition.binding.engineManifest.path);assert.equal(engine.abi,cart.requirements.abi);
  for(const path of Object.keys(engine.files))assert(path.startsWith('/games/engines/nes/'),path);
  for(const file of readdirSync(new URL(base+'cartridge/',root))){
   assert(m.files['/games/'+row.id+'/cartridge/'+file],file);
   if(['entry.mjs','data.mjs','cartridge-manifest.json'].includes(file))assert(!read(base+'cartridge/'+file).toString().includes('/engines/'));
  }
  assert(!existsSync(new URL(base+'machine.mjs',root)));assert(!existsSync(new URL(base+'engine/machine.mjs',root)));
  const legacy=base+'network-package.json';if(existsSync(new URL(legacy,root)))assert.deepEqual(json(legacy).binding,net.packages[row.id]);
 }
});

test('shared-engine migration rejects corruption and resurrected per-game engines',()=>{
 const receipt=verifySharedEngineMigration();
 const changed=Object.keys(receipt.changes)[0],original=receipt.changes[changed].original;
 const engine=Object.keys(receipt.added).find(p=>/engines\/nes\/.*\/common\//.test(p));assert(engine);
 const cartridge=Object.keys(receipt.added).find(p=>/\/cartridge\/bank-/.test(p));assert(cartridge);
 for(const target of [changed,original,engine,cartridge,'receipts/shared-engine-migration.json']){
  const corrupt=p=>p===target?Buffer.concat([read(p),Buffer.from('\n')]):read(p);
  assert.throws(()=>verifySharedEngineMigration(corrupt),undefined,target);
 }
 const deleted=Object.keys(receipt.deleted).find(p=>p.endsWith('/machine.mjs'));assert(deleted);
 assert.throws(()=>verifySharedEngineMigration(read,p=>p===deleted||existsSync(new URL(p,root))));
});
