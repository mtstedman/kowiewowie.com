export class CPUError extends Error {
 constructor(code,message,pc){super(message);this.name='CPUError';this.code=code;if(pc!==undefined)this.pc=pc;}
}
const bad=(code,message,pc)=>{throw new CPUError(code,message,pc);};
const integer=(v,max,label)=>{if(!Number.isSafeInteger(v)||v<0||v>max)bad('BAD_ARGUMENT',label);return v;};
const byte=v=>integer(v,255,'Expected byte'),address=v=>integer(v,65535,'Expected CPU address');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function fromHex(h){if(typeof h!=='string'||h.length%2||!/^[0-9a-f]*$/.test(h))bad('BAD_ROM_DATA','Invalid hex');const b=new Uint8Array(h.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(h.slice(i*2,i*2+2),16);return b;}
function banks1(v,info){const p=v.prg,mode=(v.control>>2)&3,mask=info.prgBanks-1;if(info.mmc1.wiring==='fixed32')return [0,1];if(mode<2)return [(p&14)&mask,((p&14)+1)&mask];const bypass=info.mmc1.revision==='MMC1A'&&Boolean(p&16);return mode===2?[(bypass?p&8:0)&mask,(p&15)&mask]:[(p&15)&mask,(bypass?(p&8)|7:15)&mask];}
function ram1(v,info){return info.mmc1.prg_ram==='8k'&&!(info.mmc1.revision==='MMC1B'&&(v.prg&16))&&!(info.mmc1.wiring==='SNROM'&&((v.control&16)&&(v.ppuAddress&4096)?v.chr1:v.chr0)&16);}
// Only module-owned buses with immutable cartridge metadata use the fast epoch path.
const ownedBuses=new WeakMap();
export function composeBus(base,hooks){
 const record=ownedBuses.get(base);
 if(!record||!hooks||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
 const bus=Object.freeze({...base,...hooks});ownedBuses.set(bus,record);return bus;
}
const MMC_KEYS=['mapper','identity','control','chr0','chr1','prg','shift','count','lastWriteCycle','clock','ppuAddress','version','low','high','ramEnabled'];
function valid1(v,info){
 if(!exact(v,MMC_KEYS)||v.mapper!==1||v.identity!==info.mappingIdentity)bad('BAD_MAPPER_STATE','Wrong MMC1 state identity or fields');
 for(const k of ['control','chr0','chr1','prg'])if(!Number.isInteger(v[k])||v[k]<0||v[k]>31)bad('BAD_MAPPER_STATE','Invalid register');
 if(!Number.isInteger(v.count)||v.count<0||v.count>4||!Number.isInteger(v.shift)||v.shift<0||v.shift>=2**v.count)bad('BAD_MAPPER_STATE','Invalid serial state');
 if(!Number.isSafeInteger(v.clock)||v.clock<0||v.clock>Number.MAX_SAFE_INTEGER-16||!Number.isSafeInteger(v.version)||v.version<0||!Number.isInteger(v.ppuAddress)||v.ppuAddress<0||v.ppuAddress>16383)bad('BAD_MAPPER_STATE','Invalid clock, epoch or PPU address');
 if(v.lastWriteCycle!==null&&(!Number.isSafeInteger(v.lastWriteCycle)||v.lastWriteCycle<0||v.lastWriteCycle>=v.clock))bad('BAD_MAPPER_STATE','Invalid last write');
 const [low,high]=banks1(v,info);if(v.low!==low||v.high!==high||v.ramEnabled!==ram1(v,info))bad('BAD_MAPPER_STATE','Inconsistent derived mapping');
 return {...v};
}
export function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:0},chr=new Uint8Array()){
 const mmc=info.mapper===1,ux=info.mapper===2;
 if(![0,1,2].includes(info.mapper)||!(prg instanceof Uint8Array)||!(mmc?[16384,32768,65536,131072,262144]:ux?[65536,131072,262144]:[16384,32768]).includes(prg.length))bad('BAD_ROM_DATA','Unsupported PRG');
 if(!(trainer instanceof Uint8Array)||![0,512].includes(trainer.length)||!(chr instanceof Uint8Array)||![0,8192,16384,32768,65536,131072].includes(chr.length))bad('BAD_ROM_DATA','Invalid trainer/CHR');
 if(!io||typeof io!=='object'||Array.isArray(io)||Object.keys(io).some(k=>!['read','write','peek'].includes(k))||Object.values(io).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid I/O callbacks');
 const count=prg.length/16384,cfg=mmc?info.mmc1:info.uxrom;
 if((mmc||ux)&&(typeof info.mappingIdentity!=='string'||info.prgBanks!==count||!cfg))bad('BAD_ROM_DATA','Missing cartridge policy');
 if(ux&&(!['UNROM','UOROM'].includes(cfg.board)||!(cfg.board==='UNROM'?[4,8]:[16]).includes(count)||!['and','none'].includes(cfg.bus_conflicts)||!['none','compat8k'].includes(cfg.prg_ram)||!Number.isInteger(cfg.startup_bank)||cfg.startup_bank<0||cfg.startup_bank>=count))bad('BAD_ROM_DATA','Invalid UxROM policy');
 if(mmc){
  if(!exact(cfg,['wiring','revision','prg_ram','startup_control','startup_chr0','startup_chr1','startup_prg'])||!['standard','SNROM','fixed32'].includes(cfg.wiring)||!['MMC1A','MMC1B'].includes(cfg.revision)||!['none','8k'].includes(cfg.prg_ram))bad('BAD_ROM_DATA','Invalid MMC1 policy');
  for(const k of ['startup_control','startup_chr0','startup_chr1','startup_prg'])if(!Number.isInteger(cfg[k])||cfg[k]<0||cfg[k]>31)bad('BAD_ROM_DATA','Invalid startup register');
  if(cfg.wiring==='SNROM'&&(cfg.prg_ram!=='8k'||chr.length>8192)||cfg.wiring==='fixed32'&&(count!==2||cfg.prg_ram!=='none'||chr.length<16384))bad('BAD_ROM_DATA','Unsupported wiring geometry');
 }
 const hasRAM=mmc?cfg.prg_ram==='8k':!ux||cfg.prg_ram==='compat8k',mask=ux?(cfg.board==='UNROM'?7:15):0;
 if(!hasRAM&&trainer.length)bad('BAD_ROM_DATA','Trainer requires RAM');
 const rom=prg.slice(),ram=new Uint8Array(2048),sram=new Uint8Array(hasRAM?8192:0),chrRAM=chr.length===0,chrData=chrRAM?new Uint8Array(8192):chr.slice();
 if(trainer.length)sram.set(trainer,4096);
 let register=ux?cfg.startup_bank:0,version=0;
 let state=mmc?{control:cfg.startup_control,chr0:cfg.startup_chr0,chr1:cfg.startup_chr1,prg:cfg.startup_prg,shift:0,count:0,lastWriteCycle:null,clock:0,ppuAddress:0}:null;
 const bump=()=>{if(version>=Number.MAX_SAFE_INTEGER)bad('MAPPING_OVERFLOW','Epoch exhausted');version++;};
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address required');if(mmc){const banks=banks1(state,info);return banks[a<49152?0:1]*16384+(a&16383);}return ux?((a<49152?register&(count-1):count-1)*16384+(a&16383)):(a-32768)%rom.length;}
 function getMapperState(){if(mmc){const [low,high]=banks1(state,info);return {mapper:1,identity:info.mappingIdentity,control:state.control,chr0:state.chr0,chr1:state.chr1,prg:state.prg,shift:state.shift,count:state.count,lastWriteCycle:state.lastWriteCycle,clock:state.clock,ppuAddress:state.ppuAddress,version,low,high,ramEnabled:ram1(state,info)};}return ux?{mapper:2,identity:info.mappingIdentity,register,bank:register&(count-1),version}:{mapper:0};}
 function loadMapperState(v){
  if(mmc){const q=valid1(v,info);bump();state={control:q.control,chr0:q.chr0,chr1:q.chr1,prg:q.prg,shift:q.shift,count:q.count,lastWriteCycle:q.lastWriteCycle,clock:q.clock,ppuAddress:q.ppuAddress};return;}
  if(!ux)bad('BAD_MAPPER_STATE','NROM has no latch');
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['mapper','identity','register','bank','version'].includes(k))||v.mapper!==2||v.identity!==info.mappingIdentity||!Number.isInteger(v.register)||v.register<0||v.register>mask||v.bank!==(v.register&(count-1)))bad('BAD_MAPPER_STATE','Invalid UxROM state');
  if('version' in v)integer(v.version,Number.MAX_SAFE_INTEGER,'version');bump();register=v.register;
 }
 function getCPUClock(){if(!mmc)bad('BAD_ARGUMENT','MMC1 clock only');return state.clock;}
 function advanceCPUClock(t){if(!mmc)bad('BAD_ARGUMENT','MMC1 clock only');integer(t,Number.MAX_SAFE_INTEGER-16,'CPU clock');if(t<state.clock)bad('BAD_TIMING','CPU clock cannot go backwards');state.clock=t;}
 function external(a,peek){const fn=peek?io.peek:io.read;if(!fn)bad('HARDWARE_UNIMPLEMENTED','No device/open-bus handler at '+a);return byte(fn(a));}
 function read(a,peek=false){address(a);if(a<8192)return ram[a&2047];if(a>=32768)return rom[mapPRG(a)];if(a>=24576&&hasRAM&&(!mmc||ram1(state,info)))return sram[a-24576];return external(a,peek);}
 function write(a,v,cycle){
  address(a);byte(v);let consecutive=false;
  if(mmc){integer(cycle,Number.MAX_SAFE_INTEGER-17,'Explicit CPU write cycle required');if(cycle<state.clock)bad('BAD_TIMING','Write precedes bus clock');consecutive=state.lastWriteCycle!==null&&cycle===state.lastWriteCycle+1;bump();state.lastWriteCycle=cycle;state.clock=cycle+1;}
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=32768){
   if(mmc){
    if(v&128){state.shift=0;state.count=0;state.control|=12;return;}
    if(consecutive)return;
    const loaded=state.shift|((v&1)<<state.count);
    if(state.count===4){state[['control','chr0','chr1','prg'][(a>>13)&3]]=loaded;state.shift=0;state.count=0;}else{state.shift=loaded;state.count++;}return;
   }
   if(!ux)bad('ROM_WRITE_UNSUPPORTED','NROM PRG is immutable');const effective=cfg.bus_conflicts==='and'?v&rom[mapPRG(a)]:v;bump();register=effective&mask;return;
  }
  if(a>=24576&&hasRAM){if(!mmc||ram1(state,info))sram[a-24576]=v;return;}
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','No device/open-bus handler at '+a);io.write(a,v,cycle);
 }
 function mapCHR(a){integer(a,8191,'Pattern-table address required');if(!mmc)return a;const units=chrData.length/4096,bank=state.control&16?(a<4096?state.chr0:state.chr1):(state.chr0&30)+(a>>12);return (bank&(units-1))*4096+(a&4095);}
 function setPPUAddress(a){integer(a,16383,'PPU address');if(mmc&&state.ppuAddress!==a){bump();state.ppuAddress=a;}}
 function mirroring(){return mmc?['single_lower','single_upper','vertical','horizontal'][state.control&3]:info.mirroring;}
 function mapNametable(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address required');const n=(a-8192)&4095,page=n>>10,mode=mirroring();return (mode==='four_screen'?page:mode==='single_lower'?0:mode==='single_upper'?1:mode==='vertical'?page&1:page>>1)*1024+(n&1023);}
 const api={read:a=>read(a),peek:a=>read(a,true),write,mapPRG,getMapperState,loadMapperState,mapCHR,mapNametable,getMirroring:mirroring,setPPUAddress,peekCHR:a=>chrData[mapCHR(a)],ppuRead(a){integer(a,8191,'Pattern-table address');setPPUAddress(a);return chrData[mapCHR(a)];},ppuWrite(a,v){integer(a,8191,'Pattern-table address');byte(v);setPPUAddress(a);if(chrRAM)chrData[mapCHR(a)]=v;},snapshot(){const v={ram:ram.slice(),prgRam:sram.slice()};if(mmc)v.chrRam=chrRAM?chrData.slice():new Uint8Array();if(ux||mmc)v.mapper=getMapperState();return v;},loadRAM(r,p){if(!(r instanceof Uint8Array)||r.length!==2048||!(p instanceof Uint8Array)||p.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM arrays required');ram.set(r);sram.set(p);},loadCHR(r){if(!(r instanceof Uint8Array)||r.length!==(chrRAM?8192:0))bad('BAD_ARGUMENT','Exact CHR RAM array required');if(chrRAM)chrData.set(r);}};
 if(mmc){api.getCPUClock=getCPUClock;api.advanceCPUClock=advanceCPUClock;}
 if(Object.isFrozen(info)&&(!cfg||Object.isFrozen(cfg))){
  ownedBuses.set(api,{info,snapshot(){if(mmc){const [low,high]=banks1(state,info);return {low,high,version,clock:state.clock};}return {bank:register&(count-1),version};},unchanged(m){return version===m.version&&(!mmc||state.clock===m.clock);}});
 }
 return Object.freeze(api);
}
export function makeCPU(bus,blocks,info){
 if(!bus||['read','write','peek'].some(k=>typeof bus[k]!=='function'))bad('BAD_BUS','Bus requires read, write, peek');
 const mmc=info.mapper===1,banked=info.mapper!==0;
 if(banked&&['mapPRG','getMapperState',...(mmc?['getCPUClock','advanceCPUClock']:[])].some(k=>typeof bus[k]!=='function'))bad('BAD_MAPPING_HOOK','Missing mapper/timing hooks');
 const owned=ownedBuses.get(bus),trusted=owned?.info===info?owned:null;
 function mapping(){
  if(trusted)return trusted.snapshot();
  if(!banked)return null;
  if(mmc){let v;try{v=valid1(bus.getMapperState(),info);}catch(e){if(e instanceof CPUError)bad('BAD_MAPPING',e.message);throw e;}if(bus.getCPUClock()!==v.clock)bad('BAD_MAPPING','Clock hook mismatch');return v;}
  const v=bus.getMapperState(),mask=info.uxrom.board==='UNROM'?7:15;
  if(!v||v.mapper!==2||v.identity!==info.mappingIdentity||!Number.isInteger(v.register)||v.register<0||v.register>mask||v.bank!==(v.register&(info.prgBanks-1))||!Number.isSafeInteger(v.version)||v.version<0)bad('BAD_MAPPING','Bus mapping does not match cartridge');return {bank:v.bank,register:v.register,version:v.version};
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
  const expected=(mmc?(a<49152?m.low:m.high):(a<49152?m.bank:info.prgBanks-1))*16384+(a&16383);
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
  let entry=mmc?blocks[(pc<49152?0:info.prgBanks)+(pc<49152?m.low:m.high)][pc]:banked?blocks[pc<49152?m.bank:info.prgBanks][pc]:blocks[pc];
  if(entry&&entry.cross)entry=entry.cross[m.high];
  if(!entry){const op=fetchByte(pc,m,true);bad(info.officialOpcodes.includes(op)?'MISSING_TRANSLATION':'UNSUPPORTED_OPCODE','No translated instruction at '+pc+' (opcode '+op+')',pc);}
  for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m,true)!==entry[0][i])bad('CODE_CHANGED','Peek differs from source',pc);
  for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m)!==entry[0][i])bad('CODE_CHANGED','Fetch differs from source',pc);
  if(banked)unchanged(m);
  // Semantic writes legitimately update mapping and the MMC1 clock. Do not
  // compare their final state to the pre-fetch snapshot.
  const old=s.p;hold=false;const n=entry[1](c);s.p=c.norm(s.p);irqMask=entry[2]===1?old&4:s.p&4;if(entry[2]===2)hold=true;addCycles(n);s.instructions++;return {kind:'instruction',pc,cycles:n};
 }finally{busy=false;}}
 function run(options={}){safe();if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxSteps','maxCycles','maxMs'].includes(k)))bad('BAD_ARGUMENT','Invalid run options');const maxSteps=options.maxSteps??1000,maxCycles=options.maxCycles??100000,maxMs=options.maxMs??1000;integer(maxSteps,1000000,'maxSteps');integer(maxCycles,10000000,'maxCycles');integer(maxMs,5000,'maxMs');if(!maxSteps||!maxCycles||!maxMs)bad('BAD_ARGUMENT','Positive bounds required');const now=()=>globalThis.performance?.now?.()??Date.now(),start=now(),initial=s.cycles;let steps=0,reason='steps';while(steps<maxSteps){if(s.cycles-initial>=maxCycles){reason='cycles';break;}if(now()-start>=maxMs){reason='time';break;}step();steps++;}return {steps,cycles:s.cycles-initial,reason,state:snapshot()};}
 const api=Object.freeze({bus,getState:snapshot,getPC:()=>s.pc,setState,step,run,reset,setIRQ(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean IRQ required');irq=v;},setNMI(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean NMI required');if(v&&!nmiLine)nmiPending=true;nmiLine=v;},requestNMI(){safe();nmiPending=true;},getSignals:()=>({irq,nmiLine,nmiPending,irqMask:Boolean(irqMask),hold})});reset();return api;
}
