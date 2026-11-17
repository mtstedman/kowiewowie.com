// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";

// Derived dot fetch pipeline. No CPU emulation or runtime opcode decoding.
// JSNES supplies the authenticated device container, palettes and APU.
function installDotPPU(nes,bus,peek,write){
 const p=nes.ppu,cpu=nes.cpu;
 let v=0,t=0,fineX=0,first=true,dot=bus.getPPUClock(),odd=false,lastClear=-1;
 let lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 const secondary=new Uint8Array(32),ids=new Int16Array(8);secondary.fill(255);ids.fill(-1);let found=0;
 const sprites=()=>Array.from({length:8},()=>({lo:0,hi:0,x:255,attr:255,zero:false,valid:false,address:0}));let current=sprites(),next=sprites();
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
  if(p.f_spVisibility&&(x>=8||p.f_spClipping))for(let i=0;i<8;i++){const s=current[i],dx=x-s.x;if(!s.valid||dx<0||dx>7)continue;const bit=(s.attr&64)?dx:7-dx,px=((s.lo>>>bit)&1)|(((s.hi>>>bit)&1)<<1);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break;}}
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
    else if(phase===5)s.lo=read();
    else if(phase===6)drive(s.address|8);
    else if(phase===7)s.hi=read();
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===0){const tile=peek(0x2000|(v&0x0fff));drive((p.f_bgPatternTable<<12)|(tile<<4)|((v>>>12)&7));}
  }else drive(v&16383);
  dot++;bus.advancePPUClock(dot);
  if(line===20&&d===339&&odd&&rendering()){p.curX=0;p.scanline=21;const a=current;current=next;next=a;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else{p.scanline++;if(line>=20&&line<=260){const a=current;current=next;next=a;}}}
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
 p.checkpointCapture=()=>({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next,secondary,ids});p.checkpointRestore=q=>{({v,t,fineX,first,dot,odd,lastClear,lo,hi,al,ah,nt,at,pl,ph,addr,fetchKind,found,current,next}=q);secondary.set(q.secondary);ids.set(q.ids);};
 counters();
}

