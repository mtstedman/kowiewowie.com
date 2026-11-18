// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";

// Derived dot fetch pipeline. No CPU emulation or runtime opcode decoding.
// JSNES supplies the authenticated device container, palettes and APU.
function installDotPPU(nes,bus,peek,write,fetch){
 const p=nes.ppu,cpu=nes.cpu;
 let v=0,t=0,fineX=0,first=true,dot=bus.getPPUClock(),odd=false,lastClear=-1,skippedDummy=false;
 let lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 const secondary=new Uint8Array(32),ids=new Int16Array(8);secondary.fill(255);ids.fill(-1);let found=0;
 const sprites=()=>Array.from({length:8},()=>({lo:0,hi:0,x:255,attr:255,zero:false,valid:false,address:0}));let current=sprites(),next=sprites();
 const rendering=()=>Boolean(p.f_bgVisibility||p.f_spVisibility),active=()=>rendering()&&p.scanline>=20&&p.scanline<=260;
 function counters(){p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=first;p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;}
 function xinc(){if((v&31)===31)v=(v&~31)^1024;else v++;}
 function yinc(){if((v&28672)!==28672)v+=4096;else{v&=~28672;let y=(v>>>5)&31;if(y===29){y=0;v^=2048;}else if(y===31)y=0;else y++;v=(v&~992)|(y<<5);}}
 function drive(a){addr=a&16383;bus.setPPUAddress(addr,dot);}
 function read(kind='bg'){return fetch(addr,kind);}
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
 const spritePixels=new Uint16Array(256);let spriteReady=false;
 function prepareSpritePixels(){
  spritePixels.fill(0);
  for(let i=0;i<8;i++){
   const s=current[i];if(!s.valid)continue;
   for(let dx=0;dx<8;dx++){
    const x=s.x+dx;if(x<0||x>255||spritePixels[x])continue;
    const bit=(s.attr&64)?dx:7-dx,px=((s.lo>>>bit)&1)|(((s.hi>>>bit)&1)<<1);
    if(px)spritePixels[x]=px|((s.attr&3)<<2)|((s.attr&32)?16:0)|(s.zero?32:0);
   }
  }
  spriteReady=true;
 }
 function pixel(x,y){
  const shift=15-fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?((lo>>>shift)&1)|(((hi>>>shift)&1)<<1):0,ba=((al>>>shift)&1)|(((ah>>>shift)&1)<<1);
  let sp=0,sa=0,behind=false,zero=false;
  if(p.f_spVisibility&&(x>=8||p.f_spClipping)){if(!spriteReady)prepareSpritePixels();const z=spritePixels[x];sp=z&3;sa=(z>>>2)&3;behind=Boolean(z&16);zero=Boolean(z&32);}
  if(bg&&sp&&zero&&x!==255){p.setStatusFlag(p.STATUS_SPRITE0HIT,true);p.hitSpr0=true;}
  let index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
  if(!rendering()&&(v&0x3f00)===0x3f00){index=v&31;if((index&19)===16)index&=15;}
  p.buffer[y*256+x]=color(index);
 }
 function boundary(remaining){
  if(p.curX!==1)return;
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
    lo=(lo<<1)&65535;hi=(hi<<1)&65535;al=(al<<1)&65535;ah=(ah<<1)&65535;const phase=(d-1)&7;
    switch(phase){
     case 0:drive(0x2000|(v&0x0fff));fetchKind=1;break;
     case 1:nt=read('bg-nt');break;
     case 2:drive(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7));fetchKind=2;break;
     case 3:at=(read('bg-at')>>>(((v>>>4)&4)|(v&2)))&3;break;
     case 4:drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));fetchKind=3;break;
     case 5:pl=read();break;
     case 6:drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);fetchKind=4;break;
     case 7:ph=read();loadBG();xinc();break;
    }
    if(d===256)yinc();
   }else if(d>=257&&d<=320){
    const slot=(d-257)>>>3,phase=(d-257)&7,s=next[slot],i=slot*4;
    if(phase===0){s.valid=slot<found;s.zero=ids[slot]===0;s.x=secondary[i+3];s.attr=secondary[i+2];s.address=spriteAddress(slot);drive(0x2000|(v&0x0fff));}
    else if(phase===1||phase===3)read('dummy');
     else if(phase===2)drive(0x2000|(v&0x0fff));
    else if(phase===4)drive(s.address);
    else if(phase===5)s.lo=read('sprite');
    else if(phase===6)drive(s.address|8);
    else if(phase===7)s.hi=read('sprite');
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===338||d===340)read('dummy');
   else if(d===0){if(skippedDummy){read('dummy');skippedDummy=false;}const tile=peek(0x2000|(v&0x0fff));drive((p.f_bgPatternTable<<12)|(tile<<4)|((v>>>12)&7));}
  }else drive(v&16383);
  dot++;bus.advancePPUClock(dot);
  if(line===20&&d===339&&odd&&rendering()){skippedDummy=true;p.curX=0;p.scanline=21;const a=current;current=next;next=a;spriteReady=false;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else{p.scanline++;if(line>=20&&line<=260){const a=current;current=next;next=a;spriteReady=false;}}}
  counters();
 }
 p.advanceDots=n=>{if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');if(n===3){tick(3);tick(2);tick(1);}else{for(let i=0;i<n;i++)tick(n-i);}boundary(0);};
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
 p.vramLoad=()=>{if(active()){const e=new Error('PPUDATA read during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}const a=v&16383;let value;drive(a);if(a<0x3f00){value=p.vramBufferedReadValue;p.vramBufferedReadValue=fetch(a,'cpu');}else{value=(peek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&192);drive(a&0x2fff);p.vramBufferedReadValue=fetch(a&0x2fff,'cpu');}increment();p.openBusLatch=value;p.openBusDecayFrames=36;return value;};
 p.vramWrite=value=>{if(active()){const e=new Error('PPUDATA write during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}drive(v&16383);write(v&16383,value);increment();};
 const originalOamWrite=p.sramWrite.bind(p),originalOamAddress=p.writeSRAMAddress.bind(p);
 function oamGuard(){if(active()){const e=new Error('Active-render OAM writes require dot sprite evaluation');e.code='UNSUPPORTED_RENDER_OAM';throw e;}}
 p.sramWrite=value=>{oamGuard();originalOamWrite(value);};p.writeSRAMAddress=value=>{oamGuard();originalOamAddress(value);};
 nes.mmap.clockIrqCounter=()=>{throw Error('Scanline IRQ callback forbidden: MMC5 is driven by actual PPU read strobes');};nes.mmap.latchAccess=()=>{throw Error('Lazy mapper latch callback forbidden');};
 counters();
}

return Object.freeze(Object.defineProperties(Object.create(null),{"installDotPPU":{enumerable:true,get:()=>installDotPPU}}));
}
