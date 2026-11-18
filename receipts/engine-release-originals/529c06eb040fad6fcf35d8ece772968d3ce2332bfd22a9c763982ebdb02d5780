// Canonical component ownership. Add a separately qualified component contract
// here when a new execution family cannot use one of these hardware interfaces.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {extractFactory} from './lib/engine-extraction.mjs';
export const sharedComponents=Object.freeze([
 Object.freeze({node:'devices.mjs',source:'maintenance/engines/shared/devices.mjs',contract:'jsnes-devices/1',required:true}),
 Object.freeze({node:'dma.mjs',source:'maintenance/engines/shared/dma.mjs',contract:'rp2a03-dmc-stop-reload-1',requiredFor:Object.freeze(['owned-uxrom-abi2/1','mmc5-dma/1'])}),
]);
export function componentPins(root){return sharedComponents.map(spec=>({...spec,factory:createHash('sha256').update(extractFactory(readFileSync(resolve(root,spec.source),'utf8'),spec.node).code).digest('hex')}));}
export function verifySharedComponents(engine,pins){
 const result=[];
 for(const spec of pins){const node=engine.graph.nodes.find(n=>n.key===spec.node),required=spec.required||spec.requiredFor?.includes(engine.abi);
  if(!node){if(required)throw Error('Missing shared component '+spec.contract+' in '+engine.abi);continue;}
  if(node.factory!==spec.factory)throw Error('Stale or private '+spec.contract+' implementation in '+engine.abi);
  result.push({node:spec.node,contract:spec.contract,factory:node.factory});
 }
 return result;
}
