import { createHash } from 'node:crypto';

const insist = (value, message) => { if (!value) throw new Error(message); };
const hash = source => createHash('sha256').update(source).digest('hex');

export function combineDevicesAndDmaFactory(devicesFactorySource, sharedDmaSource) {
  const exportAnchor = '\nexport {createDMA,installDMC,dmcTimingContract};\n';
  insist(sharedDmaSource.endsWith(exportAnchor), 'Canonical shared DMA export anchor mismatch');
  const resultAnchor = 'return Object.freeze(Object.defineProperties(Object.create(null),{"Controller":{enumerable:true,get:()=>controller_default},"Mapper0":{enumerable:true,get:()=>mapper0_default},"PAPU":{enumerable:true,get:()=>papu_default},"PPU":{enumerable:true,get:()=>ppu_default}}));';
  const first = devicesFactorySource.indexOf(resultAnchor);
  insist(first >= 0 && devicesFactorySource.indexOf(resultAnchor, first + resultAnchor.length) < 0, 'Expected one devices export anchor');
  const result = 'return Object.freeze(Object.defineProperties(Object.create(null),{"Controller":{enumerable:true,get:()=>controller_default},"Mapper0":{enumerable:true,get:()=>mapper0_default},"PAPU":{enumerable:true,get:()=>papu_default},"PPU":{enumerable:true,get:()=>ppu_default},"createDMA":{enumerable:true,get:()=>createDMA},"installDMC":{enumerable:true,get:()=>installDMC},"dmcTimingContract":{enumerable:true,get:()=>dmcTimingContract}}));';
  const dmaBody = sharedDmaSource.slice(0, -exportAnchor.length);
  return devicesFactorySource.slice(0, first) + dmaBody + '\n\n' + result + devicesFactorySource.slice(first + resultAnchor.length);
}

export function deriveCanonicalDeviceFactories(devicesSource, sharedDmaSource, extractFactory) {
  insist(typeof extractFactory === 'function', 'Canonical engine factory extractor required');
  const plain = extractFactory(devicesSource, 'devices.mjs').code;
  const dma = extractFactory(sharedDmaSource, 'dma.mjs').code;
  const combined = combineDevicesAndDmaFactory(plain, sharedDmaSource);
  return Object.freeze({
    plain: Object.freeze({ source: plain, factory: hash(plain) }),
    combined: Object.freeze({ source: combined, factory: hash(combined) }),
    dma: Object.freeze({ source: dma, factory: hash(dma) }),
  });
}
