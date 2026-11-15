import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const views=new WeakSet();
export const actualRead=p=>readFileSync(new URL(p,root));
export function verifyStreamingMigration(read=actualRead){
 const raw=read('tests/worker-streaming-migration.json');
 assert.equal(hash(raw),'314dbd13c4cccb039205d1fed6a172d044572d1552aef66924fb914f763a4ef5');
 const r=JSON.parse(raw);assert.equal(r.format,'worker-streaming-migration/1');
 for(const [p,c] of Object.entries(r.changes)){
  assert.deepEqual(pin(read(p)),c.after,p);
  assert.deepEqual(pin(read(c.original)),c.before,c.original);
 }
 for(const [p,v] of Object.entries(r.added))assert.deepEqual(pin(read(p)),v,p);
 return r;
}
export function streamingHistoricalRead(read=actualRead){
 if(views.has(read))return read;
 const r=verifyStreamingMigration(read);
 const view=p=>{const c=r.changes[p];if(!c)return read(p);
  assert.deepEqual(pin(read(p)),c.after,p);
  const old=read(c.original);assert.deepEqual(pin(old),c.before,c.original);return old;};
 views.add(view);return view;
}
