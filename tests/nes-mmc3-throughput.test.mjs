import test from 'node:test';import assert from 'node:assert/strict';
import {PPU} from '../maintenance/engines/shared/devices.mjs';
import {metadata} from '../htdocs/games/double-dragon-ii/cartridge/entry.mjs';
import {instantiate as oldR} from '../htdocs/games/engines/nes/1.4.3/common/097fb2adb18bf5552177933bd02d264171a26c7b6641d4876af3118559cbc92f.mjs';
import {instantiate as oldP} from '../htdocs/games/engines/nes/1.4.3/common/f1d467e06aae59ba0499271c0ed0ff609468581be4b6018b498558390dc76b9c.mjs';
import {instantiate as newR} from '../maintenance/engines/timed-mmc3/runtime-factory.mjs';
import {instantiate as newP} from '../maintenance/engines/mmc3/ppu-factory.mjs';
const pair=[[oldR([{}]),oldP([])],[newR([{}]),newP([])]];
function config(irq_revision,phase,mirroring='mapper'){return Object.freeze({...metadata,mmc3:Object.freeze({...metadata.mmc3,irq_revision,m2_falling_dot:phase,mirroring})});}
function setup([runtime,ppu],info){const cpu={mem:new Uint8Array(65536),IRQ_NMI:1,requestIrq(){this.nmiPending=true;}},nes={cpu,opts:{},ui:{writeFrame(){}},mmap:{clockIrqCounter(){},latchAccess(){}}},p=nes.ppu=new PPU(nes),chr=Uint8Array.from({length:131072},(_,i)=>((i*173)^(i>>4)^(i>>11))&255),bus=runtime.makeBus(new Uint8Array(info.prgBanks*8192),new Uint8Array(),{write(a,v){if(a===0x2000)p.updateControlReg1(v);if(a===0x2001)p.updateControlReg2(v);}},info,chr),e=ppu.createOwnedInstance(),ciram=new Uint8Array(e.memory.buffer,e.owned_ciram(),info.mmc3.mirroring==='four_screen'?4096:2048);for(let i=0;i<ciram.length;i++)ciram[i]=(i*7)&255;const vram=new Uint8Array(e.memory.buffer,e.owned_vram(),32768);vram.set(p.vramMem);p.vramMem=vram;for(let i=0;i<32;i++)vram[0x3f00+i]=i;const frame=new Uint32Array(e.memory.buffer,e.owned_framebuffer(),61440);frame.set(p.buffer);p.buffer=frame;const owner=ppu.installOwnedDotPPU(nes,bus,a=>a<8192?bus.peekCHR(a):a<0x3f00?ciram[bus.mapNametable(a)]:p.vramMem[a],()=>{},e,runtime.bindOwnedPPU(bus,e));return {p,bus,cpu,e,owner};}
test('MMC3 sprite continuation preserves both IRQ revisions, all M2 phases, CHR inversion and sprite sizes',()=>{
 for(const irq of ['sharp-bc','alternate'])for(let phase=0;phase<3;phase++)for(const size of [0,32])for(const invert of [0,128]){const ms=pair.map(x=>setup(x,config(irq,phase,invert?'four_screen':'mapper')));for(const m of ms){for(let i=0;i<64;i++){m.p.spriteMem[i*4]=(i*7)&255;m.p.spriteMem[i*4+1]=i*3;m.p.spriteMem[i*4+2]=i*5;m.p.spriteMem[i*4+3]=(i*13)&255;}for(const [a,v]of [[0x8000,invert],[0x2000,size|8],[0x2001,30],[0xc000,40],[0xe001,0]])m.bus.write(a,v,m.bus.getCPUClock());}
 for(let i=0;i<360;i++){for(const m of ms){if(i%47===0){m.bus.write(0x8000,invert+(i%6),m.bus.getCPUClock());m.bus.write(0x8001,i*11&127,m.bus.getCPUClock());}m.p.advanceDots(499);}assert.deepEqual(ms[1].p.checkpointCapture(),ms[0].p.checkpointCapture());assert.deepEqual(ms[1].bus.getMapperState(),ms[0].bus.getMapperState());assert.deepEqual(ms[1].p.buffer,ms[0].p.buffer);assert.deepEqual(ms[1].cpu.mem,ms[0].cpu.mem);}}
});
test('MMC3 owned clock preserves all M2 phases at large clocks and after invalidation',()=>{
 for(const base of [0,2**32-2,2**40-2,Number.MAX_SAFE_INTEGER-16384])for(let phase=0;phase<3;phase++){const ms=pair.map(([r,p])=>{const bus=r.makeBus(new Uint8Array(metadata.prgBanks*8192),new Uint8Array(),{},config('sharp-bc',phase),new Uint8Array(8192)),e=p.createOwnedInstance(),binding=r.bindOwnedPPU(bus,e),v=structuredClone(bus.checkpointCapture());v.mapper.ppuDot=base+phase;bus.checkpointRestore(v);const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),clocks=new Float64Array(e.memory.buffer,e.shared_clocks(),2);q[0]=20;q[1]=10;clocks[0]=base+phase;return {bus,e,binding,q};});for(let i=0;i<240;i++){for(const m of ms){if(i%4===0)m.bus.write(i%8===0?0:0xc000,i,m.bus.getCPUClock());m.q[0]=20;/* Keep this clock-only probe away from host PPU yield boundaries. */m.binding.before();assert.equal(m.e.owned_advance(i%3+1),i%3+1);m.binding.after();}assert.deepEqual(ms[1].bus.getMapperState(),ms[0].bus.getMapperState());}}
});
test('MMC3 three-dot continuation matches mixed-size advances across host effects and mapper writes',()=>{
 for(const irq of ['sharp-bc','alternate'])for(let phase=0;phase<3;phase++){
  const ms=pair.map(x=>setup(x,config(irq,phase)));
  for(const m of ms){for(let i=0;i<64;i++){m.p.spriteMem[i*4]=(i*5)&255;m.p.spriteMem[i*4+1]=i;m.p.spriteMem[i*4+2]=i*3;m.p.spriteMem[i*4+3]=(i*11)&255;}m.bus.write(0x2001,30,0);}
  for(let batch=0;batch<430;batch++){
   for(const m of ms){if(batch%29===0){m.bus.write(0x8000,batch&135,m.bus.getCPUClock());m.bus.write(0x8001,batch&127,m.bus.getCPUClock());}for(let i=0;i<80;i++)m.p.advanceDots(i%23===0?i%3:3);}
   assert.deepEqual(ms[1].p.checkpointCapture(),ms[0].p.checkpointCapture());assert.deepEqual(ms[1].bus.getMapperState(),ms[0].bus.getMapperState());assert.deepEqual(ms[1].p.buffer,ms[0].p.buffer);assert.deepEqual(ms[1].cpu.mem,ms[0].cpu.mem);
  }
 }
});

test('private machine clocks publish position before active-render DMA observations',()=>{
 for(const phase of [0,1,2]){
  const ms=pair.map(x=>setup(x,config('sharp-bc',phase)));
  for(const m of ms)m.bus.write(0x2001,30,0);
  for(let batch=0;batch<120;batch++){
   for(const m of ms){
    for(let i=0;i<257;i++){if(m.owner)m.owner.clockThree();else m.p.advanceDots(3);}
    m.owner?.publishPosition();
   }
   assert.deepEqual([ms[1].p.scanline,ms[1].p.curX],[ms[0].p.scanline,ms[0].p.curX]);
   for(const m of ms){m.p.advanceDots(batch%3);if(batch%11===0)m.p.readStatusRegister();}
   assert.deepEqual(ms[1].p.checkpointCapture(),ms[0].p.checkpointCapture());
   assert.deepEqual(ms[1].bus.getMapperState(),ms[0].bus.getMapperState());
   assert.deepEqual(ms[1].p.buffer,ms[0].p.buffer);
  }
 }
});
