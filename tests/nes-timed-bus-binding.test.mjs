import test from 'node:test';
import assert from 'node:assert/strict';
import {instantiate as mmc3} from '../maintenance/engines/timed-mmc3/hardware-cpu-factory.mjs';
function fixture(factory,mode='frozen'){
 const mem=new Uint8Array(65536);mem[0xfffd]=128;mem[0x8000]=0xea;let selected='first',malformed=null;const calls=[];
 const loc=a=>({kind:'rom',physical:a&8191,key:'rom:'+(a&8191)});
 const bus={mem,read(a){assert.equal(this,bus);return mem[a];},write(a,v){assert.equal(this,bus);mem[a]=v;},peek(a){return mem[a];},codeLocation:loc,watchCode(){},readCycle(a){assert.equal(this,bus);calls.push('opcode');return {value:mem[a],location:loc(a),elapsed:1};},writeCycle(a,v){assert.equal(this,bus);mem[a]=v;return 1;}};
 const reader=label=>function(a){assert.equal(this,bus);calls.push(label);return {value:malformed==='byte'?256:mem[a],location:null,elapsed:malformed==='clock'?0:1};},first=reader('first'),second=reader('second');
 if(mode==='accessor')Object.defineProperty(bus,'readDataCycle',{enumerable:true,configurable:true,get(){return selected==='first'?first:second;}});else bus.readDataCycle=first;
 if(mode!=='mutable')Object.freeze(bus);
 const entry=Object.freeze([Object.freeze([0xea]),c=>{c.r((c.s.pc+1)&65535);c.s.pc++;c.end(2);}]),blocks=Object.freeze([Object.freeze({0:Object.freeze({32768:entry})}),Object.freeze({}),Object.freeze({}),Object.freeze({})]);
 class Fault extends Error{constructor(code,message){super(message);this.code=code;}}
 const cpu=factory([{instructionSize:op=>op===0xea?1:0,instructionSourceBytes:()=>1,specializeInstruction(){throw Error('Static instruction expected');}},{translationLimits:{cache_entries:16,compilations:16,source_bytes:65536}}]).makeTimedCPU(bus,blocks,Object.freeze({mapper:4,prgBanks:2,prgBankBytes:8192}),Fault);
 return {cpu,calls,switch(){selected='second';if(mode==='mutable')bus.readDataCycle=second;},bad(value){malformed=value;},step(){cpu.setState({pc:32768});return cpu.step();}};
}
for(const [name,factory]of [['MMC3',mmc3]]){
 test(name+' frozen timed hooks preserve receiver, read order, results and clock validation',()=>{
  const m=fixture(factory);m.calls.length=0;const before=m.cpu.getState().cycles;m.step();assert.deepEqual(m.calls,['opcode','first']);assert.equal(m.cpu.getState().cycles-before,2);
  for(const [bad,code]of [['byte','BUS_RESULT'],['clock','CYCLE_LIMIT']]){const x=fixture(factory);x.bad(bad);assert.throws(()=>x.step(),e=>e.code===code);}
 });
 test(name+' mutable and frozen accessor hooks keep live lookup',()=>{for(const mode of ['mutable','accessor']){const m=fixture(factory,mode);m.step();m.switch();m.calls.length=0;m.step();assert.deepEqual(m.calls,['opcode','second']);}});
}
