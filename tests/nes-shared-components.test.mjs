import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
import {componentPins,verifySharedComponents} from '../maintenance/nes-shared-components.mjs';
const root=new URL('../',import.meta.url).pathname,pins=componentPins(root),registry=JSON.parse(readFileSync(resolve(root,'htdocs/games/engines/nes/registry.json')));
test('every registered sibling consumes the canonical shared hardware classes',()=>{
 for(const selection of Object.values(registry.selections)){
  const engine=JSON.parse(readFileSync(resolve(root,'htdocs'+selection.manifest.path)));verifySharedComponents(engine,pins);
  const stale=structuredClone(engine);stale.graph.nodes.find(n=>n.key==='devices.mjs').factory='0'.repeat(64);assert.throws(()=>verifySharedComponents(stale,pins),/Stale or private/);
  const missing=structuredClone(engine);missing.graph.nodes=missing.graph.nodes.filter(n=>n.key!=='devices.mjs');assert.throws(()=>verifySharedComponents(missing,pins),/Missing shared/);
 }
});
