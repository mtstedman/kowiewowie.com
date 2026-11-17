export class CPUError extends Error {
 constructor(code,message,pc){super(message);this.name='CPUError';this.code=code;if(pc!==undefined)this.pc=pc;}
}
const bad=(code,message,pc)=>{throw new CPUError(code,message,pc);};
const integer=(v,max,label)=>{if(!Number.isSafeInteger(v)||v<0||v>max)bad('BAD_ARGUMENT',label);return v;};
const byte=v=>integer(v,255,'Expected byte'),address=v=>integer(v,65535,'Expected CPU address');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function fromHex(h){if(typeof h!=='string'||h.length%2||!/^[0-9a-f]*$/.test(h))bad('BAD_ROM_DATA','Invalid hex');const b=new Uint8Array(h.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(h.slice(i*2,i*2+2),16);return b;}
// Only module-owned buses with immutable cartridge metadata use the fast epoch path.
const ownedBuses=new WeakMap();
export function composeBus(base,hooks){
 const record=ownedBuses.get(base);
 if(!record||!hooks||Object.keys(hooks).some(k=>!['read','write','peek','advanceCPUClock','dmaClock'].includes(k))||Object.values(hooks).some(v=>typeof v!=='function'))bad('BAD_BUS','Invalid hardware bus composition');
 const bus=Object.freeze({...base,...hooks});ownedBuses.set(bus,{...record,sourcePeek:hooks.peek===base.peek});return bus;
}


const MAP5=['mapper','identity','version','clock','w0','w1','w2','w3'];
function valid5(v,info){
 if(!exact(v,MAP5)||v.mapper!==5||v.identity!==info.mappingIdentity)bad('BAD_MAPPING','MMC5 mapping identity/fields');
 for(const k of ['version','clock'])integer(v[k],Number.MAX_SAFE_INTEGER-8192,k);
 for(const k of ['w0','w1','w2','w3'])if(!Number.isInteger(v[k])||v[k]<-1||v[k]>=info.prgBanks)bad('BAD_MAPPING','Invalid PRG window');
 return {...v};
}
export function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:5},chr=new Uint8Array()){
 const cfg=info.mmc5,n=prg?.length/8192,layouts={ELROM:'none',EKROM:'8k',ETROM:'16k',EWROM:'32k'};
 if(info.mapper!==5||!(prg instanceof Uint8Array)||![2,4,8,16,32,64,128].includes(n)||info.prgBanks!==n||typeof info.mappingIdentity!=='string'||!cfg||layouts[cfg.board]!==cfg.prg_ram)bad('BAD_ROM_DATA','MMC5 PRG geometry or board');
 if(!(chr instanceof Uint8Array)||![8192,16384,32768,65536,131072,262144,524288,1048576].includes(chr.length)||!(trainer instanceof Uint8Array)||trainer.length)bad('BAD_ROM_DATA','CHR ROM required; no trainer');
 if(!exact(cfg,['board','prg_ram','revision','wiring','audio','startup','exram_blank_write','chr_latch'])||cfg.revision!=='MMC5'||cfg.wiring!=='CL'||cfg.audio!=='nes-disconnected'||cfg.startup!=='reset-defined-zero-other'||cfg.exram_blank_write!=='zero'||cfg.chr_latch!=='mode-latched-reject-unknown')bad('BAD_ROM_DATA','Unsupported explicit MMC5 policy');
 if(!io||typeof io!=='object'||Array.isArray(io)||Object.keys(io).some(k=>!['read','peek','write'].includes(k))||Object.values(io).some(v=>typeof v!=='function'))bad('BAD_BUS','I/O callbacks');
 let chrData=chr.slice(),exram=new Uint8Array(1024);const rom=prg.slice(),ram=new Uint8Array(2048),sram=new Uint8Array({none:0,'8k':8192,'16k':16384,'32k':32768}[cfg.prg_ram]);
 const banks=new Uint8Array([0,0,0,0,255]),ch=new Uint16Array(12),known=new Uint16Array(12);known.fill(1023);
 let version=0,clock=0,prgMode=3,chrMode=0,protect1=1,protect2=2,exMode=3,ntMap=0,fillTile=0,fillColor=0,upper=0,lastFamily=0,ctrl=0,mask=0;
 let ppuDot=0,ppuAddress=0,lastRead=-1,matches=0,reading=false,idle=0,inFrame=false,line=0,target=0,pending=false,enabled=false,exTile=0,exLatch=0;
 let multiplyA=0,multiplyB=0,splitScroll=0,splitBank=0,splitControl=0,pcmMode=0,pcmEnable=false,pcmTrip=false,pcm=0,audioDivider=0,audioCycles=0;
 const lengths=[10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30];
 const pulses=Array.from({length:2},()=>({control:0,period:0,timer:0,phase:0,length:0,enabled:false,start:false,divider:0,envelope:0}));
 function bump(){if(version>=Number.MAX_SAFE_INTEGER-8192)bad('MAPPING_OVERFLOW','MMC5 epoch');version++;}
 function selection(a){
  if(a<32768)return banks[0]&15;
  const w=(a-32768)>>>13;
  if(prgMode===0)return 128|((banks[4]&124)|w);
  if(prgMode===1)return w<2?((banks[2]&254)|(w&1)):(128|((banks[4]&126)|(w&1)));
  if(prgMode===2)return w<2?((banks[2]&254)|(w&1)):w===2?banks[3]:banks[4]|128;
  return banks[w+1]|(w===3?128:0);
 }
 function ramBank(value){const b=value&7;if(cfg.board==='ELROM')return -1;if(cfg.board==='ETROM')return b>>>2;if(b&4)return -1;return cfg.board==='EWROM'?b&3:0;}
 let windowVersion=-1,window0,window1,window2,window3;
 function refreshWindows(){if(windowVersion===-1){const a=selection(32768),b=selection(40960),c=selection(49152),d=selection(57344);window0=a&128?a&(n-1):-1;window1=b&128?b&(n-1):-1;window2=c&128?c&(n-1):-1;window3=d&128?d&(n-1):-1;windowVersion=version;}}
 function win(w){refreshWindows();return w===0?window0:w===1?window1:w===2?window2:window3;}
 function mapping(){refreshWindows();return {mapper:5,identity:info.mappingIdentity,version,clock,w0:window0,w1:window1,w2:window2,w3:window3};}
 function fillInstructionMapping(out){refreshWindows();out.mapper=5;out.identity=info.mappingIdentity;out.version=version;out.clock=clock;out.w0=window0;out.w1=window1;out.w2=window2;out.w3=window3;return out;}
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','Immutable PRG address');const w=win((a-32768)>>>13);return w<0?-1:w*8192+(a&8191);}
 function external(a,peek){const f=peek?io.peek:io.read;if(!f)bad('HARDWARE_UNIMPLEMENTED','Missing open-bus/device handler at '+a);return byte(f(a));}
 function resetScan(){synchronizeOwned();mapperStageValid=false;inFrame=false;line=0;pending=false;lastRead=-1;matches=0;idle=0;reading=false;}
 function pcmWrite(v){pcmTrip=v===0;if(v!==0)pcm=v;}
 function readCPU(a,peek=false){
  address(a);if(a>=8192&&a<24576)synchronizeOwned();
  if(a<8192)return ram[a&2047];
  if(a>=32768){const bank=win((a-32768)>>>13);if(bank>=0){const v=rom[bank*8192+(a&8191)];if(!peek){if(a===65530||a===65531)resetScan();if(pcmMode&&a<49152)pcmWrite(v);}return v;}}
  if(a>=24576){const s=selection(a);let v;if(s&128)v=rom[(s&(n-1))*8192+(a&8191)];else{const b=ramBank(s);v=b<0?external(a,peek):sram[b*8192+(a&8191)];}
   if(!peek){if(a===65530||a===65531)resetScan();if(pcmMode&&a>=32768&&a<49152)pcmWrite(v);}return v;
  }
  if(a>=23552){return exMode>=2?exram[a&1023]:external(a,peek);}
  if(a===0x5204){const v=(external(a,true)&62)|(inFrame?64:0)|(pending?128:0);if(!peek){mapperStageValid=false;pending=false;}return v;}
  if(a===0x5205)return multiplyA*multiplyB&255;if(a===0x5206)return multiplyA*multiplyB>>>8;
  if(a===0x5010){const v=(external(a,true)&126)|(pcmTrip&&pcmEnable?128:0);if(!peek)pcmTrip=false;return v;}
  if(a===0x5015)return (external(a,true)&252)|(pulses[0].length?1:0)|(pulses[1].length?2:0);
  if((a>=0x5207&&a<=0x520a)||(a>=0x5800&&a<0x5c00))bad('UNSUPPORTED_MMC5A','Peripheral/timer access is not implemented');
  const v=external(a,peek);if(!peek&&a===0x2002&&(v&128))resetScan();return v;
 }
 function write(a,v,t){
  address(a);byte(v);integer(t,Number.MAX_SAFE_INTEGER-8192,'absolute write cycle');if(t<clock)bad('BAD_TIMING','Write precedes bus clock');
  if(a===0x5200&&(v&128))bad('UNSUPPORTED_VERTICAL_SPLIT','Vertical split rendering is not implemented');
  if((a>=0x5207&&a<=0x520a)||(a>=0x5800&&a<0x5c00))bad('UNSUPPORTED_MMC5A','Peripheral/timer access is not implemented');
  bump();clock=t+1;if(a>=8192&&a<24576){synchronizeOwned();mapperStageValid=false;}if(a===0x5100||(a>=0x5113&&a<=0x5117))windowVersion=-1;
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=24576){const s=selection(a),b=ramBank(s);if(!(s&128)&&b>=0&&protect1===2&&protect2===1)sram[b*8192+(a&8191)]=v;return;}
  if(a>=23552){if(exMode===2)exram[a&1023]=v;else if(exMode<2)exram[a&1023]=inFrame?v:0;return;}
  if(a===0x2000)ctrl=v;
  if(a===0x2001){if(!(mask&24)&&(v&24))resetScan();mask=v;}
  if(a===0x4014)resetScan();
  if(a>=0x5113&&a<=0x5117){banks[a-0x5113]=v;return;}
  if(a>=0x5120&&a<=0x512b){const i=a-0x5120,s=3-chrMode;ch[i]=(((v|(upper<<8))<<s)|(v&1))&1023;known[i]=1023^(((1<<s)-1)&~1);lastFamily=i>=8?1:0;return;}
  if(a>=0x5000&&a<=0x5007){const p=pulses[(a>>>2)&1];switch(a&3){case 0:p.control=v;break;case 1:break;case 2:p.period=(p.period&1792)|v;break;case 3:p.period=(p.period&255)|((v&7)<<8);if(p.enabled)p.length=lengths[v>>>3];p.phase=0;p.start=true;break;}return;}
  switch(a){
   case 0x5010:pcmMode=v&1;pcmEnable=Boolean(v&128);return;
   case 0x5011:if(!pcmMode)pcmWrite(v);return;
   case 0x5015:for(let i=0;i<2;i++){pulses[i].enabled=Boolean(v&(1<<i));if(!pulses[i].enabled)pulses[i].length=0;}return;
   case 0x5100:prgMode=v&3;return;case 0x5101:chrMode=v&3;return;case 0x5102:protect1=v&3;return;case 0x5103:protect2=v&3;return;
   case 0x5104:exMode=v&3;return;case 0x5105:ntMap=v;return;case 0x5106:fillTile=v;return;case 0x5107:fillColor=v&3;return;
   case 0x5130:upper=v&3;return;case 0x5200:splitControl=v;return;case 0x5201:splitScroll=v;return;case 0x5202:splitBank=v;return;
   case 0x5203:target=v;return;case 0x5204:enabled=Boolean(v&128);return;case 0x5205:multiplyA=v;return;case 0x5206:multiplyB=v;return;
  }
  if(a>=0x5000)return;
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','Missing device write');io.write(a,v,t);
 }
 function mapCHR(a,kind='cpu'){
  integer(a,8191,'CHR address');const width=1<<(3-chrMode),slot=a>>>10;
  const family=(ctrl&32)?(kind==='cpu'?lastFamily:kind==='bg'&&(mask&24)?1:0):0;
  const local=family?slot&3:slot,index=family?8+(chrMode===0?3:(local&~(width-1))+width-1):(slot&~(width-1))+width-1;
  const used=1023&~(width-1);if((known[index]&used)!==used)bad('UNSUPPORTED_CHR_MODE_REINTERPRETATION','CHR mode exposes undocumented latch bits; rewrite selected bank register');
  return (((ch[index]&used)|(slot&(width-1)))&(chrData.length/1024-1))*1024+(a&1023);
 }
 function ntSource(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address');return (ntMap>>>((((a-8192)&4095)>>>10)*2))&3;}
 function checkCiram(c){if(!(c instanceof Uint8Array)||c.length!==2048)bad('BAD_ARGUMENT','2048-byte CIRAM required');}
 function readNametable(a,c){checkCiram(c);const s=ntSource(a),o=a&1023;return s<2?c[s*1024+o]:s===2?(exMode<2?exram[o]:0):o<960?fillTile:fillColor*85;}
 function writeNametable(a,v,c){byte(v);checkCiram(c);const s=ntSource(a),o=a&1023;if(s<2)c[s*1024+o]=v;else if(s===2&&exMode<2)exram[o]=v;}
 function observeRead(a){
  reading=true;
  if(matches>=2){matches=0;if(!inFrame){inFrame=true;line=0;pending=false;}else{line=(line+1)&255;if(line===240){resetScan();reading=true;}else if(target!==0&&line===target)pending=true;}}
  else if(a>=0x2000&&a<0x3000&&a===lastRead)matches++;else matches=0;
  lastRead=a;
 }
 function ppuFetch(a,kind,c){
  integer(a,16383,'PPU fetch address');if(a>=0x3f00)bad('BAD_ARGUMENT','Palette access is internal to PPU');
  if(!['cpu','bg-nt','bg-at','bg','sprite','dummy'].includes(kind))bad('BAD_ARGUMENT','PPU fetch kind');
  observeRead(a);
  const extended=exMode===1&&Boolean(mask&24);
  if(kind==='bg-nt')exTile=a&1023;
  if(kind==='bg-at'&&extended){exLatch=exram[exTile];return (exLatch>>>6)*85;}
  if(a<8192){if(kind==='bg'&&extended)return chrData[((((upper<<6)|(exLatch&63))*4096+(a&4095))&(chrData.length-1))];return chrData[mapCHR(a,kind==='bg'?'bg':kind==='cpu'?'cpu':'sprite')];}
  return readNametable(a,c);
 }
 function clockEnvelopes(){
  for(const p of pulses){if(p.length&&!(p.control&32))p.length--;if(p.start){p.start=false;p.envelope=15;p.divider=p.control&15;}else if(p.divider)p.divider--;else{p.divider=p.control&15;if(p.envelope)p.envelope--;else if(p.control&32)p.envelope=15;}}
 }
 // Disconnected expansion channels expose digital state, with no per-tick callback.
 // Timer phase and envelope edges are independent between register accesses.
 function advanceAudio(ticks){
  if(!ticks)return;audioCycles+=ticks;
  for(const p of pulses){if(ticks<=p.timer){p.timer-=ticks;continue;}const span=(p.period+1)*2,left=ticks-p.timer-1;p.phase=(p.phase+1+Math.floor(left/span))&7;p.timer=span-1-left%span;}
  audioDivider+=ticks;while(audioDivider>=7424){audioDivider-=7424;clockEnvelopes();}
 }
 function audioTick(){
  audioCycles++;
  const p0=pulses[0],p1=pulses[1];if(p0.timer===0){p0.timer=(p0.period+1)*2-1;p0.phase=(p0.phase+1)&7;}else p0.timer--;if(p1.timer===0){p1.timer=(p1.period+1)*2-1;p1.phase=(p1.phase+1)&7;}else p1.timer--;
  if(++audioDivider<7424)return;audioDivider=0;
  clockEnvelopes();
 }
 let ppuPhase=0;
 function ppuCpuTick(){audioTick();if(reading)idle=0;else if(++idle>=3){idle=3;inFrame=false;lastRead=-1;matches=0;}reading=false;}
 function advancePPUClock(t){
  if(t===ppuDot){ppuDot=t;return;}
  if(t===ppuDot+1&&t<=Number.MAX_SAFE_INTEGER-8192){
   if(++ppuPhase===3){ppuPhase=0;ppuCpuTick();}ppuDot=t;return;
  }
  integer(t,Number.MAX_SAFE_INTEGER-8192,'PPU clock');if(t<ppuDot||t-ppuDot>24576)bad('BAD_TIMING','Bounded monotonic PPU clock required');
  const ticks=Math.floor(t/3)-Math.floor(ppuDot/3);for(let i=0;i<ticks;i++)ppuCpuTick();ppuPhase=t%3;ppuDot=t;
 }
 function advanceCPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'CPU clock');if(t<clock)bad('BAD_TIMING','CPU clock backwards');clock=t;}
 function setPPUAddress(a,t=ppuDot){integer(a,16383,'PPU address');advancePPUClock(t);ppuAddress=a;}
 function getMapperState(){return {...mapping(),prgMode,chrMode,prgRegisters:Array.from(banks),chrRegisters:Array.from(ch),chrKnownBits:Array.from(known),protect1,protect2,exMode,ntMap,fillTile,fillColor,upper,lastFamily,ctrl,mask,ppuDot,ppuAddress,inFrame,scanline:line,irqTarget:target,irqPending:pending,irqEnabled:enabled,irq:Boolean(pending&&enabled||pcmTrip&&pcmEnable),lastPpuRead:lastRead,matchingReads:matches,idleCpuCycles:idle,multiplyA,multiplyB,splitControl,splitScroll,splitBank,pcmMode,pcmEnable,pcmTrip,pcm,audioCycles,audioDivider,pulses:pulses.map(p=>({...p})),audioRouting:cfg.audio};}
 let mapperStageValid=false,synchronizeOwned=()=>{},ownedIRQ=null;
 const api={checkpointCapture:()=>({ram,sram,exram,banks,ch,known,pulses,state:{version,clock,prgMode,chrMode,protect1,protect2,exMode,ntMap,fillTile,fillColor,upper,lastFamily,ctrl,mask,ppuDot,ppuAddress,lastRead,matches,reading,idle,inFrame,line,target,pending,enabled,exTile,exLatch,multiplyA,multiplyB,splitScroll,splitBank,splitControl,pcmMode,pcmEnable,pcmTrip,pcm,audioDivider,audioCycles,ppuPhase}}),checkpointRestore(v){ram.set(v.ram);sram.set(v.sram);exram.set(v.exram);banks.set(v.banks);ch.set(v.ch);known.set(v.known);for(let i=0;i<2;i++)Object.assign(pulses[i],v.pulses[i]);({version,clock,prgMode,chrMode,protect1,protect2,exMode,ntMap,fillTile,fillColor,upper,lastFamily,ctrl,mask,ppuDot,ppuAddress,lastRead,matches,reading,idle,inFrame,line,target,pending,enabled,exTile,exLatch,multiplyA,multiplyB,splitScroll,splitBank,splitControl,pcmMode,pcmEnable,pcmTrip,pcm,audioDivider,audioCycles,ppuPhase}=v.state);mapperStageValid=false;windowVersion=-1;},read:a=>readCPU(a),peek:a=>readCPU(a,true),write,mapPRG,mapCHR,getMappingState:mapping,getMapperState,getCPUClock:()=>clock,advanceCPUClock,getPPUClock:()=>ppuDot,advancePPUClock,setPPUAddress,ppuFetch,readNametable,writeNametable,getIRQ:()=>Boolean((ownedIRQ?ownedIRQ():pending)&&enabled||pcmTrip&&pcmEnable),getMirroring:()=>'mapper_controlled',mapNametable(a){const s=ntSource(a);return s*1024+(a&1023);},peekCHR:a=>chrData[mapCHR(a)],ppuRead(a,t=ppuDot){setPPUAddress(a,t);return ppuFetch(a,'cpu',new Uint8Array(2048));},ppuWrite(a,v,t=ppuDot){integer(a,8191,'CHR address');byte(v);setPPUAddress(a,t);},snapshot(){return {ram:ram.slice(),prgRam:sram.slice(),exram:exram.slice(),chrRam:new Uint8Array(),mapper:getMapperState()};},loadRAM(r,p){if(!(r instanceof Uint8Array)||r.length!==2048||!(p instanceof Uint8Array)||p.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM sizes');bump();ram.set(r);sram.set(p);},loadCHR(r){if(!(r instanceof Uint8Array)||r.length)bad('BAD_ARGUMENT','CHR ROM is immutable');},loadMapperState(){bad('UNSUPPORTED_STATE_RESTORE','Full MMC5 restoration is not implemented');}};
 if(Object.isFrozen(info)&&Object.isFrozen(cfg))ownedBuses.set(api,{info,bindPPU(e){
    const chrStorage=new Uint8Array(e.memory.buffer,e.owned_chr(),1048576);
    chrStorage.set(chrData);chrData=chrStorage.subarray(0,chrData.length);
    const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16),m=new Uint32Array(e.memory.buffer,e.owned_mapper(),64),od=new Float64Array(e.memory.buffer,e.owned_mapper_clocks(),4);
    let mappingRefreshes=0,synchronizations=0,skippedSource=0,skippedAudio=0,ownedAudioTicks=0;
    const ex=new Uint8Array(e.memory.buffer,e.owned_exram(),1024);ex.set(exram);exram=ex;
    let cachedMode=-1,cachedFamily=-1;
    const cachedBanks=new Int32Array(8).fill(-1),cachedKnown=new Int32Array(8).fill(-1),indices=new Uint8Array(8);
    function refreshMapping(){
     const family=Boolean((ctrl&32)&&(mask&24)),width=1<<(3-chrMode),used=1023&~(width-1);
     let changed=chrMode!==cachedMode||family!==cachedFamily;
     if(changed)for(let slot=0;slot<8;slot++){
      const local=family?slot&3:slot;
      indices[slot]=family?8+(chrMode===0?3:Math.floor(local/width)*width+width-1):Math.floor(slot/width)*width+width-1;
     }
     // Only selected latch bits affect these windows; address/IRQ epochs do not.
     for(let slot=0;slot<8;slot++){const index=indices[slot];
      if(cachedBanks[slot]!== (ch[index]&used)||cachedKnown[slot]!== (known[index]&used))changed=true;
     }
     if(!changed)return;
     m[26]=0;
     for(let slot=0;slot<8;slot++){
      const index=indices[slot];
      // Unknown bits remain deferred to the original source read.
      if((known[index]&used)===used){m[slot]=mapCHR(slot*1024,'bg');m[26]|=1<<slot;}
      cachedBanks[slot]=ch[index]&used;cachedKnown[slot]=known[index]&used;
     }
     cachedMode=chrMode;cachedFamily=family;mappingRefreshes++;
    }
    function before(){
     if(mapperStageValid)return true;
     synchronizations++;refreshMapping();
     m[40]=0;const width=1<<(3-chrMode),used=1023&~(width-1);
     for(let slot=0;slot<8;slot++){const index=(slot&~(width-1))+width-1;if((known[index]&used)===used){m[32+slot]=mapCHR(slot*1024,'sprite');m[40]|=1<<slot;}}
     od[0]=ppuDot;od[1]=0;m[28]=ppuDot%3;m[8]=5;m[9]=chrData.length-1;
     m[10]=ntMap;m[11]=exMode;m[12]=fillTile;m[13]=fillColor;m[14]=upper;
     m[15]=exMode===1&&Boolean(mask&24)?1:0;m[16]=exTile;m[17]=exLatch;
     m[18]=lastRead+1;m[19]=matches;m[20]=reading?1:0;m[21]=inFrame?1:0;
     m[22]=line;m[23]=target;m[24]=pending?1:0;m[25]=ppuAddress;m[27]=idle;
     return true;
    }
    let stagedPending=false;
    function after(){mapperStageValid=true;stagedPending=true;}
    function flush(){
     if(!stagedPending)return;stagedPending=false;
     const ticks=Math.floor(od[0]/3)-Math.floor(ppuDot/3);if(ticks<0||ticks>8192)throw Error('Owned audio clock invariant');advanceAudio(ticks);ownedAudioTicks+=ticks;
     mapperStageValid=true;ppuDot=od[0];ppuPhase=ppuDot%3;ppuAddress=m[25];exTile=m[16];exLatch=m[17];lastRead=m[18]-1;
     matches=m[19];reading=Boolean(m[20]);inFrame=Boolean(m[21]);line=m[22];pending=Boolean(m[24]);idle=m[27];
    }
    synchronizeOwned=flush;ownedIRQ=()=>stagedPending?Boolean(m[24]):pending;
    return Object.freeze({before,after,skipPreparation(reason){if(reason===1)skippedSource++;else if(reason===2)skippedAudio++;else throw Error('Private boundary reason');},mappingRefreshes:()=>mappingRefreshes,stats:()=>({
     ownedAudioTicks,skippedPreparations:skippedSource+skippedAudio,skippedSourcePreparations:skippedSource,skippedAudioPreparations:skippedAudio,
     localMapperReads:e.owned_reads(),yieldSourceBoundary:e.owned_yields(1)+skippedSource,yieldMapperAudioEdge:e.owned_yields(2)+skippedAudio,
     yieldUnknownCHR:e.owned_yields(3),yieldSkippedDummy:e.owned_yields(4),yieldDirtyRow:e.owned_yields(5),yieldSpriteStatus:e.owned_yields(6),yieldNonBgPattern:e.owned_yields(7),
     localMapper:5,sourceSpriteFetch:true,sourceMapperAudio:true,synchronizations,mappingRefreshMeaning:'CHR-window/mirroring cache refreshes'
    })});
   },snapshot:mapping,fillInstructionMapping,unchanged:m=>version===m.version&&clock===m.clock});
 for(const key of ['ppuRead','ppuWrite','ppuFetch','setPPUAddress','advancePPUClock','loadRAM','loadCHR','loadMapperState']){const fn=api[key];if(fn)api[key]=function(...args){synchronizeOwned();mapperStageValid=false;return fn.apply(this,args);};}
 for(const key of ['checkpointCapture','checkpointRestore','snapshot','getMapperState','getPPUClock']){const fn=api[key];api[key]=function(...args){synchronizeOwned();return fn.apply(this,args);};}
 return Object.freeze(api);
}

// Generic fixed-property lookup; no mapping result or validation is cached.
const denseCache=new WeakMap(),machineSteps=new WeakMap();
function denseDispatch(blocks){
 if(!blocks||typeof blocks!=='object'||!Array.isArray(blocks)||blocks.length!==4||!Object.isFrozen(blocks))return null;
 if(denseCache.has(blocks))return denseCache.get(blocks);
 const result=[];
 for(let w=0;w<4;w++){
  const wd=Object.getOwnPropertyDescriptor(blocks,String(w));if(!wd||!('value' in wd))return null;
  const group=wd.value;if(!group||typeof group!=='object'||!Object.isFrozen(group))return null;
  const dense=Object.create(null);
  for(const [bank,bd] of Object.entries(Object.getOwnPropertyDescriptors(group))){
   if(!/^(0|[1-9][0-9]*)$/.test(bank)||!('value' in bd))return null;
   const table=bd.value;if(!table||Object.getPrototypeOf(table)!==null||!Object.isFrozen(table))return null;
   const row=new Array(8192);
   for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(table))){
    const pc=Number(key);if(!/^[0-9]+$/.test(key)||!Number.isInteger(pc)||pc<32768+w*8192||pc>=40960+w*8192||!('value' in d))return null;
    row[pc&8191]=d.value;
   }
   dense[bank]=row;
  }
  result.push(dense);
 }
 denseCache.set(blocks,result);return result;
}
export function bindMachineStep(cpu){
 const step=machineSteps.get(cpu);if(!step)bad('BAD_CPU','Module-owned CPU required');
 const result={kind:'',pc:0,cycles:0,physicalPC:0};return ()=>step(result);
}
function windowBank(m,w){switch(w){case 0:return m.w0;case 1:return m.w1;case 2:return m.w2;case 3:return m.w3;default:return undefined;}}
export function makeCPU(bus,blocks,info){
 if(!bus||['read','write','peek'].some(k=>typeof bus[k]!=='function'))bad('BAD_BUS','Bus requires read, write, peek');
 const mmc=true,banked=true;
 if(banked&&['mapPRG','getMappingState',...(mmc?['getCPUClock','advanceCPUClock']:[])].some(k=>typeof bus[k]!=='function'))bad('BAD_MAPPING_HOOK','Missing mapper/timing hooks');
 const owned=ownedBuses.get(bus),trusted=owned?.info===info?owned:null;
 function mapping(out){
  if(trusted)return out?trusted.fillInstructionMapping(out):trusted.snapshot();
  const v=valid5(bus.getMappingState(),info);if(bus.getCPUClock()!==v.clock)bad('BAD_MAPPING','Clock hook mismatch');return v;
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
  const bank=windowBank(m,((a-32768)>>>13));if(bank<0)bad('MUTABLE_CODE_UNSUPPORTED','Instruction/vector bytes must be immutable PRG ROM',a);const expected=bank*8192+(a&8191);
  if(trusted){address(a);if(a<32768)bad('BAD_ARGUMENT','Immutable PRG address');return;}
  const actual=bus.mapPRG(a);
  unchanged(m);
  if(actual!==expected)bad('BAD_MAPPING','Incorrect physical mapping',a);
 }
 // Check the epoch before interpreting callback results. A changed mapping is
 // a stale snapshot, not evidence of a stable but incorrect physical mapping.
 function fetchByte(a,m,peek=false){
  if(banked)mapped(a,m);
  const value=peek?bus.peek(a):bus.read(a);
  if(banked){unchanged(m);if(!trusted)mapped(a,m);}
  return byte(value);
 }
 mapping();const dense=denseDispatch(blocks);const instructionMapping={mapper:5,identity:info.mappingIdentity,version:0,clock:0,w0:0,w1:0,w2:0,w3:0};
 const s={a:0,x:0,y:0,sp:0,p:36,pc:0,cycles:0,instructions:0};let irq=false,nmiLine=false,nmiPending=false,irqMask=4,hold=false,busy=false,startCycle=0;
 const timed=typeof bus.dmaClock==='function';let coreStart=0;
 function begin(){if(timed){const q=bus.dmaClock();startCycle=integer(q.cycle,Number.MAX_SAFE_INTEGER-16384,'DMA clock');coreStart=q.accesses;if(s.cycles!==startCycle)bad('BAD_TIMING','CPU and DMA clocks differ at entry');}else if(mmc){startCycle=integer(bus.getCPUClock(),Number.MAX_SAFE_INTEGER-32,'CPU clock');}}
 const c={s,r:a=>byte(bus.read(a&65535)),w:(a,v,offset)=>{if(timed){integer(offset,6,'Write offset');const q=bus.dmaClock();if(q.accesses-coreStart!==offset)bad('BAD_TIMING','Static write offset differs from bus trace');bus.write(a&65535,byte(v),q.cycle);}else if(mmc){integer(offset,6,'Write offset');bus.write(a&65535,byte(v),startCycle+offset);}else bus.write(a&65535,byte(v));},norm:p=>(p|32)&239,f(mask,on){s.p=on?s.p|mask:s.p&~mask;},nz(v){v&=255;s.p=(s.p&125)|(v===0?2:0)|(v&128);return v;},push(v,offset){c.w(256+s.sp,v,offset);s.sp=(s.sp-1)&255;},pop(){s.sp=(s.sp+1)&255;return c.r(256+s.sp);},word(a){return c.r(a)|(c.r((a+1)&65535)<<8);},vector,q(a,v){if(fetchByte(a,mapping())!==v)bad('CODE_CHANGED','Late source operand fetch differs',a);}};
 const snapshot=()=>({a:s.a,x:s.x,y:s.y,sp:s.sp,p:s.p,pc:s.pc,cycles:s.cycles,instructions:s.instructions});
 function safe(){if(busy)bad('REENTRANT_CPU','Callbacks may not reenter CPU setters/execution');}
 function setState(patch){safe();if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!Object.hasOwn(s,k)))bad('BAD_STATE','Unknown CPU state property');for(const [k,v] of Object.entries(patch))integer(v,k==='pc'?65535:['cycles','instructions'].includes(k)?Number.MAX_SAFE_INTEGER-8:255,'Invalid CPU state');Object.assign(s,patch);s.p=c.norm(s.p);if('p' in patch)irqMask=s.p&4;}
 function addCycles(n){if(timed){const q=bus.dmaClock(),elapsed=q.cycle-startCycle;if(q.accesses-coreStart!==n||elapsed<n||elapsed>n+8192)bad('BAD_TIMING','Static cycle trace or DMA bound differs');if(mmc)bus.advanceCPUClock(q.cycle);s.cycles=q.cycle;}else{if(s.cycles>Number.MAX_SAFE_INTEGER-8)bad('CYCLE_OVERFLOW','Counter exhausted');if(mmc)bus.advanceCPUClock(startCycle+n);s.cycles+=n;}}
 function vector(a){const m=mapping(),lo=fetchByte(a,m),hi=fetchByte(a+1,m);if(banked)unchanged(m);return lo|(hi<<8);}
 function reset(){safe();busy=true;try{begin();if(timed){c.r(s.pc);c.r(s.pc);for(let i=0;i<3;i++){c.r(256+s.sp);s.sp=(s.sp-1)&255;}}else s.sp=(s.sp-3)&255;s.p=c.norm(s.p|4);s.pc=vector(65532);addCycles(7);irqMask=4;nmiPending=false;hold=false;return snapshot();}finally{busy=false;}}
 function interrupt(a){c.r(s.pc);c.r(s.pc);c.push(s.pc>>>8,2);c.push(s.pc&255,3);c.push(c.norm(s.p),4);s.p|=4;s.pc=vector(a);irqMask=4;hold=true;addCycles(7);}
 function receipt(out,kind,pc,cycles){if(!out)return {kind,pc,cycles};out.kind=kind;out.pc=pc;out.cycles=cycles;return out;}
 const verifiedCode=new WeakMap();
 const verifiedPages=trusted?.sourcePeek&&dense?dense.map(group=>Object.fromEntries(Object.keys(group).map(bank=>[bank,new Uint8Array(1024)]))):null;
 function step(out){safe();busy=true;try{
  if(s.cycles>Number.MAX_SAFE_INTEGER-8||s.instructions>Number.MAX_SAFE_INTEGER-2)bad('COUNTER_OVERFLOW','Counter exhausted');begin();const pc=s.pc;
  if(!hold&&(nmiPending||(irq&&!irqMask))){const nmi=nmiPending;if(nmi)nmiPending=false;interrupt(nmi?65530:65534);return receipt(out,nmi?'nmi':'irq',pc,timed?s.cycles-startCycle:7);}
  if(pc<32768)bad('MUTABLE_CODE_UNSUPPORTED','Execution outside immutable PRG',pc);
  const m=mapping(instructionMapping);if(banked)mapped(pc,m);
  const window=(pc-32768)>>>13,bank=windowBank(m,window);let entry=dense?dense[window][bank][pc&8191]:blocks[window][bank][pc];
  const crossed=Boolean(entry&&entry.cross);
  if(crossed){const next=windowBank(m,window+1);if(next<0)bad('MUTABLE_CODE_UNSUPPORTED','Cross-window operands enter RAM',pc);entry=entry.cross[next];}
  if(!entry){const op=fetchByte(pc,m,true);bad(info.officialOpcodes.includes(op)?'MISSING_TRANSLATION':'UNSUPPORTED_OPCODE','No translated instruction at '+pc+' (opcode '+op+')',pc);}
  // Only immutable entries and the exact owned ROM peek can reuse verification.
  // Actual cycle-bearing reads below always execute, including DMA and PCM effects.
  const page=!crossed&&verifiedPages?verifiedPages[window][bank]:null,slot=(pc&8191)>>>3,bit=1<<(pc&7);
  const codeKey=page?0:(bank*65536+pc)*129+(window<3?windowBank(m,window+1)+1:0);
  const verified=page?Boolean(page[slot]&bit):trusted?.sourcePeek&&verifiedCode.get(entry)?.key===codeKey;
  if(!verified){
   for(let i=0;i<entry[0].length;i++)if(fetchByte(pc+i,m,true)!==entry[0][i])bad('CODE_CHANGED','Peek differs from source',pc);
   if(trusted?.sourcePeek&&Object.isFrozen(entry)&&Object.isFrozen(entry[0])){if(page)page[slot]|=bit;else verifiedCode.set(entry,{key:codeKey});}
  }
  if(verified){
   // The immutable entry's address range was checked during source verification.
   // Each real read still runs, validates its byte and checks callback mutations.
   for(let i=0;i<(entry[3]??entry[0].length);i++){const value=bus.read(pc+i);unchanged(m);if(byte(value)!==entry[0][i])bad('CODE_CHANGED','Fetch differs from source',pc);}
  }else{for(let i=0;i<(entry[3]??entry[0].length);i++)if(fetchByte(pc+i,m)!==entry[0][i])bad('CODE_CHANGED','Fetch differs from source',pc);}
  if(banked)unchanged(m);
  // Semantic writes legitimately update mapping and the MMC1 clock. Do not
  // compare their final state to the pre-fetch snapshot.
  if(out)out.physicalPC=bank*8192+(pc&8191);const old=s.p;hold=false;const n=entry[1](c);s.p=c.norm(s.p);irqMask=entry[2]===1?old&4:s.p&4;if(entry[2]===2)hold=true;addCycles(n);s.instructions++;return receipt(out,'instruction',pc,timed?s.cycles-startCycle:n);
 }finally{busy=false;}}
 function run(options={}){safe();if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxSteps','maxCycles','maxMs'].includes(k)))bad('BAD_ARGUMENT','Invalid run options');const maxSteps=options.maxSteps??1000,maxCycles=options.maxCycles??100000,maxMs=options.maxMs??1000;integer(maxSteps,1000000,'maxSteps');integer(maxCycles,10000000,'maxCycles');integer(maxMs,5000,'maxMs');if(!maxSteps||!maxCycles||!maxMs)bad('BAD_ARGUMENT','Positive bounds required');const now=()=>globalThis.performance?.now?.()??Date.now(),start=now(),initial=s.cycles;let steps=0,reason='steps';while(steps<maxSteps){if(s.cycles-initial>=maxCycles){reason='cycles';break;}if(now()-start>=maxMs){reason='time';break;}step();steps++;}return {steps,cycles:s.cycles-initial,reason,state:snapshot()};}
 const api=Object.freeze({checkpointCapture(){safe();return {s,irq,nmiLine,nmiPending,irqMask,hold,startCycle,coreStart};},checkpointRestore(v){safe();setState(v.s);({irq,nmiLine,nmiPending,irqMask,hold,startCycle,coreStart}=v);},bus,getState:snapshot,getPC:()=>s.pc,setState,step:()=>step(),run,reset,setIRQ(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean IRQ required');irq=v;},setNMI(v){safe();if(typeof v!=='boolean')bad('BAD_ARGUMENT','Boolean NMI required');if(v&&!nmiLine)nmiPending=true;nmiLine=v;},requestNMI(){safe();nmiPending=true;},getSignals:()=>({irq,nmiLine,nmiPending,irqMask:Boolean(irqMask),hold})});machineSteps.set(api,step);reset();return api;
}

export function bindOwnedPPU(base,e){const record=ownedBuses.get(base);if(!record?.bindPPU)throw Error('Owned MMC5 bus required');return record.bindPPU(e);}
