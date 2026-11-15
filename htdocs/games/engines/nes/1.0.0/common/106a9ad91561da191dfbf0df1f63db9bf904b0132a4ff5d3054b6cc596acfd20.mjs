// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const makeTimedCPU=imports[0]["makeTimedCPU"];

class CPUError extends Error {
 constructor(code,message,pc){super(message);this.name='CPUError';this.code=code;if(pc!==undefined)this.pc=pc;}
}
const bad=(code,message,pc)=>{throw new CPUError(code,message,pc);};
const integer=(v,max,label)=>{if(!Number.isSafeInteger(v)||v<0||v>max)bad('BAD_ARGUMENT',label);return v;};
const byte=v=>integer(v,255,'Expected byte'),address=v=>integer(v,65535,'Expected CPU address');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fromHex(h){if(typeof h!=='string'||h.length%2||!/^[0-9a-f]*$/.test(h))bad('BAD_ROM_DATA','Invalid hex');const b=new Uint8Array(h.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(h.slice(i*2,i*2+2),16);return b;}
function banks1(v,info){const p=v.prg,mode=(v.control>>2)&3,mask=info.prgBanks-1;if(info.mmc1.wiring==='fixed32')return [0,1];if(mode<2)return [(p&14)&mask,((p&14)+1)&mask];const bypass=info.mmc1.revision==='MMC1A'&&Boolean(p&16);return mode===2?[(bypass?p&8:0)&mask,(p&15)&mask]:[(p&15)&mask,(bypass?(p&8)|7:15)&mask];}
function ram1(v,info){return info.mmc1.prg_ram==='8k'&&!(info.mmc1.revision==='MMC1B'&&(v.prg&16))&&!(info.mmc1.wiring==='SNROM'&&((v.control&16)&&(v.ppuAddress&4096)?v.chr1:v.chr0)&16);}
// Only module-owned buses with immutable cartridge metadata use the fast epoch path.
const ownedBuses=new WeakMap();
function composeBus(base,hooks){
 const record=ownedBuses.get(base);
 if(!record||!hooks||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock','readCycle','readDataCycle','writeCycle','getInterruptLines'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
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
function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:0},chr=new Uint8Array()){
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

 // Code identity is separate from mapper epochs that change on PPU dots.
 const codeListeners=new Set();let codeGeneration=0;const codeVersions=new Map();
 function codeLocation(a){address(a);let q;if(a<8192)q={kind:'ram',physical:a&2047,page:'ram:'+((a&2047)>>>8)};else if(a>=24576){if(a<32768&&hasRAM&&(!mmc||ram1(state,info)))return {kind:'ram',physical:2048+a-24576,page:'sram:'+((a-24576)>>>8)};}
 if(!q&&a>=32768){const physical=mapPRG(a);if(physical>=0)q={kind:'rom',physical};}
 if(!q)return {kind:'unmapped',key:'unmapped'};return finishLocation(q);}
 function finishLocation(q){q.key=q.kind+':'+q.physical+':'+codeGeneration+':'+(codeVersions.get(q.page)||0);return q;}
 api.codeLocation=a=>{const q=codeLocation(a);return q.key?q:finishLocation(q);};
 api.watchCode=fn=>{if(typeof fn!=='function')bad('BAD_ARGUMENT','Code listener');codeListeners.add(fn);return ()=>codeListeners.delete(fn);};
 const codeWrite=api.write;api.write=(a,v,t)=>{const before=api.codeLocation(a),old=before.kind==='ram'?api.peek(a):null;codeWrite(a,v,t);if(before.kind==='ram'&&api.codeLocation(a).physical===before.physical&&api.peek(a)!==old){const version=(codeVersions.get(before.page)||0)+1;if(!Number.isSafeInteger(version))bad('CODE_VERSION_OVERFLOW','RAM page epoch');codeVersions.set(before.page,version);for(const fn of codeListeners)fn(before.page);}};
 const codeLoad=api.loadRAM;api.loadRAM=(r,p)=>{codeLoad(r,p);if(++codeGeneration>=Number.MAX_SAFE_INTEGER)bad('CODE_VERSION_OVERFLOW','RAM generation');codeVersions.clear();for(const fn of codeListeners)fn(null);};
 const codeMapperLoad=api.loadMapperState;api.loadMapperState=v=>{codeMapperLoad(v);if(++codeGeneration>=Number.MAX_SAFE_INTEGER)bad('CODE_VERSION_OVERFLOW','Mapper restore generation');codeVersions.clear();for(const fn of codeListeners)fn(null);};
 return Object.freeze(api);
}
function makeCPU(bus,blocks,info){return makeTimedCPU(bus,blocks,info,CPUError);}

return Object.freeze(Object.defineProperties(Object.create(null),{"CPUError":{enumerable:true,get:()=>CPUError},"fromHex":{enumerable:true,get:()=>fromHex},"composeBus":{enumerable:true,get:()=>composeBus},"makeBus":{enumerable:true,get:()=>makeBus},"makeCPU":{enumerable:true,get:()=>makeCPU}}));
}
