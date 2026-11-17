import test from 'node:test';import assert from 'node:assert/strict';
import {metadata} from '../htdocs/games/adventure-island-2/cartridge/entry.mjs';
import {instantiate as oldFactory} from '../htdocs/games/engines/nes/1.4.7/common/2663c63f493c9ff95b90fb86cea5226ec98c1e4aa58641234702b8a5fc9042e8.mjs';
import {instantiate as newFactory} from '../maintenance/engines/mmc3/runtime-factory.mjs';
import {instantiate as ppuFactory} from '../maintenance/engines/mmc3/ppu-factory.mjs';
const ppu=ppuFactory([]);
function setup(factory,phase,origin){
 const r=factory([]),info=Object.freeze({...metadata,mmc3:Object.freeze({...metadata.mmc3,m2_falling_dot:phase})}),bus=r.makeBus(new Uint8Array(info.prgBanks*8192),new Uint8Array(),{},info,new Uint8Array(8192)),e=ppu.createOwnedInstance(),binding=r.bindOwnedPPU(bus,e),q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),clocks=new Float64Array(e.memory.buffer,e.shared_clocks(),2),s=structuredClone(bus.checkpointCapture());
 s.mapper.ppuDot=origin;bus.checkpointRestore(s);clocks[0]=origin;q[0]=20;q[1]=25;
 return {bus,e,binding,q};
}
test('deferred MMC3 publication preserves mapper observations, IRQ reads and invalidation at all M2 phases',()=>{
 for(const phase of [0,1,2])for(const origin of [0,2**32-2,2**40-2,Number.MAX_SAFE_INTEGER-16384]){
  const ms=[oldFactory,newFactory].map(f=>setup(f,phase,origin));
  for(let batch=0;batch<80;batch++){
   for(const m of ms){
    for(let i=0;i<17;i++){m.q[0]=20;m.q[1]=25;assert(m.binding.before());assert.equal(m.e.owned_advance(3),3);m.binding.after();}
    // Ordinary RAM writes leave staged PPU ownership intact.
    m.bus.write(batch&2047,batch,m.bus.getCPUClock());
    if(batch%7===0)m.bus.write(0xc000,batch,m.bus.getCPUClock());
    if(batch%11===0)m.bus.setPPUAddress(batch&1?4096:0,m.bus.getPPUClock());
   }
   assert.equal(ms[1].bus.getIRQ(),ms[0].bus.getIRQ());
   assert.equal(ms[1].bus.getPPUClock(),ms[0].bus.getPPUClock());
   assert.deepEqual(ms[1].bus.getMapperState(),ms[0].bus.getMapperState());
   if(batch%13===0)for(const m of ms)m.bus.checkpointRestore(structuredClone(m.bus.checkpointCapture()));
  }
 }
});
