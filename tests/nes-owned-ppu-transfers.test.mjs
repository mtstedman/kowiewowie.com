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
 const write=(a,v)=>{if(a<8192){chr[a]=v;p.vramMem[a]=v;p.patternWrite(a,v);owner.write(a);}else if(a<16128)ciram[nt(a)]=v;else{const address=pal(a);p.vramMem[address]=v&63;if((address&3)===0)p.vramMem[address^16]=v&63;p.updatePalettes();owner.write(a);}};
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

test('owned fixed-three native entry preserves event, line and clock-fence boundaries',()=>{
 const factories=[oldBinary,newBinary];
 for(const line of [0,19,20,21,260,261])for(const x of [0,1,255,337,338,340])for(const dot of [1000,Number.MAX_SAFE_INTEGER-5,Number.MAX_SAFE_INTEGER-3]){
  const pair=factories.map(factory=>{const e=factory([]).createOwnedExports();e.ppu_initialize();const codec=newCodec([transfer([])]).createCodec(e,{fixedMemory:true}),view=new DataView(e.memory.buffer);
   for(const [key,value] of Object.entries({scanline:line,x,dot,bg:1,sp:1})){const d=codec.layout[key];if(d.width===8)view.setFloat64(d.offset,value,true);else view.setUint32(d.offset,value,true);}
   return {e,state:()=>new Uint8Array(e.memory.buffer,e.ppu_state(),e.ppu_state_size()).slice()};});
  const codes=pair.map(m=>m.e.ppu_stage_three());assert.equal(codes[1],codes[0],`line=${line} x=${x} dot=${dot}`);assert.deepEqual(pair[1].state(),pair[0].state());
 }
});
test('owned bridge publishes partial state when a vblank callback throws',()=>{
 const ms=modules.map(m=>setup(m,0,30));
 for(const m of ms)m.p._fireVblankSet=function(){this.cpuBoundaryMarker=17;throw Error('callback sentinel');};
 for(const m of ms)assert.throws(()=>{for(let i=0;i<60000;i++)m.advance();},/callback sentinel/);
 assert.deepEqual(ms[1].capture(),ms[0].capture());
 for(const m of ms)assert.equal(m.p.cpuBoundaryMarker,17);
});
test('private three-dot bridge retains partial progress at clock exhaustion',()=>{
 const ms=modules.map(m=>setup(m,0,0));
 for(const m of ms){const q=m.owner.checkpointCapture();q.bridge.closure.dot=Number.MAX_SAFE_INTEGER-2;m.owner.checkpointRestore(q);assert.throws(()=>m.advance(),e=>e.code==='PPU_CLOCK_LIMIT');}
 assert.deepEqual(ms[1].capture(),ms[0].capture());
});

test('owned CHR and palette uploads preserve pending increments and subsequent rendering',()=>{
 const ms=modules.map(m=>setup(m,0,0));
 for(const address of [0,0x1ff0,0x2000,0x23f0,0x3f00,0x3f10,0x3ff0]){
  for(const m of ms){m.p.updateControlReg2(0);for(let j=0;j<10;j++)m.advance();m.p.readStatusRegister();m.p.writeVRAMAddress(address>>8);m.advance();m.p.writeVRAMAddress(address&255);m.advance();
   for(let i=0;i<96;i++){m.p.vramWrite(i*37&255);m.advance();}
   m.p.updateControlReg2(30);for(let j=0;j<30000;j++)m.advance();
  }
  assert.deepEqual(ms[1].capture(),ms[0].capture(),address.toString(16));
 }
});
test('custom palette and pattern callbacks retain complete observation boundaries',()=>{
 for(const name of ['patternWrite','updatePalettes']){
  const ms=modules.map(m=>setup(m,0,0)),observed=[];
  for(const m of ms){const fn=m.p[name];m.p[name]=function(...args){observed.push([this.scanline,this.curX,this.vramAddress]);return fn.apply(this,args);};m.p.readStatusRegister();m.p.writeVRAMAddress(name==='patternWrite'?0:0x3f);m.advance();m.p.writeVRAMAddress(0);m.advance();m.p.vramWrite(29);m.advance();}
  assert.equal(observed.length,2);assert.deepEqual(observed[1],observed[0]);assert.deepEqual(ms[1].capture(),ms[0].capture());
 }
});
