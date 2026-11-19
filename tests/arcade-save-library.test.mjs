import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore,SAVE_SLOTS,indexedSaveBackend} from '../htdocs/games/arcade/save-store.mjs';
const memory=()=>{const values=new Map();let fail=false;return {values,fail(){fail=true;},get:async key=>structuredClone(values.get(key)||null),getMany:async keys=>keys.map(key=>structuredClone(values.get(key)||null)),async put(key,value,{ifAbsent,signal}={}){if(signal?.aborted)throw Error('cancelled');if(fail)throw Error('Storage full');if(!ifAbsent||!values.has(key))values.set(key,structuredClone(value));return structuredClone(values.get(key));}};};
test('manual slots, autosave, recovery and platform/cartridge identities remain independent',async()=>{
 const backend=memory(),one=createSaveStore({platform:'nes',id:'contra',backend}),other=createSaveStore({platform:'snes',id:'contra',backend});
 for(let n=0;n<SAVE_SLOTS.length;n++)await one.write(SAVE_SLOTS[n],{frame:n});
 await other.write('slot1',{frame:99,data:new Uint8Array([1,2,3])});
 for(let n=0;n<SAVE_SLOTS.length;n++)assert.deepEqual(await one.read(SAVE_SLOTS[n]),{frame:n});
 assert.deepEqual((await other.read('slot1')).data,new Uint8Array([1,2,3]));
 const absent=createSaveStore({platform:'nes',id:'zelda',backend});await assert.rejects(absent.read('slot1'),/No saved game/);
 assert.equal((await one.list()).length,5);await assert.rejects(one.write('slot4',{}),/Invalid save slot/);
});
test('legacy one-save migration is nondestructive, retains its timestamp and cannot overwrite an existing slot',async()=>{
 const backend=memory(),old={record:{frame:120},savedAt:'2026-11-18T01:02:03.000Z'};let reads=0;
 const store=createSaveStore({platform:'nes',id:'contra',backend,legacy:async()=>{reads++;return old;}});
 const rows=await store.list();assert.equal(rows[0].migrated,true);assert.equal(rows[0].savedAt,old.savedAt);assert.deepEqual(await store.read('slot1'),old.record);assert.equal(reads,1);assert.deepEqual(old.record,{frame:120});
 await store.write('slot1',{frame:240});
 const reload=createSaveStore({platform:'nes',id:'contra',backend,legacy:async()=>{throw Error('Must not revisit legacy');}});
 assert.deepEqual(await reload.read('slot1'),{frame:240});assert.deepEqual(old.record,{frame:120});
});
test('a racing legacy migration uses an atomic insert and preserves a newly written manual save',async()=>{
 const backend=memory();let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const old=createSaveStore({platform:'nes',id:'contra',backend,legacy:()=>pending}),fresh=createSaveStore({platform:'nes',id:'contra',backend});
 const migration=old.list();await Promise.resolve();await fresh.write('slot1',{frame:300});finish({record:{frame:100}});await migration;
 assert.deepEqual(await old.read('slot1'),{frame:300});
});
test('record/thumbnail tampering and storage failure cannot replace a valid autosave',async()=>{
 const backend=memory(),store=createSaveStore({platform:'snes',id:'zelda',backend});
 const record={frame:5,data:new Uint8Array([3,4,5])},screenshot='data:image/png;base64,AQID';await store.write('autosave',record,{screenshot});
 assert.equal((await store.list()).find(r=>r.slot==='autosave').screenshot,screenshot);
 const key='snes:zelda:autosave',valid=structuredClone(backend.values.get(key));backend.values.get(key).record.data[0]=8;await assert.rejects(store.read('autosave'),/damaged/);
 backend.values.set(key,structuredClone(valid));backend.values.get(key).screenshot='data:image/png;base64,AAAA';await assert.rejects(store.read('autosave'),/damaged/);
 backend.values.set(key,valid);backend.fail();await assert.rejects(store.write('autosave',{frame:6}),/Storage full/);assert.deepEqual(await store.read('autosave'),record);
 await assert.rejects(store.write('slot2',{}, {screenshot:'javascript:alert(1)'}),/metadata/);
});
test('an aborted storage transaction rejects without committing or deleting the last good save',async t=>{
 const prior=globalThis.indexedDB,values=new Map([['key',{old:true}]]);let pending;
 globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){let update=null;const tx={objectStore:()=>({put(value,key){update={value,key};return {};}}),abort(){update=null;queueMicrotask(()=>tx.onabort());},commit(){if(update)values.set(update.key,update.value);tx.oncomplete();}};pending=tx;return tx;}};request.onsuccess();});return request;}};
 t.after(()=>{globalThis.indexedDB=prior;});const abort=new AbortController(),saving=indexedSaveBackend().put('key',{new:true},{signal:abort.signal});
 await new Promise(resolve=>setImmediate(resolve));assert(pending);abort.abort();await assert.rejects(saving,/cancelled/);assert.deepEqual(values.get('key'),{old:true});
});
