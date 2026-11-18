// Posse reusable MMC2 shared-engine runtime factory.
export function instantiate(imports){
"use strict";

class CPUError extends Error {
 constructor(code,message,pc){super(message);this.name='CPUError';this.code=code;if(pc!==undefined)this.pc=pc;}
}
const bad=(code,message,pc)=>{throw new CPUError(code,message,pc);};
const integer=(v,max,label)=>{if(!Number.isSafeInteger(v)||v<0||v>max)bad('BAD_ARGUMENT',label);return v;};
const byte=v=>integer(v,255,'Expected byte'),address=v=>integer(v,65535,'Expected CPU address');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fromHex(h){if(typeof h!=='string'||h.length%2||!/^[0-9a-f]*$/.test(h))bad('BAD_ROM_DATA','Invalid hex');const b=new Uint8Array(h.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(h.slice(i*2,i*2+2),16);return b;}

const ownedBuses=new WeakMap(),machineSteps=new WeakMap();
function composeBus(base,hooks){
 const record=ownedBuses.get(base);
 if(!record||!hooks||typeof hooks!=='object'||Array.isArray(hooks)||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock','dmaClock'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
 const bus=Object.freeze({...base,...hooks});ownedBuses.set(bus,record);return bus;
}

const S9=['prgBank','chrFd0','chrFe0','chrFd1','chrFe1','latch0','latch1','pendingLatch0','pendingLatch1','mirror','ppuAddress','ppuDot','clock','lastWriteCycle'];
const K9=['mapper','identity','version',...S9];
const latch=v=>v===253||v===254;
const pending=v=>v===null||latch(v);
function valid9(v,info){
 if(!exact(v,K9)||v.mapper!==9||v.identity!==info.mappingIdentity||v.version!==1)bad('BAD_MAPPING','MMC2 snapshot identity/fields');
 integer(v.prgBank,15,'MMC2 PRG bank');
 for(const k of ['chrFd0','chrFe0','chrFd1','chrFe1'])integer(v[k],31,'MMC2 CHR bank');
 if(!latch(v.latch0)||!latch(v.latch1)||!pending(v.pendingLatch0)||!pending(v.pendingLatch1))bad('BAD_MAPPING','MMC2 latch');
 integer(v.mirror,1,'MMC2 mirroring');integer(v.ppuAddress,16383,'PPU address');
 for(const k of ['ppuDot','clock'])integer(v[k],Number.MAX_SAFE_INTEGER-8192,'MMC2 counter');
 if(!Number.isSafeInteger(v.lastWriteCycle)||v.lastWriteCycle< -1||v.lastWriteCycle>=v.clock)bad('BAD_MAPPING','MMC2 write clock');
 return {...v};
}
function powerOfTwo(v){return Number.isSafeInteger(v)&&v>0&&(v&(v-1))===0;}
function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:9},chr=new Uint8Array()){
 const cfg=info?.mmc2,n=prg?.length/8192;
 if(info?.mapper!==9||!(prg instanceof Uint8Array)||!powerOfTwo(n)||n<4||n>16||typeof info.mappingIdentity!=='string'||!info.mappingIdentity||!cfg||(Object.hasOwn(info,'prgBanks')&&info.prgBanks!==n))bad('BAD_ROM_DATA','MMC2 geometry/identity');
 if(!(trainer instanceof Uint8Array)||![0,512].includes(trainer.length)||!(chr instanceof Uint8Array))bad('BAD_ROM_DATA','MMC2 CHR/trainer');
 const chrRomBanks=chr.length/4096;
 if(chr.length!==0&&(!powerOfTwo(chrRomBanks)||chrRomBanks>32))bad('BAD_ROM_DATA','MMC2 CHR geometry');
 if(cfg.board!=='PNROM'||!Number.isSafeInteger(cfg.prgRamBytes)||cfg.prgRamBytes<0||!cfg.startup||typeof cfg.startup!=='object')bad('BAD_ROM_DATA','Unsupported MMC2 policy');
 const start=cfg.startup;
 integer(start.prgBank,15,'MMC2 startup PRG bank');
 for(const k of ['chrFd0','chrFe0','chrFd1','chrFe1'])integer(start[k],31,'MMC2 startup CHR bank');
 if(!latch(start.latch0)||!latch(start.latch1)||!['vertical','horizontal'].includes(start.mirroring))bad('BAD_ROM_DATA','MMC2 startup policy');
 if(!io||typeof io!=='object'||Array.isArray(io)||Object.keys(io).some(k=>!['read','write','peek'].includes(k))||Object.values(io).some(v=>typeof v!=='function'))bad('BAD_BUS','I/O callbacks');
 const rom=prg.slice(),ram=new Uint8Array(2048),sram=new Uint8Array(cfg.prgRamBytes),chrRAM=chr.length===0;
 let chrData=chrRAM?new Uint8Array(8192):chr.slice();
 if(trainer.length){if(sram.length<4608)bad('BAD_ROM_DATA','Trainer requires sufficient RAM');sram.set(trainer,4096);}
 let epoch=0,state={prgBank:start.prgBank,chrFd0:start.chrFd0,chrFe0:start.chrFe0,chrFd1:start.chrFd1,chrFe1:start.chrFe1,latch0:start.latch0,latch1:start.latch1,pendingLatch0:null,pendingLatch1:null,mirror:start.mirroring==='horizontal'?1:0,ppuAddress:0,ppuDot:0,clock:0,lastWriteCycle:-1};
 let mapperStageValid=false,pullMapperStage=()=>{};
 const bump=()=>{if(epoch>=Number.MAX_SAFE_INTEGER-8192)bad('MAPPING_OVERFLOW','Epoch exhausted');epoch++;};
 function prgBank(a){const w=(a-32768)>>>13;return w===0?(state.prgBank&(n-1)):n-4+w;}
 function physicalPRG(a){return prgBank(a)*8192+(a&8191);}
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address');return physicalPRG(a);}
 function selectedCHR(a){return a<4096?(state.latch0===253?state.chrFd0:state.chrFe0):(state.latch1===253?state.chrFd1:state.chrFe1);}
 function mapCHR(a){integer(a,8191,'CHR address');const banks=chrData.length/4096;return (selectedCHR(a)&(banks-1))*4096+(a&4095);}
 function mirroring(){return state.mirror?'horizontal':'vertical';}
 function mapNametable(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address');const off=(a-8192)&4095,page=off>>>10;return (mirroring()==='vertical'?page&1:page>>>1)*1024+(off&1023);}
 function getMapperState(){pullMapperStage();return {mapper:9,identity:info.mappingIdentity,version:1,...state};}
 function loadMapperState(v){const q=valid9(v,info),next={};for(const k of S9)next[k]=q[k];bump();state=next;}
 function getCPUClock(){return state.clock;}
 function advanceCPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'CPU clock');if(t<state.clock)bad('BAD_TIMING','CPU clock backwards');state.clock=t;}
 function external(a,peek){const fn=peek?io.peek:io.read;if(!fn)bad('HARDWARE_UNIMPLEMENTED','Missing open-bus/device handler');return byte(fn(a));}
 function read(a,peek=false){address(a);if(a<8192)return ram[a&2047];if(a>=32768)return rom[physicalPRG(a)];if(a>=24576&&sram.length)return sram[(a-24576)%sram.length];return external(a,peek);}
 function write(a,v,t){
  address(a);byte(v);integer(t,Number.MAX_SAFE_INTEGER-8192,'Absolute CPU write cycle');if(t<state.clock)bad('BAD_TIMING','CPU write precedes clock');
  bump();state.clock=t+1;state.lastWriteCycle=t;
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=32768){switch(a>>>12){case 10:state.prgBank=v&15;break;case 11:state.chrFd0=v&31;break;case 12:state.chrFe0=v&31;break;case 13:state.chrFd1=v&31;break;case 14:state.chrFe1=v&31;break;case 15:state.mirror=v&1;break;}return;}
  if(a>=24576&&sram.length){sram[(a-24576)%sram.length]=v;return;}
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','Missing device write');io.write(a,v,t);
 }
 function advancePPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'PPU clock');if(t<state.ppuDot)bad('BAD_TIMING','PPU clock backwards');if(t===state.ppuDot)return;state.ppuDot=t;bump();}
 function trigger(a){if(a===4056)return [0,253];if(a===4072)return [0,254];if(a>=8152&&a<=8159)return [1,253];if(a>=8168&&a<=8175)return [1,254];return null;}
 function setPPUAddress(a,t=state.ppuDot){
  integer(a,16383,'PPU address');advancePPUClock(t);bump();
  if(state.pendingLatch0!==null){state.latch0=state.pendingLatch0;state.pendingLatch0=null;}
  if(state.pendingLatch1!==null){state.latch1=state.pendingLatch1;state.pendingLatch1=null;}
  const q=trigger(a);if(q){if(q[0]===0)state.pendingLatch0=q[1];else state.pendingLatch1=q[1];}
  state.ppuAddress=a;
 }
 function normalizeRAM(x,legacy){
  if(x instanceof Uint8Array)return {ram:x,sram:legacy};
  if(!x||typeof x!=='object'||Array.isArray(x))bad('BAD_ARGUMENT','Exact RAM arrays');
  if(exact(x,['ram','sram']))return x;
  if(exact(x,['ram','prgRam']))return {ram:x.ram,sram:x.prgRam};
  bad('BAD_ARGUMENT','Exact RAM arrays');
 }
 const api={checkpointCapture:()=>({ram,sram,chrRam:chrRAM?chrData:new Uint8Array(),mapper:getMapperState()}),checkpointRestore(v){api.loadRAM({ram:v.ram,sram:v.sram});api.loadCHR(v.chrRam);api.loadMapperState(v.mapper);},read:a=>read(a),peek:a=>read(a,true),write,mapPRG,mapCHR,mapNametable,getMirroring:mirroring,getMapperState,loadMapperState,getCPUClock,advanceCPUClock,setPPUAddress,advancePPUClock,getPPUClock:()=>{pullMapperStage();return state.ppuDot;},getIRQ:()=>false,peekCHR:a=>chrData[mapCHR(a)],ppuRead(a,t=state.ppuDot){integer(a,8191,'CHR address');setPPUAddress(a,t);return chrData[mapCHR(a)];},ppuWrite(a,v,t=state.ppuDot){integer(a,8191,'CHR address');byte(v);setPPUAddress(a,t);if(chrRAM)chrData[mapCHR(a)]=v;},snapshot(){return {ram:ram.slice(),prgRam:sram.slice(),chrRam:chrRAM?chrData.slice():new Uint8Array(),mapper:getMapperState()};},loadRAM(x,...legacy){const q=normalizeRAM(x,legacy[0]);if(!(q.ram instanceof Uint8Array)||q.ram.length!==2048||!(q.sram instanceof Uint8Array)||q.sram.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM arrays');bump();ram.set(q.ram);sram.set(q.sram);},loadCHR(x){if(!(x instanceof Uint8Array)||x.length!==(chrRAM?8192:0))bad('BAD_ARGUMENT','Exact CHR RAM');bump();if(chrRAM)chrData.set(x);}};
 if(Object.isFrozen(info)&&Object.isFrozen(cfg)&&Object.isFrozen(start))ownedBuses.set(api,{info,bankCount:n,peek:api.peek,peekPRG:a=>rom[physicalPRG(a)],bindPPU(e){
   if(!e||!e.memory||typeof e.owned_chr!=='function'||typeof e.owned_registers!=='function'||typeof e.owned_mapper!=='function'||typeof e.owned_mapper_clocks!=='function'||typeof e.shared_clocks!=='function'||typeof e.shared_state!=='function')throw Error('Owned MMC2 ABI unavailable');
   const chrStorage=new Uint8Array(e.memory.buffer,e.owned_chr(),262144);chrStorage.set(chrData);chrData=chrStorage.subarray(0,chrData.length);
   const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),m=new Uint32Array(e.memory.buffer,e.owned_mapper(),64),od=new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4),clocks=new Float64Array(e.memory.buffer,e.shared_clocks(),2),shared=new Uint32Array(e.memory.buffer,e.shared_state(),16);
   let mappingRefreshes=0,synchronizations=0,skippedSource=0,skippedAudio=0,cached='';
   const physical=bank=>(bank&(chrData.length/4096-1))*4096;
   function refreshMapping(){
    const key=[state.chrFd0,state.chrFe0,state.chrFd1,state.chrFe1,state.latch0,state.latch1,state.mirror].join(':');if(key===cached)return;
    const fd0=physical(state.chrFd0),fe0=physical(state.chrFe0),fd1=physical(state.chrFd1),fe1=physical(state.chrFe1);m[10]=fd0;m[11]=fe0;m[12]=fd1;m[13]=fe1;
    const low=state.latch0===253?fd0:fe0,high=state.latch1===253?fd1:fe1;for(let i=0;i<4;i++){m[i]=low+i*1024;m[i+4]=high+i*1024;}
    q[10]=state.mirror?3:2;cached=key;mappingRefreshes++;
   }
   function before(){if(mapperStageValid)return true;synchronizations++;if(state.ppuDot>Number.MAX_SAFE_INTEGER-8208)return false;od[0]=state.ppuDot;od[1]=0;m[8]=9;m[9]=chrData.length-1;m[14]=state.pendingLatch0??0;m[15]=state.pendingLatch1??0;refreshMapping();mapperStageValid=true;return true;}
   function select(start,fd,fe,current,pendingBefore,pendingAfter){for(let i=1;i<4;i++)if(m[start+i]!==m[start]+i*1024)throw Error('Owned MMC2 CHR-window invariant');const fdMatch=m[start]===fd,feMatch=m[start]===fe;if(!fdMatch&&!feMatch)throw Error('Owned MMC2 latch invariant');if(fdMatch!==feMatch)return fdMatch?253:254;if(pendingBefore!==null&&pendingAfter===null)return pendingBefore;return current;}
   pullMapperStage=()=>{if(!mapperStageValid)return;const dot=clocks[0],address=shared[13]&16383,p0=m[14]===0?null:m[14],p1=m[15]===0?null:m[15];if(!Number.isSafeInteger(dot)||dot<state.ppuDot||dot>Number.MAX_SAFE_INTEGER-8192||!pending(p0)||!pending(p1)||m[8]!==9||m[9]!==chrData.length-1)throw Error('Owned MMC2 epoch invariant');const old0=state.pendingLatch0,old1=state.pendingLatch1,l0=select(0,m[10],m[11],state.latch0,old0,p0),l1=select(4,m[12],m[13],state.latch1,old1,p1),changed=dot!==state.ppuDot||address!==state.ppuAddress||l0!==state.latch0||l1!==state.latch1||p0!==old0||p1!==old1;state.ppuDot=dot;state.ppuAddress=address;state.latch0=l0;state.latch1=l1;state.pendingLatch0=p0;state.pendingLatch1=p1;if(changed)bump();};
   function after(){pullMapperStage();mapperStageValid=true;}
   return Object.freeze({before,after,skipPreparation(reason){if(reason===1)skippedSource++;else if(reason===2)skippedAudio++;else throw Error('Private boundary reason');},mappingRefreshes:()=>mappingRefreshes,stats:()=>({skippedPreparations:skippedSource+skippedAudio,skippedSourcePreparations:skippedSource,skippedAudioPreparations:skippedAudio,localMapperReads:e.owned_reads?.()??0,yieldSourceBoundary:(e.owned_yields?.(1)??0)+skippedSource,yieldMapperAudioEdge:(e.owned_yields?.(2)??0)+skippedAudio,localMapper:9,sourceSpriteFetch:true,sourceMapperAudio:false,synchronizations,mappingRefreshMeaning:'MMC2 CHR-window/mirroring cache refreshes'})});
  },snapshot:()=>({prgBank:state.prgBank,clock:state.clock}),unchanged:m=>state.prgBank===m.prgBank&&state.clock===m.clock});
 const ownedWrite=api.write;api.write=(a,v,t)=>{if(a>=32768){pullMapperStage();mapperStageValid=false;}return ownedWrite(a,v,t);};
 for(const key of ['ppuRead','ppuWrite','setPPUAddress','advancePPUClock','loadCHR','loadMapperState']){const fn=api[key];api[key]=function(...args){pullMapperStage();mapperStageValid=false;return fn.apply(this,args);};}
 return Object.freeze(api);
}

