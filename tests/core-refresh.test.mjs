import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyCoreRefresh as verifyPriorCoreRefresh,coreHistoricalRead as priorCoreHistoricalRead} from './core-refresh-history.mjs';
import {sharedEngineHistoricalRead} from './shared-engine-history.mjs';
const root=new URL('../',import.meta.url);
const read=sharedEngineHistoricalRead(p=>readFileSync(new URL(p,root)));
const verifyCoreRefresh=(reader=read)=>verifyPriorCoreRefresh(reader);
const coreHistoricalRead=(reader=read)=>priorCoreHistoricalRead(reader);
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});

test('prior core release retains authenticated provenance and cartridge bytes through the shared-engine history',()=>{
 const receipt=verifyCoreRefresh();
 const ids=JSON.parse(read('htdocs/games/arcade/catalog.json')).map(x=>x.id).sort();
 assert.deepEqual(Object.keys(receipt.game_cores).sort(),ids);
 for(const [id,game] of Object.entries(receipt.game_cores)){
  assert(Object.keys(game.files).some(path=>path.endsWith('/machine.mjs')),id);
  assert(Object.keys(game.preserved).some(path=>path.endsWith('/cartridge.mjs')),id);
  assert(Object.keys(game.preserved).some(path=>/\/bank-[^/]+\.mjs$/.test(path)),id);
  for(const [path,record] of Object.entries({...game.files,...game.preserved}))assert.deepEqual(pin(read(path)),record,path);
 }
});

test('prior release views retain original bytes after validating current core changes',()=>{
 const receipt=verifyCoreRefresh(),historical=coreHistoricalRead();
 for(const [path,change] of Object.entries(receipt.changes))assert.deepEqual(pin(historical(path)),change.before,path);
 assert.equal(coreHistoricalRead(historical),historical);
});

test('prior core release rejects altered retained files, additions and receipt',()=>{
 const receipt=verifyCoreRefresh();
 const [path,change]=Object.entries(receipt.changes).find(([path])=>path.endsWith('/machine.mjs'));
 const targets=[path,change.original,'tests/core-refresh-migration.json'];
 const added=Object.keys(receipt.added)[0];if(added)targets.push(added);
 for(const target of targets){
  const changed=p=>p===target?Buffer.concat([read(p),Buffer.from('\n')]):read(p);
  assert.throws(()=>verifyCoreRefresh(changed),undefined,target);
  assert.throws(()=>coreHistoricalRead(changed),undefined,target);
 }
});
