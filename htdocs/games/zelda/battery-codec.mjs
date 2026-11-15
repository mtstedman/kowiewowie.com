import {config} from './battery-config.mjs';
const insist=(v,m)=>{if(!v)throw Error(m);};
function exact(v,keys){insist(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'Save fields');}
export function validateRecord(v){
 exact(v,['format','identity','data']);insist(v.format==='romjs-battery/1','Save version');
 exact(v.identity,['version','rom_sha256','mapping_identity','mapper','ram_bytes']);
 for(const k of Object.keys(config.identity))insist(v.identity[k]===config.identity[k],'Save ROM/board identity');
 insist(Array.isArray(v.data)&&v.data.length===config.identity.ram_bytes&&v.data.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'Exact save RAM length/bytes');
 return {format:v.format,identity:{...config.identity},data:v.data.slice()};
}
export function encodeRAM(bytes){insist(bytes instanceof Uint8Array&&bytes.length===config.identity.ram_bytes,'Exact cartridge RAM length');return validateRecord({format:'romjs-battery/1',identity:{...config.identity},data:Array.from(bytes)});}
export function decodeRAM(v){return Uint8Array.from(validateRecord(v).data);}
export const storageKey='romjs-battery/1:'+config.identity.rom_sha256+':'+config.identity.mapping_identity+':'+config.identity.mapper+':'+config.identity.ram_bytes;
export function readSave(storage){const raw=storage.getItem(storageKey);if(raw===null)return null;insist(typeof raw==='string'&&raw.length<=65536,'Save storage limit');return validateRecord(JSON.parse(raw));}
export function writeSave(storage,value){const v=validateRecord(value),raw=JSON.stringify(v);insist(raw.length<=65536,'Save storage limit');storage.setItem(storageKey,raw);return v;}
