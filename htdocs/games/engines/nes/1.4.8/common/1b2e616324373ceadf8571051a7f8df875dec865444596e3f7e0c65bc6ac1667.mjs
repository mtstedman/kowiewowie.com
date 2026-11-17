// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";

// Derived dot fetch pipeline. No CPU emulation or runtime opcode decoding.
// JSNES supplies the authenticated device container, palettes and APU.
function installDotPPU(nes,bus,peek,write){
 const p=nes.ppu,cpu=nes.cpu;
 let v=0,t=0,fineX=0,first=true,dot=bus.getPPUClock?.()??0,odd=false,lastClear=-1;
 let lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 const secondary=new Uint8Array(32),ids=new Int16Array(8);secondary.fill(255);ids.fill(-1);let found=0;
 const sprites=()=>Array.from({length:8},()=>({lo:0,hi:0,x:255,attr:255,zero:false,valid:false,address:0}));let current=sprites(),next=sprites();
 // Only fetched private sprite state is prepared. Palette and visibility stay live.
 const spriteRow=new Uint16Array(256);let spriteRowDirty=true;
 function prepareSpriteRow(){
  spriteRow.fill(0);
  for(let i=0;i<8;i++){
   const s=current[i];if(!s.valid)continue;
   const flags=((s.attr&3)<<2)|((s.attr&32)?16:0)|(s.zero?32:0);
   for(let dx=0;dx<8&&s.x+dx<256;dx++){
    const x=s.x+dx;if(spriteRow[x])continue;
    const bit=(s.attr&64)?dx:7-dx,px=((s.lo>>>bit)&1)|(((s.hi>>>bit)&1)<<1);
    if(px)spriteRow[x]=flags|px;
   }
  }
  spriteRowDirty=false;
 }
 const rendering=()=>Boolean(p.f_bgVisibility||p.f_spVisibility),active=()=>rendering()&&p.scanline>=20&&p.scanline<=260;
 function counters(){p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=first;p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;}
 function xinc(){if((v&31)===31)v=(v&~31)^1024;else v++;}
 function yinc(){if((v&28672)!==28672)v+=4096;else{v&=~28672;let y=(v>>>5)&31;if(y===29){y=0;v^=2048;}else if(y===31)y=0;else y++;v=(v&~992)|(y<<5);}}
 function drive(a){addr=a&16383;bus.setPPUAddress(addr,dot);}
 function read(){return peek(addr);}
 function loadBG(){lo=(lo&65280)|pl;hi=(hi&65280)|ph;al=(al&65280)|((at&1)?255:0);ah=(ah&65280)|((at&2)?255:0);}
 function shiftBG(){lo=(lo<<1)&65535;hi=(hi<<1)&65535;al=(al<<1)&65535;ah=(ah<<1)&65535;}
 function evaluate(){
  if(p.scanline===20)return;
  secondary.fill(255);ids.fill(-1);found=0;const y=p.scanline-21,height=p.f_spriteSize?16:8;
  // Active-render OAM writes are rejected below, so this bounded scan sees stable primary OAM.
  for(let i=0;i<64;i++){const row=y-p.spriteMem[i*4];if(row<0||row>=height)continue;if(found===8){p.setStatusFlag(p.STATUS_SLSPRITECOUNT,true);break;}secondary.set(p.spriteMem.subarray(i*4,i*4+4),found*4);ids[found]=i;found++;}
  p.secondaryOAM.set(secondary);p.spritesFound=found;p.sprite0InSecondary=ids[0]===0;
 }
 function spriteAddress(slot){const i=slot*4,tile=secondary[i+1],attr=secondary[i+2],height=p.f_spriteSize?16:8;let row=((p.scanline===20?255:p.scanline-21)-secondary[i])&(height-1);if(attr&128)row=height-1-row;return p.f_spriteSize?((tile&1)<<12)|((tile&254)<<4)|((row&8)<<1)|(row&7):(p.f_spPatternTable<<12)|(tile<<4)|(row&7);}
 function color(index){return p.palTable.getEntry(peek(0x3f00+index)&(p.f_dispType?0x30:0x3f));}
 function pixel(x,y){
  const mask=0x8000>>>fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?((lo&mask?1:0)|(hi&mask?2:0)):0,ba=(al&mask?1:0)|(ah&mask?2:0);
  let sp=0,sa=0,behind=false,zero=false;
  if(p.f_spVisibility&&(x>=8||p.f_spClipping)){if(spriteRowDirty)prepareSpriteRow();const packed=spriteRow[x];sp=packed&3;sa=(packed>>>2)&3;behind=Boolean(packed&16);zero=Boolean(packed&32);}
  if(bg&&sp&&zero&&x!==255){p.setStatusFlag(p.STATUS_SPRITE0HIT,true);p.hitSpr0=true;}
  let index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
  if(!rendering()&&(v&0x3f00)===0x3f00){index=v&31;if((index&19)===16)index&=15;}
  p.buffer[y*256+x]=color(index);
 }
 function boundary(remaining){
  if(p.scanline===0&&p.curX===1&&p.vblankPending)p._fireVblankSet(cpu,remaining);
  if(p.scanline===20&&p.curX===1&&lastClear!==dot){lastClear=dot;p._fireVblankClear(cpu,remaining<=1);}
 }
 function tick(remaining){
  boundary(remaining);const d=p.curX,line=p.scanline,run=active();
  if(line>=21&&line<=260&&d>=1&&d<=256)pixel(d-1,line-21);
  if(run){
   if(d===257){evaluate();v=(v&~0x041f)|(t&0x041f);p.sramAddress=0;}
   if(line===20&&d>=280&&d<=304)v=(v&~0x7be0)|(t&0x7be0);
   if((d>=1&&d<=256)||(d>=321&&d<=336)){
    shiftBG();const phase=(d-1)&7;
    if(phase===0){drive(0x2000|(v&0x0fff));fetchKind=1;}
    else if(phase===1)nt=read();
    else if(phase===2){drive(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7));fetchKind=2;}
    else if(phase===3)at=(read()>>>(((v>>>4)&4)|(v&2)))&3;
    else if(phase===4){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));fetchKind=3;}
    else if(phase===5)pl=read();
    else if(phase===6){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);fetchKind=4;}
    else{ph=read();loadBG();xinc();}
    if(d===256)yinc();
   }else if(d>=257&&d<=320){
    const slot=(d-257)>>>3,phase=(d-257)&7,s=next[slot],i=slot*4;
    if(phase===0){s.valid=slot<found;s.zero=ids[slot]===0;s.x=secondary[i+3];s.attr=secondary[i+2];s.address=spriteAddress(slot);spriteRowDirty=true;drive(0x2000|(v&0x0fff));}
    else if(phase===2)drive(0x2000|(v&0x0fff));
    else if(phase===4)drive(s.address);
    else if(phase===5){s.lo=read();spriteRowDirty=true;}
    else if(phase===6)drive(s.address|8);
    else if(phase===7){s.hi=read();spriteRowDirty=true;}
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===0){const tile=peek(0x2000|(v&0x0fff));drive((p.f_bgPatternTable<<12)|(tile<<4)|((v>>>12)&7));}
  }else drive(v&16383);
  dot++;bus.advancePPUClock?.(dot);
  if(line===20&&d===339&&odd&&rendering()){p.curX=0;p.scanline=21;const a=current;current=next;next=a;spriteRowDirty=true;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else{p.scanline++;if(line>=20&&line<=260){const a=current;current=next;next=a;spriteRowDirty=true;}}}
  counters();
 }
 p.advanceDots=n=>{if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');for(let i=0;i<n;i++)tick(n-i);boundary(0);};
 p.triggerRendering=()=>{};p.renderFramePartially=()=>{throw Error('Lazy rendering forbidden in dot adapter');};
 p.startFrame=()=>{};
 p.startVBlank=()=>{if(p.openBusDecayFrames>0&&--p.openBusDecayFrames===0)p.openBusLatch=0;nes.ui.writeFrame(p.buffer);p.lastRenderedScanline=-1;};
 p.cntsToAddress=()=>{p.vramAddress=v;};p.regsToAddress=()=>{p.vramTmpAddress=t;};
 p.cntsFromAddress=()=>{v=p.vramAddress&32767;counters();};p.regsFromAddress=()=>{t=p.vramTmpAddress&32767;counters();};
 p.updateControlReg1=value=>{p.f_nmiOnVblank=(value>>>7)&1;p.f_spriteSize=(value>>>5)&1;p.f_bgPatternTable=(value>>>4)&1;p.f_spPatternTable=(value>>>3)&1;p.f_addrInc=(value>>>2)&1;p.f_nTblAddress=value&3;p.regS=p.f_bgPatternTable;t=(t&~0x0c00)|((value&3)<<10);counters();p._updateNmiOutput();};
 p.updateControlReg2=value=>{p.f_color=(value>>>5)&7;p.f_spVisibility=(value>>>4)&1;p.f_bgVisibility=(value>>>3)&1;p.f_spClipping=(value>>>2)&1;p.f_bgClipping=(value>>>1)&1;p.f_dispType=value&1;p.palTable.setEmphasis(p.f_color);p.updatePalettes();if(!active())drive(v&16383);};
 p.scrollWrite=value=>{if(first){t=(t&~31)|(value>>>3);fineX=value&7;}else t=(t&~0x73e0)|((value&7)<<12)|((value&248)<<2);first=!first;counters();};
 p.writeVRAMAddress=value=>{if(first)t=(t&255)|((value&63)<<8);else{t=(t&0x7f00)|value;v=t;drive(v&16383);}first=!first;counters();};
 p.readStatusRegister=()=>{const value=(cpu.mem[0x2002]&224)|(p.openBusLatch&31);first=true;if(p.scanline===0&&p.curX===0)p.nmiSuppressed=true;p.setStatusFlag(p.STATUS_VBLANK,false);p._updateNmiOutput();p.openBusLatch=value;p.openBusDecayFrames=36;counters();return value;};
 function increment(){if(active()){xinc();yinc();}else v=(v+(p.f_addrInc?32:1))&32767;counters();drive(v&16383);}
 p.vramLoad=()=>{if(active()){const e=new Error('PPUDATA read during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}const a=v&16383;let value;drive(a);if(a<0x3f00){value=p.vramBufferedReadValue;p.vramBufferedReadValue=peek(a);}else{value=(peek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&192);drive(a&0x2fff);p.vramBufferedReadValue=peek(a&0x2fff);}increment();p.openBusLatch=value;p.openBusDecayFrames=36;return value;};
 p.vramWrite=value=>{if(active()){const e=new Error('PPUDATA write during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}drive(v&16383);write(v&16383,value);increment();};
 const originalOamWrite=p.sramWrite.bind(p),originalOamAddress=p.writeSRAMAddress.bind(p);
 function oamGuard(){if(active()){const e=new Error('Active-render OAM writes require dot sprite evaluation');e.code='UNSUPPORTED_RENDER_OAM';throw e;}}
 p.sramWrite=value=>{oamGuard();originalOamWrite(value);};p.writeSRAMAddress=value=>{oamGuard();originalOamAddress(value);};
 nes.mmap.clockIrqCounter=()=>{throw Error('Scanline IRQ callback forbidden: MMC3 is driven by filtered PPU A12');};nes.mmap.latchAccess=()=>{throw Error('Lazy mapper latch callback forbidden');};
 p.checkpointCapture=()=>({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next,spriteRowDirty,secondary,ids,spriteRow});p.checkpointRestore=q=>{({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next,spriteRowDirty}=q);secondary.set(q.secondary);ids.set(q.ids);spriteRow.set(q.spriteRow);};
 counters();
}

let ownedModule;
 function createOwnedInstance(){
  if(typeof WebAssembly==='undefined')return null;
  if(!ownedModule){const bytes=Uint8Array.from(atob('AGFzbQEAAAABQApgA39/fwF8YAABf2AFf39/f38BfGACf38Bf2AEf39/fwF/YAl/f39/f39/f38Bf2AAAXxgAABgAX8AYAF/AX8CEAEDZW52CHBwdV9ob3N0AAADISABAgMEBQEBAQYHAQEGBgYHBggHAQEBAQEBAQYGBgYJCQUEAQEICAYIAX8BQeC1HQsHsgQfBm1lbW9yeQIAEHNoYXJlZF9waXhlbF9hYmkAAQ1zaGFyZWRfcGxhbmVzAAINc2hhcmVkX3Njcm9sbAADDHNoYXJlZF9mZXRjaAAEDHNoYXJlZF9waXhlbAAFE3NoYXJlZF9wdWJsaWNfc3RhdGUABhNzaGFyZWRfc3ByaXRlX2lucHV0AAcRc2hhcmVkX3Nwcml0ZV9yb3cACBJzaGFyZWRfc3ByaXRlX3Jvd3MACRZzaGFyZWRfcHJlcGFyZV9zcHJpdGVzAAoMc2hhcmVkX3N0YXRlAAsNc2hhcmVkX2Nsb2NrcwAMEXNoYXJlZF90aWNrX2NvdW50AA0Sc2hhcmVkX2JhdGNoX2NvdW50AA4Tc2hhcmVkX3Nwcml0ZV9jb3VudAAPEnNoYXJlZF9zcHJpdGVfc3RlcAAQFXNoYXJlZF9ob3N0X2Nyb3NzaW5ncwARDnNoYXJlZF9hZHZhbmNlABIPb3duZWRfcmVnaXN0ZXJzABQJb3duZWRfY2hyABULb3duZWRfY2lyYW0AFg1vd25lZF9wYWxldHRlABcKb3duZWRfdnJhbQAYDG93bmVkX2NvbG9ycwAZEW93bmVkX2ZyYW1lYnVmZmVyABoPb3duZWRfZG90X2NvdW50ABsQb3duZWRfc3Bhbl9jb3VudAAcEW93bmVkX2RyaXZlX2NvdW50AB0Vb3duZWRfYWRkcmVzc19jaGFuZ2VzAB4Nb3duZWRfYWR2YW5jZQAfCosjIAQAQQILTwACQAJAIAINACABQQF0Qf7/A3EhASAAQQF0Qf7/A3EhAAwBCyABQYD+A3EgBHIhASAAQYD+A3EgA3IhAAsgAbhEAAAAAAAA8ECiIAC4oAudAQEBfwJAIAFBAXFFDQACQCAAQR9xQR9HDQAgAEFgcUGACHMhAAwBCyAAQQFqIQALAkAgAUECcUUNAAJAIABBgOABcUGA4AFGDQAgAEGAIGoPCyAAQf+ffnEhAUEAIQICQAJAAkAg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aGFyZWRfcHJlcGFyZV9zcHJpdGVzCwxzaGFyZWRfc3RhdGUMDXNoYXJlZF9jbG9ja3MNEXNoYXJlZF90aWNrX2NvdW50DhJzaGFyZWRfYmF0Y2hfY291bnQPE3NoYXJlZF9zcHJpdGVfY291bnQQEnNoYXJlZF9zcHJpdGVfc3RlcBEVc2hhcmVkX2hvc3RfY3Jvc3NpbmdzEg5zaGFyZWRfYWR2YW5jZRMEbG9hZBQPb3duZWRfcmVnaXN0ZXJzFQlvd25lZF9jaHIWC293bmVkX2NpcmFtFw1vd25lZF9wYWxldHRlGApvd25lZF92cmFtGQxvd25lZF9jb2xvcnMaEW93bmVkX2ZyYW1lYnVmZmVyGw9vd25lZF9kb3RfY291bnQcEG93bmVkX3NwYW5fY291bnQdEW93bmVkX2RyaXZlX2NvdW50HhVvd25lZF9hZGRyZXNzX2NoYW5nZXMfDW93bmVkX2FkdmFuY2UgCm93bmVkX3JlYWQHEgEAD19fc3RhY2tfcG9pbnRlcgA4CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQxVYnVudHUgY2xhbmcRMTguMS4zICgxdWJ1bnR1MSkALA90YXJnZXRfZmVhdHVyZXMCKw9tdXRhYmxlLWdsb2JhbHMrCHNpZ24tZXh0'),c=>c.charCodeAt(0));ownedModule=new WebAssembly.Module(bytes);}
  return new WebAssembly.Instance(ownedModule,{env:{ppu_host(){throw Error('Unexpected owned PPU callback');}}}).exports;
 }
 function installOwnedDotPPU(nes,bus,peek,write,e,binding){
 const p=nes.ppu,cpu=nes.cpu;
 const state=new Uint32Array(e.memory.buffer,e.shared_state(),15),clocks=new Float64Array(e.memory.buffer,e.shared_clocks(),2);
 let v=0,t=0,fineX=0,first=true,dot=0,odd=false,lastClear=-1,lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 first=true;dot=bus.getPPUClock?.()??0;lastClear=-1;
 const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16);
 const rowInput=new Uint32Array(e.memory.buffer,e.shared_sprite_input(),48);
 const rowOutput=new Uint32Array(e.memory.buffer,e.shared_sprite_row(),256);
 const colors=new Uint32Array(e.memory.buffer,e.owned_colors(),64);
 let fallbackDots=0,advanceCalls=0,ownedCalls=0,inAdvance=false;
 
 function refreshColors(){for(let i=0;i<64;i++)colors[i]=p.palTable.getEntry(i);}
 refreshColors();
 Object.defineProperty(p,'getSharedPPUStats',{configurable:true,value:()=>({backend:'wasm-owned-three-dot/1',ownedSpans:e.owned_span_count(),ownedDots:e.owned_dot_count(),ownedCalls,fallbackDots,advanceCalls,hostCrossings:0,hostEffectDots:fallbackDots,wasmSpriteRows:e.shared_sprite_rows(),mappingRefreshes:binding.mappingRefreshes(),fullPipelineWasm:false,mapperScope:[0,1,2],...(binding.stats?.()??{})})});

 const secondary=new Uint8Array(32),ids=new Int16Array(8);secondary.fill(255);ids.fill(-1);let found=0;
 const sprites=()=>Array.from({length:8},()=>({lo:0,hi:0,x:255,attr:255,zero:false,valid:false,address:0}));let current=sprites(),next=sprites();
 // Only fetched private sprite state is prepared. Palette and visibility stay live.
 const spriteRow=new Uint16Array(256);let spriteRowDirty=true;
 function prepareSpriteRow(){
  for(let i=0;i<8;i++){const sp=current[i],j=i*6;
   rowInput[j]=sp.lo;rowInput[j+1]=sp.hi;rowInput[j+2]=sp.x;rowInput[j+3]=sp.attr;rowInput[j+4]=sp.zero?1:0;rowInput[j+5]=sp.valid?1:0;}
  e.shared_prepare_sprites();spriteRow.set(rowOutput);spriteRowDirty=false;
 }
 const rendering=()=>Boolean(p.f_bgVisibility||p.f_spVisibility),active=()=>rendering()&&p.scanline>=20&&p.scanline<=260;
 function counters(){p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=Boolean(first);p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;}
 function xinc(){if((v&31)===31)v=(v&~31)^1024;else v++;}
 function yinc(){if((v&28672)!==28672)v+=4096;else{v&=~28672;let y=(v>>>5)&31;if(y===29){y=0;v^=2048;}else if(y===31)y=0;else y++;v=(v&~992)|(y<<5);}}
 function drive(a){addr=a&16383;bus.setPPUAddress(addr,dot);}
 function read(){return peek(addr);}
 function loadBG(){lo=(lo&65280)|pl;hi=(hi&65280)|ph;al=(al&65280)|((at&1)?255:0);ah=(ah&65280)|((at&2)?255:0);}
 function shiftBG(){lo=(lo<<1)&65535;hi=(hi<<1)&65535;al=(al<<1)&65535;ah=(ah<<1)&65535;}
 function evaluate(){
  if(p.scanline===20)return;
  secondary.fill(255);ids.fill(-1);found=0;const y=p.scanline-21,height=p.f_spriteSize?16:8;
  // Active-render OAM writes are rejected below, so this bounded scan sees stable primary OAM.
  for(let i=0;i<64;i++){const row=y-p.spriteMem[i*4];if(row<0||row>=height)continue;if(found===8){p.setStatusFlag(p.STATUS_SLSPRITECOUNT,true);break;}secondary.set(p.spriteMem.subarray(i*4,i*4+4),found*4);ids[found]=i;found++;}
  p.secondaryOAM.set(secondary);p.spritesFound=found;p.sprite0InSecondary=ids[0]===0;
 }
 function spriteAddress(slot){const i=slot*4,tile=secondary[i+1],attr=secondary[i+2],height=p.f_spriteSize?16:8;let row=((p.scanline===20?255:p.scanline-21)-secondary[i])&(height-1);if(attr&128)row=height-1-row;return p.f_spriteSize?((tile&1)<<12)|((tile&254)<<4)|((row&8)<<1)|(row&7):(p.f_spPatternTable<<12)|(tile<<4)|(row&7);}
 function color(index){return p.palTable.getEntry(peek(0x3f00+index)&(p.f_dispType?0x30:0x3f));}
 function pixel(x,y){
  const mask=0x8000>>>fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?((lo&mask?1:0)|(hi&mask?2:0)):0,ba=(al&mask?1:0)|(ah&mask?2:0);
  let sp=0,sa=0,behind=false,zero=false;
  if(p.f_spVisibility&&(x>=8||p.f_spClipping)){if(spriteRowDirty)prepareSpriteRow();const packed=spriteRow[x];sp=packed&3;sa=(packed>>>2)&3;behind=Boolean(packed&16);zero=Boolean(packed&32);}
  if(bg&&sp&&zero&&x!==255){p.setStatusFlag(p.STATUS_SPRITE0HIT,true);p.hitSpr0=true;}
  let index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
  if(!rendering()&&(v&0x3f00)===0x3f00){index=v&31;if((index&19)===16)index&=15;}
  p.buffer[y*256+x]=color(index);
 }
 function boundary(remaining){
  if(p.scanline===0&&p.curX===1&&p.vblankPending)p._fireVblankSet(cpu,remaining);
  if(p.scanline===20&&p.curX===1&&lastClear!==dot){lastClear=dot;p._fireVblankClear(cpu,remaining<=1);}
 }
 function tick(remaining){
  boundary(remaining);const d=p.curX,line=p.scanline,run=active();
  if(line>=21&&line<=260&&d>=1&&d<=256)pixel(d-1,line-21);
  if(run){
   if(d===257){evaluate();v=(v&~0x041f)|(t&0x041f);p.sramAddress=0;}
   if(line===20&&d>=280&&d<=304)v=(v&~0x7be0)|(t&0x7be0);
   if((d>=1&&d<=256)||(d>=321&&d<=336)){
    shiftBG();const phase=(d-1)&7;
    if(phase===0){drive(0x2000|(v&0x0fff));fetchKind=1;}
    else if(phase===1)nt=read();
    else if(phase===2){drive(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7));fetchKind=2;}
    else if(phase===3)at=(read()>>>(((v>>>4)&4)|(v&2)))&3;
    else if(phase===4){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));fetchKind=3;}
    else if(phase===5)pl=read();
    else if(phase===6){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);fetchKind=4;}
    else{ph=read();loadBG();xinc();}
    if(d===256)yinc();
   }else if(d>=257&&d<=320){
    const slot=(d-257)>>>3,phase=(d-257)&7,s=next[slot],i=slot*4;
    if(phase===0){s.valid=slot<found;s.zero=ids[slot]===0;s.x=secondary[i+3];s.attr=secondary[i+2];s.address=spriteAddress(slot);drive(0x2000|(v&0x0fff));}
    else if(phase===2)drive(0x2000|(v&0x0fff));
    else if(phase===4)drive(s.address);
    else if(phase===5){s.lo=read();}
    else if(phase===6)drive(s.address|8);
    else if(phase===7){s.hi=read();}
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===0){const tile=peek(0x2000|(v&0x0fff));drive((p.f_bgPatternTable<<12)|(tile<<4)|((v>>>12)&7));}
  }else drive(v&16383);
  dot++;bus.advancePPUClock?.(dot);
  if(line===20&&d===339&&odd&&rendering()){p.curX=0;p.scanline=21;const a=current;current=next;next=a;spriteRowDirty=true;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else{p.scanline++;if(line>=20&&line<=260){const a=current;current=next;next=a;spriteRowDirty=true;}}}
  counters();
 }
 function syncInput(){
  q[0]=p.curX;q[1]=p.scanline;q[2]=p.f_bgVisibility;q[3]=p.f_spVisibility;
  q[4]=p.f_bgClipping;q[5]=p.f_spClipping;q[6]=p.f_bgPatternTable;
  q[7]=p.f_spPatternTable;q[8]=p.f_spriteSize;q[9]=p.f_dispType;
 }
 function syncOutput(){p.curX=q[0];p.scanline=q[1];}
 let stageActive=false,entries=0,exits=0;
 function leave(){if(!stageActive)return;v=state[0];t=state[1];fineX=state[2];first=Boolean(state[3]);odd=Boolean(state[4]);lo=state[5];hi=state[6];al=state[7];ah=state[8];nt=state[9];at=state[10];pl=state[11];ph=state[12];addr=state[13];fetchKind=state[14];dot=clocks[0];lastClear=clocks[1];syncOutput();stageActive=false;exits++;counters();}
 function enter(){state[0]=v;state[1]=t;state[2]=fineX;state[3]=first;state[4]=odd;state[5]=lo;state[6]=hi;state[7]=al;state[8]=ah;state[9]=nt;state[10]=at;state[11]=pl;state[12]=ph;state[13]=addr;state[14]=fetchKind;clocks[0]=dot;clocks[1]=lastClear;syncInput();stageActive=true;entries++;}
 p.advanceDots=n=>{
  if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');if(inAdvance)throw Error('Private owned PPU reentry');
  inAdvance=true;advanceCalls++;
  try{let left=n;
   while(left){const x=stageActive?q[0]:p.curX,line=stageActive?q[1]:p.scanline,reason=((line===0&&x===1)||(line===20&&x===1)||x===340||(line===20&&x===339&&(stageActive?state[4]:odd)&&(p.f_bgVisibility||p.f_spVisibility))||((p.f_bgVisibility||p.f_spVisibility)&&line>=20&&line<=260&&x>=257&&x<=320)?1:0);
    if(reason){leave();fallbackDots++;tick(left);left--;continue;}
    if(!stageActive)enter();
    if(spriteRowDirty&&q[1]>=21&&q[1]<=260&&q[0]>=1&&q[0]<=256&&q[3]&&(q[0]>=9||q[5])){leave();prepareSpriteRow();enter();}
    q[15]=spriteRowDirty?1:0;
    let done=0;if(binding.before()){ownedCalls++;done=e.owned_advance(Math.min(3,left));binding.after();}
    if(done){left-=done;}else{leave();fallbackDots++;tick(left);left--;}
   }
   if(stageActive)syncOutput();
   if((p.scanline===0||p.scanline===20)&&p.curX===1)leave();boundary(0);
  }finally{inAdvance=false;}
 };
 p.triggerRendering=()=>{};p.renderFramePartially=()=>{throw Error('Lazy rendering forbidden in dot adapter');};
 p.startFrame=()=>{};
 p.startVBlank=()=>{if(p.openBusDecayFrames>0&&--p.openBusDecayFrames===0)p.openBusLatch=0;nes.ui.writeFrame(p.buffer);p.lastRenderedScanline=-1;};
 p.cntsToAddress=()=>{p.vramAddress=v;};p.regsToAddress=()=>{p.vramTmpAddress=t;};
 p.cntsFromAddress=()=>{v=p.vramAddress&32767;counters();};p.regsFromAddress=()=>{t=p.vramTmpAddress&32767;counters();};
 p.updateControlReg1=value=>{p.f_nmiOnVblank=(value>>>7)&1;p.f_spriteSize=(value>>>5)&1;p.f_bgPatternTable=(value>>>4)&1;p.f_spPatternTable=(value>>>3)&1;p.f_addrInc=(value>>>2)&1;p.f_nTblAddress=value&3;p.regS=p.f_bgPatternTable;t=(t&~0x0c00)|((value&3)<<10);counters();p._updateNmiOutput();};
 p.updateControlReg2=value=>{p.f_color=(value>>>5)&7;p.f_spVisibility=(value>>>4)&1;p.f_bgVisibility=(value>>>3)&1;p.f_spClipping=(value>>>2)&1;p.f_bgClipping=(value>>>1)&1;p.f_dispType=value&1;p.palTable.setEmphasis(p.f_color);p.updatePalettes();refreshColors();if(!active())drive(v&16383);};
 p.scrollWrite=value=>{if(first){t=(t&~31)|(value>>>3);fineX=value&7;}else t=(t&~0x73e0)|((value&7)<<12)|((value&248)<<2);first=!first;counters();};
 p.writeVRAMAddress=value=>{if(first)t=(t&255)|((value&63)<<8);else{t=(t&0x7f00)|value;v=t;drive(v&16383);}first=!first;counters();};
 p.readStatusRegister=()=>{const value=(cpu.mem[0x2002]&224)|(p.openBusLatch&31);first=true;if(p.scanline===0&&p.curX===0)p.nmiSuppressed=true;p.setStatusFlag(p.STATUS_VBLANK,false);p._updateNmiOutput();p.openBusLatch=value;p.openBusDecayFrames=36;counters();return value;};
 function increment(){if(active()){xinc();yinc();}else v=(v+(p.f_addrInc?32:1))&32767;counters();drive(v&16383);}
 p.vramLoad=()=>{if(active()){const e=new Error('PPUDATA read during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}const a=v&16383;let value;drive(a);if(a<0x3f00){value=p.vramBufferedReadValue;p.vramBufferedReadValue=peek(a);}else{value=(peek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&192);drive(a&0x2fff);p.vramBufferedReadValue=peek(a&0x2fff);}increment();p.openBusLatch=value;p.openBusDecayFrames=36;return value;};
 p.vramWrite=value=>{if(active()){const e=new Error('PPUDATA write during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}drive(v&16383);write(v&16383,value);increment();};
 const originalOamWrite=p.sramWrite.bind(p),originalOamAddress=p.writeSRAMAddress.bind(p);
 function oamGuard(){if(active()){const e=new Error('Active-render OAM writes require dot sprite evaluation');e.code='UNSUPPORTED_RENDER_OAM';throw e;}}
 p.sramWrite=value=>{oamGuard();originalOamWrite(value);};p.writeSRAMAddress=value=>{oamGuard();originalOamAddress(value);};
 nes.mmap.clockIrqCounter=()=>{throw Error('Scanline IRQ callback forbidden: MMC3 is driven by filtered PPU A12');};nes.mmap.latchAccess=()=>{throw Error('Lazy mapper latch callback forbidden');};
 counters();

p.checkpointCapture=()=>{leave();return {v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next,secondary,ids};};
 p.checkpointRestore=s=>{stageActive=false;({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next}=s);secondary.set(s.secondary);ids.set(s.ids);spriteRowDirty=true;refreshColors();counters();};
  const methods=new Set();for(let proto=p;proto&&proto!==Object.prototype;proto=Object.getPrototypeOf(proto))for(const key of Object.getOwnPropertyNames(proto))methods.add(key);
 for(const key of methods){if(key==='constructor'||key==='advanceDots'||typeof p[key]!=='function')continue;const fn=p[key];Object.defineProperty(p,key,{configurable:true,writable:true,value:function(...args){if(!inAdvance)leave();return fn.apply(this,args);}});}
 p.sharedPPUBoundary=leave;
 p.sharedPPUTransferStats=()=>({stageActive,entries,exits});
 }
return Object.freeze(Object.defineProperties(Object.create(null),{"createOwnedInstance":{enumerable:true,get:()=>createOwnedInstance},"installOwnedDotPPU":{enumerable:true,get:()=>installOwnedDotPPU},"installDotPPU":{enumerable:true,get:()=>installDotPPU}}));
}
