// Posse extracted reusable engine factory; original body retained.
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
const mediaLittleEndian=new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]===4;







const limitations=Object.freeze(["Shared MMC5 execution core. Release qualification and measured performance are recorded separately.","Only official immutable-PRG instructions are translated. Executing PRG RAM, unofficial opcodes, or operands wrapping FFFF into RAM stops explicitly.","Static official-instruction bus reads and writes feed DMA arbitration. Interrupt polling retains instruction-boundary approximations; hardware equivalence is not established.","The inherited dot renderer batches sprite evaluation at dot 257. Sprite overflow, active-render OAM/PPUDATA, chip-specific DMC stop windows, sub-dot effects and analog behavior remain unsupported or approximate.","Vertical split enable and MMC5A peripheral/timer registers stop explicitly. CHR mode changes exposing undocumented latch bits stop until affected registers are rewritten.","Only CL wiring and an unmodified NES with disconnected cartridge audio are accepted. Five-channel NES audio is provided; MMC5 pulse/PCM digital register state and PCM IRQ are modeled but cartridge audio is not mixed.","ExRAM writes outside rendering in modes 0/1 deterministically write zero; hardware descriptions allow corruption/ignored writes. Unspecified startup registers and memories initialize to zero by explicit policy.","RAM is volatile. Full-machine checkpoints include CPU, PPU, mapper, APU and pending DMA. Battery persistence is not enabled for this board. A CPU-only reset is distinct from cartridge power/reset detection.","Mesen 2.1.1 without its database uses a 64 KiB RAM superset for legacy iNES MMC5 and different startup defaults. Captures expose those differences; frame-end state mismatches are not silently normalized.","Nominal NTSC clocks are unchanged: CPU 1789772.7272727273 Hz, three PPU dots per CPU cycle, 341x262 dots with the rendered odd-frame skip. Full-game and all-board compatibility are not established by a smoke test."]);
class MachineError extends Error {constructor(code,message){super(message);this.code=code;this.name='MachineError';}}
const bad=(c,m)=>{throw new MachineError(c,m);};
const int=(v,lo,hi,n)=>{if(!Number.isSafeInteger(v)||v<lo||v>hi)bad('BAD_ARGUMENT',n);return v;};
const object=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))bad('BAD_ARGUMENT','Unexpected options');};
function createMachine(options={}) {
 let dma,dmaDmc,dmaCpuCycles=0,cpuStep;
 const mmc=metadata.mapper===5,ux=false,banked=true,chrRAM=getCHR().length===0,sampleRate=48000,capacity=16384;
 let registers,nes,cpu,base,bus,facade,cycles,frames,metrics,fault,video,audio,head,count,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset,tracing=false,disposed=false;
 function active(){const p=nes.ppu;return Boolean(p.f_bgVisibility||p.f_spVisibility)&&p.scanline>=20&&p.scanline<=260;}
 function gateSupported(){}
 function audioSample(l,r){if(!Number.isFinite(l)||!Number.isFinite(r))bad('DEVICE_AUDIO','Nonfinite sample');if(count===capacity){head=(head+1)%capacity;count--;metrics.audioDropped++;}const i=((head+count)%capacity)*2;audio[i]=l;audio[i+1]=r;count++;metrics.audioSamples++;}
 function latch(){for(let i=0;i<2;i++){latches[i]=nes.controllers[i+1].state.map(v=>v&1);positions[i]=0;}}
 function readIO(a){
  if(a>=0x6000&&a<0x8000)return facade.dataBus;
  if(a>=0x4018)return facade.dataBus;
  if(a===0x4016||a===0x4017){const i=a-0x4016,v=strobe?(nes.controllers[i+1].state[0]&1):positions[i]<8?latches[i][positions[i]++]:1;return (facade.dataBus&0xe0)|v;}
  return nes.mmap.regLoad(a);
 }
 function peekIO(a){if(a>=0x4018)return facade.dataBus;bad('UNSUPPORTED_PEEK','Device peek is unsupported');}
 function writeIO(a,v){
  if(a>=0x6000&&a<0x8000)return;
  if(a>=0x4018)return;
  if(a===0x4014){dma.requestOam(v);return;}
  if(a===0x4016){const next=Boolean(v&1);if(next||strobe)latch();strobe=next;return;}
  if(a===0x4017){const p=nes.papu;p.frameIrqEnabled=!(v&64);if(v&64){p.frameIrqActive=false;p.frameIrqClearPending=false;}frameReset={at:cycles+1+((p.apuCycleParity&1)?3:4),mode:(v>>7)&1};return;}
  nes.mmap.regWrite(a<0x4000?0x2000+(a&7):a,v);gateSupported();
 }
 function captureNMI(){if(facade.nmiRaised||facade.nmiPending){nmiQueued=true;facade.nmiRaised=false;facade.nmiPending=false;metrics.nmiEdges++;}}
 function sync(){if(!cpu||busy)return;captureNMI();if(nmiQueued){cpu.requestNMI();nmiQueued=false;}cpu.setIRQ(Boolean((nes.papu.frameIrqEnabled&&nes.papu.frameIrqActive)||nes.papu.dmc.irqGenerated||base.getIRQ()));}
 function clockTo(target){
  if(!((target===cycles||target===cycles+1)&&target<=Number.MAX_SAFE_INTEGER-8192)){int(target,cycles,Number.MAX_SAFE_INTEGER-8192,'clock target');if(target-cycles>8192)bad('CLOCK_LIMIT','Clock advance exceeds bound');}
  while(cycles<target){
   gateSupported();nes.ppu.advanceDots(3);dmaDmc.tick();nes.papu.clockFrameCounter(1);cycles++;facade._cpuCycleBase=cycles;captureNMI();
   if(frameReset&&cycles>=frameReset.at){const p=nes.papu;p.countSequence=frameReset.mode;p.frameCycleCounter=0;p.frameStep=0;if(frameReset.mode){p.clockQuarterFrame();p.clockHalfFrame();}frameReset=null;}
   if(nes.ppu.frameEnded){nes.ppu.frameEnded=false;nes.controllers[1].clock();nes.controllers[2].clock();nes.ppu.startFrame();}
  }
 }
 function completeClock(t){clockTo(t);base.advanceCPUClock(t);metrics.clockCompletions++;}
 function idle(n){clockTo(cycles+n);if(mmc)base.advanceCPUClock(cycles);}
 function palAddress(a){let i=a&31;if((i&19)===16)i&=15;return 0x3f00+i;}
 function ppuPeek(a){a&=16383;if(a<8192)return base.peekCHR(a);if(a<0x3f00)return base.readNametable(a,ciram);return nes.ppu.vramMem[palAddress(a)];}
 function mappingRefresh(){chrMap=[];mirror='mapper_controlled';}
 function ppuRead(a){a&=16383;base.setPPUAddress(a);return a<8192?base.ppuRead(a):ppuPeek(a);}
 function ppuWrite(a,v){
  a&=16383;base.setPPUAddress(a);const p=nes.ppu;
  if(a<8192){base.ppuWrite(a,v);if(chrRAM){const physical=base.mapCHR(a);for(let half=0;half<8;half++){const logical=half*1024+(a&1023);if(base.mapCHR(logical)===physical){p.vramMem[logical]=base.peekCHR(logical);p.ptTile[logical>>4].opaque[logical&7]=1;p.patternWrite(logical,p.vramMem[logical]);}}p.validTileData=false;}return;}
  if(a<0x3f00){base.writeNametable(a,v,ciram);return;}
  const address=palAddress(a);p.vramMem[address]=v&63;if((address&3)===0)p.vramMem[address^16]=v&63;p.updatePalettes();
 }
 function installPPU(){mappingRefresh();
   const record={bindPPU:e=>bindOwnedPPU(base,e)};
   const e=createOwnedInstance();
   if(!record?.bindPPU||!e){installDotPPU(nes,base,ppuPeek,ppuWrite,(a,k)=>base.ppuFetch(a,k,ciram));return;}
   const c=new Uint8Array(e.memory.buffer,e.owned_ciram(),ciram.length);c.set(ciram);ciram=c;
   const vram=new Uint8Array(e.memory.buffer,e.owned_vram(),32768);vram.set(nes.ppu.vramMem);nes.ppu.vramMem=vram;
   const frame=new Uint32Array(e.memory.buffer,e.owned_framebuffer(),61440);frame.set(nes.ppu.buffer);nes.ppu.buffer=frame;
   const binding=record.bindPPU(e);
   installOwnedDotPPU(nes,base,ppuPeek,ppuWrite,e,binding,(a,k)=>base.ppuFetch(a,k,ciram));
  }
 function writeCPU(a,v,t,dma=false){
  int(t,cycles,Number.MAX_SAFE_INTEGER-8192,'absolute write cycle');clockTo(t);
  const cartridge=a>=32768||(a>=0x5000&&a<0x6000),before=tracing&&cartridge?base.getMapperState():null,visible=tracing&&cartridge?base.peek(a):null;
  base.write(a,v,t);facade.dataBus=v;
  if(tracing&&!dma){const w={address:a,value:v,cycle:t,deviceCycle:cycles};stepWrites.push(w);if(stepWrites.length>8)bad('DEVICE_CONTRACT','Unexpected CPU write count');lastWrites.push(w);if(lastWrites.length>32)lastWrites.shift();}
  if(cartridge){metrics.mapperWrites++;if(tracing){writes.push({address:a,value:v,visible,effective:v,cycle:t,before,after:base.getMapperState()});if(writes.length>16)writes.shift();}if(a<49152)mappingRefresh();}
 }
 function initialize(o={}){
  if(disposed)bad('DISPOSED','Machine disposed');object(o,['startPC']);if(o.startPC!==undefined)int(o.startPC,32768,65535,'startPC');
  if(metadata.apiVersion!==3||metadata.runtimeRevision!=='fetch-epoch-2'||metadata.mapper!==5||metadata.region!=='ntsc'||metadata.scan_complete!==true)bad('UNSUPPORTED_CARTRIDGE','Requires complete compiler API3 fetch-epoch-2 NTSC output');
  cpu=null;base=null;fault=null;cycles=0;frames=0;head=0;count=0;dmaCpuCycles=0;strobe=false;latches=[Array(8).fill(0),Array(8).fill(0)];positions=[0,0];writes=[];lastWrites=[];stepWrites=[];chrMap=null;mirror=null;busy=false;nmiQueued=false;frameReset=null;
  video=new Uint32Array(61440);audio=new Float32Array(capacity*2);ciram=new Uint8Array(metadata.mirroring==='four_screen'?4096:2048);
  metrics={translatedInstructions:0,nmiEntries:0,irqEntries:0,nmiEdges:0,oamTransfers:0,oamCycles:0,dmcRequests:0,dmcCycles:0,audioSamples:0,audioDropped:0,interpreterCalls:0,mapperWrites:0,clockCompletions:0,chrRefreshes:0,mirroringUpdates:0,bankInstructions:Array(metadata.prgBanks*4).fill(0)};
  registers=new Uint8Array(65536);const numeric=k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<65536;
  const mem=new Proxy(Object.create(null),{get(t,k){if(k==='length')return 65536;if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view property');const a=Number(k);return base&&(a<8192||a>=24576)?base.peek(a):registers[a];},set(t,k,v){if(!numeric(k))bad('DEVICE_CONTRACT','Unsupported memory view write');const a=Number(k);int(v,0,255,'device byte');if(a<8192||a>=24576)bad('DEVICE_CONTRACT','Device attempted an untimed cartridge/RAM write');registers[a]=v;return true;}});
  const f={mem,dataBus:0,instrBusCycles:0,apuCatchupCycles:0,_cpuCycleBase:0,_dmcFetchCycles:0,nmiRaised:false,nmiPending:false,nmiRaisedAtCycle:0,nmiDotsRemainingInStep:0,IRQ_NORMAL:0,IRQ_NMI:1,IRQ_RESET:2,
   requestIrq(k){if(k===0)return;if(k===1){f.nmiPending=true;return;}bad('DEVICE_IRQ','Unexpected IRQ/reset request');},
   haltCycles(){bad('DEVICE_CONTRACT','Legacy immediate DMC fetch/stall is forbidden');},
   emulate(){metrics.interpreterCalls++;bad('CPU_INTERPRETER_FORBIDDEN','Translated CPU execution is mandatory');}};
  // Device fields are fixed by the bundled device contract; avoid Proxy traps on every CPU cycle.
  facade=Object.seal(f);
  nes={cpu:facade,opts:{sampleRate,emulateSound:true,onAudioSample:audioSample,onBatteryRamWrite(){}},ui:{writeFrame(p){if(p.length!==61440)bad('DEVICE_VIDEO','Framebuffer length');video.set(p);frames++;},updateStatus(){}},controllers:{1:new Controller(),2:new Controller()},rom:{VERTICAL_MIRRORING:0,HORIZONTAL_MIRRORING:1,FOURSCREEN_MIRRORING:2,SINGLESCREEN_MIRRORING:3,SINGLESCREEN_MIRRORING2:4,vromCount:getCHR().length/4096}};
  nes.mmap=new DeviceRegisters(nes);nes.ppu=new PPU(nes);nes.papu=new PAPU(nes);base=createBus({read:readIO,write:writeIO,peek:peekIO});
   dma=createDMA({cycle:()=>cycles,tick:()=>clockTo(cycles+1),read(a){gateSupported();const v=base.read(a);facade.dataBus=v;return v;},writeCPU:(a,v)=>writeCPU(a,v,cycles),writeOam(v){if(active())bad('UNSUPPORTED_RENDER_DMA','OAM during active rendering');nes.mmap.regWrite(0x2004,v);},getBus:()=>facade.dataBus,setBus:v=>{facade.dataBus=v;}});
   dmaDmc=installDMC(nes.papu.dmc,dma,()=>cycles);
  const dmaClockReceipt={cycle:0,accesses:0};
  const b={read(a){facade.instrBusCycles++;const v=dma.readCPU(a);dmaCpuCycles++;return v;},write(a,v,t){facade.instrBusCycles++;if(t!==cycles)bad('BAD_TIMING','CPU write clock mismatch');dma.writeCPU(a,v);dmaCpuCycles++;},peek:base.peek,mapPRG:a=>base.mapPRG(a),getMapperState:()=>base.getMapperState()};
  if(mmc){b.getCPUClock=()=>base.getCPUClock();b.advanceCPUClock=completeClock;}bus=composeBus(base,{dmaClock:()=>{dmaClockReceipt.cycle=cycles;dmaClockReceipt.accesses=dmaCpuCycles;return dmaClockReceipt;},read:b.read,write:b.write,peek:b.peek,...(mmc?{advanceCPUClock:b.advanceCPUClock}:{})});
  nes.mmap.load=a=>{const v=base.read(a);facade.dataBus=v;return v;};
  for(const name of ['loadROM','loadPRGROM','loadCHRROM','loadBatteryRam','loadRomBank','load32kRomBank','load8kRomBank','loadVromBank','load8kVromBank','load1kVromBank','load2kVromBank','write','writelow'])nes.mmap[name]=()=>bad('DEVICE_CONTRACT','Compiler owns cartridge and timed writes');
  nes.ppu.clipToTvSize=false;installPPU();nes.ppu.startFrame();busy=true;
  try{cpu=createCPU(bus);cpuStep=bindMachineStep(cpu);}finally{busy=false;}
  if(o.startPC!==undefined)cpu.setState({pc:o.startPC});facade.instrBusCycles=0;sync();return state();
 }
 function state(){nes.ppu.sharedPPUBoundary?.();return {disposed,cpu:cpu.getState(),cycles,cartridgeClock:mmc?base.getCPUClock():null,frames,sampleRate,fault,dataBus:facade.dataBus,mapper:base.getMapperState(),mapperWrites:writes.map(w=>({...w,before:{...w.before},after:{...w.after}})),cpuWrites:lastWrites.map(w=>({...w})),dma:{...dma.snapshot(),dmcOutput:dmaDmc.snapshot()},metrics:{...metrics,...dma.stats(),bankInstructions:metrics.bankInstructions.slice()},ppu:{scanline:nes.ppu.scanline,dot:nes.ppu.curX,status:facade.mem[0x2002],mirroring:mirror,chrOffsets:chrMap.slice()},apu:{frameIRQ:nes.papu.frameIrqActive,dmcIRQ:nes.papu.dmc.irqGenerated,dmcLastByte:nes.papu.dmc.lastFetchedByte}};}
 function healthy(){if(disposed)bad('DISPOSED','Machine disposed');if(fault)bad('MACHINE_FAULTED','Reset required after '+fault);}
 function drain(){return 0;} // DMA now halts the next CPU read, never an instruction-end write.
 function invariant(){const s=cpu.getState();if(s.instructions!==metrics.translatedInstructions||s.cycles!==cycles||(mmc&&base.getCPUClock()!==cycles))bad('CPU_PROVENANCE','CPU/device/cartridge counters differ');}
 function step(trace=true){
  healthy();tracing=trace;try{
   const before=cycles;facade.instrBusCycles=0;facade.apuCatchupCycles=0;facade._cpuCycleBase=cycles;stepWrites.length=0;sync();
   const pc=cpu.getPC(),mappingBefore=trace?base.getMapperState():null,physicalPC=pc>=32768?base.mapPRG(pc):null;
   busy=true;let r;try{r=cpuStep();}finally{busy=false;}
   if(r.kind==='instruction'){metrics.translatedInstructions++;const bank=physicalPC===null?0:physicalPC>>>13,index=((pc-32768)>>>13)*metadata.prgBanks+bank;metrics.bankInstructions[index]++;}else if(r.kind==='nmi')metrics.nmiEntries++;else if(r.kind==='irq')metrics.irqEntries++;
   drain();sync();if(trace){invariant();return {kind:r.kind,pc:r.pc,cycles:cycles-before,physicalPC,mappingBefore,mappingAfter:base.getMapperState(),writes:stepWrites.map(w=>({...w}))};}
  }catch(e){busy=false;fault=e.code||'DEVICE_ERROR';throw e;}finally{tracing=false;}
 }
 function resetCPU(){healthy();try{const before=cycles;stepWrites=[];busy=true;try{cpu.reset();}finally{busy=false;}drain();sync();invariant();return state();}catch(e){fault=e.code||'DEVICE_ERROR';throw e;}}
 function execute(o,target){object(o,['maxSteps','maxCycles','maxMs']);healthy();const maxSteps=int(o.maxSteps??20000,1,100000,'maxSteps'),maxCycles=int(o.maxCycles??40000,1,1000000,'maxCycles'),maxMs=int(o.maxMs??250,1,60000,'maxMs'),start=performance.now(),initial=cycles;let steps=0,pollRemaining=0,reason='steps';while(steps<maxSteps){if(cycles-initial>=maxCycles){reason='cycles';break;}if(pollRemaining===0){if(performance.now()-start>=maxMs){reason='time';break;}pollRemaining=32;}pollRemaining--;step(false);steps++;if(target!==null&&frames>=target){reason='frame';break;}}invariant();return {steps,cycles:cycles-initial,reason,frames,state:state()};}
 function memory(a,n,device){int(a,0,65535,'address');int(n,1,4096,'length');if(a+n>65536)bad('BAD_ARGUMENT','memory range');const r=new Uint8Array(n);for(let i=0;i<n;i++){const p=a+i;if(p>=8192&&p<24576)bad('UNSUPPORTED_PEEK','I/O requires snapshots');r[i]=device?facade.mem[p]:base.peek(p);}return r;}
 function checkpointCapture(){healthy();if(busy)bad('CHECKPOINT_BUSY','Instruction in progress');nes.ppu.sharedPPUBoundary();invariant();return {machine:{cycles,frames,metrics,fault,video,audio,head,count,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset,tracing,disposed,dmaCpuCycles},registers,nes,cpu:cpu.checkpointCapture(),base:base.checkpointCapture(),ppu:nes.ppu.checkpointCapture(),dma:dma.checkpointCapture(),dmc:dmaDmc.checkpointCapture()};}
 function checkpointRestore(v){({cycles,frames,metrics,fault,video,audio,head,count,strobe,latches,positions,writes,lastWrites,stepWrites,ciram,chrMap,mirror,busy,nmiQueued,frameReset,tracing,disposed,dmaCpuCycles}=v.machine);registers.set(v.registers);cpu.checkpointRestore(v.cpu);base.checkpointRestore(v.base);nes.ppu.checkpointRestore(v.ppu);const callbacks=dmaDmc.checkpointRestore(v.dmc);dma.checkpointRestore(v.dma,callbacks);invariant();}
 initialize(options);
 return Object.freeze({checkpointCapture,checkpointRestore,getSharedPPUStats:()=>nes.ppu.getSharedPPUStats(),reset:initialize,resetCPU,step,advance:(o={})=>execute(o,null),frame(o={}){const r=execute(o,frames+1);if(r.reason!=='frame')bad('FRAME_BUDGET','Frame incomplete at '+r.reason);return r;},getState:state,
 setButton(port,button,down){if(disposed)bad('DISPOSED','Machine disposed');int(port,1,2,'port');int(button,0,7,'button');if(typeof down!=='boolean')bad('BAD_ARGUMENT','down');nes.controllers[port][down?'buttonDown':'buttonUp'](button);if(strobe)latch();},
 getFrame:()=>video.slice(),getRGBA(buffer){if(buffer!==undefined&&(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==245760))bad('BAD_ARGUMENT','RGBA buffer size');const a=buffer?new Uint8ClampedArray(buffer):new Uint8ClampedArray(245760);if(mediaLittleEndian){const words=new Uint32Array(a.buffer,a.byteOffset,video.length);for(let i=0;i<video.length;i++)words[i]=video[i]|0xff000000;}else{for(let i=0;i<video.length;i++){const v=video[i];a[i*4]=v&255;a[i*4+1]=(v>>>8)&255;a[i*4+2]=(v>>>16)&255;a[i*4+3]=255;}}return a;},
 audioLength:()=>count*2,
 takeAudio(buffer){const a=buffer instanceof ArrayBuffer&&buffer.byteLength===count*8?new Float32Array(buffer):new Float32Array(count*2);const first=Math.min(count,capacity-head)*2;a.set(audio.subarray(head*2,head*2+first));if(first<count*2)a.set(audio.subarray(0,count*2-first),first);head=0;count=0;return a;},
 readMemory:(a,n=1)=>memory(a,n,false),readDeviceMemory:(a,n=1)=>memory(a,n,true),readPPUMemory(a,n=1){int(a,0,16383,'PPU address');int(n,1,4096,'PPU length');if(a+n>16384)bad('BAD_ARGUMENT','PPU range');return Uint8Array.from({length:n},(_,i)=>ppuPeek(a+i));},getOAM:()=>nes.ppu.spriteMem.slice(),
 getPPUCache(){return {tile0:nes.ppu.ptTile[0].pix.slice(),tile256:nes.ppu.ptTile[256].pix.slice(),nametablePages:nes.ppu.ntable1.slice(),physicalTile0:nes.ppu.nameTable.slice(0,ciram.length/1024).map(t=>t.tile[0])};},
 dispose(){if(disposed)return;for(let port=1;port<=2;port++)for(let b=0;b<8;b++)nes.controllers[port].buttonUp(b);dma.clear();head=0;count=0;disposed=true;},
 checkInterpreterGuard(){try{facade.emulate();}catch(e){if(e.code==='CPU_INTERPRETER_FORBIDDEN')return true;throw e;}bad('CPU_PROVENANCE','Interpreter guard failed');}
 });
}

return Object.freeze(Object.defineProperties(Object.create(null),{"metadata":{enumerable:true,get:()=>metadata},"limitations":{enumerable:true,get:()=>limitations},"MachineError":{enumerable:true,get:()=>MachineError},"createMachine":{enumerable:true,get:()=>createMachine}}));
}
