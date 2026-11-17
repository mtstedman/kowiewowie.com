import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PPU} from '../maintenance/engines/shared/devices.mjs';
import * as newRuntime from '../maintenance/engines/mmc5/runtime.mjs';
import * as newPPU from '../maintenance/engines/mmc5/ppu-owned.mjs';
// Frozen previous release is the differential reference, never a mutable copy.
import {instantiate as oldBusFactory} from '../htdocs/games/engines/nes/1.4.1/common/2f73e2731f583ad90372afbae50866a0ad87497d360436869f6b714d67028166.mjs';
import {instantiate as oldPPUFactory} from '../htdocs/games/engines/nes/1.4.1/common/9acc17bfae2c0cd38a04379caaefb50e700f3ce7ec6421ea4a0de782dd20f87f.mjs';
import {instantiate as oldBinaryFactory} from '../htdocs/games/engines/nes/1.4.1/common/e53699bdd31823955eb74b945933f04dc449c7deb377af38f23de869d1f7847a.mjs';
const oldRuntime=oldBusFactory([]),oldPPU=oldPPUFactory([oldBinaryFactory([])]);
test('MMC5 sprite fetches preserve every CHR mode, sprite size and extended-attribute state',()=>{
const profile=Object.freeze({board:'ELROM',prg_ram:'none',revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'}),info=Object.freeze({mapper:5,prgBanks:2,mappingIdentity:'synthetic-mmc5',mmc5:profile});
function machine(runtime,ppu){const cpu={mem:new Uint8Array(65536),IRQ_NMI:1,requestIrq(){this.nmiPending=true;}},nes={cpu,opts:{},ui:{writeFrame(){}},mmap:{clockIrqCounter(){},latchAccess(){}}};const p=nes.ppu=new PPU(nes);const chr=Uint8Array.from({length:131072},(_,i)=>((i*173)^(i>>4)^(i>>11))&255);const bus=runtime.makeBus(new Uint8Array(16384),new Uint8Array(),{write(a,v){if(a===0x2000)p.updateControlReg1(v);if(a===0x2001)p.updateControlReg2(v);}},info,chr),e=ppu.createOwnedInstance();const ciram=new Uint8Array(e.memory.buffer,e.owned_ciram(),2048);for(let i=0;i<2048;i++)ciram[i]=(i*7)&255;const vram=new Uint8Array(e.memory.buffer,e.owned_vram(),32768);vram.set(p.vramMem);p.vramMem=vram;for(let i=0;i<32;i++)vram[0x3f00+i]=i;const buffer=new Uint32Array(e.memory.buffer,e.owned_framebuffer(),61440);buffer.set(p.buffer);p.buffer=buffer;
ppu.installOwnedDotPPU(nes,bus,a=>a<8192?bus.peekCHR(a):a<0x3f00?bus.readNametable(a,ciram):p.vramMem[a],()=>{},e,runtime.bindOwnedPPU(bus,e),(a,k)=>bus.ppuFetch(a,k,ciram));return {p,bus,cpu};}
const hash=b=>createHash('sha256').update(new Uint8Array(b.buffer,b.byteOffset,b.byteLength)).digest('hex');let checks=0;
for(const mode of [0,1,2,3])for(const size of [0,32])for(const extended of [0,1]){const a=machine(oldRuntime,oldPPU),b=machine(newRuntime,newPPU);for(const m of [a,b]){m.bus.write(0x5101,mode,m.bus.getCPUClock());m.bus.write(0x5104,extended,m.bus.getCPUClock());m.bus.write(0x5105,0x44,m.bus.getCPUClock());for(let i=0;i<12;i++)m.bus.write(0x5120+i,(i*11)&127,m.bus.getCPUClock());for(let i=0;i<64;i++){m.p.spriteMem[i*4]=(i*7)&255;m.p.spriteMem[i*4+1]=i*3;m.p.spriteMem[i*4+2]=i*5;m.p.spriteMem[i*4+3]=(i*13)&255;}m.bus.write(0x2000,size,m.bus.getCPUClock());m.bus.write(0x2001,30,m.bus.getCPUClock());m.bus.write(0x5203,40,m.bus.getCPUClock());m.bus.write(0x5204,128,m.bus.getCPUClock());}
for(let i=0;i<900;i++){for(const m of [a,b]){if(i%2){for(let j=0;j<66;j++)m.p.advanceDots(3);m.p.advanceDots(1);}else m.p.advanceDots(199);}assert.deepEqual(b.p.checkpointCapture(),a.p.checkpointCapture());assert.deepEqual(b.bus.getMapperState(),a.bus.getMapperState());assert.equal(hash(b.p.buffer),hash(a.p.buffer));assert.deepEqual(b.cpu.mem,a.cpu.mem);checks++;}}

});
test('MMC5 bulk disconnected audio preserves timer, envelope and checkpoint state',()=>{
const profile=Object.freeze({board:'ELROM',prg_ram:'none',revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'}),info=Object.freeze({mapper:5,prgBanks:2,mappingIdentity:'synthetic-mmc5',mmc5:profile});
const setup=r=>{const b=r.makeBus(new Uint8Array(16384),new Uint8Array(),{},info,new Uint8Array(8192)),e=newPPU.createOwnedInstance(),binding=r.bindOwnedPPU(b,e);return {b,binding,clock:new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4)};};const a=setup(oldRuntime),b=setup(newRuntime);let seed=0x12345;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let i=0;i<10000;i++){if(i%3===0){const reg=[0x5000,0x5002,0x5003,0x5004,0x5006,0x5007,0x5015][rand()%7],value=rand()&255;for(const m of [a,b])m.b.write(reg,value,m.b.getCPUClock());}const ticks=i<5?[0,1,7423,7424,8192][i]:rand()%8193;for(const m of [a,b]){m.binding.before();m.clock[0]+=ticks*3;m.binding.after();}assert.deepEqual(b.b.getMapperState(),a.b.getMapperState());if(i%127===0){for(const m of [a,b]){const save=structuredClone(m.b.checkpointCapture());m.b.checkpointRestore(save);}}}

});
test('MMC5 cached ROM reads preserve PRG modes, RAM boards, PCM and restore invalidation',()=>{
 const profiles={ELROM:'none',EKROM:'8k',ETROM:'16k',EWROM:'32k'};
 for(const [board,prg_ram] of Object.entries(profiles)){
  const cfg=Object.freeze({board,prg_ram,revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'}),info=Object.freeze({mapper:5,prgBanks:16,mappingIdentity:'prg-cache-parity',mmc5:cfg});
  const rom=Uint8Array.from({length:16*8192},(_,i)=>((i>>>13)*17+(i&255))&255),make=r=>r.makeBus(rom,new Uint8Array(),{read:()=>0x75,peek:()=>0x75},info,new Uint8Array(8192)),a=make(oldRuntime),b=make(newRuntime);
  for(const bus of [a,b]){bus.write(0x5102,2,bus.getCPUClock());bus.write(0x5103,1,bus.getCPUClock());bus.write(0x5010,129,bus.getCPUClock());}
  for(let i=0;i<512;i++){
   for(const bus of [a,b]){bus.write(0x5100,i&3,bus.getCPUClock());bus.write(0x5113+i%5,(i*43)&255,bus.getCPUClock());bus.write(0x6000+(i&8191),i&255,bus.getCPUClock());}
   for(const address of [0x6000+(i&8191),0x8000,0x9fff,0xa011,0xbfff,0xc000,0xdfff,0xe010,0xfffa,0xfffb,0xffff]){assert.equal(b.peek(address),a.peek(address));assert.equal(b.read(address),a.read(address));}
   assert.deepEqual(b.getMapperState(),a.getMapperState());
   if(i%31===0)for(const bus of [a,b]){const save=structuredClone(bus.checkpointCapture());bus.write(0x5117,0x80,bus.getCPUClock());bus.checkpointRestore(save);}
  }
 }
});
test('MMC5 owned clock phase remains exact beyond 32-bit clocks',()=>{
 const cfg=Object.freeze({board:'ELROM',prg_ram:'none',revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'}),info=Object.freeze({mapper:5,prgBanks:2,mappingIdentity:'phase-parity',mmc5:cfg});
 for(const base of [0,2**32-2,2**40-2])for(let phase=0;phase<3;phase++){
  const pair=[[oldRuntime,oldPPU],[newRuntime,newPPU]].map(([r,p])=>{const b=r.makeBus(new Uint8Array(16384),new Uint8Array(),{},info,new Uint8Array(8192)),e=p.createOwnedInstance(),binding=r.bindOwnedPPU(b,e),v=b.checkpointCapture();v.state.ppuDot=base+phase;v.state.ppuPhase=(base+phase)%3;b.checkpointRestore(v);const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),clock=new Float64Array(e.memory.buffer,e.shared_clocks(),2);q[0]=20;q[1]=10;clock[0]=base+phase;return {b,e,binding};});
  for(let i=0;i<24;i++){for(const m of pair){m.binding.before();assert.equal(m.e.owned_advance(i%3+1),i%3+1);m.binding.after();}assert.deepEqual(pair[1].b.getMapperState(),pair[0].b.getMapperState());}
 }
});

test('Verified instruction fetches retain real reads and mapping-first failure ordering',()=>{
const cfg=Object.freeze({board:'ELROM',prg_ram:'none',revision:'MMC5',wiring:'CL',audio:'nes-disconnected',startup:'reset-defined-zero-other',exram_blank_write:'zero',chr_latch:'mode-latched-reject-unknown'}),info=Object.freeze({mapper:5,prgBanks:4,mappingIdentity:'checked-fetch',mmc5:cfg,officialOpcodes:[0x4c]});
const rom=new Uint8Array(32768);rom.set([0x4c,0,0xe0],3*8192);rom.set([0,0xe0],32764);const entry=Object.freeze([Object.freeze([0x4c,0,0xe0]),c=>{c.s.pc=0xe000;return 3;},0]),table=Object.freeze(Object.assign(Object.create(null),{57344:entry})),blocks=Object.freeze([Object.freeze({}),Object.freeze({}),Object.freeze({}),Object.freeze({3:table})]);
for(const [mode,code] of [['mapping','MAPPING_CHANGED'],['byte','BAD_ARGUMENT'],['source','CODE_CHANGED']]){let armed=false,reads=0;const base=newRuntime.makeBus(rom,new Uint8Array(),{},info,new Uint8Array(8192)),bus=newRuntime.composeBus(base,{peek:base.peek,read(a){reads++;const value=base.read(a);if(!armed||a!==0xe001)return value;if(mode==='mapping'){base.write(0x5117,0x81,base.getCPUClock());return NaN;}return mode==='byte'?NaN:99;}}),cpu=newRuntime.makeCPU(bus,blocks,info);cpu.step();cpu.step();assert.equal(reads,8);armed=true;assert.throws(()=>cpu.step(),e=>e.code===code,mode);assert.equal(reads,10);}

});
