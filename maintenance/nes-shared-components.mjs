// Replacement source for maintenance/nes-shared-components.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { extractFactory } from './lib/engine-extraction.mjs';
import { deriveCanonicalDeviceFactories } from './engines/shared/canonical-devices-dma.mjs';

export const sharedComponents = Object.freeze([
  Object.freeze({ node: 'devices.mjs', source: 'maintenance/engines/shared/devices.mjs', contract: 'jsnes-devices/1', required: true }),
  Object.freeze({ node: 'dma.mjs', source: 'maintenance/engines/shared/dma.mjs', contract: 'rp2a03-dmc-stop-reload-1', requiredFor: Object.freeze(['owned-uxrom-abi2/1', 'mmc5-dma/1', 'mmc2-dot/1', 'timed-mmc3/1']) }),
]);

export function componentPins(root) {
  const devicesSpec = sharedComponents[0];
  const dmaSpec = sharedComponents[1];
  const devicesSource = readFileSync(resolve(root, devicesSpec.source), 'utf8');
  const dmaSource = readFileSync(resolve(root, dmaSpec.source), 'utf8');
  const identities = deriveCanonicalDeviceFactories(devicesSource, dmaSource, extractFactory);
  return [
    { ...devicesSpec, factory: identities.plain.factory, combinedFactory: identities.combined.factory },
    { ...dmaSpec, factory: identities.dma.factory, combinedFactory: identities.combined.factory },
  ];
}

export function verifySharedComponents(engine, pins) {
  const result = [];
  const devicesSpec = pins.find(spec => spec.node === 'devices.mjs');
  const dmaSpec = pins.find(spec => spec.node === 'dma.mjs');
  if (!devicesSpec || !dmaSpec) throw new Error('Missing canonical component pin definitions');

  const nodes = engine?.graph?.nodes;
  if (!Array.isArray(nodes)) throw new Error(`Missing shared component graph in ${engine?.abi}`);
  const devicesNode = nodes.find(node => node.key === devicesSpec.node);
  if (!devicesNode) throw new Error(`Missing shared component ${devicesSpec.contract} in ${engine.abi}`);
  const packedDma = devicesNode.factory === devicesSpec.combinedFactory;
  if (devicesNode.factory !== devicesSpec.factory && !packedDma) throw new Error(`Stale or private ${devicesSpec.contract} implementation in ${engine.abi}`);
  result.push({ node: devicesSpec.node, contract: devicesSpec.contract, factory: devicesNode.factory });

  const dmaNode = nodes.find(node => node.key === dmaSpec.node);
  const required = dmaSpec.required || dmaSpec.requiredFor?.includes(engine.abi);
  if (dmaNode) {
    if (dmaNode.factory !== dmaSpec.factory) throw new Error(`Stale or private ${dmaSpec.contract} implementation in ${engine.abi}`);
    result.push({ node: dmaSpec.node, contract: dmaSpec.contract, factory: dmaNode.factory });
  } else if (packedDma) {
    result.push({ node: devicesSpec.node, contract: dmaSpec.contract, factory: devicesNode.factory, provenance: 'packed-canonical-dma' });
  } else if (required) {
    throw new Error(`Missing shared component ${dmaSpec.contract} in ${engine.abi}`);
  }
  for (const spec of pins) {
    if (spec === devicesSpec || spec === dmaSpec) continue;
    const node = nodes.find(candidate => candidate.key === spec.node);
    const componentRequired = spec.required || spec.requiredFor?.includes(engine.abi);
    if (!node) {
      if (componentRequired) throw new Error(`Missing shared component ${spec.contract} in ${engine.abi}`);
      continue;
    }
    if (node.factory !== spec.factory) throw new Error(`Stale or private ${spec.contract} implementation in ${engine.abi}`);
    result.push({ node: spec.node, contract: spec.contract, factory: node.factory });
  }
  return result;
}
