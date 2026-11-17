import test from 'node:test';
import assert from 'node:assert/strict';
import {instantiate as timed} from '../maintenance/engines/timed-mmc3/runtime-factory.mjs';
import {instantiate as regular} from '../maintenance/engines/mmc3/runtime-factory.mjs';
import {instantiate as oldTimed} from '../htdocs/games/engines/nes/1.4.4/common/074b8b4c9e02d593bacabfaa51da2f0d0f76d566e79eee1fbc383efcb88d5df5.mjs';
import {instantiate as oldRegular} from '../htdocs/games/engines/nes/1.4.4/common/230e0d31de10b3a1c8b4e22c58ff79c5bc471aaa337fd1f3323c8d5315ee7667.mjs';
import {instantiate as ppuFactory} from '../maintenance/engines/mmc3/ppu-factory.mjs';
const ppu=ppuFactory([]);
function setup(runtime,irq_revision,m2_falling_dot){
 const mmc3=Object.freeze({board:'standard-txrom',irq_revision,m2_falling_dot,mirroring:'mapper',prg_ram:'none',reload_policy:'reject-consecutive-reload',startup_model:'explicit-banks-zero-irq',startup_select:0,startup_ram_protect:0,startup_mirroring:0,startup_registers:Object.freeze([0,2,4,5,6,7,0,1])});
 const info=Object.freeze({mapper:4,prgBanks:2,prgBankBytes:8192,mappingIdentity:'mapper-transfer-regression',mmc3}),bus=runtime.makeBus(new Uint8Array(16384),new Uint8Array(),{},info,new Uint8Array(8192)),e=ppu.createOwnedInstance(),binding=runtime.bindOwnedPPU(bus,e),q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),clock=new Float64Array(e.memory.buffer,e.shared_clocks(),2),sprites=new Uint32Array(e.memory.buffer,e.owned_sprite_next(),64);
 const write=(a,v)=>bus.write(a,v,bus.getCPUClock());
 function edge(){bus.setPPUAddress(0);bus.advancePPUClock(bus.getPPUClock()+12);clock[0]=bus.getPPUClock();q[0]=261;q[1]=21;q[2]=q[3]=1;sprites[6]=4096;assert(binding.before());assert.equal(e.owned_advance(3),3);binding.after();}
 return {bus,write,edge};
}
test('both MMC3 execution families expose native IRQ changes before any mapper snapshot flush',()=>{
 for(const [oldFactory,newFactory] of [[oldTimed,timed],[oldRegular,regular]])for(const irq of ['sharp-bc','alternate'])for(let phase=0;phase<3;phase++){
  const pair=[oldFactory,newFactory].map(factory=>setup(factory([{}]),irq,phase));
  for(const m of pair){m.write(0xc000,1);m.write(0xc001,0);m.write(0xe001,0);m.edge();assert.equal(m.bus.getIRQ(),false);m.write(0xc000,0);m.edge();assert.equal(m.bus.getIRQ(),true,'IRQ visible without reading clock or mapper state');m.write(0x10,123);assert.equal(m.bus.getIRQ(),true,'RAM write retains staged IRQ');}
  assert.deepEqual(pair[1].bus.getMapperState(),pair[0].bus.getMapperState());
  const saved=pair.map(m=>structuredClone(m.bus.checkpointCapture()));
  for(const m of pair){m.write(0xe000,0);assert.equal(m.bus.getIRQ(),false);m.edge();assert.equal(m.bus.getIRQ(),false);}
  for(let i=0;i<pair.length;i++){pair[i].bus.checkpointRestore(saved[i]);assert.equal(pair[i].bus.getIRQ(),true);}
  assert.deepEqual(pair[1].bus.getMapperState(),pair[0].bus.getMapperState());
 }
});
