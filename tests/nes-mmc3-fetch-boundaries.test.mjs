import test from 'node:test';
import assert from 'node:assert/strict';
import {instantiate as baseline} from '../htdocs/games/engines/nes/1.4.7/common/2663c63f493c9ff95b90fb86cea5226ec98c1e4aa58641234702b8a5fc9042e8.mjs';
import {instantiate as candidate} from '../maintenance/engines/mmc3/runtime-factory.mjs';
import {metadata} from '../htdocs/games/adventure-island-2/cartridge/entry.mjs';
const factories=[baseline,candidate];
function setup(factory,hook=null,source=null,info=metadata){
 const r=factory([]),prg=new Uint8Array(info.prgBanks*8192).fill(0xea);
 for(const a of [prg.length-6,prg.length-4,prg.length-2]){prg[a]=0;prg[a+1]=128;}
 const base=r.makeBus(prg,new Uint8Array(),{},info,new Uint8Array(8192));
 const bytes=source??Object.freeze([0xea]);
 const entry=Object.freeze([bytes,c=>{c.s.pc=0x8000;return 2;},0]);
 const blocks=Object.freeze(Array.from({length:4},(_,w)=>Object.freeze(Array.from({length:info.prgBanks},()=>Object.freeze(Object.assign(Object.create(null),w===0?{32768:entry}:{}))))));
 const bus=hook?r.composeBus(base,hook(base)):base,cpu=r.makeCPU(bus,blocks,info);return {base,bus,cpu};
}
function outcome(m,kindOnly=false){try{const result=kindOnly?m.cpu.stepKind():m.cpu.step();return {kind:typeof result==='string'?result:result.kind,state:m.cpu.getState(),mapping:m.base.getMapperState()};}catch(e){return {error:{code:e.code,message:e.message,pc:e.pc},state:m.cpu.getState(),mapping:m.base.getMapperState()};}}
test('owned MMC3 fetch and kind-only execution retain reads, interrupts, clocks and mapper writes',()=>{
 const ms=factories.map(f=>setup(f));
 for(let i=0;i<120;i++){
  for(const m of ms){if(i===20)m.cpu.requestNMI();if(i===50){m.cpu.setState({p:0});m.cpu.setIRQ(true);}if(i===51)m.cpu.setIRQ(false);if(i%11===0){m.base.write(0x8000,6,m.base.getCPUClock());m.base.write(0x8001,i%metadata.prgBanks,m.base.getCPUClock());}}
  assert.deepEqual(outcome(ms[1],true),outcome(ms[0]));
 }
});
test('custom peek hooks and mutable source bytes are checked on every instruction',()=>{
 for(const scenario of ['peek','bytes']){
  const ms=factories.map(f=>{let changed=false;const bytes=[0xea],m=setup(f,scenario==='peek'?b=>({peek:a=>a===0x8000&&changed?0: b.peek(a)}):null,scenario==='bytes'?bytes:null);return {...m,change(){changed=true;bytes[0]=0;}};});
  assert.deepEqual(outcome(ms[1]),outcome(ms[0]));ms.forEach(m=>m.change());const actual=outcome(ms[1]),expected=outcome(ms[0]);assert.deepEqual(actual,expected);assert.equal(actual.error.code,'CODE_CHANGED');
 }
});
test('mapping mutation during a composed read fails before byte interpretation',()=>{
 const ms=factories.map(f=>setup(f,b=>({read:a=>{if(a===0x8000){b.write(0x8000,6,b.getCPUClock());return -1;}return b.read(a);}})));
 const actual=outcome(ms[1]),expected=outcome(ms[0]);assert.deepEqual(actual,expected);assert.equal(actual.error.code,'MAPPING_CHANGED');
});
test('accessor metadata retains the generic mapping path',()=>{
 const info=Object.freeze({...metadata,get prgBanks(){return metadata.prgBanks;}}),ms=factories.map(f=>setup(f,null,null,info));
 for(let i=0;i<20;i++)assert.deepEqual(outcome(ms[1]),outcome(ms[0]));
});
test('reentrant read callbacks retain the CPU execution guard',()=>{
 const ms=factories.map(f=>{let cpu;const m=setup(f,b=>({read:a=>{if(a===0x8000)cpu.setState({a:7});return b.read(a);}}));cpu=m.cpu;return m;});
 const actual=outcome(ms[1]),expected=outcome(ms[0]);assert.deepEqual(actual,expected);assert.equal(actual.error.code,'REENTRANT_CPU');
});
