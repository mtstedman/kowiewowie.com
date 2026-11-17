// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const restoreArray=imports[0]["restoreArray"];
const replaceRows=imports[0]["replaceRows"];
const createOamEvaluator=imports[1]["createOamEvaluator"];
const REFERENCE=imports[1]["referenceOamModel"];

// Derived dot fetch pipeline. No CPU emulation or runtime opcode decoding.
// JSNES supplies the authenticated device container, palettes and APU.

function installOwnedDotPPU(nes,bus,peek,write,capture){
 let oamTransfer;
 const p=nes.ppu,cpu=nes.cpu;
 let v=0,t=0,fineX=0,first=true,dot=bus.getPPUClock?.()??0,odd=false,lastClear=-1;
 let lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 const secondary=p.secondaryOAM;secondary.fill(255);const oam=createOamEvaluator(p,secondary,bridge=>{oamTransfer=bridge;});const oamTick=oam.tick,oamFinish=oam.finish,oamRead=oam.read;
 let sprite0Lo=0,sprite0Hi=0,sprite0Counter=255,sprite0Armed=false,sprite0Valid=false,sprite1Lo=0,sprite1Hi=0,sprite1Counter=255,sprite1Armed=false,sprite1Valid=false,sprite2Lo=0,sprite2Hi=0,sprite2Counter=255,sprite2Armed=false,sprite2Valid=false,sprite3Lo=0,sprite3Hi=0,sprite3Counter=255,sprite3Armed=false,sprite3Valid=false,sprite4Lo=0,sprite4Hi=0,sprite4Counter=255,sprite4Armed=false,sprite4Valid=false,sprite5Lo=0,sprite5Hi=0,sprite5Counter=255,sprite5Armed=false,sprite5Valid=false,sprite6Lo=0,sprite6Hi=0,sprite6Counter=255,sprite6Armed=false,sprite6Valid=false,sprite7Lo=0,sprite7Hi=0,sprite7Counter=255,sprite7Armed=false,sprite7Valid=false;
 const current=Array.from({length:8},(_,slot)=>{switch(slot){case 0:return {get lo(){return sprite0Lo;},set lo(value){sprite0Lo=value;},get hi(){return sprite0Hi;},set hi(value){sprite0Hi=value;},x:255,get counter(){return sprite0Counter;},set counter(value){sprite0Counter=value;},get armed(){return sprite0Armed;},set armed(value){sprite0Armed=value;},attr:255,zero:false,get valid(){return sprite0Valid;},set valid(value){sprite0Valid=value;},address:0};case 1:return {get lo(){return sprite1Lo;},set lo(value){sprite1Lo=value;},get hi(){return sprite1Hi;},set hi(value){sprite1Hi=value;},x:255,get counter(){return sprite1Counter;},set counter(value){sprite1Counter=value;},get armed(){return sprite1Armed;},set armed(value){sprite1Armed=value;},attr:255,zero:false,get valid(){return sprite1Valid;},set valid(value){sprite1Valid=value;},address:0};case 2:return {get lo(){return sprite2Lo;},set lo(value){sprite2Lo=value;},get hi(){return sprite2Hi;},set hi(value){sprite2Hi=value;},x:255,get counter(){return sprite2Counter;},set counter(value){sprite2Counter=value;},get armed(){return sprite2Armed;},set armed(value){sprite2Armed=value;},attr:255,zero:false,get valid(){return sprite2Valid;},set valid(value){sprite2Valid=value;},address:0};case 3:return {get lo(){return sprite3Lo;},set lo(value){sprite3Lo=value;},get hi(){return sprite3Hi;},set hi(value){sprite3Hi=value;},x:255,get counter(){return sprite3Counter;},set counter(value){sprite3Counter=value;},get armed(){return sprite3Armed;},set armed(value){sprite3Armed=value;},attr:255,zero:false,get valid(){return sprite3Valid;},set valid(value){sprite3Valid=value;},address:0};case 4:return {get lo(){return sprite4Lo;},set lo(value){sprite4Lo=value;},get hi(){return sprite4Hi;},set hi(value){sprite4Hi=value;},x:255,get counter(){return sprite4Counter;},set counter(value){sprite4Counter=value;},get armed(){return sprite4Armed;},set armed(value){sprite4Armed=value;},attr:255,zero:false,get valid(){return sprite4Valid;},set valid(value){sprite4Valid=value;},address:0};case 5:return {get lo(){return sprite5Lo;},set lo(value){sprite5Lo=value;},get hi(){return sprite5Hi;},set hi(value){sprite5Hi=value;},x:255,get counter(){return sprite5Counter;},set counter(value){sprite5Counter=value;},get armed(){return sprite5Armed;},set armed(value){sprite5Armed=value;},attr:255,zero:false,get valid(){return sprite5Valid;},set valid(value){sprite5Valid=value;},address:0};case 6:return {get lo(){return sprite6Lo;},set lo(value){sprite6Lo=value;},get hi(){return sprite6Hi;},set hi(value){sprite6Hi=value;},x:255,get counter(){return sprite6Counter;},set counter(value){sprite6Counter=value;},get armed(){return sprite6Armed;},set armed(value){sprite6Armed=value;},attr:255,zero:false,get valid(){return sprite6Valid;},set valid(value){sprite6Valid=value;},address:0};case 7:return {get lo(){return sprite7Lo;},set lo(value){sprite7Lo=value;},get hi(){return sprite7Hi;},set hi(value){sprite7Hi=value;},x:255,get counter(){return sprite7Counter;},set counter(value){sprite7Counter=value;},get armed(){return sprite7Armed;},set armed(value){sprite7Armed=value;},attr:255,zero:false,get valid(){return sprite7Valid;},set valid(value){sprite7Valid=value;},address:0};}});
 const unit0=current[0],unit1=current[1],unit2=current[2],unit3=current[3],unit4=current[4],unit5=current[5],unit6=current[6],unit7=current[7];
 const rendering=()=>Boolean(p.f_bgVisibility||p.f_spVisibility),active=()=>rendering()&&p.scanline>=20&&p.scanline<=260;
 function counters(){p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=first;p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;}
 function xinc(){if(lastX===dot)return;lastX=dot;if((v&31)===31)v=(v&~31)^1024;else v++;}
 function yinc(){if(lastY===dot)return;lastY=dot;if((v&28672)!==28672)v+=4096;else{v&=~28672;let y=(v>>>5)&31;if(y===29){y=0;v^=2048;}else if(y===31)y=0;else y++;v=(v&~992)|(y<<5);}}
 function drive(a,latch=true){a&=16383;if(latch)busLow=a&255;addr=(a&0x3f00)|busLow;bus.setPPUAddress(addr,dot);}
 function sample(a){if((addr&0x3f00)!==(a&0x3f00))drive(a,false);fetchReads++;return peek(addr);}
 function spriteAddress(slot){const i=slot*4,tile=secondary[i+1],attr=secondary[i+2],height=p.f_spriteSize?16:8;let row=((p.scanline===20?255:p.scanline-21)-secondary[i])&(height-1);if(attr&128)row=height-1-row;return p.f_spriteSize?((tile&1)<<12)|((tile&254)<<4)|((row&8)<<1)|(row&7):(p.f_spPatternTable<<12)|(tile<<4)|(row&7);}
 function boundary(remaining){
  if(p.scanline===0&&p.curX===1&&p.vblankPending)p._fireVblankSet(cpu,remaining);
  if(p.scanline===20&&p.curX===1&&lastClear!==dot){lastClear=dot;p._fireVblankClear(cpu,remaining<=1);}
 }
 function tick(remaining){
  boundary(remaining);
  const d=p.curX,line=p.scanline,run=Boolean(p.f_bgVisibility||p.f_spVisibility)&&p.scanline>=20&&p.scanline<=260,visible=line>=21&&line<=260&&d>=1&&d<=256;
  const backgroundWindow=(d>=1&&d<=256)||(d>=321&&d<=336);
  const scrollRun=REFERENCE?renderPrevious&&line>=20&&line<=260:run;
  oamTick(d,line,run);
  if(visible){const x=d-1,y=line-21;
  const mask=0x8000>>>fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?((lo&mask?1:0)|(hi&mask?2:0)):0,ba=(al&mask?1:0)|(ah&mask?2:0);
  let sp=0,sa=0,behind=false,zero=false;
  if(p.f_spVisibility&&(x>=8||p.f_spClipping)){spriteSelection:{
   {const s=unit0;if(sprite0Valid&&sprite0Armed&&sprite0Counter===0){const px=((sprite0Lo>>>7)&1)|((sprite0Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit1;if(sprite1Valid&&sprite1Armed&&sprite1Counter===0){const px=((sprite1Lo>>>7)&1)|((sprite1Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit2;if(sprite2Valid&&sprite2Armed&&sprite2Counter===0){const px=((sprite2Lo>>>7)&1)|((sprite2Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit3;if(sprite3Valid&&sprite3Armed&&sprite3Counter===0){const px=((sprite3Lo>>>7)&1)|((sprite3Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit4;if(sprite4Valid&&sprite4Armed&&sprite4Counter===0){const px=((sprite4Lo>>>7)&1)|((sprite4Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit5;if(sprite5Valid&&sprite5Armed&&sprite5Counter===0){const px=((sprite5Lo>>>7)&1)|((sprite5Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit6;if(sprite6Valid&&sprite6Armed&&sprite6Counter===0){const px=((sprite6Lo>>>7)&1)|((sprite6Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
   {const s=unit7;if(sprite7Valid&&sprite7Armed&&sprite7Counter===0){const px=((sprite7Lo>>>7)&1)|((sprite7Hi>>>6)&2);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break spriteSelection;}}}
  }}
  if(bg&&sp&&zero&&x!==255){p.setStatusFlag(p.STATUS_SPRITE0HIT,true);p.hitSpr0=true;}
  let index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
  if(!Boolean(p.f_bgVisibility||p.f_spVisibility)&&(v&0x3f00)===0x3f00){index=v&31;if((index&19)===16)index&=15;}
  p.buffer[y*256+x]=p.palTable.getEntry(peek(0x3f00+index)&(p.f_dispType?0x30:0x3f));

  }
  if(visible||run&&backgroundWindow){lo=(lo<<1)&65535;hi=((hi<<1)|1)&65535;al=((al<<1)|(attributeFill&1))&65535;ah=((ah<<1)|((attributeFill>>>1)&1))&65535;}
  if(visible){{if(sprite0Armed){if(sprite0Counter>0)sprite0Counter--;else if(run){sprite0Lo=(sprite0Lo<<1)&255;sprite0Hi=(sprite0Hi<<1)&255;}}}{if(sprite1Armed){if(sprite1Counter>0)sprite1Counter--;else if(run){sprite1Lo=(sprite1Lo<<1)&255;sprite1Hi=(sprite1Hi<<1)&255;}}}{if(sprite2Armed){if(sprite2Counter>0)sprite2Counter--;else if(run){sprite2Lo=(sprite2Lo<<1)&255;sprite2Hi=(sprite2Hi<<1)&255;}}}{if(sprite3Armed){if(sprite3Counter>0)sprite3Counter--;else if(run){sprite3Lo=(sprite3Lo<<1)&255;sprite3Hi=(sprite3Hi<<1)&255;}}}{if(sprite4Armed){if(sprite4Counter>0)sprite4Counter--;else if(run){sprite4Lo=(sprite4Lo<<1)&255;sprite4Hi=(sprite4Hi<<1)&255;}}}{if(sprite5Armed){if(sprite5Counter>0)sprite5Counter--;else if(run){sprite5Lo=(sprite5Lo<<1)&255;sprite5Hi=(sprite5Hi<<1)&255;}}}{if(sprite6Armed){if(sprite6Counter>0)sprite6Counter--;else if(run){sprite6Lo=(sprite6Lo<<1)&255;sprite6Hi=(sprite6Hi<<1)&255;}}}{if(sprite7Armed){if(sprite7Counter>0)sprite7Counter--;else if(run){sprite7Lo=(sprite7Lo<<1)&255;sprite7Hi=(sprite7Hi<<1)&255;}}}}
  const oldLow=v&255;
  if(scrollRun&&d===257)v=(v&~0x041f)|(t&0x041f);
  if(run){
   if(d===257)drive(0x2000|(v&0x0f00)|oldLow);
   if(line===20&&d>=280&&d<=304)v=(v&~0x7be0)|(t&0x7be0);
   if(backgroundWindow){
    const phase=(d-1)&7;
     if(phase<4){
      if(phase<2){
       if(phase===0){drive(0x2000|(v&0x0fff));fetchKind=1;}else{nt=sample(0x2000|(v&0x0fff));}
      }else{
       if(phase===2){drive(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7));fetchKind=2;attrShift=((v>>>4)&4)|(v&2);}else{at=(sample(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7))>>>attrShift)&3;}
      }
     }else{
      if(phase<6){
       if(phase===4){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));fetchKind=3;}else{pl=sample((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));}
      }else{
       if(phase===6){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);fetchKind=4;}else{ph=sample((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);attributeFill=at;lo=(lo&65280)|pl;hi=(hi&65280)|ph;al=(al&65280)|((at&1)?255:0);ah=(ah&65280)|((at&2)?255:0);}
      }
     }
   }else if(d>=257&&d<=320){
    const slot=(d-257)>>>3,phase=(d-257)&7,s=current[slot];
    if(phase===0){if(d!==257)drive(0x2000|(v&0x0fff));}
    else if(phase===1||phase===3){sample(0x2000|(v&0x0fff));if(phase===3){s.x=oamRead();s.counter=s.x;s.armed=false;}}
    else if(phase===2){s.attr=oamRead();drive(0x2000|(v&0x0fff));}
    else if(phase===4){s.address=spriteAddress(slot);drive(s.address);}
    else if(phase===5){const value=sample(s.address);s.valid=slot<oam.count&&line!==20;s.zero=slot===0&&oam.zero;s.lo=s.valid?((s.attr&64)?reversedBytes[value&255]:value):0;}
    else if(phase===6)drive(s.address|8);
    else if(phase===7){const value=sample(s.address|8);s.hi=slot<oam.count&&line!==20?((s.attr&64)?reversedBytes[value&255]:value):0;}
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===338||d===340)nt=sample(0x2000|(v&0x0fff));
   else if(d===0){if(carryDummy){nt=sample(0x2000|(v&0x0fff));carryDummy=false;}else drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));}
   if(d===339){sprite0Armed=true;sprite1Armed=true;sprite2Armed=true;sprite3Armed=true;sprite4Armed=true;sprite5Armed=true;sprite6Armed=true;sprite7Armed=true;}
  }else{drive(v&16383,Boolean(d&1));if(d===0)carryDummy=false;}
  // The previous-render latch permits the final increment/reload strobe even
  // when fetching has stopped. Conversely, enable does not invent a strobe.
  if(scrollRun&&backgroundWindow&&(d&7)===0)xinc();
  if(scrollRun&&d===256)yinc();
  const release=oamFinish(d,line);
  if(REFERENCE){if(release)drive(v&16383);renderPrevious=Boolean(p.f_bgVisibility||p.f_spVisibility);}
  if(addressPending||incrementPending||maskQueue.length)finishDot();if(REFERENCE&&edgeRemaining>0)traceEdge();
  if(dot>=Number.MAX_SAFE_INTEGER-1)fail('PPU_CLOCK_LIMIT','PPU clock exhausted');
  dot++;bus.advancePPUClock?.(dot);
  if(line===20&&d===339&&odd&&run){carryDummy=true;p.curX=0;p.scanline=21;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else p.scanline++;}
  p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=first;p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;
 }
 p.advanceDots=n=>{if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');if(n===3){tick(3);tick(2);tick(1);}else for(let i=0;i<n;i++)tick(n-i);boundary(0);};
 p.triggerRendering=()=>{};p.renderFramePartially=()=>{throw Error('Lazy rendering forbidden in dot adapter');};
 p.startFrame=()=>{};
 p.startVBlank=()=>{if(p.openBusDecayFrames>0&&--p.openBusDecayFrames===0)p.openBusLatch=0;nes.ui.writeFrame(p.buffer);p.lastRenderedScanline=-1;};
 p.cntsToAddress=()=>{p.vramAddress=v;};p.regsToAddress=()=>{p.vramTmpAddress=t;};
 p.cntsFromAddress=()=>{v=p.vramAddress&32767;counters();};p.regsFromAddress=()=>{t=p.vramTmpAddress&32767;counters();};
  // Digital register contract. These are not CPU instructions or a CPU clock.
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const byte=n=>{if(!Number.isInteger(n)||n<0||n>255)fail('PPU_ARGUMENT','Expected register byte');return n;};
 let addressPending=null,incrementPending=false,maskPending=null,lastRead=-100000,lastX=-1,lastY=-1;
 let attrShift=0,carryDummy=false,fetchReads=0;
 let busLow=0,attributeFill=0,renderPrevious=rendering();
 let maskRequested=(p.f_bgVisibility?8:0)|(p.f_spVisibility?16:0)|(p.f_bgClipping?2:0)|(p.f_spClipping?4:0);
 let maskWanted=maskRequested&30;
 const maskQueue=[],maskTrace=[],edgeTrace=[];
 let edgeRemaining=0,droppedEdgeTrace=0,maskPendingLeft=0;
 const maskStats={writes:0,commits:0,starts:0,stops:0,layer_changes:0,active_transitions:0,palette_range_transitions:0,dropped_trace:0};
 function recordMask(kind,value){
  if(maskTrace.length===24){maskTrace.shift();maskStats.dropped_trace++;}
  maskTrace.push({kind,value,absolute_dot:dot,scanline:p.scanline,dot:p.curX,bus_address:addr,v,oam_address:p.sramAddress&255});
 }
 function traceEdge(){
  if(!REFERENCE||edgeRemaining<=0)return;
  edgeRemaining--;
  if(edgeTrace.length===32){edgeTrace.shift();droppedEdgeTrace++;}
  // Compact numeric rows are bounded, including repeated active transitions.
  edgeTrace.push([dot,p.scanline,p.curX,Number(rendering()),Number(renderPrevious),v,t,addr,busLow,fetchReads,lo,hi,al,ah,nt,at,pl,ph,...oam.traceState(),...current.flatMap(s=>[s.counter,s.lo,s.hi,Number(s.valid),Number(s.armed)])]);
 }
 function setMask(value){
  byte(value);maskRequested=value;maskStats.writes++;recordMask('write',value);
  if(REFERENCE&&p.scanline>=20&&p.scanline<=260)edgeRemaining=16;
  const bits=value&30;
  if(bits!==maskWanted){
   if(maskQueue.length>=8)fail('PPU_ACCESS_ORDER','Too many PPUMASK writes without advancing the PPU');
   maskQueue.push({value:bits,bg:(bits>>>3)&1,sp:(bits>>>4)&1,due:dot+3});
   maskWanted=bits;maskPending=maskQueue[0];maskPendingLeft=maskPending.due-dot;
  }
  p.f_color=(value>>>5)&7;p.f_dispType=value&1;p.palTable.setEmphasis(p.f_color);p.updatePalettes();
 }
 function finishMask(){
  while(maskQueue.length&&maskQueue[0].due<=dot+1){
   const item=maskQueue[0],was=rendering(),on=Boolean(item.bg||item.sp),visible=p.scanline>=20&&p.scanline<=260;
   if(was!==on){
    if(visible&&(v&0x3c00)===0x3c00){
     if(!REFERENCE)fail('UNSUPPORTED_MASK_PALETTE_PHASE','Rendering transition in the palette-corruption address range requires physical phase evidence');
     maskStats.palette_range_transitions++;
    }
    oam.transition(on,p.curX,p.scanline);
   }
   maskQueue.shift();p.f_bgVisibility=item.bg;p.f_spVisibility=item.sp;p.f_bgClipping=(item.value>>>1)&1;p.f_spClipping=(item.value>>>2)&1;
   maskStats.commits++;
   if(was!==on){if(on)maskStats.starts++;else maskStats.stops++;if(visible)maskStats.active_transitions++;}
   else maskStats.layer_changes++;
   if(!on&&was&&!REFERENCE)drive(v&16383,false);
   recordMask('commit',item.value);
  }
  maskPending=maskQueue.length?maskQueue[0]:null;if(maskPending)maskPendingLeft=maskPending.due-(dot+1);
 }
 const maskSnapshot=()=>({requested:maskRequested,effective:(p.f_bgVisibility?8:0)|(p.f_spVisibility?16:0)|(p.f_bgClipping?2:0)|(p.f_spClipping?4:0),previous_rendering:renderPrevious,stats:{...maskStats},trace:maskTrace.map(x=>({...x})),queue:maskQueue.map(x=>({...x})),edge_trace:edgeTrace.map(x=>x.slice()),dropped_edge_trace:droppedEdgeTrace});
 const reversedBytes=Uint8Array.from({length:256},(_,value)=>{value=((value&0x55)<<1)|((value>>>1)&0x55);value=((value&0x33)<<2)|((value>>>2)&0x33);return ((value<<4)|(value>>>4))&255;});


 const access={addressWrites:0,addressCommits:0,activeAddressCommits:0,scrollWrites:0,dataReads:0,ignoredReads:0,dataWrites:0,activeDataReads:0,activeDataWrites:0,activeOamWrites:0,oamAddressWrites:0};
 function temporaryRace(){if(active()&&p.curX===257)fail('UNSUPPORTED_PPU_TEMP_RACE','Dot-257 CPU/open-bus temporary-scroll race needs independent phase evidence');}
 function finishDot(){
  if(addressPending&&--addressPending.left===0){
   const target=addressPending.value,d=p.curX;
   if(active()&&d===257)v&=target;
   else if(active()&&d>0&&(d&7)===0&&(d<=256||d>=321&&d<=336))v=(target&~0x041f)|(v&target&0x041f);
   else v=target;
   v&=32767;t=v;addressPending=null;access.addressCommits++;if(active())access.activeAddressCommits++;else drive(v&16383);
  }
  if(incrementPending){incrementPending=false;if(active()){xinc();yinc();}else{v=(v+(p.f_addrInc?32:1))&32767;drive(v&16383);}}
  finishMask();
 }
 function scheduleIncrement(){if(incrementPending)fail('PPU_ACCESS_ORDER','Multiple PPUDATA accesses without a dot');incrementPending=true;}
 p.updateControlReg1=value=>{byte(value);temporaryRace();if(value&64)fail('UNSUPPORTED_PPU_EXT','External PPU pin mode is outside the hardware policy');p.f_nmiOnVblank=(value>>>7)&1;p.f_spriteSize=(value>>>5)&1;p.f_bgPatternTable=(value>>>4)&1;p.f_spPatternTable=(value>>>3)&1;p.f_addrInc=(value>>>2)&1;p.f_nTblAddress=value&3;p.regS=p.f_bgPatternTable;t=(t&~0x0c00)|((value&3)<<10);counters();p._updateNmiOutput();};
 p.updateControlReg2=setMask;
 p.scrollWrite=value=>{byte(value);if(first){temporaryRace();t=(t&~31)|(value>>>3);fineX=value&7;}else t=(t&~0x73e0)|((value&7)<<12)|((value&248)<<2);first=!first;access.scrollWrites++;counters();};
 p.writeVRAMAddress=value=>{byte(value);if(first){temporaryRace();t=(t&255)|((value&63)<<8);}else{if(addressPending)fail('PPU_ACCESS_ORDER','Uncommitted PPUADDR pair');t=(t&0x7f00)|value;addressPending={left:3,value:t};}first=!first;access.addressWrites++;counters();};
 p.readStatusRegister=()=>{const value=(cpu.mem[0x2002]&224)|(p.openBusLatch&31);first=true;if(p.scanline===0&&p.curX===0)p.nmiSuppressed=true;p.setStatusFlag(p.STATUS_VBLANK,false);p._updateNmiOutput();p.openBusLatch=value;p.openBusDecayFrames=36;counters();return value;};
 p.vramLoad=()=>{
  if(dot-lastRead<6){access.ignoredReads++;return p.openBusLatch;}
  if(incrementPending)fail('PPU_ACCESS_ORDER','PPUDATA increment still pending');
  const a=addr&16383;let value;
  if(a<0x3f00){value=p.vramBufferedReadValue;p.vramBufferedReadValue=peek(a);}
  else{value=(peek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&192);p.vramBufferedReadValue=peek(a&0x2fff);}
  // Palette storage is internal. The external bus retains its actual address;
  // the nametable shadow lookup must not fabricate a mapper A12 transition.
  lastRead=dot;access.dataReads++;if(active())access.activeDataReads++;scheduleIncrement();p.openBusLatch=value;p.openBusDecayFrames=36;return value;
 };
 p.vramWrite=value=>{
  byte(value);if(incrementPending)fail('PPU_ACCESS_ORDER','PPUDATA increment still pending');const a=addr&16383;
  if(active()&&a<0x3f00){if(!REFERENCE)fail('UNSUPPORTED_RENDER_DATA_WRITE','Active-render nonpalette write corruption is unqualified; no ordinary VRAM write is substituted');value=a&255;access.activeDataWrites++;}
  write(a,value);access.dataWrites++;scheduleIncrement();
 };
 p.renderRegisterState=()=>Object.freeze({v,t,fine_x:fineX,write_toggle:first?0:1,bus_address:addr,absolute_dot:dot,read_buffer:p.vramBufferedReadValue,pending_address:addressPending?{...addressPending}:null,pending_increment:incrementPending,pending_mask:maskPending?{...maskPending,left:maskPendingLeft}:null,ppu_mask:maskSnapshot(),oam:oam.snapshot(),sprite_units:current.map(s=>({...s})),background:{lo,hi,al,ah,nt,at,pl,ph},external_low_latch:busLow,fetch_reads:fetchReads,access:{...access},policy:'ntsc-dot3-mesen211-oam-v1'});
 const originalOamWrite=p.sramWrite.bind(p),originalOamAddress=p.writeSRAMAddress.bind(p);
 function oamGuard(){if(active()){const e=new Error('Active-render OAM writes require dot sprite evaluation');e.code='UNSUPPORTED_RENDER_OAM';throw e;}}
 p.sramWrite=value=>{
  byte(value);
  if(!REFERENCE){oamGuard();originalOamWrite(value);return;}
  if(active()){p.sramAddress=(p.sramAddress+4)&255;access.activeOamWrites++;}
  else originalOamWrite((p.sramAddress&3)===2?value&0xe3:value);
 };
 p.writeSRAMAddress=value=>{byte(value);if(!REFERENCE)oamGuard();originalOamAddress(value);access.oamAddressWrites++;};
 p.sramLoad=()=>{const value=active()?oamRead():oam.primary(p.sramAddress);p.openBusLatch=value;p.openBusDecayFrames=36;return value;};
 nes.mmap.clockIrqCounter=()=>{throw Error('Scanline IRQ callback forbidden: MMC3 is driven by filtered PPU A12');};nes.mmap.latchAccess=()=>{throw Error('Lazy mapper latch callback forbidden');};
 drive(v&16383);counters();

 // Capture is lexical factory access, never a public PPU property or trust flag.
 // Export/import must occur outside an in-flight JS call/callback.
 const deviceFields=["scanline","curX","vblankPending","nmiSuppressed","nmiOutput","frameEnded","spr0HitX","spr0HitY","openBusLatch","openBusDecayFrames","vramBufferedReadValue","sramAddress","spritesFound","sprite0InSecondary","hitSpr0","lastRenderedScanline","f_bgVisibility","f_spVisibility","f_bgClipping","f_spClipping","f_spriteSize","f_bgPatternTable","f_spPatternTable","f_dispType","f_color","f_addrInc","f_nmiOnVblank","f_nTblAddress","regS","vramAddress","vramTmpAddress","firstWrite","regFH","cntFV","cntV","cntH","cntVT","cntHT","regFV","regV","regH","regVT","regHT"];
 const cpuFields=['nmiRaised','nmiPending','nmiRaisedAtCycle','nmiDotsRemainingInStep'];
 const bulk=()=>({primary:p.spriteMem,secondary,frame:p.buffer,sprX:p.sprX,sprY:p.sprY,sprTile:p.sprTile,sprCol:p.sprCol,vertFlip:p.vertFlip,horiFlip:p.horiFlip,bgPriority:p.bgPriority});
 // This graph is borrowed only by synchronous lexical consumers. It is not a snapshot.
 const live={abi:'owned-renderer-js/1',closure:{},current:current.map(s=>({...s})),maskQueue,maskTrace,edgeTrace,maskStats,access,oam:null,device:{},cpu:{},palette:{},bulk:bulk()};
 const deviceKeys=deviceFields.filter(k=>Object.hasOwn(p,k)),cpuKeys=cpuFields.filter(k=>Object.hasOwn(cpu,k));
 const bulkKeys=Object.keys(live.bulk),paletteKeys=['imgPalette','sprPalette'];
 function borrowState(){
  live.closure.v=v;live.closure.t=t;live.closure.fineX=fineX;live.closure.first=first;live.closure.dot=dot;live.closure.odd=odd;live.closure.lastClear=lastClear;live.closure.lo=lo;live.closure.hi=hi;live.closure.al=al;live.closure.ah=ah;live.closure.nt=nt;live.closure.at=at;live.closure.pl=pl;live.closure.ph=ph;live.closure.addr=addr;live.closure.fetchKind=fetchKind;live.closure.addressPending=addressPending;live.closure.incrementPending=incrementPending;live.closure.maskPending=maskPending;live.closure.lastRead=lastRead;live.closure.lastX=lastX;live.closure.lastY=lastY;live.closure.attrShift=attrShift;live.closure.carryDummy=carryDummy;live.closure.fetchReads=fetchReads;live.closure.busLow=busLow;live.closure.attributeFill=attributeFill;live.closure.renderPrevious=renderPrevious;live.closure.maskRequested=maskRequested;live.closure.maskWanted=maskWanted;live.closure.edgeRemaining=edgeRemaining;live.closure.droppedEdgeTrace=droppedEdgeTrace;live.closure.maskPendingLeft=maskPendingLeft;
  for(let i=0;i<8;i++)Object.assign(live.current[i],current[i]);
  for(const k of deviceKeys)live.device[k]=p[k];for(const k of cpuKeys)live.cpu[k]=cpu[k];
  live.status=cpu.mem[0x2002];live.oam=oamTransfer.borrowState();
  live.palette.currentEmph=p.palTable.currentEmph;live.palette.curTable=p.palTable.curTable;live.palette.imgPalette=p.imgPalette;live.palette.sprPalette=p.sprPalette;
  return live;
 }
 function restoreBorrowed(s){
   if(s?.abi!=='owned-renderer-js/1')throw Error('Renderer state ABI mismatch');
   for(const k of bulkKeys){const a=live.bulk[k],b=s.bulk[k];if(a!==b)restoreArray(a,b);}
   ({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,addressPending,incrementPending,maskPending,lastRead,lastX,lastY,attrShift,carryDummy,fetchReads,busLow,attributeFill,renderPrevious,maskRequested,maskWanted,edgeRemaining,droppedEdgeTrace,maskPendingLeft}=s.closure);
   for(let i=0;i<8;i++)Object.assign(current[i],s.current[i]);
   replaceRows(maskQueue,s.maskQueue);replaceRows(maskTrace,s.maskTrace);replaceRows(edgeTrace,s.edgeTrace);
   Object.assign(maskStats,s.maskStats);Object.assign(access,s.access);
   oamTransfer.restoreBorrowed(s.oam);
   Object.assign(p,s.device);Object.assign(cpu,s.cpu);cpu.mem[0x2002]=s.status;
   p.palTable.currentEmph=s.palette.currentEmph;
   if(s.palette.curTable!==undefined&&p.palTable.curTable!==s.palette.curTable)restoreArray(p.palTable.curTable,s.palette.curTable);
   for(const k of paletteKeys)if(s.palette[k]!==undefined&&p[k]!==s.palette[k])restoreArray(p[k],s.palette[k]);
 }
 const bridge=Object.freeze({
  borrowState,restoreBorrowed,registerIn(name,codec){p.scanline=codec.get('scanline');p.curX=codec.get('x');if(name==='readStatusRegister'){v=codec.get('v');t=codec.get('t');fineX=codec.get('fine_x');first=Boolean(codec.get('first'));cpu.mem[0x2002]=codec.get('status');}else p.sramAddress=codec.get('sram_address');},registerOut(name,codec){if(name==='readStatusRegister'){codec.set('first',first);codec.set('status',cpu.mem[0x2002]);}else codec.set('sram_address',p.sramAddress);},
  safeInterval:n=>Number.isInteger(n)&&n>=0&&n<=24576&&!addressPending&&!incrementPending&&!maskPending&&!maskQueue.length&&edgeRemaining<=0&&dot+n<Number.MAX_SAFE_INTEGER-1&&!oamTransfer.pending(),
  exportState:({shareBulk=false}={})=>{
   const graph=structuredClone({abi:'owned-renderer-js/1',closure:{v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,addressPending,incrementPending,maskPending,lastRead,lastX,lastY,attrShift,carryDummy,fetchReads,busLow,attributeFill,renderPrevious,maskRequested,maskWanted,edgeRemaining,droppedEdgeTrace,maskPendingLeft},
    current:current.map(s=>({...s})),maskQueue,maskTrace,edgeTrace,maskStats,access,
    oam:oamTransfer.exportState(),device:Object.fromEntries(deviceFields.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),status:cpu.mem[0x2002],cpu:Object.fromEntries(cpuFields.filter(k=>Object.hasOwn(cpu,k)).map(k=>[k,cpu[k]])),palette:{currentEmph:p.palTable.currentEmph,curTable:p.palTable.curTable,imgPalette:p.imgPalette,sprPalette:p.sprPalette}});
   graph.bulk=shareBulk?bulk():structuredClone(bulk());return graph;
  },
  importState:state=>{
   if(state?.abi!=='owned-renderer-js/1')throw Error('Renderer state ABI mismatch');
   // Clone the entire closure graph once: maskPending aliases its queued item.
   const s=structuredClone({...state,bulk:undefined});
   s.bulk=state.bulk;restoreBorrowed(s);
  }
 });
 if(capture)capture(bridge);
}

return Object.freeze(Object.defineProperties(Object.create(null),{"installOwnedDotPPU":{enumerable:true,get:()=>installOwnedDotPPU}}));
}