let ownedModule;
 function createOwnedInstance(){
  if(typeof WebAssembly==='undefined')return null;
  if(!ownedModule){const bytes=Uint8Array.from(atob('AGFzbQEAAAABRQtgA39/fwF8YAABf2AFf39/f38BfGACf38Bf2AEf39/fwF/YAl/f39/f39/f38Bf2AAAXxgAABgAX8AYAF/AXxgAX8BfwIQAQNlbnYIcHB1X2hvc3QAAAMnJgECAwQFAQEBBgcBAQYGBgcGCAcBAQEJBgEBAQEBAQEGBgYGCgMIBQQBAQoKBggBfwFB0MAlCweCBSQGbWVtb3J5AgAQc2hhcmVkX3BpeGVsX2FiaQABDXNoYXJlZF9wbGFuZXMAAg1zaGFyZWRfc2Nyb2xsAAMMc2hhcmVkX2ZldGNoAAQMc2hhcmVkX3BpeGVsAAUTc2hhcmVkX3B1YmxpY19zdGF0ZQAGE3NoYXJlZF9zcHJpdGVfaW5wdXQABxFzaGFyZWRfc3ByaXRlX3JvdwAIEnNoYXJlZF9zcHJpdGVfcm93cwAJFnNoYXJlZF9wcmVwYXJlX3Nwcml0ZXMACgxzaGFyZWRfc3RhdGUACw1zaGFyZWRfY2xvY2tzAAwRc2hhcmVkX3RpY2tfY291bnQADRJzaGFyZWRfYmF0Y2hfY291bnQADhNzaGFyZWRfc3ByaXRlX2NvdW50AA8Sc2hhcmVkX3Nwcml0ZV9zdGVwABAVc2hhcmVkX2hvc3RfY3Jvc3NpbmdzABEOc2hhcmVkX2FkdmFuY2UAEgtvd25lZF9leHJhbQAUDG93bmVkX21hcHBlcgAVE293bmVkX21hcHBlcl9jbG9ja3MAFgxvd25lZF95aWVsZHMAFwtvd25lZF9yZWFkcwAYD293bmVkX3JlZ2lzdGVycwAZCW93bmVkX2NocgAaC293bmVkX2NpcmFtABsNb3duZWRfcGFsZXR0ZQAcCm93bmVkX3ZyYW0AHQxvd25lZF9jb2xvcnMAHhFvd25lZF9mcmFtZWJ1ZmZlcgAfD293bmVkX2RvdF9jb3VudAAgEG93bmVkX3NwYW5fY291bnQAIRFvd25lZF9kcml2ZV9jb3VudAAiFW93bmVkX2FkZHJlc3NfY2hhbmdlcwAjDW93bmVkX2FkdmFuY2UAJArPKiYEAEECC08AAkACQCACDQAgAUEBdEH+/wNxIQEgAEEBdEH+/wNxIQAMAQsgAUGA/gNxIARyIQEgAEGA/gNxIANyIQALIAG4RAAAAAAAAPBAoiAAuKALnQEBAX8CQCABQQFx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cmVkX3BpeGVsX2FiaQINc2hhcmVkX3BsYW5lcwMNc2hhcmVkX3Njcm9sbAQMc2hhcmVkX2ZldGNoBQxzaGFyZWRfcGl4ZWwGE3NoYXJlZF9wdWJsaWNfc3RhdGUHE3NoYXJlZF9zcHJpdGVfaW5wdXQIEXNoYXJlZF9zcHJpdGVfcm93CRJzaGFyZWRfc3ByaXRlX3Jvd3MKFnNoYXJlZF9wcmVwYXJlX3Nwcml0ZXMLDHNoYXJlZF9zdGF0ZQwNc2hhcmVkX2Nsb2Nrcw0Rc2hhcmVkX3RpY2tfY291bnQOEnNoYXJlZF9iYXRjaF9jb3VudA8Tc2hhcmVkX3Nwcml0ZV9jb3VudBASc2hhcmVkX3Nwcml0ZV9zdGVwERVzaGFyZWRfaG9zdF9jcm9zc2luZ3MSDnNoYXJlZF9hZHZhbmNlEwRsb2FkFAtvd25lZF9leHJhbRUMb3duZWRfbWFwcGVyFhNvd25lZF9tYXBwZXJfY2xvY2tzFwxvd25lZF95aWVsZHMYC293bmVkX3JlYWRzGQ9vd25lZF9yZWdpc3RlcnMaCW93bmVkX2NochsLb3duZWRfY2lyYW0cDW93bmVkX3BhbGV0dGUdCm93bmVkX3ZyYW0eDG93bmVkX2NvbG9ycx8Rb3duZWRfZnJhbWVidWZmZXIgD293bmVkX2RvdF9jb3VudCEQb3duZWRfc3Bhbl9jb3VudCIRb3duZWRfZHJpdmVfY291bnQjFW93bmVkX2FkZHJlc3NfY2hhbmdlcyQNb3duZWRfYWR2YW5jZSULbWFwcGVyX3JlYWQmDG1hcHBlcl9kcml2ZQcSAQAPX19zdGFja19wb2ludGVyADgJcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBDFVidW50dSBjbGFuZxExOC4xLjMgKDF1YnVudHUxKQAsD3RhcmdldF9mZWF0dXJlcwIrD211dGFibGUtZ2xvYmFscysIc2lnbi1leHQ='),c=>c.charCodeAt(0));ownedModule=new WebAssembly.Module(bytes);}
  return new WebAssembly.Instance(ownedModule,{env:{ppu_host(){throw Error('Unexpected owned PPU callback');}}}).exports;
 }
 function installOwnedDotPPU(nes,bus,peek,write,e,binding){
 const p=nes.ppu,cpu=nes.cpu;
 const state=new Uint32Array(e.memory.buffer,e.shared_state(),15),clocks=new Float64Array(e.memory.buffer,e.shared_clocks(),2);
 let v=0,t=0,fineX=0,first=true,dot=0,odd=false,lastClear=-1,lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 first=true;dot=bus.getPPUClock();lastClear=-1;
 const q=new Uint32Array(e.memory.buffer,e.owned_registers(),16);
 const rowInput=new Uint32Array(e.memory.buffer,e.shared_sprite_input(),48);
 const rowOutput=new Uint32Array(e.memory.buffer,e.shared_sprite_row(),256);
 const colors=new Uint32Array(e.memory.buffer,e.owned_colors(),64);
 let fallbackDots=0,advanceCalls=0,ownedCalls=0,inAdvance=false;
 function sourceBoundary(d,line,render,boundaryOdd,clock){return ((line==0&&d==1)||(line==20&&d==1)||d==340||(line==20&&d==339&&boundaryOdd&&render)||(render&&line>=20&&line<=260&&d>=257&&d<=320))?1:0;}
 function refreshColors(){for(let i=0;i<64;i++)colors[i]=p.palTable.getEntry(i);}
 refreshColors();
 Object.defineProperty(p,'getSharedPPUStats',{configurable:true,value:()=>({backend:'wasm-owned-three-dot/1',ownedSpans:e.owned_span_count(),ownedDots:e.owned_dot_count(),ownedCalls,fallbackDots,advanceCalls,hostCrossings:0,hostEffectDots:fallbackDots,wasmSpriteRows:e.shared_sprite_rows(),mappingRefreshes:binding.mappingRefreshes(),fullPipelineWasm:false,mapperScope:[4],...(binding.stats?.()??{})})});

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
  const shift=15-fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?(((lo>>>shift)&1)|(((hi>>>shift)&1)<<1)):0,ba=((al>>>shift)&1)|(((ah>>>shift)&1)<<1); // romjs-background-bits/1
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
  dot++;bus.advancePPUClock(dot);
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
   while(left){const x=stageActive?q[0]:p.curX,line=stageActive?q[1]:p.scanline,reason=sourceBoundary(x,line,p.f_bgVisibility||p.f_spVisibility,stageActive?state[4]:odd,stageActive?clocks[0]:dot);
    if(reason){binding.skipPreparation(reason);leave();fallbackDots++;tick(left);left--;continue;}
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
