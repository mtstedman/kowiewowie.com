// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const composeBus=imports[0]["composeBus"];
const createCPU=imports[1]["createCPU"];
const createBus=imports[1]["createBus"];
const getCHR=imports[1]["getCHR"];
const metadata=imports[1]["metadata"];
const PPU=imports[2]["PPU"];
const PAPU=imports[2]["PAPU"];
const DeviceRegisters=imports[2]["Mapper0"];
const Controller=imports[2]["Controller"];




const limitations=Object.freeze(['MMC1 exact write scheduling, incomplete read timing','JSNES scanline renderer; no active-render CHR/mirroring changes','SNROM address-dependent gates require rendering disabled','bounded approximate DMA; no overlapping DMA','volatile RAM and deterministic startup']);
class MachineError extends Error {constructor(code,message){super(message);this.code=code;this.name='MachineError';}}
const bad=(c,m)=>{throw new MachineError(c,m);};
const int=(v,lo,hi,n)=>{if(!Number.isSafeInteger(v)||v<lo||v>hi)bad('BAD_ARGUMENT',n);return v;};
const object=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))bad('BAD_ARGUMENT','Unexpected options');};
function createMachine(options={}) {
 const mmc=metadata.mapper===1,ux=metadata.mapper===2,banked=metadata.mapper!==0,chrRAM=getCHR().length===0,sampleRate=48000,capacity=16384;
 let registers,nes,cpu,base,bus,facade,cycles,frames,metrics,fault,video,audio,head,count,pendingOam,pendingDmc,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset;
 function active(){const p=nes.ppu;return Boolean(p.f_bgVisibility||p.f_spVisibility)&&p.scanline>=20&&p.scanline<=260;}
 function gateSupported(){if(mmc&&metadata.mmc1.wiring==='SNROM'&&active()){const s=base.getMapperState();if((s.control&16)&&((s.chr0^s.chr1)&16))bad('UNSUPPORTED_SNROM_RENDER_GATE','JSNES does not expose exact rendering PPU A12; unequal SNROM gates require rendering disabled');}}
 function audioSample(l,r){if(!Number.isFinite(l)||!Number.isFinite(r))bad('DEVICE_AUDIO','Nonfinite sample');if(count===capacity){head=(head+1)%capacity;count--;metrics.audioDropped++;}const i=((head+count)%capacity)*2;audio[i]=l;audio[i+1]=r;count++;metrics.audioSamples++;}
 function latch(){for(let i=0;i<2;i++){latches[i]=nes.controllers[i+1].state.map(v=>v&1);positions[i]=0;}}
 function readIO(a){
  if(a>=0x6000&&a<0x8000)return facade.dataBus;
  if(a>=0x4018)bad('UNSUPPORTED_EXPANSION','Expansion address '+a);
  if(a===0x4016||a===0x4017){const i=a-0x4016,v=strobe?(nes.controllers[i+1].state[0]&1):positions[i]<8?latches[i][positions[i]++]:1;return (facade.dataBus&0xe0)|v;}
  return nes.mmap.regLoad(a);
 }
 function peekIO(a){if(a>=0x6000&&a<0x8000)return facade.dataBus;bad('UNSUPPORTED_PEEK','Device peek is unsupported');}
 function writeIO(a,v){
  if(a>=0x6000&&a<0x8000)return;
  if(a>=0x4018)bad('UNSUPPORTED_EXPANSION','Expansion address '+a);
  if(a===0x4014){if(pendingOam!==null)bad('UNSUPPORTED_MULTIPLE_DMA','Multiple OAM requests in one instruction');pendingOam=v;return;}
  if(a===0x4016){const next=Boolean(v&1);if(next||strobe)latch();strobe=next;return;}
  if(a===0x4017){const p=nes.papu;p.frameIrqEnabled=!(v&64);if(v&64){p.frameIrqActive=false;p.frameIrqClearPending=false;}frameReset={at:cycles+1+((p.apuCycleParity&1)?3:4),mode:(v>>7)&1};return;}
  nes.mmap.regWrite(a<0x4000?0x2000+(a&7):a,v);gateSupported();
 }
 function captureNMI(){if(facade.nmiRaised||facade.nmiPending){nmiQueued=true;facade.nmiRaised=false;facade.nmiPending=false;metrics.nmiEdges++;}}
 function sync(){if(!cpu||busy)return;captureNMI();if(nmiQueued){cpu.requestNMI();nmiQueued=false;}cpu.setIRQ(Boolean((nes.papu.frameIrqEnabled&&nes.papu.frameIrqActive)||nes.papu.dmc.irqGenerated));}
 function clockTo(target){
  int(target,cycles,Number.MAX_SAFE_INTEGER-8192,'clock target');if(target-cycles>8192)bad('CLOCK_LIMIT','Clock advance exceeds bound');
  while(cycles<target){
   gateSupported();nes.ppu.advanceDots(3);nes.papu.clockFrameCounter(1);cycles++;facade._cpuCycleBase=cycles;captureNMI();
   if(frameReset&&cycles>=frameReset.at){const p=nes.papu;p.countSequence=frameReset.mode;p.frameCycleCounter=0;p.frameStep=0;if(frameReset.mode){p.clockQuarterFrame();p.clockHalfFrame();}frameReset=null;}
   if(nes.ppu.frameEnded){nes.ppu.frameEnded=false;nes.controllers[1].clock();nes.controllers[2].clock();nes.ppu.startFrame();}
   if(mmc&&!active()){nes.ppu.cntsToAddress();base.setPPUAddress(nes.ppu.vramAddress&16383);}
  }
 }
 function completeClock(t){clockTo(t);base.advanceCPUClock(t);metrics.clockCompletions++;}
 function idle(n){clockTo(cycles+n);if(mmc)base.advanceCPUClock(cycles);}
 function palAddress(a){let i=a&31;if((i&19)===16)i&=15;return 0x3f00+i;}
 function ppuPeek(a){a&=16383;if(a<8192)return base.peekCHR(a);if(a<0x3f00)return ciram[base.mapNametable(a)];return nes.ppu.vramMem[palAddress(a)];}
 function patternRefresh(){const p=nes.ppu;for(let i=0;i<8192;i++)p.vramMem[i]=base.peekCHR(i);for(let i=0;i<512;i++){const t=p.ptTile[i];for(let row=0;row<8;row++){t.opaque[row]=1;t.setScanline(row,p.vramMem[i*16+row],p.vramMem[i*16+row+8]);}}p.validTileData=false;metrics.chrRefreshes++;}
 function mappingRefresh(force=false){
  const current=[base.mapCHR(0),base.mapCHR(4096)],mode=base.getMirroring(),changed=force||!chrMap||current.some((v,i)=>v!==chrMap[i])||mode!==mirror;
  if(!changed)return;
  if(!force&&active())bad('UNSUPPORTED_RASTER_MAPPING','CHR/CIRAM mapping changed during rendering; reset required');
  const p=nes.ppu;chrMap=current;mirror=mode;p.ntable1=Array.from({length:4},(_,i)=>base.mapNametable(0x2000+i*1024)>>10);
  p.currentMirroring={vertical:0,horizontal:1,four_screen:2,single_lower:3,single_upper:4}[mode];patternRefresh();p.validTileData=false;metrics.mirroringUpdates++;
 }
 function ppuRead(a){a&=16383;base.setPPUAddress(a);return a<8192?base.ppuRead(a):ppuPeek(a);}
 function ppuWrite(a,v){
  a&=16383;base.setPPUAddress(a);const p=nes.ppu;
  if(a<8192){base.ppuWrite(a,v);if(chrRAM){const physical=base.mapCHR(a);for(let half=0;half<2;half++){const logical=half*4096+(a&4095);if(base.mapCHR(logical)===physical){p.vramMem[logical]=base.peekCHR(logical);p.ptTile[logical>>4].opaque[logical&7]=1;p.patternWrite(logical,p.vramMem[logical]);}}p.validTileData=false;}return;}
  if(a<0x3f00){const physical=base.mapNametable(a),page=physical>>10,offset=physical&1023;ciram[physical]=v;const nt=p.nameTable[page];nt.tile[offset]=v;if(offset>=960)nt.writeAttrib(offset-960,v);p.validTileData=false;return;}
  const address=palAddress(a);p.vramMem[address]=v&63;if((address&3)===0)p.vramMem[address^16]=v&63;p.updatePalettes();
 }
 function installPPU(){
  const p=nes.ppu;
  for(const n of ['advanceDots','startFrame','patternWrite','cntsToAddress','cntsFromAddress','regsToAddress','regsFromAddress','_incrementVramAddress','triggerRendering'])if(typeof p[n]!=='function')bad('DEVICE_CONTRACT','Missing PPU method '+n);
  p.mirroredLoad=a=>ppuPeek(a);p.mirroredWrite=(a,v)=>ppuWrite(a,v);
  const originalAddress=p.writeVRAMAddress.bind(p);
  p.writeVRAMAddress=v=>{if(active())bad('UNSUPPORTED_RENDER_VRAM','PPUADDR during active rendering');originalAddress(v);p.cntsToAddress();base.setPPUAddress(p.vramAddress&16383);};
  function finishAccess(){p._incrementVramAddress();p.vramAddress&=32767;p.cntsFromAddress();p.regsFromAddress();base.setPPUAddress(p.vramAddress&16383);}
  p.vramLoad=()=>{if(active())bad('UNSUPPORTED_RENDER_VRAM','PPUDATA during active rendering');p.cntsToAddress();p.regsToAddress();const a=p.vramAddress&16383;let v;if(a<0x3f00){v=p.vramBufferedReadValue;p.vramBufferedReadValue=ppuRead(a);}else{v=(ppuPeek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&0xc0);p.vramBufferedReadValue=ppuRead(a&0x2fff);}finishAccess();p.openBusLatch=v;p.openBusDecayFrames=36;return v;};
  p.vramWrite=v=>{if(active())bad('UNSUPPORTED_RENDER_VRAM','PPUDATA during active rendering');p.triggerRendering();p.cntsToAddress();p.regsToAddress();ppuWrite(p.vramAddress,v);finishAccess();};
  nes.mmap.latchAccess=()=>{};mappingRefresh(true);
 }
 function writeCPU(a,v,t,dma=false){
  if(mmc){int(t,cycles,Number.MAX_SAFE_INTEGER-8192,'absolute write cycle');clockTo(t);}gateSupported();
  const cartridge=banked&&a>=32768,before=cartridge?base.getMapperState():null,visible=cartridge?base.peek(a):null,effective=ux&&cartridge&&metadata.uxrom.bus_conflicts==='and'?(v&visible):v;
  if(mmc&&cartridge)nes.ppu.triggerRendering();base.write(a,v,t);facade.dataBus=effective;
  if(!dma){const w={address:a,value:v,cycle:mmc?t:null,deviceCycle:cycles};stepWrites.push(w);if(stepWrites.length>8)bad('DEVICE_CONTRACT','Unexpected CPU write count');lastWrites.push(w);if(lastWrites.length>32)lastWrites.shift();}
  if(cartridge){metrics.mapperWrites++;writes.push({address:a,value:v,visible,effective,cycle:mmc?t:null,before,after:base.getMapperState()});if(writes.length>16)writes.shift();if(mmc){mappingRefresh();gateSupported();}}
 }
 function initialize(o={}){
  object(o,['startPC']);if(o.startPC!==undefined)int(o.startPC,32768,65535,'startPC');
  if(metadata.apiVersion!==3||metadata.runtimeRevision!=='fetch-epoch-2'||![0,1,2].includes(metadata.mapper)||metadata.region!=='ntsc'||metadata.scan_complete!==true)bad('UNSUPPORTED_CARTRIDGE','Requires complete compiler API3 fetch-epoch-2 NTSC output');
  cpu=null;base=null;fault=null;cycles=0;frames=0;head=0;count=0;pendingOam=null;pendingDmc=0;strobe=false;latches=[Array(8).fill(0),Array(8).fill(0)];positions=[0,0];writes=[];lastWrites=[];stepWrites=[];chrMap=null;mirror=null;busy=false;nmiQueued=false;frameReset=null;
  video=new Uint32Array(61440);audio=new Float32Array(capacity*2);ciram=new Uint8Array(metadata.mirroring==='four_screen'?4096:2048);
  metrics={translatedInstructions:0,nmiEntries:0,irqEntries:0,nmiEdges:0,oamTransfers:0,oamCycles:0,dmcRequests:0,dmcCycles:0,audioSamples:0,audioDropped:0,interpreterCalls:0,mapperWrites:0,clockCompletions:0,chrRefreshes:0,mirroringUpdates:0,bankInstructions:Array(mmc?metadata.prgBanks*2:ux?metadata.prgBanks+1:1).fill(0)};
  registers=new Uint8Array(65536);const numeric=k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<65536;
  const mem=new Proxy(Object.create(null),{get(t,k){if(k==='length')return 65536;if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view property');const a=Number(k);return base&&(a<8192||a>=24576)?base.peek(a):registers[a];},set(t,k,v){if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view write');const a=Number(k);int(v,0,255,'device byte');if(a<8192||a>=24576)bad('DEVICE_CONTRACT','Device attempted an untimed cartridge/RAM write');registers[a]=v;return true;}});
  const f={mem,dataBus:0,instrBusCycles:0,apuCatchupCycles:0,_cpuCycleBase:0,_dmcFetchCycles:0,nmiRaised:false,nmiPending:false,nmiRaisedAtCycle:0,nmiDotsRemainingInStep:0,IRQ_NORMAL:0,IRQ_NMI:1,IRQ_RESET:2,
   requestIrq(k){if(k===0)return;if(k===1){f.nmiPending=true;return;}bad('DEVICE_IRQ','Unexpected IRQ/reset request');},
   haltCycles(n){if(n!==4)bad('DEVICE_DMA','Only four-cycle DMC requests accepted');pendingDmc+=n;metrics.dmcRequests++;if(pendingDmc>4096)bad('DMA_LIMIT','Excessive DMC stalls');},
   emulate(){metrics.interpreterCalls++;bad('CPU_INTERPRETER_FORBIDDEN','Translated CPU execution is mandatory');}};
  // Device fields are fixed by the bundled device contract; avoid Proxy traps on every CPU cycle.
  facade=Object.seal(f);
  nes={cpu:facade,opts:{sampleRate,emulateSound:true,onAudioSample:audioSample,onBatteryRamWrite(){}},ui:{writeFrame(p){if(p.length!==61440)bad('DEVICE_VIDEO','Framebuffer length');video.set(p);frames++;},updateStatus(){}},controllers:{1:new Controller(),2:new Controller()},rom:{VERTICAL_MIRRORING:0,HORIZONTAL_MIRRORING:1,FOURSCREEN_MIRRORING:2,SINGLESCREEN_MIRRORING:3,SINGLESCREEN_MIRRORING2:4,vromCount:getCHR().length/4096}};
  nes.mmap=new DeviceRegisters(nes);nes.ppu=new PPU(nes);nes.papu=new PAPU(nes);base=createBus({read:readIO,write:writeIO,peek:peekIO});
  const b={read(a){facade.instrBusCycles++;gateSupported();const v=base.read(a);facade.dataBus=v;return v;},write(a,v,t){facade.instrBusCycles++;writeCPU(a,v,t);},peek:a=>base.peek(a),mapPRG:a=>base.mapPRG(a),getMapperState:()=>base.getMapperState()};
  if(mmc){b.getCPUClock=()=>base.getCPUClock();b.advanceCPUClock=completeClock;}bus=composeBus(base,{read:b.read,write:b.write,peek:b.peek,...(mmc?{advanceCPUClock:b.advanceCPUClock}:{})});
  nes.mmap.load=a=>{const v=base.read(a);facade.dataBus=v;return v;};
  for(const name of ['loadROM','loadPRGROM','loadCHRROM','loadBatteryRam','loadRomBank','load32kRomBank','load8kRomBank','loadVromBank','load8kVromBank','load1kVromBank','load2kVromBank','write','writelow'])nes.mmap[name]=()=>bad('DEVICE_CONTRACT','Compiler owns cartridge and timed writes');
  nes.ppu.clipToTvSize=false;installPPU();nes.ppu.startFrame();busy=true;
  try{cpu=createCPU(bus);if(!mmc)clockTo(7);}finally{busy=false;}
  if(o.startPC!==undefined)cpu.setState({pc:o.startPC});facade.instrBusCycles=0;sync();return state();
 }
 function state(){return {cpu:cpu.getState(),cycles,cartridgeClock:mmc?base.getCPUClock():null,frames,sampleRate,fault,dataBus:facade.dataBus,mapper:base.getMapperState(),mapperWrites:writes.map(w=>({...w,before:{...w.before},after:{...w.after}})),cpuWrites:lastWrites.map(w=>({...w})),metrics:{...metrics,bankInstructions:metrics.bankInstructions.slice()},ppu:{scanline:nes.ppu.scanline,dot:nes.ppu.curX,status:facade.mem[0x2002],mirroring:mirror,chrOffsets:chrMap.slice()},apu:{frameIRQ:nes.papu.frameIrqActive,dmcIRQ:nes.papu.dmc.irqGenerated,dmcLastByte:nes.papu.dmc.lastFetchedByte}};}
 function healthy(){if(fault)bad('MACHINE_FAULTED','Reset required after '+fault);}
 function drain(){
  let stalled=0;
  if(pendingOam!==null){
   if(nes.papu.dmc.isEnabled||pendingDmc)bad('UNSUPPORTED_DMA_COLLISION','OAM and DMC overlap');if(active())bad('UNSUPPORTED_RENDER_DMA','OAM during active rendering');
   const page=pendingOam;pendingOam=null;const delay=1+(cycles&1);idle(delay);stalled+=delay;
   for(let i=0;i<256;i++){if(active())bad('UNSUPPORTED_RENDER_DMA','OAM crosses into active rendering');const v=base.read((page<<8)|i);facade.dataBus=v;idle(1);writeCPU(0x2004,v,mmc?cycles:undefined,true);idle(1);stalled+=2;}
   metrics.oamTransfers++;metrics.oamCycles+=stalled;
  }
  let drained=0;while(pendingDmc){if(drained>=4096)bad('DMA_LIMIT','DMC drain exceeds bound');pendingDmc--;idle(1);drained++;stalled++;}
  metrics.dmcCycles+=drained;if(stalled)cpu.setState({cycles:cpu.getState().cycles+stalled});return stalled;
 }
 function invariant(){const s=cpu.getState();if(s.instructions!==metrics.translatedInstructions||s.cycles!==cycles||(mmc&&base.getCPUClock()!==cycles))bad('CPU_PROVENANCE','CPU/device/cartridge counters differ');}
 function step(trace=true){
  healthy();try{
   const before=cycles;facade.instrBusCycles=0;facade.apuCatchupCycles=0;facade._cpuCycleBase=cycles;stepWrites=[];sync();
   const pc=cpu.getPC(),mappingBefore=trace?base.getMapperState():null,physicalPC=pc>=32768?base.mapPRG(pc):null;
   busy=true;let r;try{r=cpu.step();}finally{busy=false;}if(!mmc)clockTo(before+r.cycles);
   if(r.kind==='instruction'){metrics.translatedInstructions++;const bank=physicalPC===null?0:physicalPC>>>14,index=mmc?(pc<49152?bank:metadata.prgBanks+bank):ux?(pc<49152?bank:metadata.prgBanks):0;metrics.bankInstructions[index]++;}else if(r.kind==='nmi')metrics.nmiEntries++;else if(r.kind==='irq')metrics.irqEntries++;
   drain();sync();if(trace){invariant();return {kind:r.kind,pc:r.pc,cycles:cycles-before,physicalPC,mappingBefore,mappingAfter:base.getMapperState(),writes:stepWrites.map(w=>({...w}))};}
  }catch(e){busy=false;fault=e.code||'DEVICE_ERROR';throw e;}
 }
 function resetCPU(){healthy();try{const before=cycles;stepWrites=[];busy=true;try{cpu.reset();}finally{busy=false;}if(!mmc)clockTo(before+7);drain();sync();invariant();return state();}catch(e){fault=e.code||'DEVICE_ERROR';throw e;}}
 function execute(o,target){object(o,['maxSteps','maxCycles','maxMs']);healthy();const maxSteps=int(o.maxSteps??20000,1,100000,'maxSteps'),maxCycles=int(o.maxCycles??40000,1,1000000,'maxCycles'),maxMs=int(o.maxMs??250,1,60000,'maxMs'),start=performance.now(),initial=cycles;let steps=0,pollRemaining=0,reason='steps';while(steps<maxSteps){if(cycles-initial>=maxCycles){reason='cycles';break;}if(pollRemaining===0){if(performance.now()-start>=maxMs){reason='time';break;}pollRemaining=32;}pollRemaining--;step(false);steps++;if(target!==null&&frames>=target){reason='frame';break;}}invariant();return {steps,cycles:cycles-initial,reason,frames,state:state()};}
 function memory(a,n,device){int(a,0,65535,'address');int(n,1,4096,'length');if(a+n>65536)bad('BAD_ARGUMENT','memory range');const r=new Uint8Array(n);for(let i=0;i<n;i++){const p=a+i;if(p>=8192&&p<24576)bad('UNSUPPORTED_PEEK','I/O requires snapshots');r[i]=device?facade.mem[p]:base.peek(p);}return r;}
 function checkpointCapture(){healthy();if(busy)bad('CHECKPOINT_BUSY','Instruction in progress');invariant();return {machine:{cycles,frames,metrics,fault,video,audio,head,count,pendingOam,pendingDmc,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset},registers,nes,cpu:cpu.checkpointCapture(),base:base.checkpointCapture()};}
 function checkpointRestore(v){({cycles,frames,metrics,fault,video,audio,head,count,pendingOam,pendingDmc,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset}=v.machine);registers=v.registers;nes=v.nes;facade=nes.cpu;base.checkpointRestore(v.base);cpu.checkpointRestore(v.cpu);healthy();invariant();}
 initialize(options);
 return Object.freeze({checkpointCapture,checkpointRestore,reset:initialize,resetCPU,step,advance:(o={})=>execute(o,null),frame(o={}){const r=execute(o,frames+1);if(r.reason!=='frame')bad('FRAME_BUDGET','Frame incomplete at '+r.reason);return r;},getState:state,
 setButton(port,button,down){int(port,1,2,'port');int(button,0,7,'button');if(typeof down!=='boolean')bad('BAD_ARGUMENT','down');nes.controllers[port][down?'buttonDown':'buttonUp'](button);if(strobe)latch();},
 getFrame:()=>video.slice(),getRGBA(buffer){if(buffer!==undefined&&(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==245760))bad('BAD_ARGUMENT','RGBA buffer size');const a=buffer?new Uint8ClampedArray(buffer):new Uint8ClampedArray(245760);for(let i=0;i<video.length;i++){const v=video[i];a[i*4]=v&255;a[i*4+1]=(v>>>8)&255;a[i*4+2]=(v>>>16)&255;a[i*4+3]=255;}return a;},
 audioLength(){return count*2;},
 takeAudio(buffer){const a=buffer instanceof ArrayBuffer&&buffer.byteLength===count*8?new Float32Array(buffer):new Float32Array(count*2);for(let i=0;i<count;i++){const j=((head+i)%capacity)*2;a[i*2]=audio[j];a[i*2+1]=audio[j+1];}head=0;count=0;return a;},
 readMemory:(a,n=1)=>memory(a,n,false),readDeviceMemory:(a,n=1)=>memory(a,n,true),readPPUMemory(a,n=1){int(a,0,16383,'PPU address');int(n,1,4096,'PPU length');if(a+n>16384)bad('BAD_ARGUMENT','PPU range');return Uint8Array.from({length:n},(_,i)=>ppuPeek(a+i));},getOAM:()=>nes.ppu.spriteMem.slice(),
 getPPUCache(){return {tile0:nes.ppu.ptTile[0].pix.slice(),tile256:nes.ppu.ptTile[256].pix.slice(),nametablePages:nes.ppu.ntable1.slice(),physicalTile0:nes.ppu.nameTable.slice(0,ciram.length/1024).map(t=>t.tile[0])};},
 checkInterpreterGuard(){try{facade.emulate();}catch(e){if(e.code==='CPU_INTERPRETER_FORBIDDEN')return true;throw e;}bad('CPU_PROVENANCE','Interpreter guard failed');}
 });
}

return Object.freeze(Object.defineProperties(Object.create(null),{"metadata":{enumerable:true,get:()=>metadata},"limitations":{enumerable:true,get:()=>limitations},"MachineError":{enumerable:true,get:()=>MachineError},"createMachine":{enumerable:true,get:()=>createMachine}}));
}
