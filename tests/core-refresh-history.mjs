// Validate the current core refresh before exposing immutable prior release bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const rawRead=p=>readFileSync(new URL(p,root));
const views=new WeakSet();
export const receiptSHA='f8e1043928676704a2bfd17d61a40b88d3bcc5588b905dadba9c2cb76dea079d';
export function verifyCoreRefresh(read=rawRead){
 const raw=read('tests/core-refresh-migration.json');
 assert.equal(hash(raw),receiptSHA,'Core refresh receipt');
 const receipt=JSON.parse(raw);assert.equal(receipt.format,'core-refresh-migration/1');
 for(const [path,change] of Object.entries(receipt.changes)){
  assert.deepEqual(pin(read(path)),change.after,path);
  assert.deepEqual(pin(read(change.original)),change.before,change.original);
 }
 for(const [path,record] of Object.entries(receipt.added))assert.deepEqual(pin(read(path)),record,path);
 return receipt;
}
export function coreHistoricalRead(read=rawRead){
 if(views.has(read))return read;
 const receipt=verifyCoreRefresh(read);
 const view=path=>{
  const change=receipt.changes[path];
  if(!change)return read(path);
  assert.deepEqual(pin(read(path)),change.after,path);
  const old=read(change.original);assert.deepEqual(pin(old),change.before,change.original);return old;
 };
 views.add(view);return view;
}
