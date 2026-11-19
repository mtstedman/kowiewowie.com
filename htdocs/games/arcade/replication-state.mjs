// Full-machine replication records. Video pixels are never a state authority.
const limit=16*1024*1024;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function base64(bytes){let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(text);}
// Canonicalize graph references as well as keys, without changing the pinned engine
// or discarding fields, aliases, array order, typed storage or prototype identity.
function canonicalGraph(graph){
 const ids=new Map(),nodes=[],prototypeIds=new Map(),prototypes=[];
 function value(v){
  if(!v||typeof v!=='object'||!Object.hasOwn(v,'ref'))return v;
  const old=v.ref;if(!Number.isInteger(old)||old<0||old>=graph.nodes.length)throw Error('Invalid checkpoint graph reference');
  if(ids.has(old))return {...v,ref:ids.get(old)};
  const id=nodes.length;ids.set(old,id);nodes.push(null);const node=graph.nodes[old];
  const values=node.kind==='object'?node.values.slice().sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([key,item])=>[key,value(item)]):node.values.map(value);
  nodes[id]={...node,values};
  if(node.kind==='object'&&node.prototype>=0){if(!prototypeIds.has(node.prototype)){prototypeIds.set(node.prototype,prototypes.length);prototypes.push(graph.prototypes[node.prototype]);}nodes[id].prototype=prototypeIds.get(node.prototype);}
  return {...v,ref:id};
 }
 const root=value(graph.root);for(let i=0;i<graph.nodes.length;i++)if(!ids.has(i))value({ref:i});
 for(let i=0;i<graph.prototypes.length;i++)if(!prototypeIds.has(i)){prototypeIds.set(i,prototypes.length);prototypes.push(graph.prototypes[i]);}
 return {...graph,root,nodes,prototypes};
}
function canonicalValue(v){
 if(v instanceof Uint8Array)return {$uint8:base64(v)};
 if(!v||typeof v!=='object')return v;
 if(Array.isArray(v))return v.some(item=>item&&typeof item==='object')?v.map(canonicalValue):v;
 if(v.format==='nes-state-graph/1')v=canonicalGraph(v);
 const result=Object.create(null);for(const key of Object.keys(v).sort())result[key]=canonicalValue(v[key]);return result;
}
export function encodeReplicationState(state){
 const bytes=new TextEncoder().encode(JSON.stringify(canonicalValue(state)));if(bytes.length>limit)throw Error('Replication checkpoint exceeds limit');return bytes;
}
export function decodeReplicationState(bytes){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit)throw Error('Invalid replication checkpoint bytes');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),(_,v)=>{if(v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$uint8==='string'){const text=atob(v.$uint8);return Uint8Array.from(text,c=>c.charCodeAt(0));}return v;});
}
export async function hashReplicationState(state){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encodeReplicationState(state))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function replicationIdentity(state){
 if(state?.format==='nes-checkpoint/1'&&typeof state.identity==='string')return {system:'nes',key:await hashReplicationState(state.identity)};
 if(state?.format==='posse-snes-browser-state/1'&&hex(state.romSha256)&&hex(state.coreSha256))return {system:'snes',romSha256:state.romSha256,coreSha256:state.coreSha256,sampleRate:state.sampleRate};
 throw Error('Unsupported replication checkpoint');
}
export async function replicationSnapshot(frame,state){if(!Number.isSafeInteger(frame)||frame<0)throw Error('Invalid checkpoint frame');return {frame,state,identity:await replicationIdentity(state),hash:await hashReplicationState(state)};}
export async function validateReplicationSnapshot(snapshot){
 if(!snapshot||!Number.isSafeInteger(snapshot.frame)||snapshot.frame<0||!hex(snapshot.hash))throw Error('Invalid replication snapshot');
 if(snapshot.picture)validateReplicationPicture(snapshot.picture);
 const identity=await replicationIdentity(snapshot.state);if(JSON.stringify(Object.entries(identity).sort())!==JSON.stringify(Object.entries(snapshot.identity||{}).sort())||await hashReplicationState(snapshot.state)!==snapshot.hash)throw Error('Replication checkpoint integrity mismatch');return snapshot.state;
}
export function validateFrameRecords(records,frame,mask){
 if(!Array.isArray(records)||!records.length||records.length>120)throw Error('Invalid replication batch');
 for(const record of records){if(!record||record.frame!==++frame||!Array.isArray(record.pads)||record.pads.length!==2||record.pads.some(v=>!Number.isInteger(v)||v<0||v>mask)||record.hash!==undefined&&!hex(record.hash))throw Error('Invalid or nonconsecutive replication frame');}
 return records;
}

export function validateReplicationPicture(picture){if(!picture||!Number.isInteger(picture.width)||picture.width<1||picture.width>512||!Number.isInteger(picture.height)||picture.height<1||picture.height>478||!(picture.rgba instanceof Uint8Array)||picture.rgba.length!==picture.width*picture.height*4)throw Error('Invalid replication picture');return picture;}
