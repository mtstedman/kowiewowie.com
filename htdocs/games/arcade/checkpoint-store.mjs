const LIMIT=16*1024*1024;
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export async function encodeCheckpoint(record){
 const payload=JSON.stringify(record);if(typeof payload!=='string'||payload.length>LIMIT)throw Error('Save is too large');
 return {format:'nes-local-save/1',savedAt:new Date().toISOString(),payload,sha256:await digest(payload)};
}
export async function decodeCheckpoint(stored){
 if(!stored||stored.format!=='nes-local-save/1'||typeof stored.payload!=='string'||stored.payload.length>LIMIT||typeof stored.sha256!=='string'||stored.sha256!==await digest(stored.payload))throw Error('Saved game is damaged');
 return JSON.parse(stored.payload);
}
async function database(){
 if(!globalThis.indexedDB)throw Error('Browser save storage is unavailable');
 return new Promise((resolve,reject)=>{
  let abandoned=false;const request=indexedDB.open('wowiekowie-nes-saves',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('slots');
  request.onerror=()=>reject(Error('Cannot open browser save storage'));
  request.onblocked=()=>{abandoned=true;reject(Error('Close other game tabs and try again'));};
  request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
 });
}
async function slot(id,write,value){
 if(typeof id!=='string'||!/^[-a-z0-9]{1,80}$/.test(id))throw Error('Invalid save slot');
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('slots',write?'readwrite':'readonly'),store=tx.objectStore('slots');
  const req=write?store.put(value,id):store.get(id);
  tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(Error(write?'Could not save. Browser storage may be full.':'Could not read saved game.'));
 });}finally{db.close();}
}
export async function saveCheckpoint(id,record){const stored=await encodeCheckpoint(record);await slot(id,true,stored);return stored.savedAt;}
export async function loadCheckpoint(id){const stored=await slot(id,false);if(!stored)throw Error('No saved game on this browser yet');return decodeCheckpoint(stored);}
// Migration reads the old slot without replacing or deleting it.
export async function readLegacyCheckpoint(id){const stored=await slot(id,false);return stored?{record:await decodeCheckpoint(stored),savedAt:stored.savedAt}:null;}
