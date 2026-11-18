import test from 'node:test';import assert from 'node:assert/strict';
import {PPU} from '../maintenance/engines/shared/devices.mjs';
import {instantiate as transfer} from '../htdocs/games/engines/nes/1.4.7/common/11a5fb418692a5ed52bdbf6868bce68ff371fe1d1b766d87f2d07f7f99684edf.mjs';
import {instantiate as mask} from '../htdocs/games/engines/nes/1.4.7/common/6c965abddeff13876f78c12e0afa20491ec52c41037a3c6451436d7ed80208e6.mjs';
import {instantiate as oldPpu} from '../htdocs/games/engines/nes/1.4.7/common/eeeda9b93b25814f472926ab1389da035996bb80f455fb13bf3f804e629bd39c.mjs';
import {instantiate as oldCodec} from '../htdocs/games/engines/nes/1.4.7/common/7c399b0ca751db7b1b90ea7dde37030bfe40c1e0c941c8f0ac6930ee435df81c.mjs';
import {instantiate as oldSession} from '../htdocs/games/engines/nes/1.4.7/common/7f2a8e94e5586f16e95682ba800ff319c6454a4528dc6ccfa500ffa0683be008.mjs';
import {instantiate as oldAdapter} from '../htdocs/games/engines/nes/1.4.7/common/5d53c241983b28c79819f9ff629b9464cc330cd6139ae3cd4e0147fdb9ce186a.mjs';
import {instantiate as oldBinary} from '../htdocs/games/engines/nes/1.4.7/common/348059551e4ae43a916e6c8d1a7117ae34036784a837fafdf28ec3155f109466.mjs';
import {instantiate as newPpu} from '../maintenance/engines/owned-uxrom/ppu-factory.mjs';
import {instantiate as newCodec} from '../maintenance/engines/owned-uxrom/codec-factory.mjs';
import {instantiate as newSession} from '../maintenance/engines/owned-uxrom/session-factory.mjs';
import {instantiate as newAdapter} from '../maintenance/engines/owned-uxrom/adapter-factory.mjs';
import {instantiate as newBinary} from '../maintenance/engines/owned-uxrom/binary-factory.mjs';
function moduleSet(p,c,s,a,b){const state=transfer([]),codec=c([state]);return a([p([state,mask([state])]),s([codec]),codec,b([])]);}
const modules=[moduleSet(oldPpu,oldCodec,oldSession,oldAdapter,oldBinary),moduleSet(newPpu,newCodec,newSession,newAdapter,newBinary)];
function setup(module,size,visible){
 const cpu={mem:new Uint8Array(65536),IRQ_NMI:1,IRQ_NORMAL:0,nmiRaised:false,nmiPending:false,nmiRaisedAtCycle:0,nmiDotsRemainingInStep:0,instrBusCycles:0,requestIrq(k){if(k===1)this.nmiPending=true;}},nes={cpu,opts:{},ui:{writeFrame(){}},mmap:{clockIrqCounter(){},latchAccess(){}}};
 const p=nes.ppu=new PPU(nes);p.clipToTvSize=false;
 const chr=Uint8Array.from({length:8192},(_,i)=>((i*79)^(i>>3)^(i>>7))&255);let ciram=Uint8Array.from({length:2048},(_,i)=>i*13&255),owner;
 const nt=a=>((a-8192)&2047),pal=a=>{let i=a&31;if((i&19)===16)i&=15;return 0x3f00+i;};
 const peek=a=>a<8192?chr[a]:a<16128?ciram[nt(a)]:p.vramMem[pal(a)],bus={setPPUAddress(){}};
 const write=(a,v)=>{if(a<8192){chr[a]=v;owner.write(a);}else if(a<16128)ciram[nt(a)]=v;else{p.vramMem[pal(a)]=v&63;owner.write(a);}};
 for(let i=0;i<32;i++)p.vramMem[0x3f00+i]=i;
 for(let i=0;i<64;i++){p.spriteMem[i*4]=i*7&255;p.spriteMem[i*4+1]=i*3;p.spriteMem[i*4+2]=i*37&227;p.spriteMem[i*4+3]=i*11&255;}
 owner=module.installFactoryPPU(nes,bus,peek,write,{mirroring:'vertical',ciram,setCiram:a=>ciram=a});
 p.updateControlReg1(size|136);p.updateControlReg2(visible);p.startFrame();
 return {p,cpu,owner,advance(){owner.clockThree?owner.clockThree():p.advanceDots(3);},capture(){const q=owner.checkpointCapture();return structuredClone({bridge:q.bridge,storage:q.storage});}};
}
test('owned PPU narrow transfers and sprite row cache preserve exact hardware state across register changes',()=>{
 for(const size of [0,32])for(const visibility of [10,20,30]){
  const ms=modules.map(m=>setup(m,size,visibility));
  for(let batch=0;batch<350;batch++){
   for(const m of ms){
    for(let i=0;i<300;i++)m.advance();
    // Public advances and observations must publish the same complete boundary.
    m.p.advanceDots(batch%3);
    if(batch%11===0)m.p.readStatusRegister();
    if(batch%17===0){m.p.scrollWrite(batch&255);m.p.scrollWrite(batch*3&255);}
    if(batch%31===0)m.p.updateControlReg1(size|128|(batch&3));
    if(batch%47===0)m.p.updateControlReg2(batch%94===0?visibility:0);
    if(m.p.scanline<20&&batch%5===0){m.p.readStatusRegister();m.p.writeVRAMAddress(32);m.advance();m.p.writeVRAMAddress(batch&255);m.advance();m.p.vramWrite(batch&255);m.advance();}
   }
   assert.deepEqual(ms[1].capture(),ms[0].capture(),`size=${size} visible=${visibility} batch=${batch}`);
  }
 }
});
test('owned PPU retains partial register errors and pending address/increment state',()=>{
 const ms=modules.map(m=>setup(m,0,0));
 for(const m of ms){m.p.advanceDots(3);m.p.writeVRAMAddress(32);m.p.writeVRAMAddress(7);}
 assert.deepEqual(ms[1].capture(),ms[0].capture());
 for(const m of ms){for(let i=0;i<4;i++)m.advance();m.p.vramWrite(81);assert.throws(()=>m.p.vramWrite(82),e=>e.code==='PPU_ACCESS_ORDER');}
 assert.deepEqual(ms[1].capture(),ms[0].capture());
 for(const m of ms){m.advance();m.p.scrollWrite(19);assert.throws(()=>m.p.updateControlReg1(64),e=>e.code==='UNSUPPORTED_PPU_EXT');}
 assert.deepEqual(ms[1].capture(),ms[0].capture());
});
test('batched sprite shifts publish exact counters at arbitrary native return boundaries',()=>{
 for(const size of [0,32]){
  const ms=modules.map(m=>setup(m,size,30));
  for(let round=0;round<4;round++)for(const dots of [0,1,2,3,7,8,9,17,255,256,257,341,1023,24000]){
   for(const m of ms){
    m.p.advanceDots(dots);
    if(dots===257)m.p.updateControlReg2(round%2?30:0);
   }
   assert.deepEqual(ms[1].capture(),ms[0].capture(),`size=${size} round=${round} dots=${dots}`);
  }
 }
});
