import test from 'node:test';import assert from 'node:assert/strict';
import {instantiate} from '../maintenance/engines/timed-mmc3/hardware-cpu-factory.mjs';
const freeze=Object.freeze,limits={cache_entries:16,compilations:16,source_bytes:65536};
function fixture({mutable=false,accessor=false,cross=false,elapsed}={}){
 let bank=0,which=0,reads=0;const mem=new Uint8Array(65536);mem[0xfffc]=0;mem[0xfffd]=128;mem[0x8000]=0xea;
 const entry=value=>freeze([freeze([0xea]),c=>{c.r((c.s.pc+1)&65535);c.s.a=value;c.s.pc=(c.s.pc+1)&65535;c.end(2);}]);
 const entries=[entry(11),entry(22)];const table=mutable?{32768:entries[0]}:accessor?freeze(Object.defineProperty({},32768,{get:()=>entries[which]})):freeze({32768:cross?freeze({cross:freeze({0:entries[0],1:entries[1]})}):entries[0]});
 const blocks=freeze([freeze({0:table,1:freeze({32768:entries[1]})}),freeze({}),freeze({}),freeze({})]);
 const bus={read(a){reads++;return mem[a];},write(a,v){mem[a]=v;},peek:a=>mem[a],codeLocation(a){const physical=(cross&&a!==0xa000?0:bank)*8192+(a&8191);return {kind:'rom',physical,key:'rom:'+physical};},watchCode(){}};
 if(elapsed!==undefined){bus.readCycle=a=>({value:bus.read(a),location:bus.codeLocation(a),elapsed});bus.writeCycle=(a,v)=>{bus.write(a,v);return elapsed;};}
 class Fault extends Error{constructor(code,message){super(message);this.code=code;}}
 const cpu=instantiate([{instructionSize:op=>op===0xea?1:op===0xa9?2:0,instructionSourceBytes:()=>1,specializeInstruction:()=>{throw Error('ROM must use static translation');}},{translationLimits:limits}]).makeTimedCPU(bus,blocks,freeze({mapper:4,prgBanks:2,prgBankBytes:8192}),Fault);
 const step=()=>{cpu.setState({pc:0x8000});cpu.step();return cpu.getState().a;};return {cpu,mem,table,entries,step,bank:v=>bank=v,which:v=>which=v,reads:()=>reads};
}
test('immutable dispatch retains live opcode reads, bank identity and checkpoint mapping changes',()=>{const m=fixture();assert.equal(m.step(),11);const before=m.reads(),saved=structuredClone(m.cpu.checkpointCapture());assert.equal(m.step(),11);assert.equal(m.reads()-before,2);m.bank(1);assert.equal(m.step(),22);m.cpu.checkpointRestore(saved);assert.equal(m.step(),22);m.bank(0);assert.equal(m.step(),11);m.mem[0x8000]=0xa9;assert.throws(()=>m.step(),e=>e.code==='CODE_CHANGED');m.mem[0x8000]=2;assert.throws(()=>m.step(),e=>e.code==='UNSUPPORTED_OPCODE');});
test('mutable and accessor-backed translation tables retain checked lookup',()=>{for(const mode of ['mutable','accessor']){const m=fixture({[mode]:true});assert.equal(m.step(),11);if(mode==='mutable')m.table[32768]=m.entries[1];else m.which(1);assert.equal(m.step(),22);}});
test('cross-bank translation entries retain the live second-bank lookup',()=>{const m=fixture({cross:true});assert.equal(m.step(),11);m.bank(1);assert.equal(m.step(),22);});

test('timed dispatch preserves single-cycle and stretched-cycle accounting and overflow guards',()=>{
 for(const elapsed of [1,2,8192]){const m=fixture({elapsed}),before=m.cpu.getState().cycles;m.step();assert.equal(m.cpu.getState().cycles-before,2*elapsed);m.cpu.setState({cycles:Number.MAX_SAFE_INTEGER-8192});assert.throws(()=>m.step(),e=>e.code==='CYCLE_LIMIT');}
 for(const elapsed of [0,-1,1.5,NaN,Infinity,8193])assert.throws(()=>fixture({elapsed}),e=>e.code==='CYCLE_LIMIT');
});
