import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBus,bindOwnedPPU} from '../maintenance/engines/mmc5/runtime.mjs';
import {createOwnedInstance} from '../maintenance/engines/mmc5/ppu-owned.mjs';
import {verifyInertBank} from '../maintenance/lib/cartridge-construction.mjs';
const profile=Object.freeze({board:'ELROM',prg_ram:'none',revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'});
const info=Object.freeze({mapper:5,prgBanks:2,mappingIdentity:'synthetic-mmc5',mmc5:profile});
const make=()=>makeBus(new Uint8Array(16384),new Uint8Array(),{},info,new Uint8Array(8192));
test('MMC5 preserves CPU phase across Wasm and JavaScript PPU boundaries',()=>{
 for(let phase=0;phase<3;phase++){
  const bus=make(),e=createOwnedInstance(),binding=bindOwnedPPU(bus,e),clocks=new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4);
  bus.advancePPUClock(phase);binding.before();clocks[0]=phase+1;binding.after();bus.advancePPUClock(phase+2);bus.advancePPUClock(phase+3);
  assert.equal(bus.getMapperState().audioCycles,Math.floor((phase+3)/3));
 }
});
test('MMC5 checkpoint restores nonzero PPU phase and hidden mapper state',()=>{
 const bus=make();bus.advancePPUClock(5);bus.write(0x5205,13,0);bus.write(0x5206,7,1);const saved=structuredClone(bus.checkpointCapture());
 bus.advancePPUClock(99);bus.write(0x5205,2,2);bus.checkpointRestore(saved);bus.advancePPUClock(6);
 assert.equal(bus.getMapperState().audioCycles,2);assert.equal(bus.read(0x5205),91);
});
test('MMC5 machine instances own independent Wasm memory',()=>{const a=createOwnedInstance(),b=createOwnedInstance();assert.notEqual(a.memory,b.memory);new Uint8Array(a.memory.buffer)[a.owned_exram()]=71;assert.equal(new Uint8Array(b.memory.buffer)[b.owned_exram()],0);});
test('translated DMA banks retain counted early fetches and inert freeze grammar',()=>{
 const text='const B=Object.create(null);B[32768]=[[32,0,128],c=>{c.q(32770,128);return 6;},0,2];function f(e){if(e.cross){for(const v of Object.values(e.cross))f(v);Object.freeze(e.cross);}else Object.freeze(e[0]);Object.freeze(e);}for(const e of Object.values(B))f(e);export default Object.freeze(B);';
 verifyInertBank(text,'synthetic');assert.throws(()=>verifyInertBank(text.replace('f(v);','f(v);danger();'),'synthetic'),/freeze construction/);assert.throws(()=>verifyInertBank(text.replace(',0,2]',',0,4]'),'synthetic'),/construction/);
});
test('MMC5 code verification preserves custom peek hooks and rejects remapped bytes',async()=>{
 const {makeCPU,composeBus}=await import('../maintenance/engines/mmc5/runtime.mjs');
 const rom=new Uint8Array(32768);rom.set([0x4c,0,0xe0],3*8192);rom.set([0,0xe0],32764);rom.set([0xea,0,0xe0],8192);
 const metadata=Object.freeze({...info,prgBanks:4,officialOpcodes:[0x4c,0xea]});
 const entry=Object.freeze([Object.freeze([0x4c,0,0xe0]),c=>{c.s.pc=0xe000;return 3;},0]);
 const table=Object.freeze(Object.assign(Object.create(null),{57344:entry}));
 const blocks=Object.freeze([Object.freeze({}),Object.freeze({}),Object.freeze({}),Object.freeze({1:table,3:table})]);
 for(const custom of [false,true]){
  const base=makeBus(rom,new Uint8Array(),{},metadata,new Uint8Array(8192));let peeks=0;
  const bus=composeBus(base,{peek:custom?a=>{peeks++;return base.peek(a);}:base.peek});const cpu=makeCPU(bus,blocks,metadata);
  cpu.step();cpu.step();if(custom)assert.equal(peeks,6,'Custom peek must still run on every instruction');
  base.write(0x5117,0x81,base.getCPUClock());assert.throws(()=>cpu.step(),e=>e.code==='CODE_CHANGED');
 }
});
test('MMC5 staged scanline IRQ is visible before synchronization and clears on status read',()=>{
 const bus=makeBus(new Uint8Array(16384),new Uint8Array(),{peek:()=>0},info,new Uint8Array(8192)),e=createOwnedInstance(),binding=bindOwnedPPU(bus,e);
 const mapper=new Uint32Array(e.memory.buffer,e.owned_mapper(),64),clocks=new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4);
 bus.write(0x5204,128,0);binding.before();mapper[24]=1;clocks[0]=3;binding.after();assert.equal(bus.getIRQ(),true);
 assert.equal(bus.read(0x5204)&128,128);assert.equal(bus.getIRQ(),false);assert.equal(bus.getMapperState().audioCycles,1);
});
