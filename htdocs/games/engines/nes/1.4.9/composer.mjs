// Shared engine graph composer; cartridges supply data and graph identifiers.
const admitted=new WeakMap();
export function admit(data,graph,abi){
 if(!data||!Object.isFrozen(data.metadata)||!Object.isFrozen(data.blocks)||!graph||!Array.isArray(graph.nodes))throw Error('BAD_CARTRIDGE');
 const admission=Object.freeze({});admitted.set(admission,{data,graph,abi});return admission;
}
export function createMachine(admission,options,factories,expectedABI){
 const record=admitted.get(admission);if(!record||record.abi!==expectedABI)throw Error('UNSUPPORTED_ENGINE_ABI');
 const {data,graph}=record,cache=new Map(),pending=new Set();
 function get(key){
  if(key==='$data')return data;
  if(cache.has(key))return cache.get(key);
  if(pending.has(key))throw Error('UNSUPPORTED_ENGINE_CYCLE: '+key);
  const node=graph.nodes.find(n=>n.key===key);if(!node||typeof factories[node.factory]!=='function')throw Error('INCOMPLETE_ENGINE_CLOSURE');
  pending.add(key);const value=factories[node.factory](node.dependencies.map(get));pending.delete(key);cache.set(key,value);return value;
 }
 const namespace=get(graph.entry);if(typeof namespace.createMachine!=='function')throw Error('BAD_MACHINE_ABI');
 const startup={...options};return wrapCheckpointMachine(()=>namespace.createMachine(startup),data,graph,expectedABI);
}

// Checkpoint graph codec: data only, with aliases, cycles and typed storage preserved.
const MAX_NODES=20000,MAX_VALUES=1000000,MAX_BYTES=16*1024*1024;
const typed=new Map([Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array].map(T=>[T.name,T]));
const insist=(v,m)=>{if(!v)throw Error('Invalid checkpoint: '+m);};
const safeKey=k=>k!=='__proto__'&&k!=='constructor'&&k!=='prototype';
function prototypeSignature(proto){
 return JSON.stringify(Object.getOwnPropertyNames(proto).sort().map(k=>{
  const d=Object.getOwnPropertyDescriptor(proto,k);
  insist(!d.get&&!d.set,'prototype accessor');
  return [k,typeof d.value==='function'?Function.prototype.toString.call(d.value):JSON.stringify(d.value)];
 }));
}
function templatePrototypes(root){
 const seen=new Set(),prototypes=new Map();
 function visit(v){
  if(!v||typeof v!=='object'||seen.has(v)||ArrayBuffer.isView(v))return;seen.add(v);
  const p=Object.getPrototypeOf(v);
  if(p&&p!==Object.prototype&&p!==Array.prototype){const key=prototypeSignature(p);insist(!prototypes.has(key)||prototypes.get(key)===p,'ambiguous prototype');prototypes.set(key,p);}
  for(const k of Object.keys(v))visit(v[k]);
 }
 visit(root);return prototypes;
}
export function captureGraph(root){
 const seen=new Map(),nodes=[],prototypes=[],prototypeIds=new Map();let values=0;
 function value(v){
  insist(++values<=MAX_VALUES,'value limit');
  if(v===undefined)return {undefined:true};
  if(Object.is(v,-0))return {negativeZero:true};
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'){insist(Number.isFinite(v),'nonfinite value');return v;}
  insist(v&&typeof v==='object','non-data value');
  if(seen.has(v))return {ref:seen.get(v)};
  insist(nodes.length<MAX_NODES,'node limit');const id=nodes.length;seen.set(v,id);nodes.push(null);
  if(ArrayBuffer.isView(v)){
   insist(typed.get(v.constructor.name)===v.constructor,'typed storage');
   nodes[id]={kind:v.constructor.name,values:Array.from(v,value)};
  }else if(Array.isArray(v))nodes[id]={kind:'array',values:Array.from(v,value)};
  else{
   insist(!(v instanceof Map)&&!(v instanceof Set)&&!(v instanceof ArrayBuffer),'unsupported storage');
   const entries=[];
   for(const k of Object.keys(v)){const item=v[k];if(typeof item==='function')continue;insist(safeKey(k),'reserved key');entries.push([k,value(item)]);}
   const proto=Object.getPrototypeOf(v);let prototype=proto===null?-1:proto===Object.prototype?-2:prototypeIds.get(proto);
   if(prototype===undefined){prototype=prototypes.length;prototypeIds.set(proto,prototype);prototypes.push(prototypeSignature(proto));}
   nodes[id]={kind:'object',prototype,values:entries};
  }
  return {ref:id};
 }
 const graph={format:'nes-state-graph/1',root:value(root),nodes,prototypes};
 insist(JSON.stringify(graph).length<=MAX_BYTES,'size limit');return graph;
}

