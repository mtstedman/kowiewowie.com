import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
export const receiptSHA="50e258f13eabcb0a1c44ce00b3145c75727ca9c63881189b522a82dbdaf77bf4";
const rawRead=p=>readFileSync(new URL(p,root));
export function verifySharedEngineMigration(read=rawRead,exists=p=>existsSync(new URL(p,root))){
 const raw=read('receipts/shared-engine-migration.json');assert.equal(hash(raw),receiptSHA);
 const r=JSON.parse(raw);assert.equal(r.format,'shared-engine-migration/1');
 for(const [p,c]of Object.entries(r.changes)){assert.deepEqual(pin(read(p)),c.after,p);assert.deepEqual(pin(read(c.original)),c.before,c.original);}
 for(const [p,c]of Object.entries(r.added))assert.deepEqual(pin(read(p)),c,p);
 for(const [p,c]of Object.entries(r.deleted)){assert.equal(exists(p),false,p);assert.deepEqual(pin(read(c.original)),c.before,c.original);}
 return r;
}
export function sharedEngineHistoricalRead(read=rawRead,exists){
 const r=verifySharedEngineMigration(read,exists);
 return p=>{
  if(Object.hasOwn(r.added,p)){const e=Error('File did not exist before shared-engine migration: '+p);e.code='ENOENT';throw e;}
  const c=r.changes[p]||r.deleted[p];if(!c)return read(p);
  const b=read(c.original);assert.deepEqual(pin(b),c.before,p);return b;
 };
}
// Apply this successor layer before the existing coreHistoricalRead function.
export async function historicalRead(){const {coreHistoricalRead}=await import('./core-refresh-history.mjs');return coreHistoricalRead(sharedEngineHistoricalRead());}