function bankCountFor(info,owned,blocks){if(owned)return owned.bankCount;const declared=info?.prgBanks;if(Number.isSafeInteger(declared)&&declared>=4)return declared;const translated=blocks?.[0]?.length;return Number.isSafeInteger(translated)&&translated>=4?translated:null;}
function windowBank9(m,w,n){if(w===0)return n===null?m.prgBank:m.prgBank&(n-1);if(w>=1&&w<=3&&n!==null)return n-4+w;return undefined;}
function makeCPU(bus,blocks,info){
 if(!bus||['read','write','peek'].some(k=>typeof bus[k]!=='function'))bad('BAD_BUS','Bus requires read, write, peek');
 if(['mapPRG','getMapperState','getCPUClock','advanceCPUClock'].some(k=>typeof bus[k]!=='function'))bad('BAD_MAPPING_HOOK','Missing mapper/timing hooks');
 const owned=ownedBuses.get(bus),trusted=owned?.info===info?owned:null,n=bankCountFor(info,trusted,blocks);
 const fixedMapping=trusted&&['mapper','mappingIdentity'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(info,k)||{},'value'));
 const purePeek=fixedMapping&&bus.peek===trusted.peek?trusted.peekPRG:null;
 function mapping(){if(trusted)return trusted.snapshot();const v=valid9(bus.getMapperState(),info);if(bus.getCPUClock()!==v.clock)bad('BAD_MAPPING','Clock hook mismatch');return v;}
 let comparisonSnapshot=null,comparisonKeys=null;
 function unchanged(m){if(trusted){if(!trusted.unchanged(m))bad('MAPPING_CHANGED','Mapping changed during fetch');return;}const v=mapping();if(m!==comparisonSnapshot){comparisonKeys=Object.keys(m);comparisonSnapshot=m;}for(let i=0;i<comparisonKeys.length;i++){const k=comparisonKeys[i];if(v[k]!==m[k])bad('MAPPING_CHANGED','Mapping changed during fetch');}}
 function mapped(a,m){
  if(fixedMapping){unchanged(m);address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address required');return;}
  unchanged(m);const actual=bus.mapPRG(a);unchanged(m);
  if(!Number.isSafeInteger(actual)||actual<0)bad('BAD_MAPPING','Incorrect physical mapping',a);
  if(n!==null){const expected=windowBank9(m,(a-32768)>>>13,n)*8192+(a&8191);if(actual!==expected)bad('BAD_MAPPING','Incorrect physical mapping',a);}
 }
 function fetchByte(a,m,peek=false){if(fixedMapping){unchanged(m);address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address required');const value=peek?(purePeek?purePeek(a):bus.peek(a)):bus.read(a);unchanged(m);return byte(value);}mapped(a,m);const value=peek?bus.peek(a):bus.read(a);unchanged(m);mapped(a,m);return byte(value);}
 mapping();
 const s={a:0,x:0,y:0,sp:0,p:36,pc:0,cycles:0,instructions:0};let irq=false,nmiLine=false,nmiPending=false,irqMask=4,hold=false,busy=false,startCycle=0,coreStart=0;
 const timed=typeof bus.dmaClock==='function';
 function begin(){if(timed){const q=bus.dmaClock();startCycle=integer(q.cycle,Number.MAX_SAFE_INTEGER-16384,'DMA clock');coreStart=integer(q.accesses,Number.MAX_SAFE_INTEGER-16384,'DMA accesses');if(s.cycles!==startCycle)bad('BAD_TIMING','CPU and DMA clocks differ at entry');}else startCycle=integer(bus.getCPUClock(),Number.MAX_SAFE_INTEGER-32,'CPU clock');}
 const c={s,r:a=>byte(bus.read(a&65535)),w:(a,v,offset)=>{integer(offset,6,'Write offset');if(timed){const q=bus.dmaClock();if(q.accesses-coreStart!==offset)bad('BAD_TIMING','Static write offset differs from bus trace');bus.write(a&65535,byte(v),q.cycle);}else bus.write(a&65535,byte(v),startCycle+offset);},norm:p=>(p|32)&239,f(mask,on){s.p=on?s.p|mask:s.p&~mask;},nz(v){v&=255;s.p=(s.p&125)|(v===0?2:0)|(v&128);return v;},push(v,offset){c.w(256+s.sp,v,offset);s.sp=(s.sp-1)&255;},pop(){s.sp=(s.sp+1)&255;return c.r(256+s.sp);},word(a){return c.r(a)|(c.r((a+1)&65535)<<8);},vector,q(a,v){if(fetchByte(a,mapping())!==v)bad('CODE_CHANGED','Late source operand fetch differs',a);}};
 const snapshot=()=>({...s});
 function safe(){if(busy)bad('REENTRANT_CPU','Callbacks may not reenter CPU setters/execution');}
 function setState(patch){safe();if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!Object.hasOwn(s,k)))bad('BAD_STATE','Unknown CPU state property');for(const [k,v] of Object.entries(patch))integer(v,k==='pc'?65535:['cycles','instructions'].includes(k)?Number.MAX_SAFE_INTEGER-8:255,'Invalid CPU state');Object.assign(s,patch);s.p=c.norm(s.p);if('p' in patch)irqMask=s.p&4;}
 function addCycles(n){if(timed){const q=bus.dmaClock(),elapsed=q.cycle-startCycle;if(q.accesses-coreStart!==n||elapsed<n||elapsed>n+8192)bad('BAD_TIMING','Static cycle trace or DMA bound differs');bus.advanceCPUClock(q.cycle);s.cycles=q.cycle;}else{if(s.cycles>Number.MAX_SAFE_INTEGER-8)bad('CYCLE_OVERFLOW','Counter exhausted');bus.advanceCPUClock(startCycle+n);s.cycles+=n;}}
 function vector(a){const m=mapping(),lo=fetchByte(a,m),hi=fetchByte(a+1,m);unchanged(m);return lo|(hi<<8);}
 function reset(){safe();busy=true;try{begin();if(timed){c.r(s.pc);c.r(s.pc);for(let i=0;i<3;i++){c.r(256+s.sp);s.sp=(s.sp-1)&255;}}else s.sp=(s.sp-3)&255;s.p=c.norm(s.p|4);s.pc=vector(65532);addCycles(7);irqMask=4;nmiPending=false;hold=false;return snapshot();}finally{busy=false;}}
 function interrupt(a){c.r(s.pc);c.r(s.pc);c.push(s.pc>>>8,2);c.push(s.pc&255,3);c.push(c.norm(s.p),4);s.p|=4;s.pc=vector(a);irqMask=4;hold=true;addCycles(7);}
 function receipt(out,kind,pc,cycles){if(!out)return {kind,pc,cycles};out.kind=kind;out.pc=pc;out.cycles=cycles;return out;}
 function step(out){safe();busy=true;try{
  if(s.cycles>Number.MAX_SAFE_INTEGER-8||s.instructions>Number.MAX_SAFE_INTEGER-2)bad('COUNTER_OVERFLOW','Counter exhausted');begin();const pc=s.pc;
  if(!hold&&(nmiPending||(irq&&!irqMask))){const nmi=nmiPending;if(nmi)nmiPending=false;interrupt(nmi?65530:65534);return receipt(out,nmi?'nmi':'irq',pc,timed?s.cycles-startCycle:7);}
  if(pc<32768)bad('MUTABLE_CODE_UNSUPPORTED','Execution outside immutable PRG',pc);
  const m=mapping();mapped(pc,m);const window=(pc-32768)>>>13,bank=windowBank9(m,window,n);if(bank===undefined)bad('BAD_MAPPING','Missing PRG bank count',pc);let entry=blocks[window][bank][pc];if(entry&&entry.cross)entry=entry.cross[windowBank9(m,window+1,n)];
  if(!entry){const op=fetchByte(pc,m,true);bad(info.officialOpcodes?.includes(op)?'MISSING_TRANSLATION':'UNSUPPORTED_OPCODE','No translated instruction at '+pc+' (opcode '+op+')',pc);}
  for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m,true)!==entry[0][i])bad('CODE_CHANGED','Peek differs from source',pc);
  const fetches=entry[3]??entry[0].length;for(let i=0;i<fetches;i++)if(fetchByte(pc+i,m)!==entry[0][i])bad('CODE_CHANGED','Fetch differs from source',pc);
  unchanged(m);if(out)out.physicalPC=bank*8192+(pc&8191);const old=s.p;hold=false;const q=entry[1](c);s.p=c.norm(s.p);irqMask=entry[2]===1?old&4:s.p&4;if(entry[2]===2)hold=true;addCycles(q);s.instructions++;return receipt(out,'instruction',pc,timed?s.cycles-startCycle:q);
 }finally{busy=false;}}
 const now=()=>globalThis.performance?.now?.()??Date.now();
 function run(options={}){safe();if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxSteps','maxCycles','maxMs'].includes(k)))bad('BAD_ARGUMENT','Invalid run options');const maxSteps=options.maxSteps??1000,maxCycles=options.maxCycles??100000,maxMs=options.maxMs??1000;integer(maxSteps,1000000,'maxSteps');integer(maxCycles,10000000,'maxCycles');integer(maxMs,5000,'maxMs');if(!maxSteps||!maxCycles||!maxMs)bad('BAD_ARGUMENT','Positive bounds required');const start=now(),initial=s.cycles;let steps=0,reason='steps';while(steps<maxSteps){if(s.cycles-initial>=maxCycles){reason='cycles';break;}if(now()-start>=maxMs){reason='time';break;}step();steps++;}return {steps,cycles:s.cycles-initial,reason,state:snapshot()};}
 const api=Object.freeze({checkpointCapture(){safe();return {s,irq,nmiLine,nmiPending,irqMask,hold,startCycle,coreStart};},checkpointRestore(v){safe();setState(v.s);({irq,nmiLine,nmiPending,irqMask,hold,startCycle,coreStart}=v);},bus,getState:snapshot,getPC:()=>s.pc,setState,step:()=>step(),stepKind:()=>step().kind,run,reset,setIRQ(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean IRQ required');irq=v;},setNMI(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean NMI required');if(v&&!nmiLine)nmiPending=true;nmiLine=v;},requestNMI(){safe();nmiPending=true;},getSignals:()=>({irq,nmiLine,nmiPending,irqMask:Boolean(irqMask),hold})});machineSteps.set(api,step);reset();return api;
}
function bindMachineStep(cpu){const step=machineSteps.get(cpu);if(!step)bad('BAD_CPU','Module-owned CPU required');const result={kind:'',pc:0,cycles:0,physicalPC:0};return ()=>step(result);}
function bindOwnedPPU(base,e){const record=ownedBuses.get(base);if(!record?.bindPPU)throw Error('Unowned PPU bus');return record.bindPPU(e);}
return Object.freeze(Object.defineProperties(Object.create(null),{"bindOwnedPPU":{enumerable:true,get:()=>bindOwnedPPU},"bindMachineStep":{enumerable:true,get:()=>bindMachineStep},"CPUError":{enumerable:true,get:()=>CPUError},"fromHex":{enumerable:true,get:()=>fromHex},"composeBus":{enumerable:true,get:()=>composeBus},"makeBus":{enumerable:true,get:()=>makeBus},"makeCPU":{enumerable:true,get:()=>makeCPU}}));
}
