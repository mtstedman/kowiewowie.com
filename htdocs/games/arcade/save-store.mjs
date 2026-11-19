export const SAVE_SLOTS=Object.freeze(['slot1','slot2','slot3','autosave','recovery']);
const MAX=32*1024*1024,THUMBNAIL_MAX=256*1024;
const insist=(ok,message)=>{if(!ok)throw Error(message);};
const cancelled=signal=>{if(signal?.aborted)throw Error('Save operation was cancelled');};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const validImage=value=>value===null||typeof value==='string'&&value.length<=THUMBNAIL_MAX&&/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
function identity(platform,id,slot){insist(['nes','snes'].includes(platform)&&typeof id==='string'&&/^[-a-z0-9]{1,80}$/.test(id)&&SAVE_SLOTS.includes(slot),'Invalid save slot');return `${platform}:${id}:${slot}`;}
function summary(value){
 insist(value?.format==='arcade-local-save/1'&&typeof value.savedAt==='string'&&Number.isFinite(Date.parse(value.savedAt))&&validImage(value.screenshot),'Saved game metadata is damaged');
 return {slot:value.slot,savedAt:value.savedAt,screenshot:value.screenshot,migrated:value.migrated===true};
}
async function checksum(value){
 let record=value.record;
 insist(record&&typeof record==='object','Saved game is damaged');
 if(record.data instanceof Uint8Array){insist(record.data.byteLength<=MAX,'Save is too large');record={...record,data:{encoding:'uint8-sha256',bytes:record.data.byteLength,sha256:await hash(record.data)}};}
 const text=JSON.stringify({platform:value.platform,id:value.id,slot:value.slot,savedAt:value.savedAt,screenshot:value.screenshot,migrated:value.migrated,record});
 insist(text.length<=MAX,'Save is too large');return hash(new TextEncoder().encode(text));
}
export function indexedSaveBackend(){
 async function open(signal){
  cancelled(signal);insist(globalThis.indexedDB,'Browser save storage is unavailable');
  return new Promise((resolve,reject)=>{
   let abandoned=false;const request=indexedDB.open('wowiekowie-arcade-saves',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('slots');
   request.onerror=()=>reject(Error('Cannot open browser save storage'));
   request.onblocked=()=>{abandoned=true;reject(Error('Close other game tabs and try again'));};
   request.onsuccess=()=>{const db=request.result;if(abandoned||signal?.aborted){db.close();reject(Error('Save operation was cancelled'));return;}db.onversionchange=()=>db.close();resolve(db);};
  });
 }
 async function transaction(keys,value,{write=false,ifAbsent=false,signal}={}){
  const db=await open(signal);
  try{return await new Promise((resolve,reject)=>{
   cancelled(signal);const tx=db.transaction('slots',write?'readwrite':'readonly'),store=tx.objectStore('slots'),results=[];
   const abort=()=>tx.abort();signal?.addEventListener('abort',abort,{once:true});
   tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve(write?results[0]:results);};
   tx.onerror=tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(Error(signal?.aborted?'Save operation was cancelled':write?'Could not save. Browser storage may be full.':'Could not read saved game.'));};
   if(write){if(ifAbsent){const request=store.get(keys[0]);request.onsuccess=()=>{results[0]=request.result??value;if(request.result===undefined)store.put(value,keys[0]);};}else{store.put(value,keys[0]);results[0]=value;}}
   else keys.forEach((key,index)=>{const request=store.get(key);request.onsuccess=()=>{results[index]=request.result??null;};});
  });}finally{db.close();}
 }
 return {get:async(key,signal)=>(await transaction([key],null,{signal}))[0],getMany:(keys,signal)=>transaction(keys,null,{signal}),put:(key,value,options={})=>transaction([key],value,{...options,write:true})};
}
export function createSaveStore({platform,id,legacy=async()=>null,backend=indexedSaveBackend(),now=()=>new Date().toISOString()}){
 identity(platform,id,'slot1');let migration=null;
 async function encode(slot,record,{screenshot=null,savedAt=now(),migrated=false}={}){
  identity(platform,id,slot);const value={format:'arcade-local-save/1',platform,id,slot,savedAt,screenshot,migrated,record:structuredClone(record)};summary(value);value.sha256=await checksum(value);return value;
 }
 async function decode(slot,value){
  insist(value,'No saved game in this slot yet');summary(value);
  insist(value.platform===platform&&value.id===id&&value.slot===slot&&value.sha256===await checksum(value),'Saved game is damaged or belongs to another cartridge');return structuredClone(value.record);
 }
 async function migrate(signal){
  if(migration)return migration;
  migration=(async()=>{
   const key=identity(platform,id,'slot1');if(await backend.get(key,signal))return;
   const old=await legacy();cancelled(signal);if(!old)return;
   const value=await encode('slot1',old.record,{savedAt:old.savedAt||now(),migrated:true});cancelled(signal);
   await backend.put(key,value,{ifAbsent:true,signal});
  })().catch(error=>{migration=null;throw error;});return migration;
 }
 return {
  async list({signal}={}){await migrate(signal);const rows=await backend.getMany(SAVE_SLOTS.map(slot=>identity(platform,id,slot)),signal);return rows.map((row,index)=>{if(!row)return {slot:SAVE_SLOTS[index],empty:true};try{return {...summary(row),empty:false};}catch{return {slot:SAVE_SLOTS[index],empty:false,damaged:true};}});},
  async read(slot,{signal}={}){identity(platform,id,slot);await migrate(signal);const value=await backend.get(identity(platform,id,slot),signal);cancelled(signal);return decode(slot,value);},
  async write(slot,record,metadata={}, {signal}={}){await migrate(signal);const value=await encode(slot,record,metadata);cancelled(signal);await backend.put(identity(platform,id,slot),value,{signal});return summary(value);},
 };
}
