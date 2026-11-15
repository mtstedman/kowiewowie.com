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
 return namespace.createMachine(options);
}
