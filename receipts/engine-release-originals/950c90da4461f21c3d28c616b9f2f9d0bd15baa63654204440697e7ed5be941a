// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const makeTimedCPU=imports[0].makeTimedCPU;

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
 if(!record||!hooks||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock','readCycle','readDataCycle','writeCycle','getInterruptLines'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
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
 const prgOffsets=new Uint32Array(4);
 function refreshPRG(){const mask=n-1,r6=(state.r6&63&mask)*8192,r7=(state.r7&63&mask)*8192;prgOffsets[0]=(state.select&64)?(n-2)*8192:r6;prgOffsets[1]=r7;prgOffsets[2]=(state.select&64)?r6:(n-2)*8192;prgOffsets[3]=(n-1)*8192;}
 refreshPRG();
 function physicalPRG(a){return prgOffsets[(a-32768)>>>13]+(a&8191);}
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address');return physicalPRG(a); }
 function mapCHR(a){integer(a,8191,'CHR address');let slot=(a>>>10)^((state.select&128)?4:0),bank=slot<4?(((slot<2?state.r0:state.r1)&254)+(slot&1)):(slot===4?state.r2:slot===5?state.r3:slot===6?state.r4:state.r5);return (bank&(chrData.length/1024-1))*1024+(a&1023);}
 function mirroring(){return cfg.mirroring==='mapper'?(state.mirror?'horizontal':'vertical'):cfg.mirroring.replace('fixed_','');}
 function mapNametable(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address');const off=(a-8192)&4095,page=off>>>10,mode=mirroring();return (mode==='four_screen'?page:mode==='vertical'?page&1:page>>>1)*1024+(off&1023);}
 function getMapperState(){pullMapperStage();const w=windows4(state,info),en=ramEnabled();return {mapper:4,identity:info.mappingIdentity,...state,version,w0:w[0],w1:w[1],w2:w[2],w3:w[3],ramEnabled:en,ramWritable:en&&!(state.protect&64)};}
 function loadMapperState(v){const q=valid4(v,info),next={};for(const k of S4)next[k]=q[k];bump();state=next;refreshPRG();}
 function getCPUClock(){return state.clock;}
 function advanceCPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'CPU clock');if(t<state.clock)bad('BAD_TIMING','CPU clock backwards');state.clock=t;}
 function external(a,peek){const fn=peek?io.peek:io.read;if(!fn)bad('HARDWARE_UNIMPLEMENTED','Missing open-bus/device handler');return byte(fn(a));}
 function read(a,peek=false){address(a);if(a<8192)return ram[a&2047];if(a>=32768)return rom[physicalPRG(a)];if(a>=24576&&ramEnabled())return sram[a-24576];return external(a,peek);}
 function write(a,v,t){
  address(a);byte(v);integer(t,Number.MAX_SAFE_INTEGER-8192,'Absolute CPU write cycle');if(t<state.clock)bad('BAD_TIMING','CPU write precedes clock');
  if(a>=32768&&(a&57345)===49153&&state.reloadBlocked)bad('UNSUPPORTED_MMC3_RELOAD_GLITCH','Consecutive manual reload requires board-specific pathological behavior');
  bump();state.clock=t+1;state.lastWriteCycle=t;
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=32768){switch(a&57345){case 32768:state.select=v;break;case 32769:state['r'+(state.select&7)]=v;break;case 40960:state.mirror=v&1;break;case 40961:state.protect=v;break;case 49152:state.latch=v;break;case 49153:state.counter=0;state.reload=true;break;case 57344:state.enabled=false;state.asserted=false;break;case 57345:state.enabled=true;break;}if((a&57344)===32768)refreshPRG();return;}
  if(a>=24576){if(ramEnabled()&&!(state.protect&64))sram[a-24576]=v;return;}
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','Missing device write');io.write(a,v,t);
 }
 function irqClock(){const old=state.counter,manual=state.reload;state.counter=old===0||manual?state.latch:old-1;if(state.counter===0&&state.enabled&&(cfg.irq_revision==='sharp-bc'||old>0||manual))state.asserted=true;state.reload=false;state.reloadBlocked=manual;}
 function advancePPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'PPU clock');if(t<state.ppuDot)bad('BAD_TIMING','PPU clock backwards');if(t===state.ppuDot)return;const phase=cfg.m2_falling_dot;if(!(state.ppuAddress&4096)){const edges=Math.floor((t-1-phase)/3)-Math.floor((state.ppuDot-1-phase)/3);state.lowSamples=Math.min(3,state.lowSamples+edges);}state.ppuDot=t;bump();}
 function setPPUAddress(a,t=state.ppuDot){integer(a,16383,'PPU address');advancePPUClock(t);const high=Boolean(a&4096),was=Boolean(state.ppuAddress&4096);bump();if(high&&!was&&state.lowSamples>=3)irqClock();if(high||was)state.lowSamples=0;state.ppuAddress=a;}
 let mapperStageValid=false,pullMapperStage=()=>{},ownedIRQ=()=>false;
 const api={checkpointCapture:()=>({ram,sram,chrRam:chrRAM?chrData:new Uint8Array(),mapper:getMapperState()}),checkpointRestore(v){api.loadRAM(v.ram,v.sram);api.loadCHR(v.chrRam);loadMapperState(v.mapper);version=v.mapper.version;},read:a=>read(a),peek:a=>read(a,true),write,mapPRG,mapCHR,mapNametable,getMirroring:mirroring,getMapperState,loadMapperState,getCPUClock,advanceCPUClock,setPPUAddress,advancePPUClock,getPPUClock:()=>{pullMapperStage();return state.ppuDot;},getIRQ:()=>mapperStageValid?ownedIRQ():state.asserted,peekCHR:a=>chrData[mapCHR(a)],ppuRead(a,t=state.ppuDot){integer(a,8191,'CHR address');setPPUAddress(a,t);return chrData[mapCHR(a)];},ppuWrite(a,v,t=state.ppuDot){integer(a,8191,'CHR address');byte(v);setPPUAddress(a,t);if(chrRAM)chrData[mapCHR(a)]=v;},snapshot(){return {ram:ram.slice(),prgRam:sram.slice(),chrRam:chrRAM?chrData.slice():new Uint8Array(),mapper:getMapperState()};},loadRAM(r,p){if(!(r instanceof Uint8Array)||r.length!==2048||!(p instanceof Uint8Array)||p.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM arrays');bump();ram.set(r);sram.set(p);},loadCHR(r){if(!(r instanceof Uint8Array)||r.length!==(chrRAM?8192:0))bad('BAD_ARGUMENT','Exact CHR RAM');bump();if(chrRAM)chrData.set(r);}};
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
    ownedIRQ=()=>Boolean(m[18]);
    pullMapperStage=()=>{if(!mapperStageValid)return;state.ppuDot=od[0];state.ppuAddress=m[11];state.lowSamples=m[12];state.counter=m[13];state.reload=Boolean(m[15]);state.reloadBlocked=Boolean(m[16]);state.asserted=Boolean(m[18]);};
    function after(){
     const delta=od[1];if(!Number.isSafeInteger(delta)||delta<0||delta>6)throw Error('Owned MMC3 epoch invariant');
     od[1]=0;mapperStageValid=true;version+=delta;
    }
    return Object.freeze({before,after,skipPreparation(reason){if(reason===1)skippedSource++;else if(reason===2)skippedAudio++;else throw Error('Private boundary reason');},mappingRefreshes:()=>mappingRefreshes,stats:()=>({
     skippedPreparations:skippedSource+skippedAudio,skippedSourcePreparations:skippedSource,skippedAudioPreparations:skippedAudio,
     localMapperReads:e.owned_reads(),yieldSourceBoundary:e.owned_yields(1)+skippedSource,yieldMapperAudioEdge:e.owned_yields(2)+skippedAudio,
     yieldUnknownCHR:e.owned_yields(3),yieldSkippedDummy:e.owned_yields(4),yieldDirtyRow:e.owned_yields(5),yieldSpriteStatus:e.owned_yields(6),yieldNonBgPattern:e.owned_yields(7),
     localMapper:4,sourceSpriteFetch:true,sourceMapperAudio:false,synchronizations,mappingRefreshMeaning:'CHR-window/mirroring cache refreshes'
    })});
   },snapshot(){const mask=info.prgBanks-1,r6=(state.r6&63)&mask,r7=(state.r7&63)&mask;return state.select&64?{w0:info.prgBanks-2,w1:r7,w2:r6,w3:info.prgBanks-1,version,clock:state.clock}:{w0:r6,w1:r7,w2:info.prgBanks-2,w3:info.prgBanks-1,version,clock:state.clock};},unchanged(m){return version===m.version&&state.clock===m.clock;}});
 const ownedWrite=api.write;api.write=(a,v,t)=>{if(a>=8192){pullMapperStage();mapperStageValid=false;}return ownedWrite(a,v,t);};
 for(const key of ['ppuRead','ppuWrite','setPPUAddress','advancePPUClock','loadRAM','loadCHR','loadMapperState']){const fn=api[key];if(fn)api[key]=function(...args){pullMapperStage();mapperStageValid=false;return fn.apply(this,args);};}
 // Code identity is separate from mapper epochs that change on PPU dots.
 const codeListeners=new Set();let codeGeneration=0;const codeVersions=new Map();
 // romjs-live-code-identity/1: bounded private strings, live address classification.
 const identityKinds=new Uint8Array(8192),identityPhysical=new Uint32Array(8192),identityVersions=new Float64Array(8192),identityKeys=new Array(8192);
 const identityRamPages=Array.from({length:8},(_,i)=>'ram:'+i),identitySramPages=Array.from({length:32},(_,i)=>'sram:'+i);
 let identityGeneration=-1,romIdentityGeneration=-1;const romIdentityKeys=new Array(rom.length);
 function identityKey(kind,physical,page){
  // ROM identity has no writable-page epoch and is bounded by cartridge size.
  if(kind===2){if(romIdentityGeneration!==codeGeneration){romIdentityKeys.fill(undefined);romIdentityGeneration=codeGeneration;}return romIdentityKeys[physical]??(romIdentityKeys[physical]='rom:'+physical+':'+codeGeneration+':0');}
  if(identityGeneration!==codeGeneration){identityKinds.fill(0);identityGeneration=codeGeneration;}
  const version=codeVersions.get(page)||0,slot=physical&8191;
  if(identityKinds[slot]===kind&&identityPhysical[slot]===physical&&identityVersions[slot]===version)return identityKeys[slot];
  const key=(kind===1?'ram':'rom')+':'+physical+':'+codeGeneration+':'+version;
  identityKeys[slot]=key;identityPhysical[slot]=physical;identityVersions[slot]=version;identityKinds[slot]=kind;return key;
 }
 api.codeLocation=function(a){
  address(a);
  if(a<8192){const physical=a&2047,page=identityRamPages[physical>>>8];return {kind:'ram',physical,page,key:identityKey(1,physical,page)};}
  if(a>=24576&&a<32768&&ramEnabled()){const physical=2048+a-24576,page=identitySramPages[(a-24576)>>>8];return {kind:'ram',physical,page,key:identityKey(1,physical,page)};}
  if(a>=32768){const physical=mapPRG(a);if(physical>=0)return {kind:'rom',physical,key:identityKey(2,physical,undefined)};}
  return {kind:'unmapped',key:'unmapped'};
 };
 api.watchCode=fn=>{if(typeof fn!=='function')bad('BAD_ARGUMENT','Code listener');codeListeners.add(fn);return ()=>codeListeners.delete(fn);};
 const codeWrite=api.write;api.write=(a,v,t)=>{const before=api.codeLocation(a),old=before.kind==='ram'?api.peek(a):null;codeWrite(a,v,t);if(before.kind==='ram'&&api.codeLocation(a).physical===before.physical&&api.peek(a)!==old){const version=(codeVersions.get(before.page)||0)+1;if(!Number.isSafeInteger(version))bad('CODE_VERSION_OVERFLOW','RAM page epoch');codeVersions.set(before.page,version);for(const fn of codeListeners)fn(before.page);}};
 const codeLoad=api.loadRAM;api.loadRAM=(r,p)=>{codeLoad(r,p);if(++codeGeneration>=Number.MAX_SAFE_INTEGER)bad('CODE_VERSION_OVERFLOW','RAM generation');codeVersions.clear();for(const fn of codeListeners)fn(null);};
 const codeMapperLoad=api.loadMapperState;api.loadMapperState=v=>{codeMapperLoad(v);if(++codeGeneration>=Number.MAX_SAFE_INTEGER)bad('CODE_VERSION_OVERFLOW','Mapper restore generation');codeVersions.clear();for(const fn of codeListeners)fn(null);};
 api.checkpointCapture=()=>({ram,sram,chrRam:chrRAM?chrData:new Uint8Array(),mapper:getMapperState(),codeGeneration,codeVersions:[...codeVersions]});
 api.checkpointRestore=v=>{api.loadRAM(v.ram,v.sram);api.loadCHR(v.chrRam);loadMapperState(v.mapper);version=v.mapper.version;integer(v.codeGeneration,Number.MAX_SAFE_INTEGER-1,'Code generation');codeGeneration=v.codeGeneration;codeVersions.clear();if(!Array.isArray(v.codeVersions)||v.codeVersions.length>40)bad('BAD_CHECKPOINT','Code versions');for(const [page,n] of v.codeVersions){if(typeof page!=='string'||!(/^(ram:[0-7]|sram:([0-9]|[12][0-9]|3[01]))$/).test(page))bad('BAD_CHECKPOINT','Code page');integer(n,Number.MAX_SAFE_INTEGER-1,'Code page epoch');codeVersions.set(page,n);}identityKinds.fill(0);identityGeneration=-1;romIdentityGeneration=-1;};
 return Object.freeze(api);
}
// Generic fixed-property lookup; no mapping result or validation is cached.
function windowBank(m,w){switch(w){case 0:return m.w0;case 1:return m.w1;case 2:return m.w2;case 3:return m.w3;default:return undefined;}}
function makeCPU(bus,blocks,info){return makeTimedCPU(bus,blocks,info,CPUError);}

function bindOwnedPPU(base,e){const record=ownedBuses.get(base);if(!record?.bindPPU)throw Error('Unowned PPU bus');return record.bindPPU(e);}
return Object.freeze(Object.defineProperties(Object.create(null),{"bindOwnedPPU":{enumerable:true,get:()=>bindOwnedPPU},"CPUError":{enumerable:true,get:()=>CPUError},"fromHex":{enumerable:true,get:()=>fromHex},"composeBus":{enumerable:true,get:()=>composeBus},"makeBus":{enumerable:true,get:()=>makeBus},"makeCPU":{enumerable:true,get:()=>makeCPU}}));
}