// The caller supplies a fresh machine. A failed hydration never touches the running one.
export function restoreGraph(root,graph){
 insist(graph&&Object.keys(graph).length===4&&graph.format==='nes-state-graph/1'&&Array.isArray(graph.nodes)&&graph.nodes.length<=MAX_NODES&&Array.isArray(graph.prototypes)&&graph.prototypes.length<=128,'format');
 insist(JSON.stringify(graph).length<=MAX_BYTES,'size limit');
 const catalog=templatePrototypes(root),prototypes=graph.prototypes.map(signature=>{insist(typeof signature==='string'&&catalog.has(signature),'unknown prototype');return catalog.get(signature);});
 const restored=new Map(),used=new Set();let values=0;
 function value(v,target,trail="root"){
  insist(++values<=MAX_VALUES,'value limit');
  if(target!==undefined&&target!==null&&typeof target!=='object'){const kind=typeof target;insist(typeof v===kind||(kind==='number'&&v?.negativeZero===true),'scalar type at '+trail);}
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'){insist(Number.isFinite(v),'nonfinite value');return v;}
  insist(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1,'value');
  if(v.undefined===true)return undefined;
  if(v.negativeZero===true)return -0;
  const id=v.ref;insist(Number.isInteger(id)&&id>=0&&id<graph.nodes.length,'reference');
  if(restored.has(id))return restored.get(id);
  const node=graph.nodes[id];insist(node&&Object.keys(node).length===(node.kind==='object'?3:2)&&Array.isArray(node.values),'node');
  const T=typed.get(node.kind);let result;
  if(T){
   insist(node.values.length<=MAX_VALUES,'typed storage limit');
   if(target===undefined||target===null)result=new T(node.values.length);
   else {insist(target instanceof T&&target.length===node.values.length,`typed storage shape at ${trail}`);result=target;}
  }else if(node.kind==='array'){
   insist(node.values.length<=MAX_VALUES,'array size');result=Array.isArray(target)&&!used.has(target)?target:[];
  }else{
   insist(node.kind==='object','node kind');
   insist(Number.isInteger(node.prototype)&&node.prototype>=-2&&node.prototype<prototypes.length,'prototype reference');
   const proto=node.prototype===-1?null:node.prototype===-2?Object.prototype:prototypes[node.prototype];
   result=target&&typeof target==='object'&&Object.getPrototypeOf(target)===proto&&!used.has(target)?target:Object.create(proto);
  }
  insist(!used.has(result),'storage alias mismatch');restored.set(id,result);used.add(result);
  if(T){
   for(let i=0;i<node.values.length;i++){
    const n=value(node.values[i]);insist(typeof n==='number','typed number');result[i]=n;
    insist(Object.is(result[i],n),'typed value range');
   }
  }else if(node.kind==='array'){
   result.length=node.values.length;for(let i=0;i<node.values.length;i++)result[i]=value(node.values[i],result[i],trail+"["+i+"]");
  }else{
   const keys=new Set(),required=Object.keys(result).filter(k=>typeof result[k]!=='function');
   for(const pair of node.values){
    insist(Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&safeKey(pair[0])&&!keys.has(pair[0]),'object key');
    const [k,v]=pair;keys.add(k);insist(typeof result[k]!=='function','method replacement');
    const next=value(v,result[k],trail+"."+k);
    if(Object.isFrozen(result))insist(Object.is(result[k],next),'immutable value');else result[k]=next;
   }
   for(const k of required)insist(keys.has(k),'missing field '+trail+'.'+k);
   for(const k of Object.keys(result))if(typeof result[k]!=='function'&&!keys.has(k)){
    insist(Object.getOwnPropertyDescriptor(result,k)?.configurable!==false,'missing fixed field');delete result[k];
   }
  }
  return result;
 }
 return value(graph.root,root);
}

export function wrapCheckpointMachine(create,data,graph,abi){
 const identity=JSON.stringify({abi,rom:data.metadata.romSha256,mapping:data.metadata.mappingIdentity,graph});
 let machine=create();
 const result={};
 for(const key of Object.keys(machine))if(!key.startsWith('checkpoint')){
  if(typeof machine[key]==='function')result[key]=(...args)=>machine[key](...args);
  else Object.defineProperty(result,key,{enumerable:true,get:()=>machine[key]});
 }
 result.exportCheckpoint=()=>({format:'nes-checkpoint/1',identity,state:captureGraph(machine.checkpointCapture())});
 result.importCheckpoint=record=>{
  if(!record||Object.keys(record).length!==3||record.format!=='nes-checkpoint/1'||record.identity!==identity)throw Error('Checkpoint belongs to a different cartridge or engine version');
  const candidate=create();
  let restoredState;
  try{
   const state=restoreGraph(candidate.checkpointCapture(),record.state);
   candidate.checkpointRestore(state);
   restoredState=candidate.getState();
  }catch(error){candidate.dispose?.();throw error;}
  const previous=machine;machine=candidate;previous.dispose?.();return restoredState;
 };
 return Object.freeze(result);
}
