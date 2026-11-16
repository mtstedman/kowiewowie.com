// Battery persistence is bound to cartridge identity, independent of engine releases.
export function createBatteryCodec(input){
 const config={identity:{...input?.identity}};
 const id=config.identity;
 if(Object.keys(id).length!==5||id.version!==1||!Number.isInteger(id.mapper)||id.mapper<0||id.mapper>4095||!Number.isInteger(id.ram_bytes)||id.ram_bytes<1||id.ram_bytes>1048576||![id.rom_sha256,id.mapping_identity].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('Battery configuration');
 const storageLimit=Math.max(65536,id.ram_bytes*4+1024);
const insist=(v,m)=>{if(!v)throw Error(m);};
function exact(v,keys){insist(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'Save fields');}
function validateRecord(v){
 exact(v,['format','identity','data']);insist(v.format==='romjs-battery/1','Save version');
 exact(v.identity,['version','rom_sha256','mapping_identity','mapper','ram_bytes']);
 for(const k of Object.keys(config.identity))insist(v.identity[k]===config.identity[k],'Save ROM/board identity');
 insist(Array.isArray(v.data)&&v.data.length===config.identity.ram_bytes&&v.data.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'Exact save RAM length/bytes');
 return {format:v.format,identity:{...config.identity},data:v.data.slice()};
}
function encodeRAM(bytes){insist(bytes instanceof Uint8Array&&bytes.length===config.identity.ram_bytes,'Exact cartridge RAM length');return validateRecord({format:'romjs-battery/1',identity:{...config.identity},data:Array.from(bytes)});}
function decodeRAM(v){return Uint8Array.from(validateRecord(v).data);}
const storageKey='romjs-battery/1:'+config.identity.rom_sha256+':'+config.identity.mapping_identity+':'+config.identity.mapper+':'+config.identity.ram_bytes;
function readSave(storage){const raw=storage.getItem(storageKey);if(raw===null)return null;insist(typeof raw==='string'&&raw.length<=storageLimit,'Save storage limit');return validateRecord(JSON.parse(raw));}
function writeSave(storage,value){const v=validateRecord(value),raw=JSON.stringify(v);insist(raw.length<=storageLimit,'Save storage limit');storage.setItem(storageKey,raw);return v;}
return Object.freeze({validateRecord,encodeRAM,decodeRAM,storageKey,readSave,writeSave});
}
