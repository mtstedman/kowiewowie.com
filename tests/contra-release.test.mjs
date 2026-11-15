import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {actualRead,verifyContraAddition} from './contra-addition-history.mjs';
import {verifyPackage} from '../htdocs/games/arcade/package.mjs';
const json=p=>JSON.parse(actualRead(p));
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
test('Contra addition preserves agent-authored engine, current shared dependencies and all existing packages',async()=>{
 const r=verifyContraAddition(),rows=json('htdocs/games/arcade/catalog.json');
 const prior=json(r.changes['htdocs/games/arcade/catalog.json'].original);
 assert.deepEqual(rows.filter(x=>x.id!=='contra'),prior);assert.equal(rows.length,prior.length+1);
 const row=rows.find(x=>x.id==='contra');assert.equal(row.artifactDigest,r.artifactDigest);
 const p=await verifyPackage(json('htdocs'+row.manifest),row.artifactDigest);
 assert.equal(p.capabilities.nativePlayers,2);assert.equal(p.capabilities.play,'host-p1-guest-p2');assert.equal(p.capabilities.watch,true);
 for(const [u,v] of Object.entries(p.files))assert.deepEqual(pin(actualRead('htdocs'+u)),v,u);
 const prefix='htdocs/games/contra/';
 for(const entries of [json(prefix+'bundle-inputs.json'),json(prefix+'manifest.json').files])
  for(const [n,v] of Object.entries(entries))assert.deepEqual(pin(actualRead(prefix+n)),v,n);
 const current=json('htdocs/games/netplay/catalog.json'),old=json(r.changes['htdocs/games/netplay/catalog.json'].original);
 assert.deepEqual(Object.fromEntries(Object.entries(current.packages).filter(([id])=>id!=='contra')),old.packages);
});
test('addition verification rejects changed engine, catalog, retained history and receipt',()=>{
 const r=verifyContraAddition();
 for(const path of ['htdocs/games/contra/engine/machine.mjs','htdocs/games/arcade/catalog.json',r.changes['tests/cartridge-library-plan.json'].original,'tests/contra-addition.json'])
  assert.throws(()=>verifyContraAddition(p=>{const b=Buffer.from(actualRead(p));if(p===path)b[0]^=1;return b;}));
});
