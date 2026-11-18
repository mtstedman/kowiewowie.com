// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const specializeInstruction=imports[0]["specializeInstruction"];
const instructionSize=imports[0]["instructionSize"];
const instructionSourceBytes=imports[0]["instructionSourceBytes"];
const translationLimits=imports[1]["translationLimits"];



function makeTimedCPU(bus,blocks,info,CPUError,limits=translationLimits){
 if(!limits||Object.keys(limits).length!==3)throw Error('Translation limits required');
 for(const [k,a,b]of [['cache_entries',16,8192],['compilations',16,1000000],['source_bytes',65536,67108864]])if(!Number.isSafeInteger(limits[k])||limits[k]<a||limits[k]>b)throw Error('Invalid translation limit '+k);
 limits=Object.freeze({...limits});
 if(Boolean(bus.readCycle)!==Boolean(bus.writeCycle))throw Error('Paired timed bus hooks required');
 if(bus.readDataCycle!==undefined&&(!bus.readCycle||typeof bus.readDataCycle!=='function'))throw Error('Data-cycle hook requires a paired timed bus');
 const bad=(code,message,pc)=>{throw new CPUError(code,message,pc);};
 for(const k of ['read','write','peek','codeLocation','watchCode'])if(typeof bus[k]!=='function')bad('CODE_BUS_CONTRACT','Missing '+k);
 const s={a:0,x:0,y:0,sp:0,p:36,pc:0,cycles:0,instructions:0};
 let busy=false,irq=false,nmiLine=false,nmiPending=false,nmiSerial=0,pendingIRQ=false,pendingNMI=false,hold=false,core=0,oldP=36,last=0,previous=0,stepStart=0,lastLocation=null;
 const cache=new Map(),pages=new Map();let compilations=0,sourceBytes=0,hits=0,invalidations=0,mutableInstructions=0,staticInstructions=0,evictions=0;
 function checkedLocation(q){if(!q||!['ram','rom','unmapped'].includes(q.kind))bad('CODE_BUS_CONTRACT','Invalid code location');if(q.kind!=='unmapped'&&(!Number.isSafeInteger(q.physical)||q.physical<0||q.physical>16777215||typeof q.key!=='string'||q.key.length>512))bad('CODE_BUS_CONTRACT','Invalid code identity');if(q.kind==='ram'&&(typeof q.page!=='string'||!q.page.length||q.page.length>128))bad('CODE_BUS_CONTRACT','Invalid RAM page');return q;}
 function location(a){return checkedLocation(bus.codeLocation(a&65535));}
 function forget(key){const e=cache.get(key);if(!e)return;cache.delete(key);for(const p of e.pages){const set=pages.get(p);set?.delete(key);if(set?.size===0)pages.delete(p);}}
 bus.watchCode(page=>{if(page===null){invalidations+=cache.size;cache.clear();pages.clear();return;}const set=pages.get(page);if(set)for(const k of [...set]){invalidations++;forget(k);}});
 function signals(){const v=bus.getInterruptLines?.();if(v){if(typeof v.irq!=='boolean'||!Number.isSafeInteger(v.nmiSerial)||v.nmiSerial<nmiSerial)bad('SIGNAL_CONTRACT','Invalid interrupt lines');if(v.nmiSerial!==nmiSerial)nmiPending=true;nmiSerial=v.nmiSerial;}return (irq||Boolean(v?.irq)?1:0)|(nmiPending?2:0);}
 function sample(){previous=last;last=signals();}
 function advance(n){if(!Number.isSafeInteger(n)||n<1||n>8192||s.cycles+n>Number.MAX_SAFE_INTEGER-8192)bad('CYCLE_LIMIT','Invalid bus cycle duration');s.cycles+=n;core++;sample();}
 function r(a,code=false){a&=65535;let v;if(bus.readCycle){const z=(code||!bus.readDataCycle)?bus.readCycle(a):bus.readDataCycle(a);if(!z||!Number.isInteger(z.value)||z.value<0||z.value>255)bad('BUS_RESULT','Invalid timed read');v=z.value;lastLocation=z.location;advance(z.elapsed);}else{lastLocation=location(a);v=bus.read(a);if(!Number.isInteger(v)||v<0||v>255)bad('BUS_RESULT','Invalid read');if(bus.getCPUClock)bus.advanceCPUClock(bus.getCPUClock()+1);advance(1);}return v;}
 function w(a,v){a&=65535;v&=255;if(bus.writeCycle){const n=bus.writeCycle(a,v);advance(n);}else{const t=bus.getCPUClock?.()??s.cycles;bus.write(a,v,t);if(bus.getCPUClock)bus.advanceCPUClock(t+1);advance(1);}}
 const c={s,r,w,norm:p=>(p|32)&239,nz(v){v&=255;s.p=(s.p&125)|(v===0?2:0)|(v&128);return v;},f(mask,on){s.p=on?s.p|mask:s.p&~mask;},push(v){w(256+s.sp,v);s.sp=(s.sp-1)&255;},pop(){s.sp=(s.sp+1)&255;return r(256+s.sp);},poll(useOld=false){pendingIRQ=pendingIRQ||((previous&1)!==0&&!((useOld?oldP:s.p)&4));pendingNMI=pendingNMI||(previous&2)!==0;},hijack(vector){if(nmiPending){nmiPending=false;pendingNMI=false;return 65530;}return vector;},end(n,noPoll=false,useOld=false){if(core!==n)bad('CPU_CYCLE_CONTRACT','Emitted instruction bus cycle count differs');if(!noPoll)c.poll(useOld);s.p=c.norm(s.p);}};
 function start(){core=0;stepStart=s.cycles;oldP=s.p;last=signals();previous=last;}
 function safe(){if(busy)bad('REENTRANT_CPU','Reentry forbidden');}
 function staticEntry(pc,loc){
  const bankBytes=info.prgBankBytes??(info.mapper>=4?8192:16384),bank=Math.floor(loc.physical/bankBytes);
  let entry;
  if(info.mapper===0)entry=blocks[pc];
  else if(info.mapper===1)entry=blocks[(pc<49152?0:info.prgBanks)+bank]?.[pc];
  else if(info.mapper===2)entry=blocks[pc<49152?bank:info.prgBanks]?.[pc];
  else entry=blocks[(pc-32768)>>>13]?.[bank]?.[pc];
  if(entry?.cross){const boundary=(pc+bankBytes)&~(bankBytes-1),other=location(boundary&65535);if(other.kind!=='rom')return null;entry=entry.cross[Math.floor(other.physical/bankBytes)];}
  return entry;
 }
 function translated(pc,op,loc){
  const len=instructionSize(op);if(!len)bad('UNSUPPORTED_OPCODE','Unofficial opcode '+op,pc);
  if(loc.kind==='rom'&&pc+len<=65536){const e=staticEntry(pc,loc);if(!e)bad('MISSING_TRANSLATION','Immutable source candidate missing',pc);if(!Array.isArray(e[0])||e[0][0]!==op||typeof e[1]!=='function')bad('CODE_CHANGED','Immutable translation differs',pc);staticInstructions++;return e[1];}
  if(loc.kind!=='ram'&&!(loc.kind==='rom'&&pc+len>65536))bad('MUTABLE_CODE_UNSUPPORTED','Instruction opcode is not mapped RAM/ROM',pc);
  const raw=[op],refs=[loc];for(let i=1;i<len;i++){const a=(pc+i)&65535,q=location(a);refs.push(q);const byte=q.kind==='unmapped'?0:bus.peek(a);if(!Number.isInteger(byte)||byte<0||byte>255)bad('BUS_RESULT','Invalid code peek',a);raw.push(byte);}
  // Keys include logical PC, exact observed bytes and every physical code page.
  // Operand fetches use live bus values; JSR can alter its own high operand.
  const key=pc+':'+refs.map(q=>q.key??'io').join('|')+':'+raw.join(',');
  const found=cache.get(key);if(found){cache.delete(key);cache.set(key,found);hits++;return found.fn;}
  if(compilations>=limits.compilations)bad('TRANSLATION_LIMIT','Compilation count exhausted',pc);
     const weight=instructionSourceBytes(op);if(sourceBytes+weight>limits.source_bytes)bad('TRANSLATION_LIMIT','Cumulative specialization source weight exhausted',pc);
   const fn=specializeInstruction(pc,raw);compilations++;sourceBytes+=weight;
while(cache.size>=limits.cache_entries){forget(cache.keys().next().value);evictions++;}
  const ownedPages=[...new Set(refs.filter(q=>q.kind==='ram').map(q=>q.page))];cache.set(key,{fn,pages:ownedPages,pc,raw});for(const p of ownedPages){if(!pages.has(p))pages.set(p,new Set());pages.get(p).add(key);}return fn;
 }
 function interrupt(vector){r(s.pc);r(s.pc);c.push(s.pc>>>8);c.push(s.pc&255);vector=c.hijack(vector);c.push(c.norm(s.p));s.p|=4;const lo=r(vector),hi=r(vector+1);s.pc=lo|(hi<<8);c.end(7,true);hold=true;}
 function step(){safe();busy=true;try{start();const pc=s.pc;if(!hold&&(pendingNMI||pendingIRQ)){const nmi=pendingNMI;pendingNMI=false;pendingIRQ=false;if(nmi)nmiPending=false;interrupt(nmi?65530:65534);return {kind:nmi?'nmi':'irq',pc,cycles:s.cycles-stepStart};}hold=false;pendingIRQ=false;pendingNMI=false;const pre=location(pc);if(pre.kind==='unmapped')bad('MUTABLE_CODE_UNSUPPORTED','Opcode lies on I/O or disabled/uninstalled RAM',pc);const op=r(pc,true),loc=checkedLocation(lastLocation??pre);if(loc.kind==='ram')mutableInstructions++;const fn=translated(pc,op,loc);fn(c);s.instructions++;return {kind:'instruction',pc,cycles:s.cycles-stepStart};}finally{busy=false;}}
 function reset(){safe();busy=true;try{start();r(s.pc);r(s.pc);for(let i=0;i<3;i++){r(256+s.sp);s.sp=(s.sp-1)&255;}s.p=c.norm(s.p|4);const lo=r(65532),hi=r(65533);s.pc=lo|(hi<<8);pendingIRQ=false;pendingNMI=false;nmiPending=false;hold=false;c.end(7,true);return {...s};}finally{busy=false;}}
 function setState(v){safe();if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(s,k)))bad('BAD_STATE','Invalid CPU state fields');for(const [k,x]of Object.entries(v))if(!Number.isSafeInteger(x)||x<0||x>(k==='pc'?65535:['cycles','instructions'].includes(k)?Number.MAX_SAFE_INTEGER-8192:255))bad('BAD_STATE','Invalid CPU state value');Object.assign(s,v);s.p=c.norm(s.p);if('p'in v){pendingIRQ=irq&&!(s.p&4);}}
 function run(o={}){safe();if(!o||typeof o!=='object'||Object.keys(o).some(k=>!['maxSteps','maxCycles','maxMs'].includes(k)))bad('BAD_ARGUMENT','Invalid run options');const maxSteps=o.maxSteps??1000,maxCycles=o.maxCycles??100000,maxMs=o.maxMs??1000;for(const [v,max]of [[maxSteps,1000000],[maxCycles,10000000],[maxMs,5000]])if(!Number.isInteger(v)||v<1||v>max)bad('BAD_ARGUMENT','Run bound');const initial=s.cycles,t=performance.now();let steps=0,reason='steps';while(steps<maxSteps){if(s.cycles-initial>=maxCycles){reason='cycles';break;}if(performance.now()-t>=maxMs){reason='time';break;}step();steps++;}return {steps,cycles:s.cycles-initial,reason,state:{...s}};}
 const api=Object.freeze({checkpointCapture(){safe();return {s,irq,nmiLine,nmiPending,nmiSerial,pendingIRQ,pendingNMI,hold,core,oldP,last,previous,stepStart,lastLocation,compilations,sourceBytes,hits,invalidations,mutableInstructions,staticInstructions,evictions,entries:[...cache].map(([key,e])=>({key,pc:e.pc,raw:e.raw,pages:e.pages}))};},
 checkpointRestore(v){safe();setState(v.s);cache.clear();pages.clear();if(!Array.isArray(v.entries)||v.entries.length>limits.cache_entries)bad('BAD_CHECKPOINT','Code cache limit');for(const e of v.entries){
 if(!e||!Number.isInteger(e.pc)||e.pc<0||e.pc>65535||!Array.isArray(e.raw)||e.raw.length<1||e.raw.length>3||e.raw.some(n=>!Number.isInteger(n)||n<0||n>255)||instructionSize(e.raw[0])!==e.raw.length||typeof e.key!=='string'||e.key.length>2048||!e.key.startsWith(e.pc+':')||!e.key.endsWith(':'+e.raw.join(','))||!Array.isArray(e.pages)||e.pages.length>3||e.pages.some(p=>typeof p!=='string'||!(/^(ram:[0-7]|sram:([0-9]|[12][0-9]|3[01]))$/).test(p)))bad('BAD_CHECKPOINT','Code cache entry');
 if(cache.has(e.key))bad('BAD_CHECKPOINT','Duplicate code cache entry');const fn=specializeInstruction(e.pc,e.raw);cache.set(e.key,{fn,pc:e.pc,raw:e.raw,pages:e.pages});for(const p of e.pages){if(!pages.has(p))pages.set(p,new Set());pages.get(p).add(e.key);}}
 ({irq,nmiLine,nmiPending,nmiSerial,pendingIRQ,pendingNMI,hold,core,oldP,last,previous,stepStart,lastLocation,compilations,sourceBytes,hits,invalidations,mutableInstructions,staticInstructions,evictions}=v);},bus,step,reset,run,setState,getState:()=>({...s}),getPC:()=>s.pc,setIRQ(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean IRQ');irq=v;if(v&&!hold&&!(s.p&4))pendingIRQ=true;},setNMI(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean NMI');if(v&&!nmiLine){nmiPending=true;pendingNMI=true;}nmiLine=v;},requestNMI(){safe();nmiPending=true;pendingNMI=true;},getSignals:()=>({irq,nmiLine,nmiPending,irqMask:Boolean(s.p&4),hold}),getTranslationStats:()=>({compilations,sourceBytes,hits,invalidations,cacheEntries:cache.size,mutableInstructions,staticInstructions,evictions,sourceSpecialized:true})});reset();return api;
}
return Object.freeze(Object.defineProperties(Object.create(null),{"makeTimedCPU":{enumerable:true,get:()=>makeTimedCPU}}));
}
