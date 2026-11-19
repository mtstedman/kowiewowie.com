// Separate SNES slots avoid changing existing NES persistence contracts.
async function database(){if(!globalThis.indexedDB)throw Error('Browser save storage unavailable');return new Promise((resolve,reject)=>{let abandoned=false;const request=indexedDB.open('wowiekowie-snes-saves',1);request.onupgradeneeded=()=>request.result.createObjectStore('slots');request.onerror=()=>reject(Error('Browser save storage unavailable'));request.onblocked=()=>{abandoned=true;reject(Error('Close other game tabs to open save storage'));};request.onsuccess=()=>{if(abandoned){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};});}
export async function snesSlot(id,kind,value){
 if(!/^[-a-z0-9]{1,80}$/.test(id)||!['battery','checkpoint'].includes(kind))throw Error('Invalid SNES save slot');
 const db=await database(),write=value!==undefined;
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('slots',write?'readwrite':'readonly'),store=tx.objectStore('slots'),request=write?store.put(value,`${id}:${kind}`):store.get(`${id}:${kind}`);tx.oncomplete=()=>resolve(request.result??null);tx.onerror=tx.onabort=()=>reject(Error(write?'Cannot save: browser storage may be full':'Cannot read saved game'));});}finally{db.close();}
}
