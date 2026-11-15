import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
export const actualRead=p=>readFileSync(new URL(p,root));
export function verifyContraAddition(read=actualRead){
 const raw=read('tests/contra-addition.json');
 assert.equal(hash(raw),'533f336660d655510a26585c3633239646a01c70d7e24d34d3c8e20ef400d595');
 const r=JSON.parse(raw);assert.equal(r.format,'cartridge-addition/1');
 for(const [p,c] of Object.entries(r.changes)){
  assert.deepEqual(pin(read(p)),c.after,p);
  assert.deepEqual(pin(read(c.original)),c.before,c.original);
 }
 for(const [p,v] of Object.entries(r.files))assert.deepEqual(pin(read(p)),v,p);
 for(const [p,v] of Object.entries(r.agent_authored_files_preserved))assert.deepEqual(pin(read(p)),v,p);
 return r;
}
// Preserve each historical transition while validating the current addition first.
export function contraHistoricalRead(read=actualRead){
 const r=verifyContraAddition(read);
 return p=>{const c=r.changes[p];if(!c)return read(p);
  assert.deepEqual(pin(read(p)),c.after,p);const old=read(c.original);
  assert.deepEqual(pin(old),c.before,c.original);return old;};
}
