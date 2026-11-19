import {contraHistoricalRead} from './contra-addition-history.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const rawRead=p=>readFileSync(new URL(p,root));
export const actualRead=contraHistoricalRead(rawRead);
export function verifyAddition(read=actualRead){
 const raw=read('tests/zelda-addition.json');
 assert.equal(hash(raw),'d94007f9451be64fedf92257bf0ab04b27f20254eee878fdd90edb805b197748');
 const r=JSON.parse(raw);assert.equal(r.format,'cartridge-addition/1');
 for(const [p,c] of Object.entries(r.changes)){
  assert.deepEqual(pin(read(p)),c.after,p);
  assert.deepEqual(pin(read(c.original)),c.before,c.original);
 }
 for(const [p,v] of Object.entries(r.files))assert.deepEqual(pin(read(p)),v,p);
 for(const [p,v] of Object.entries(r.agent_authored_files_preserved))assert.deepEqual(pin(read(p)),v,p);
 return r;
}
// The hotfix test still validates its original five-game transition. Verify
// the current additive release first, then supply retained catalog metadata.
export function additionHistoricalRead(read){
 read=contraHistoricalRead(read);
 const r=verifyAddition(read);
 return p=>{const c=r.changes[p];if(!c)return read(p);
  assert.deepEqual(pin(read(p)),c.after,p);const old=read(c.original);
  assert.deepEqual(pin(old),c.before,c.original);return old;};
}
