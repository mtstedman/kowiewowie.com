// Posse reusable MMC2 machine factory composed from current shared engine devices.
export function instantiate(imports){
"use strict";
const createOwnedInstance=imports[0]["createOwnedInstance"];
const installOwnedDotPPU=imports[0]["installOwnedDotPPU"];
const createDMA=imports[1]["createDMA"];
const installDMC=imports[1]["installDMC"];
const composeBus=imports[2]["composeBus"];
const bindMachineStep=imports[2]["bindMachineStep"];
const bindOwnedPPU=imports[2]["bindOwnedPPU"];
const installDotPPU=imports[3]["installDotPPU"];
const createCPU=imports[4]["createCPU"];
const createBus=imports[4]["createBus"];
const getCHR=imports[4]["getCHR"];
const metadata=imports[4]["metadata"];
const PPU=imports[5]["PPU"];
const PAPU=imports[5]["PAPU"];
const DeviceRegisters=imports[5]["Mapper0"];
const Controller=imports[5]["Controller"];
const mediaLittleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;

const limitations=Object.freeze([
 "No ROM execution, browser interaction, measured performance or full-game correctness is established by this inactive candidate.",
 "Official immutable-PRG CPU instructions only; unofficial opcodes, RAM execution and operands wrapping FFFF into RAM trap.",
 "The shared DMA/DMC/APU graph and prefetched-cycle CPU contract are wired. Interrupt polling remains instruction-boundary approximate and hardware equivalence is not established.",
 "The shared dot renderer still batches sprite selection at dot 257; sprite overflow timing, analog behavior and sub-dot register effects remain approximate or unsupported.",
 "An MMC2 owned PPU is used only when the supplied mapper-9 owned instance is available. The JS dot PPU is the explicit null-instance fallback; real compiled Wasm frame equality remains host qualification work.",
 "Only mapper 9 PNROM-style geometry, NTSC, compiler API3 fetch-epoch-2 output and explicit operational startup policy are accepted. NES 2.0 submapper variants, outer banking, expansion devices, PAL and non-power-of-two geometries are unsupported.",
 "Active-render OAM writes remain an explicit failure boundary. Full-machine checkpoints include CPU, PPU, mapper, APU and pending DMA; battery persistence remains a separate shared cartridge-identity concern.",
 "Site publication requires an authenticated mmc2-dot/1 admission and actual gameplay/browser qualification."
]);
class MachineError extends Error {constructor(code,message){super(message);this.code=code;this.name='MachineError';}}
const bad=(c,m)=>{throw new MachineError(c,m);};
const int=(v,lo,hi,n)=>{if(!Number.isSafeInteger(v)||v<lo||v>hi)bad('BAD_ARGUMENT',n);return v;};
const object=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))bad('BAD_ARGUMENT','Unexpected options');};
const copy=x=>{if(ArrayBuffer.isView(x))return x.slice();if(Array.isArray(x))return x.map(copy);if(x&&typeof x==='object'){const q={};for(const [k,v] of Object.entries(x))q[k]=copy(v);return q;}return x;};
function createMachine(options={}) {
 let clockPPU,observePPU=()=>{},ownedPPU=false;
 let dma,dmaDmc,dmaCpuCycles=0,cpuStep;
 const chrRAM=getCHR().length===0,sampleRate=48000,capacity=16384,checkpointOwner=Object.freeze({});
 let registers,nes,cpu,base,bus,facade,cycles,frames,metrics,fault,video,audio,head,count,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset,tracing=false;
 function active(){observePPU();const p=nes.ppu;return Boolean(p.f_bgVisibility||p.f_spVisibility)&&p.scanline>=20&&p.scanline<=260;}
 function gateSupported(){}
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
  if(a===0x4014){dma.requestOam(v);return;}
  if(a===0x4016){const next=Boolean(v&1);if(next||strobe)latch();strobe=next;return;}
  if(a===0x4017){const p=nes.papu;p.frameIrqEnabled=!(v&64);if(v&64){p.frameIrqActive=false;p.frameIrqClearPending=false;}frameReset={at:cycles+1+((p.apuCycleParity&1)?3:4),mode:(v>>7)&1};return;}
  nes.mmap.regWrite(a<0x4000?0x2000+(a&7):a,v);gateSupported();
 }
 function captureNMI(){if(facade.nmiRaised||facade.nmiPending){nmiQueued=true;facade.nmiRaised=false;facade.nmiPending=false;metrics.nmiEdges++;}}
 function sync(){if(!cpu||busy)return;captureNMI();if(nmiQueued){cpu.requestNMI();nmiQueued=false;}cpu.setIRQ(Boolean((nes.papu.frameIrqEnabled&&nes.papu.frameIrqActive)||nes.papu.dmc.irqGenerated));}
 function tickCycle(){
  gateSupported();clockPPU();dmaDmc.tick();nes.papu.clockFrameCounter(1);cycles++;facade._cpuCycleBase=cycles;captureNMI();
  if(frameReset&&cycles>=frameReset.at){const p=nes.papu;p.countSequence=frameReset.mode;p.frameCycleCounter=0;p.frameStep=0;if(frameReset.mode){p.clockQuarterFrame();p.clockHalfFrame();}frameReset=null;}
  if(nes.ppu.frameEnded){nes.ppu.frameEnded=false;nes.controllers[1].clock();nes.controllers[2].clock();nes.ppu.startFrame();}
 }
 function clockTo(target){
  if(!((target===cycles||target===cycles+1)&&target<=Number.MAX_SAFE_INTEGER-8192)){int(target,cycles,Number.MAX_SAFE_INTEGER-8192,'clock target');if(target-cycles>8192)bad('CLOCK_LIMIT','Clock advance exceeds bound');}
  while(cycles<target)tickCycle();
 }
 function completeClock(t){clockTo(t);base.advanceCPUClock(t);metrics.clockCompletions++;}
 function palAddress(a){let i=a&31;if((i&19)===16)i&=15;return 0x3f00+i;}
 function ppuPeek(a){a&=16383;if(a<8192)return base.peekCHR(a);if(a<0x3f00)return ciram[base.mapNametable(a)];return nes.ppu.vramMem[palAddress(a)];}
 function patternRefresh(){const p=nes.ppu;for(let i=0;i<8192;i++)p.vramMem[i]=base.peekCHR(i);for(let i=0;i<512;i++){const t=p.ptTile[i];for(let row=0;row<8;row++){t.opaque[row]=1;t.setScanline(row,p.vramMem[i*16+row],p.vramMem[i*16+row+8]);}}p.validTileData=false;metrics.chrRefreshes++;}
 function mappingRefresh(force=false){
  const current=Array.from({length:8},(_,i)=>base.mapCHR(i*1024)),mode=base.getMirroring(),changed=force||!chrMap||current.some((v,i)=>v!==chrMap[i])||mode!==mirror;
  chrMap=current;mirror=mode;if(!changed||ownedPPU)return;
  const p=nes.ppu;p.ntable1=Array.from({length:4},(_,i)=>base.mapNametable(0x2000+i*1024)>>10);p.currentMirroring={vertical:0,horizontal:1,four_screen:2,single_lower:3,single_upper:4}[mode];patternRefresh();p.validTileData=false;metrics.mirroringUpdates++;
 }
 function setPPUAddress(a,t){const before=ownedPPU?null:base.getMapperState();base.setPPUAddress(a,t);if(!ownedPPU){const after=base.getMapperState();if(before.latch0!==after.latch0||before.latch1!==after.latch1)mappingRefresh();}}
 function ppuRead(a){a&=16383;setPPUAddress(a);return a<8192?base.peekCHR(a):ppuPeek(a);}
 // The owned installer drives the mapper address before fetching; do not strobe it twice and commit an MMC2 latch before the triggering byte is read.
 function ppuFetch(a){return ppuPeek(a);}
 function ppuWrite(a,v){
  a&=16383;const p=nes.ppu;
  if(a<8192){const before=ownedPPU?null:base.getMapperState();base.ppuWrite(a,v);if(!ownedPPU){const after=base.getMapperState();if(before.latch0!==after.latch0||before.latch1!==after.latch1)mappingRefresh();if(chrRAM){const physical=base.mapCHR(a);for(let half=0;half<8;half++){const logical=half*1024+(a&1023);if(base.mapCHR(logical)===physical){p.vramMem[logical]=base.peekCHR(logical);p.ptTile[logical>>4].opaque[logical&7]=1;p.patternWrite(logical,p.vramMem[logical]);}}p.validTileData=false;}}return;}
  setPPUAddress(a);
  if(a<0x3f00){const physical=base.mapNametable(a),page=physical>>10,offset=physical&1023;ciram[physical]=v;const nt=p.nameTable[page];nt.tile[offset]=v;if(offset>=960)nt.writeAttrib(offset-960,v);p.validTileData=false;return;}
  const address=palAddress(a);p.vramMem[address]=v&63;if((address&3)===0)p.vramMem[address^16]=v&63;p.updatePalettes();
 }
 function installPPU(){
  observePPU=()=>{};clockPPU=()=>nes.ppu.advanceDots(3);mappingRefresh(true);
  const e=createOwnedInstance();
  if(!e){installDotPPU(nes,base,ppuPeek,ppuWrite);return;}
  if(!e.memory||typeof e.owned_ciram!=='function'||typeof e.owned_vram!=='function'||typeof e.owned_framebuffer!=='function')bad('DEVICE_CONTRACT','Owned MMC2 PPU ABI unavailable');
  const c=new Uint8Array(e.memory.buffer,e.owned_ciram(),ciram.length);c.set(ciram);ciram=c;
  const vram=new Uint8Array(e.memory.buffer,e.owned_vram(),32768);vram.set(nes.ppu.vramMem);nes.ppu.vramMem=vram;
  const frame=new Uint32Array(e.memory.buffer,e.owned_framebuffer(),61440);frame.set(nes.ppu.buffer);nes.ppu.buffer=frame;
  const binding=bindOwnedPPU(base,e);ownedPPU=true;const owner=installOwnedDotPPU(nes,base,ppuPeek,ppuWrite,e,binding,ppuFetch);if(!owner||typeof owner.clockThree!=='function'||typeof owner.publishPosition!=='function')bad('DEVICE_CONTRACT','Owned PPU installer contract');clockPPU=owner.clockThree;observePPU=owner.publishPosition;
 }
 function writeCPU(a,v,t,dmaWrite=false){
  int(t,cycles,Number.MAX_SAFE_INTEGER-8192,'absolute write cycle');clockTo(t);
  const cartridge=a>=32768,before=tracing&&cartridge?base.getMapperState():null,visible=tracing&&cartridge?base.peek(a):null;
  base.write(a,v,t);facade.dataBus=v;
  if(tracing&&!dmaWrite){const w={address:a,value:v,cycle:t,deviceCycle:cycles};stepWrites.push(w);if(stepWrites.length>8)bad('DEVICE_CONTRACT','Unexpected CPU write count');lastWrites.push(w);if(lastWrites.length>32)lastWrites.shift();}
  if(cartridge){metrics.mapperWrites++;if(tracing){writes.push({address:a,value:v,visible,effective:v,cycle:t,before,after:base.getMapperState()});if(writes.length>16)writes.shift();}if(a>=0xa000)mappingRefresh();}
 }
 function initialize(o={}){
  object(o,['startPC']);if(o.startPC!==undefined)int(o.startPC,32768,65535,'startPC');
  if(metadata.apiVersion!==3)bad('UNSUPPORTED_CARTRIDGE','Requires compiler API3 output');
  if(metadata.runtimeRevision!=='fetch-epoch-2')bad('UNSUPPORTED_CARTRIDGE','Requires fetch-epoch-2 output');
  if(metadata.mapper!==9)bad('UNSUPPORTED_CARTRIDGE','Requires mapper 9 MMC2 output');
  if(metadata.region!=='ntsc')bad('UNSUPPORTED_CARTRIDGE','Requires NTSC output');
  if(metadata.scan_complete!==true)bad('UNSUPPORTED_CARTRIDGE','Requires a complete compiler scan');
  cpu=null;base=null;fault=null;cycles=0;frames=0;head=0;count=0;dmaCpuCycles=0;strobe=false;latches=[Array(8).fill(0),Array(8).fill(0)];positions=[0,0];writes=[];lastWrites=[];stepWrites=[];chrMap=null;mirror=null;busy=false;nmiQueued=false;frameReset=null;ownedPPU=false;
  video=new Uint32Array(61440);audio=new Float32Array(capacity*2);ciram=new Uint8Array(metadata.mirroring==='four_screen'?4096:2048);
  metrics={translatedInstructions:0,nmiEntries:0,irqEntries:0,nmiEdges:0,audioSamples:0,audioDropped:0,interpreterCalls:0,mapperWrites:0,clockCompletions:0,chrRefreshes:0,mirroringUpdates:0,bankInstructions:Array(metadata.prgBanks*4).fill(0)};
  registers=new Uint8Array(65536);const numeric=k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<65536;
  const mem=new Proxy(Object.create(null),{get(t,k){if(k==='length')return 65536;if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view property');const a=Number(k);return base&&(a<8192||a>=24576)?base.peek(a):registers[a];},set(t,k,v){if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view write');const a=Number(k);int(v,0,255,'device byte');if(a<8192||a>=24576)bad('DEVICE_CONTRACT','Device attempted an untimed cartridge/RAM write');registers[a]=v;return true;}});
  const f={mem,dataBus:0,instrBusCycles:0,apuCatchupCycles:0,_cpuCycleBase:0,_dmcFetchCycles:0,nmiRaised:false,nmiPending:false,nmiRaisedAtCycle:0,nmiDotsRemainingInStep:0,IRQ_NORMAL:0,IRQ_NMI:1,IRQ_RESET:2,
   requestIrq(k){if(k===0)return;if(k===1){f.nmiPending=true;return;}bad('DEVICE_IRQ','Unexpected IRQ/reset request');},
   haltCycles(){bad('DEVICE_CONTRACT','Legacy immediate DMC fetch/stall is forbidden');},
   emulate(){metrics.interpreterCalls++;bad('CPU_INTERPRETER_FORBIDDEN','Translated CPU execution is mandatory');}};
  facade=Object.seal(f);
  nes={cpu:facade,opts:{sampleRate,emulateSound:true,onAudioSample:audioSample,onBatteryRamWrite(){}},ui:{writeFrame(p){if(p.length!==61440)bad('DEVICE_VIDEO','Framebuffer length');video.set(p);frames++;},updateStatus(){}},controllers:{1:new Controller(),2:new Controller()},rom:{VERTICAL_MIRRORING:0,HORIZONTAL_MIRRORING:1,FOURSCREEN_MIRRORING:2,SINGLESCREEN_MIRRORING:3,SINGLESCREEN_MIRRORING2:4,vromCount:getCHR().length/4096}};
  nes.mmap=new DeviceRegisters(nes);nes.ppu=new PPU(nes);nes.papu=new PAPU(nes);base=createBus({read:readIO,write:writeIO,peek:peekIO});
  dma=createDMA({cycle:()=>cycles,tick:tickCycle,read(a){gateSupported();const v=base.read(a);facade.dataBus=v;return v;},writeCPU:(a,v)=>writeCPU(a,v,cycles),writeOam(v){if(active())bad('UNSUPPORTED_RENDER_DMA','OAM during active rendering');nes.mmap.regWrite(0x2004,v);},getBus:()=>facade.dataBus,setBus:v=>{facade.dataBus=v;}});
  dmaDmc=installDMC(nes.papu.dmc,dma,()=>cycles);
  const dmaClockReceipt={cycle:0,accesses:0};
  const b={read(a){facade.instrBusCycles++;const v=dma.readCPU(a);dmaCpuCycles++;return v;},write(a,v,t){facade.instrBusCycles++;if(t!==cycles)bad('BAD_TIMING','CPU write clock mismatch');dma.writeCPU(a,v);dmaCpuCycles++;},peek:base.peek,mapPRG:a=>base.mapPRG(a),getMapperState:()=>base.getMapperState(),getCPUClock:()=>base.getCPUClock(),advanceCPUClock:completeClock};
  bus=composeBus(base,{dmaClock:()=>{dmaClockReceipt.cycle=cycles;dmaClockReceipt.accesses=dmaCpuCycles;return dmaClockReceipt;},read:b.read,write:b.write,peek:b.peek,advanceCPUClock:b.advanceCPUClock});
  nes.mmap.load=a=>{const v=base.read(a);facade.dataBus=v;return v;};
  for(const name of ['loadROM','loadPRGROM','loadCHRROM','loadBatteryRam','loadRomBank','load32kRomBank','load8kRomBank','loadVromBank','load8kVromBank','load1kVromBank','load2kVromBank','write','writelow'])nes.mmap[name]=()=>bad('DEVICE_CONTRACT','Compiler owns cartridge and timed writes');
  nes.ppu.clipToTvSize=false;installPPU();nes.ppu.startFrame();busy=true;
  try{cpu=createCPU(bus);cpuStep=bindMachineStep(cpu);}finally{busy=false;}
  if(o.startPC!==undefined)cpu.setState({pc:o.startPC});facade.instrBusCycles=0;sync();return state();
 }
 function state(){nes.ppu.sharedPPUBoundary?.();mappingRefresh();return {cpu:cpu.getState(),cycles,cartridgeClock:base.getCPUClock(),frames,sampleRate,fault,dataBus:facade.dataBus,mapper:base.getMapperState(),mapperWrites:writes.map(w=>({...w,before:{...w.before},after:{...w.after}})),cpuWrites:lastWrites.map(w=>({...w})),dma:{...dma.snapshot(),dmcOutput:dmaDmc.snapshot()},metrics:{...metrics,...dma.stats(),bankInstructions:metrics.bankInstructions.slice()},ppu:{scanline:nes.ppu.scanline,dot:nes.ppu.curX,status:facade.mem[0x2002],mirroring:mirror,chrOffsets:chrMap.slice()},apu:{frameIRQ:nes.papu.frameIrqActive,dmcIRQ:nes.papu.dmc.irqGenerated,dmcLastByte:nes.papu.dmc.lastFetchedByte}};}
 function healthy(){if(fault)bad('MACHINE_FAULTED','Reset required after '+fault);}
 function invariant(){const s=cpu.getState();if(s.instructions!==metrics.translatedInstructions||s.cycles!==cycles||base.getCPUClock()!==cycles)bad('CPU_PROVENANCE','CPU/device/cartridge counters differ');}
 function step(trace=true){
  healthy();tracing=trace;try{
   const before=cycles;facade.instrBusCycles=0;facade.apuCatchupCycles=0;facade._cpuCycleBase=cycles;stepWrites.length=0;
   const pc=trace?cpu.getPC():0,mappingBefore=trace?base.getMapperState():null;
   busy=true;let r;try{r=cpuStep();}finally{busy=false;}
   if(r.kind==='instruction'){metrics.translatedInstructions++;const bank=r.physicalPC>>>13,index=((r.pc-32768)>>>13)*metadata.prgBanks+bank;metrics.bankInstructions[index]++;}else if(r.kind==='nmi')metrics.nmiEntries++;else if(r.kind==='irq')metrics.irqEntries++;
   sync();if(trace){invariant();return {kind:r.kind,pc:r.pc,cycles:cycles-before,physicalPC:r.physicalPC,mappingBefore,mappingAfter:base.getMapperState(),writes:stepWrites.map(w=>({...w}))};}
  }catch(e){busy=false;fault=e.code||'DEVICE_ERROR';throw e;}finally{tracing=false;}
 }
 function resetCPU(){healthy();try{stepWrites=[];busy=true;try{cpu.reset();}finally{busy=false;}sync();invariant();return state();}catch(e){fault=e.code||'DEVICE_ERROR';throw e;}}
 function execute(o,target){object(o,['maxSteps','maxCycles','maxMs']);healthy();const maxSteps=int(o.maxSteps??20000,1,100000,'maxSteps'),maxCycles=int(o.maxCycles??40000,1,1000000,'maxCycles'),maxMs=int(o.maxMs??250,1,60000,'maxMs'),start=performance.now(),initial=cycles;let steps=0,pollRemaining=0,reason='steps';while(steps<maxSteps){if(cycles-initial>=maxCycles){reason='cycles';break;}if(pollRemaining===0){if(performance.now()-start>=maxMs){reason='time';break;}pollRemaining=32;}pollRemaining--;step(false);steps++;if(target!==null&&frames>=target){reason='frame';break;}}invariant();return {steps,cycles:cycles-initial,reason,frames,state:state()};}
 function memory(a,n,device){int(a,0,65535,'address');int(n,1,4096,'length');if(a+n>65536)bad('BAD_ARGUMENT','memory range');const r=new Uint8Array(n);for(let i=0;i<n;i++){const p=a+i;if(p>=8192&&p<24576)bad('UNSUPPORTED_PEEK','I/O requires snapshots');r[i]=device?facade.mem[p]:base.peek(p);}return r;}
 function papuCapture(){const p={};for(const key of nes.papu.constructor.JSON_PROPERTIES)p[key]=copy(nes.papu[key]);p.noise=copy(nes.papu.noise.toJSON());p.square1=copy(nes.papu.square1.toJSON());p.square2=copy(nes.papu.square2.toJSON());p.triangle=copy(nes.papu.triangle.toJSON());p.dmcDevice={};for(const key of nes.papu.dmc.constructor.JSON_PROPERTIES)p.dmcDevice[key]=copy(nes.papu.dmc[key]);return p;}
 function papuRestore(p){for(const key of nes.papu.constructor.JSON_PROPERTIES)nes.papu[key]=copy(p[key]);nes.papu.noise.fromJSON(copy(p.noise));nes.papu.square1.fromJSON(copy(p.square1));nes.papu.square2.fromJSON(copy(p.square2));nes.papu.triangle.fromJSON(copy(p.triangle));for(const [key,value] of Object.entries(p.dmcDevice))nes.papu.dmc[key]=copy(value);}
 function checkpointCapture(){
  healthy();if(busy)bad('CHECKPOINT_BUSY','Instruction in progress');nes.ppu.sharedPPUBoundary?.();invariant();
  return {owner:checkpointOwner,machine:copy({cycles,frames,metrics,fault,video,audio,head,count,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset,tracing,dmaCpuCycles}),registers:registers.slice(),devices:{ppu:copy(nes.ppu.toJSON()),papu:papuCapture(),mmap:copy(nes.mmap.toJSON()),controllers:[copy(nes.controllers[1].toJSON()),copy(nes.controllers[2].toJSON())]},cpu:copy(cpu.checkpointCapture()),base:copy(base.checkpointCapture()),ppu:copy(nes.ppu.checkpointCapture()),dma:copy(dma.checkpointCapture()),dmc:copy(dmaDmc.checkpointCapture())};
 }
 function applyCheckpoint(q){
  if(!q||q.owner!==checkpointOwner||!q.machine||!(q.registers instanceof Uint8Array)||q.registers.length!==registers.length||!q.devices||!q.cpu||!q.base||!q.ppu||!q.dma||!q.dmc)bad('BAD_CHECKPOINT','Foreign or invalid machine checkpoint');
  const m=copy(q.machine);if(!(m.video instanceof Uint32Array)||m.video.length!==video.length||!(m.audio instanceof Float32Array)||m.audio.length!==audio.length||!(m.ciram instanceof Uint8Array)||m.ciram.length!==ciram.length||!Array.isArray(m.chrMap)||!m.metrics)bad('BAD_CHECKPOINT','Invalid machine checkpoint arrays');
  cycles=m.cycles;frames=m.frames;metrics=m.metrics;fault=m.fault;video.set(m.video);audio.set(m.audio);head=m.head;count=m.count;strobe=m.strobe;latches=m.latches;positions=m.positions;writes=m.writes;lastWrites=m.lastWrites;stepWrites=m.stepWrites;ciram.set(m.ciram);chrMap=m.chrMap;mirror=m.mirror;busy=m.busy;nmiQueued=m.nmiQueued;frameReset=m.frameReset;tracing=m.tracing;dmaCpuCycles=m.dmaCpuCycles;registers.set(q.registers);
  nes.ppu.fromJSON(copy(q.devices.ppu));papuRestore(copy(q.devices.papu));nes.mmap.fromJSON(copy(q.devices.mmap));nes.controllers[1].fromJSON(copy(q.devices.controllers[0]));nes.controllers[2].fromJSON(copy(q.devices.controllers[1]));base.checkpointRestore(copy(q.base));cpu.checkpointRestore(copy(q.cpu));nes.ppu.checkpointRestore(copy(q.ppu));const callbacks=dmaDmc.checkpointRestore(copy(q.dmc));dma.checkpointRestore(copy(q.dma),callbacks);invariant();
 }
 function checkpointRestore(q){healthy();if(busy)bad('CHECKPOINT_BUSY','Instruction in progress');const backup=checkpointCapture();try{applyCheckpoint(q);healthy();}catch(error){applyCheckpoint(backup);throw error;}}
 initialize(options);
 return Object.freeze({checkpointCapture,checkpointRestore,reset:initialize,resetCPU,step,advance:(o={})=>execute(o,null),frame(o={}){const r=execute(o,frames+1);if(r.reason!=='frame')bad('FRAME_BUDGET','Frame incomplete at '+r.reason);return r;},getState:state,getSharedPPUStats:()=>nes.ppu.getSharedPPUStats?.()??{backend:'js'},
  setButton(port,button,down){int(port,1,2,'port');int(button,0,7,'button');if(typeof down!=='boolean')bad('BAD_ARGUMENT','down');nes.controllers[port][down?'buttonDown':'buttonUp'](button);if(strobe)latch();},
  getFrame:()=>video.slice(),getRGBA(buffer){if(buffer!==undefined&&(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==245760))bad('BAD_ARGUMENT','RGBA buffer size');const a=buffer?new Uint8ClampedArray(buffer):new Uint8ClampedArray(245760);if(mediaLittleEndian){const words=new Uint32Array(a.buffer,a.byteOffset,video.length);for(let i=0;i<video.length;i++)words[i]=video[i]|0xff000000;}else{for(let i=0;i<video.length;i++){const v=video[i];a[i*4]=v&255;a[i*4+1]=(v>>>8)&255;a[i*4+2]=(v>>>16)&255;a[i*4+3]=255;}}return a;},
  audioLength(){return count*2;},
  takeAudio(buffer){const a=buffer instanceof ArrayBuffer&&buffer.byteLength===count*8?new Float32Array(buffer):new Float32Array(count*2);const first=Math.min(count,capacity-head)*2;a.set(audio.subarray(head*2,head*2+first));if(first<count*2)a.set(audio.subarray(0,count*2-first),first);head=0;count=0;return a;},
  readMemory:(a,n=1)=>memory(a,n,false),readDeviceMemory:(a,n=1)=>memory(a,n,true),readPPUMemory(a,n=1){int(a,0,16383,'PPU address');int(n,1,4096,'PPU length');if(a+n>16384)bad('BAD_ARGUMENT','PPU range');nes.ppu.sharedPPUBoundary?.();return Uint8Array.from({length:n},(_,i)=>ppuPeek(a+i));},getOAM:()=>nes.ppu.spriteMem.slice(),
  getPPUCache(){nes.ppu.sharedPPUBoundary?.();return {tile0:nes.ppu.ptTile[0].pix.slice(),tile256:nes.ppu.ptTile[256].pix.slice(),nametablePages:nes.ppu.ntable1.slice(),physicalTile0:nes.ppu.nameTable.slice(0,ciram.length/1024).map(t=>t.tile[0])};},
  checkInterpreterGuard(){try{facade.emulate();}catch(e){if(e.code==='CPU_INTERPRETER_FORBIDDEN')return true;throw e;}bad('CPU_PROVENANCE','Interpreter guard failed');}
 });
}
return Object.freeze(Object.defineProperties(Object.create(null),{"metadata":{enumerable:true,get:()=>metadata},"limitations":{enumerable:true,get:()=>limitations},"MachineError":{enumerable:true,get:()=>MachineError},"createMachine":{enumerable:true,get:()=>createMachine}}));
}
