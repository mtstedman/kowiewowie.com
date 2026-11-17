// Posse extracted reusable engine factory; original body retained.
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
// Only module-owned buses with immutable cartridge metadata use the fast epoch path.
const ownedBuses=new WeakMap();
function composeBus(base,hooks){
 const record=ownedBuses.get(base);
 if(!record||!hooks||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
 const bus=Object.freeze({...base,...hooks});ownedBuses.set(bus,record);return bus;
}

const S4=['select','r0','r1','r2','r3','r4','r5','r6','r7','mirror','protect','latch','counter','reload','reloadBlocked','enabled','asserted','clock','lastWriteCycle','ppuAddress','ppuDot','lowSamples'];
const K4=['mapper','identity',...S4,'version','w0','w1','w2','w3','ramEnabled','ramWritable'];
function windows4(v,info){const mask=info.prgBanks-1,r6=(v.r6&63)&mask,r7=(v.r7&63)&mask;return v.select&64?[info.prgBanks-2,r7,r6,info.prgBanks-1]:[r6,r7,info.prgBanks-2,info.prgBanks-1];}
function valid4(v,info){
 if(!exact(v,K4)||v.mapper!==4||v.identity!==info.mappingIdentity)bad('BAD_MAPPING','MMC3 snapshot identity/fields');
 for(const k of ['select','r0','r1','r2','r3','r4','r5','r6','r7','protect','latch','counter'])integer(v[k],255,'MMC3 byte');
 integer(v.mirror,1,'mirroring');integer(v.ppuAddress,16383,'PPU address');integer(v.lowSamples,3,'A12 filter');
 for(const k of ['reload','reloadBlocked','enabled','asserted','ramEnabled','ramWritable'])if(typeof v[k]!=='boolean')bad('BAD_MAPPING','MMC3 boolean');
 for(const k of ['clock','ppuDot','version'])integer(v[k],Number.MAX_SAFE_INTEGER-8192,'MMC3 counter');
 if(!Number.isSafeInteger(v.lastWriteCycle)||v.lastWriteCycle< -1||v.lastWriteCycle>=v.clock)bad('BAD_MAPPING','MMC3 write clock');
 if((v.ppuAddress&4096)&&v.lowSamples!==0)bad('BAD_MAPPING','High A12 cannot accumulate low samples');
 const w=windows4(v,info),enabled=info.mmc3.prg_ram==='8k'&&Boolean(v.protect&128);
 if(w.some((b,i)=>v['w'+i]!==b)||v.ramEnabled!==enabled||v.ramWritable!==(enabled&&!(v.protect&64))||v.asserted&&!v.enabled)bad('BAD_MAPPING','Inconsistent MMC3 derived state');
 return {...v};
}
function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:4},chr=new Uint8Array()){
 const cfg=info.mmc3,n=prg?.length/8192;
 if(info.mapper!==4||!(prg instanceof Uint8Array)||![2,4,8,16,32,64].includes(n)||info.prgBanks!==n||typeof info.mappingIdentity!=='string'||!cfg)bad('BAD_ROM_DATA','MMC3 geometry/identity');
 if(!(trainer instanceof Uint8Array)||![0,512].includes(trainer.length)||!(chr instanceof Uint8Array)||![0,8192,16384,32768,65536,131072,262144].includes(chr.length))bad('BAD_ROM_DATA','MMC3 CHR/trainer');
 if(cfg.board!=='standard-txrom'||!['sharp-bc','alternate'].includes(cfg.irq_revision)||cfg.reload_policy!=='reject-consecutive-reload'||!['none','8k'].includes(cfg.prg_ram)||!['mapper','fixed_horizontal','fixed_vertical','four_screen'].includes(cfg.mirroring)||cfg.startup_model!=='explicit-banks-zero-irq')bad('BAD_ROM_DATA','Unsupported MMC3 policy');
 integer(cfg.m2_falling_dot,2,'M2 phase');byte(cfg.startup_select);byte(cfg.startup_ram_protect);integer(cfg.startup_mirroring,1,'startup mirroring');
 if(!Array.isArray(cfg.startup_registers)||cfg.startup_registers.length!==8)bad('BAD_ROM_DATA','Eight startup bank registers');cfg.startup_registers.forEach(byte);
 if(!io||typeof io!=='object'||Array.isArray(io)||Object.keys(io).some(k=>!['read','write','peek'].includes(k))||Object.values(io).some(v=>typeof v!=='function'))bad('BAD_BUS','I/O callbacks');
 const rom=prg.slice(),ram=new Uint8Array(2048),sram=new Uint8Array(cfg.prg_ram==='8k'?8192:0),chrRAM=chr.length===0,initialCHR=chrRAM?new Uint8Array(8192):chr.slice();
 let chrData=initialCHR;
 if(trainer.length){if(!sram.length)bad('BAD_ROM_DATA','Trainer requires RAM');sram.set(trainer,4096);}
 let version=0,state={select:cfg.startup_select,mirror:cfg.startup_mirroring,protect:cfg.startup_ram_protect,latch:0,counter:0,reload:false,reloadBlocked:false,enabled:false,asserted:false,clock:0,lastWriteCycle:-1,ppuAddress:0,ppuDot:0,lowSamples:0};
 for(let i=0;i<8;i++)state['r'+i]=cfg.startup_registers[i];
 const bump=()=>{if(version>=Number.MAX_SAFE_INTEGER-8192)bad('MAPPING_OVERFLOW','Epoch exhausted');version++;};
 const ramEnabled=()=>sram.length>0&&Boolean(state.protect&128);
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address');const slot=(a-32768)>>>13,mask=n-1;let bank;if(slot===3)bank=n-1;else if(slot===1)bank=state.r7&63&mask;else bank=((state.select&64)?slot===0:slot===2)?n-2:state.r6&63&mask;return bank*8192+(a&8191);}
 function mapCHR(a){integer(a,8191,'CHR address');let slot=(a>>>10)^((state.select&128)?4:0),bank=slot<4?(((slot<2?state.r0:state.r1)&254)+(slot&1)):(slot===4?state.r2:slot===5?state.r3:slot===6?state.r4:state.r5);return (bank&(chrData.length/1024-1))*1024+(a&1023);}
 function mirroring(){return cfg.mirroring==='mapper'?(state.mirror?'horizontal':'vertical'):cfg.mirroring.replace('fixed_','');}
 function mapNametable(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address');const off=(a-8192)&4095,page=off>>>10,mode=mirroring();return (mode==='four_screen'?page:mode==='vertical'?page&1:page>>>1)*1024+(off&1023);}
 function getMapperState(){const w=windows4(state,info),en=ramEnabled();return {mapper:4,identity:info.mappingIdentity,...state,version,w0:w[0],w1:w[1],w2:w[2],w3:w[3],ramEnabled:en,ramWritable:en&&!(state.protect&64)};}
 function loadMapperState(v){const q=valid4(v,info),next={};for(const k of S4)next[k]=q[k];bump();state=next;}
 function getCPUClock(){return state.clock;}
 function advanceCPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'CPU clock');if(t<state.clock)bad('BAD_TIMING','CPU clock backwards');state.clock=t;}
 function external(a,peek){const fn=peek?io.peek:io.read;if(!fn)bad('HARDWARE_UNIMPLEMENTED','Missing open-bus/device handler');return byte(fn(a));}
 function read(a,peek=false){address(a);if(a<8192)return ram[a&2047];if(a>=32768)return rom[mapPRG(a)];if(a>=24576&&ramEnabled())return sram[a-24576];return external(a,peek);}
 function write(a,v,t){
  address(a);byte(v);integer(t,Number.MAX_SAFE_INTEGER-8192,'Absolute CPU write cycle');if(t<state.clock)bad('BAD_TIMING','CPU write precedes clock');
  if(a>=32768&&(a&57345)===49153&&state.reloadBlocked)bad('UNSUPPORTED_MMC3_RELOAD_GLITCH','Consecutive manual reload requires board-specific pathological behavior');
  bump();state.clock=t+1;state.lastWriteCycle=t;
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=32768){switch(a&57345){case 32768:state.select=v;break;case 32769:state['r'+(state.select&7)]=v;break;case 40960:state.mirror=v&1;break;case 40961:state.protect=v;break;case 49152:state.latch=v;break;case 49153:state.counter=0;state.reload=true;break;case 57344:state.enabled=false;state.asserted=false;break;case 57345:state.enabled=true;break;}return;}
  if(a>=24576){if(ramEnabled()&&!(state.protect&64))sram[a-24576]=v;return;}
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','Missing device write');io.write(a,v,t);
 }
 function irqClock(){const old=state.counter,manual=state.reload;state.counter=old===0||manual?state.latch:old-1;if(state.counter===0&&state.enabled&&(cfg.irq_revision==='sharp-bc'||old>0||manual))state.asserted=true;state.reload=false;state.reloadBlocked=manual;}
 function advancePPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'PPU clock');if(t<state.ppuDot)bad('BAD_TIMING','PPU clock backwards');if(t===state.ppuDot)return;const phase=cfg.m2_falling_dot;if(!(state.ppuAddress&4096)){const edges=Math.floor((t-1-phase)/3)-Math.floor((state.ppuDot-1-phase)/3);state.lowSamples=Math.min(3,state.lowSamples+edges);}state.ppuDot=t;bump();}
 function setPPUAddress(a,t=state.ppuDot){integer(a,16383,'PPU address');advancePPUClock(t);const high=Boolean(a&4096),was=Boolean(state.ppuAddress&4096);bump();if(high&&!was&&state.lowSamples>=3)irqClock();if(high||was)state.lowSamples=0;state.ppuAddress=a;}
 let mapperStageValid=false;
 const api={checkpointCapture:()=>({ram,sram,chrRam:chrRAM?chrData:new Uint8Array(),mapper:getMapperState()}),checkpointRestore(v){api.loadRAM(v.ram,v.sram);api.loadCHR(v.chrRam);loadMapperState(v.mapper);version=v.mapper.version;},read:a=>read(a),peek:a=>read(a,true),write,mapPRG,mapCHR,mapNametable,getMirroring:mirroring,getMapperState,loadMapperState,getCPUClock,advanceCPUClock,setPPUAddress,advancePPUClock,getPPUClock:()=>state.ppuDot,getIRQ:()=>state.asserted,peekCHR:a=>chrData[mapCHR(a)],ppuRead(a,t=state.ppuDot){integer(a,8191,'CHR address');setPPUAddress(a,t);return chrData[mapCHR(a)];},ppuWrite(a,v,t=state.ppuDot){integer(a,8191,'CHR address');byte(v);setPPUAddress(a,t);if(chrRAM)chrData[mapCHR(a)]=v;},snapshot(){return {ram:ram.slice(),prgRam:sram.slice(),chrRam:chrRAM?chrData.slice():new Uint8Array(),mapper:getMapperState()};},loadRAM(r,p){if(!(r instanceof Uint8Array)||r.length!==2048||!(p instanceof Uint8Array)||p.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM arrays');bump();ram.set(r);sram.set(p);},loadCHR(r){if(!(r instanceof Uint8Array)||r.length!==(chrRAM?8192:0))bad('BAD_ARGUMENT','Exact CHR RAM');bump();if(chrRAM)chrData.set(r);}};
 if(Object.isFrozen(info)&&Object.isFrozen(cfg)&&Object.isFrozen(cfg.startup_registers))ownedBuses.set(api,{info,bindPPU(e){
    const chrStorage=new Uint8Array(e.memory.buffer,e.owned_chr(),262144);
    chrStorage.set(chrData);chrData=chrStorage.subarray(0,chrData.length);
    const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),m=new Uint32Array(e.memory.buffer,e.owned_mapper(),64),od=new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4);
    let mappingRefreshes=0,synchronizations=0,skippedSource=0,skippedAudio=0;
    let cachedSelect=-1,cachedMirror=-1,c0=-1,c1=-1,c2=-1,c3=-1,c4=-1,c5=-1;
    function refreshMapping(){
     const select=state.select&128,mirror=cfg.mirroring==='mapper'?state.mirror:0;
     if(select===cachedSelect&&mirror===cachedMirror&&state.r0===c0&&state.r1===c1&&state.r2===c2&&state.r3===c3&&state.r4===c4&&state.r5===c5)return;
     for(let slot=0;slot<8;slot++)m[slot]=mapCHR(slot*1024);
     const mode=mirroring();q[10]=({single_lower:0,single_upper:1,vertical:2,horizontal:3,four_screen:4})[mode];
     if(!Object.hasOwn({single_lower:0,single_upper:1,vertical:2,horizontal:3,four_screen:4},mode))throw Error('Owned MMC3 mirroring invariant');
     cachedSelect=select;cachedMirror=mirror;c0=state.r0;c1=state.r1;c2=state.r2;c3=state.r3;c4=state.r4;c5=state.r5;mappingRefreshes++;
    }
    function before(){
     if(mapperStageValid&&version<Number.MAX_SAFE_INTEGER-8208)return true;
     synchronizations++;
     if(version>Number.MAX_SAFE_INTEGER-8208||state.ppuDot>Number.MAX_SAFE_INTEGER-8208)return false;
     od[0]=state.ppuDot;od[1]=0;m[8]=4;m[9]=chrData.length-1;
     m[10]=cfg.m2_falling_dot;m[11]=state.ppuAddress;m[12]=state.lowSamples;
     m[13]=state.counter;m[14]=state.latch;m[15]=state.reload?1:0;
     m[16]=state.reloadBlocked?1:0;m[17]=state.enabled?1:0;m[18]=state.asserted?1:0;m[19]=cfg.irq_revision==='sharp-bc'?1:0;
     refreshMapping();return true;
    }
    function after(){
     const delta=od[1];if(!Number.isSafeInteger(delta)||delta<0||delta>6)throw Error('Owned MMC3 epoch invariant');
     od[1]=0;mapperStageValid=true;version+=delta;state.ppuDot=od[0];state.ppuAddress=m[11];state.lowSamples=m[12];
     state.counter=m[13];state.reload=Boolean(m[15]);state.reloadBlocked=Boolean(m[16]);state.asserted=Boolean(m[18]);
    }
    return Object.freeze({before,after,skipPreparation(reason){if(reason===1)skippedSource++;else if(reason===2)skippedAudio++;else throw Error('Private boundary reason');},mappingRefreshes:()=>mappingRefreshes,stats:()=>({
     skippedPreparations:skippedSource+skippedAudio,skippedSourcePreparations:skippedSource,skippedAudioPreparations:skippedAudio,
     localMapperReads:e.owned_reads(),yieldSourceBoundary:e.owned_yields(1)+skippedSource,yieldMapperAudioEdge:e.owned_yields(2)+skippedAudio,
     yieldUnknownCHR:e.owned_yields(3),yieldSkippedDummy:e.owned_yields(4),yieldDirtyRow:e.owned_yields(5),yieldSpriteStatus:e.owned_yields(6),yieldNonBgPattern:e.owned_yields(7),
     localMapper:4,sourceSpriteFetch:true,sourceMapperAudio:false,synchronizations,mappingRefreshMeaning:'CHR-window/mirroring cache refreshes'
    })});
   },snapshot(){const mask=info.prgBanks-1,r6=(state.r6&63)&mask,r7=(state.r7&63)&mask;return state.select&64?{w0:info.prgBanks-2,w1:r7,w2:r6,w3:info.prgBanks-1,version,clock:state.clock}:{w0:r6,w1:r7,w2:info.prgBanks-2,w3:info.prgBanks-1,version,clock:state.clock};},unchanged(m){return version===m.version&&state.clock===m.clock;}});
 for(const key of ['write','ppuRead','ppuWrite','setPPUAddress','advancePPUClock','loadRAM','loadCHR','loadMapperState']){const fn=api[key];if(fn)api[key]=function(...args){if(key!=='write'||args[0]>=8192)mapperStageValid=false;return fn.apply(this,args);};}
 return Object.freeze(api);
}
// Generic fixed-property lookup; no mapping result or validation is cached.
function windowBank(m,w){switch(w){case 0:return m.w0;case 1:return m.w1;case 2:return m.w2;case 3:return m.w3;default:return undefined;}}
function makeCPU(bus,blocks,info){
 if(!bus||['read','write','peek'].some(k=>typeof bus[k]!=='function'))bad('BAD_BUS','Bus requires read, write, peek');
 const mmc=true,banked=true;
 if(banked&&['mapPRG','getMapperState',...(mmc?['getCPUClock','advanceCPUClock']:[])].some(k=>typeof bus[k]!=='function'))bad('BAD_MAPPING_HOOK','Missing mapper/timing hooks');
 const owned=ownedBuses.get(bus),trusted=owned?.info===info?owned:null;
 function mapping(){
  if(trusted)return trusted.snapshot();
  const v=valid4(bus.getMapperState(),info);if(bus.getCPUClock()!==v.clock)bad('BAD_MAPPING','Clock hook mismatch');return v;
 }
 // m is a private fresh snapshot, never returned or passed to a hook.
 // Cache only its keys, never public results or validation decisions.
 // mapping() still runs first, including EVERY state and clock callback.
 let comparisonSnapshot=null,comparisonKeys=null;
 function unchanged(m){
  if(trusted){if(!trusted.unchanged(m))bad('MAPPING_CHANGED','Mapping changed during fetch');return;}
  const v=mapping();
  if(m!==comparisonSnapshot){comparisonKeys=Object.keys(m);comparisonSnapshot=m;}
  for(let i=0;i<comparisonKeys.length;i++){const k=comparisonKeys[i];if(v[k]!==m[k])bad('MAPPING_CHANGED','Mapping changed during fetch');}
 }
 function mapped(a,m){
  unchanged(m);
  const expected=windowBank(m,((a-32768)>>>13))*8192+(a&8191);
  const actual=bus.mapPRG(a);
  unchanged(m);
  if(actual!==expected)bad('BAD_MAPPING','Incorrect physical mapping',a);
 }
 // Check the epoch before interpreting callback results. A changed mapping is
 // a stale snapshot, not evidence of a stable but incorrect physical mapping.
 function fetchByte(a,m,peek=false){
  if(banked)mapped(a,m);
  const value=peek?bus.peek(a):bus.read(a);
  if(banked){unchanged(m);mapped(a,m);}
  return byte(value);
 }
 mapping();
 const s={a:0,x:0,y:0,sp:0,p:36,pc:0,cycles:0,instructions:0};let irq=false,nmiLine=false,nmiPending=false,irqMask=4,hold=false,busy=false,startCycle=0;
 function begin(){if(mmc){startCycle=integer(bus.getCPUClock(),Number.MAX_SAFE_INTEGER-32,'CPU clock');}}
 const c={s,r:a=>byte(bus.read(a&65535)),w:(a,v,offset)=>{if(mmc){integer(offset,6,'Write offset');bus.write(a&65535,byte(v),startCycle+offset);}else bus.write(a&65535,byte(v));},norm:p=>(p|32)&239,f(mask,on){s.p=on?s.p|mask:s.p&~mask;},nz(v){v&=255;s.p=(s.p&125)|(v===0?2:0)|(v&128);return v;},push(v,offset){c.w(256+s.sp,v,offset);s.sp=(s.sp-1)&255;},pop(){s.sp=(s.sp+1)&255;return c.r(256+s.sp);},word(a){return c.r(a)|(c.r((a+1)&65535)<<8);},vector};
 const snapshot=()=>({...s});
 function safe(){if(busy)bad('REENTRANT_CPU','Callbacks may not reenter CPU setters/execution');}
 function setState(patch){safe();if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!Object.hasOwn(s,k)))bad('BAD_STATE','Unknown CPU state property');for(const [k,v] of Object.entries(patch))integer(v,k==='pc'?65535:['cycles','instructions'].includes(k)?Number.MAX_SAFE_INTEGER-8:255,'Invalid CPU state');Object.assign(s,patch);s.p=c.norm(s.p);if('p' in patch)irqMask=s.p&4;}
 function addCycles(n){if(s.cycles>Number.MAX_SAFE_INTEGER-8)bad('CYCLE_OVERFLOW','Counter exhausted');if(mmc)bus.advanceCPUClock(startCycle+n);s.cycles+=n;}
 function vector(a){const m=mapping(),lo=fetchByte(a,m),hi=fetchByte(a+1,m);if(banked)unchanged(m);return lo|(hi<<8);}
 function reset(){safe();busy=true;try{begin();s.sp=(s.sp-3)&255;s.p=c.norm(s.p|4);s.pc=vector(65532);addCycles(7);irqMask=4;nmiPending=false;hold=false;return snapshot();}finally{busy=false;}}
 function interrupt(a){c.r(s.pc);c.r(s.pc);c.push(s.pc>>>8,2);c.push(s.pc&255,3);c.push(c.norm(s.p),4);s.p|=4;s.pc=vector(a);irqMask=4;hold=true;addCycles(7);}
 function step(){safe();busy=true;try{
  if(s.cycles>Number.MAX_SAFE_INTEGER-8||s.instructions>Number.MAX_SAFE_INTEGER-2)bad('COUNTER_OVERFLOW','Counter exhausted');begin();const pc=s.pc;
  if(!hold&&(nmiPending||(irq&&!irqMask))){const nmi=nmiPending;if(nmi)nmiPending=false;interrupt(nmi?65530:65534);return {kind:nmi?'nmi':'irq',pc,cycles:7};}
  if(pc<32768)bad('MUTABLE_CODE_UNSUPPORTED','Execution outside immutable PRG',pc);
  const m=mapping();if(banked)mapped(pc,m);
  const window=(pc-32768)>>>13;let entry=blocks[window][windowBank(m,window)][pc];
  if(entry&&entry.cross)entry=entry.cross[windowBank(m,window+1)];
  if(!entry){const op=fetchByte(pc,m,true);bad(info.officialOpcodes.includes(op)?'MISSING_TRANSLATION':'UNSUPPORTED_OPCODE','No translated instruction at '+pc+' (opcode '+op+')',pc);}
  for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m,true)!==entry[0][i])bad('CODE_CHANGED','Peek differs from source',pc);
  for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m)!==entry[0][i])bad('CODE_CHANGED','Fetch differs from source',pc);
  if(banked)unchanged(m);
  // Semantic writes legitimately update mapping and the MMC1 clock. Do not
  // compare their final state to the pre-fetch snapshot.
  const old=s.p;hold=false;const n=entry[1](c);s.p=c.norm(s.p);irqMask=entry[2]===1?old&4:s.p&4;if(entry[2]===2)hold=true;addCycles(n);s.instructions++;return {kind:'instruction',pc,cycles:n};
 }finally{busy=false;}}
 const now=()=>globalThis.performance?.now?.()??Date.now();
 function run(options={}){safe();if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxSteps','maxCycles','maxMs'].includes(k)))bad('BAD_ARGUMENT','Invalid run options');const maxSteps=options.maxSteps??1000,maxCycles=options.maxCycles??100000,maxMs=options.maxMs??1000;integer(maxSteps,1000000,'maxSteps');integer(maxCycles,10000000,'maxCycles');integer(maxMs,5000,'maxMs');if(!maxSteps||!maxCycles||!maxMs)bad('BAD_ARGUMENT','Positive bounds required');const start=now(),initial=s.cycles;let steps=0,reason='steps';while(steps<maxSteps){if(s.cycles-initial>=maxCycles){reason='cycles';break;}if(now()-start>=maxMs){reason='time';break;}step();steps++;}return {steps,cycles:s.cycles-initial,reason,state:snapshot()};}
 const api=Object.freeze({checkpointCapture(){safe();return {s,irq,nmiLine,nmiPending,irqMask,hold,startCycle};},checkpointRestore(v){safe();setState(v.s);({irq,nmiLine,nmiPending,irqMask,hold,startCycle}=v);},bus,getState:snapshot,getPC:()=>s.pc,setState,step,run,reset,setIRQ(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean IRQ required');irq=v;},setNMI(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean NMI required');if(v&&!nmiLine)nmiPending=true;nmiLine=v;},requestNMI(){safe();nmiPending=true;},getSignals:()=>({irq,nmiLine,nmiPending,irqMask:Boolean(irqMask),hold})});reset();return api;
}

function bindOwnedPPU(base,e){const record=ownedBuses.get(base);if(!record?.bindPPU)throw Error('Unowned PPU bus');return record.bindPPU(e);}
return Object.freeze(Object.defineProperties(Object.create(null),{"bindOwnedPPU":{enumerable:true,get:()=>bindOwnedPPU},"CPUError":{enumerable:true,get:()=>CPUError},"fromHex":{enumerable:true,get:()=>fromHex},"composeBus":{enumerable:true,get:()=>composeBus},"makeBus":{enumerable:true,get:()=>makeBus},"makeCPU":{enumerable:true,get:()=>makeCPU}}));
}
