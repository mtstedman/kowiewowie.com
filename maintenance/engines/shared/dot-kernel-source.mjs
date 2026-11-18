// Shared native dot pipeline. Hardware-family constants are resolved at build time.
// The MMC3-only edge filter and MMC5-only read/IRQ behavior stay explicitly gated.
const template=String.raw`#include <stdint.h>
#define API __attribute__((visibility("default")))
API uint32_t shared_pixel_abi(void){return 2;}
/* Pure scalar continuations; host retains lexical ownership and callbacks.
 * Scroll arithmetic follows owned-ppu.c without Contra same-dot suppression,
 * which is absent from the authenticated fetched-row renderers. */
API double shared_planes(uint32_t a,uint32_t b,uint32_t op,uint32_t x,uint32_t y){
 if(op==0){a=(a<<1)&65535u;b=(b<<1)&65535u;}
 else{a=(a&65280u)|x;b=(b&65280u)|y;}
 return (double)a+65536.0*(double)b;
}
API uint32_t shared_scroll(uint32_t v,uint32_t axes){
 if(axes&1){if((v&31u)==31u)v=(v&~31u)^1024u;else v++;}
 if(axes&2){if((v&28672u)!=28672u)v+=4096u;
 else{v&=~28672u;uint32_t y=(v>>5)&31u;
 if(y==29){y=0;v^=2048u;}else if(y==31)y=0;else y++;
 v=(v&~992u)|(y<<5);}}
 return v;
}
API uint32_t shared_fetch(uint32_t phase,uint32_t v,uint32_t nt,uint32_t table){
 if(phase==0)return 0x2000u|(v&0x0fffu);
 if(phase==2)return 0x23c0u|(v&0x0c00u)|((v>>4)&0x38u)|((v>>2)&7u);
 return (table<<12)|(nt<<4)|((v>>12)&7u)|(phase==6?8u:0u);
}
API uint32_t shared_pixel(uint32_t x,uint32_t fine,uint32_t lo,uint32_t hi,
 uint32_t al,uint32_t ah,uint32_t flags,uint32_t packed,uint32_t v){
 uint32_t mask=0x8000u>>fine;
 uint32_t bg=(flags&1)&&(x>=8||(flags&4))?((lo&mask?1:0)|(hi&mask?2:0)):0;
 uint32_t ba=(al&mask?1:0)|(ah&mask?2:0),sp=0,sa=0,behind=0,zero=0;
 if((flags&2)&&(x>=8||(flags&8))){sp=packed&3;sa=(packed>>2)&3;behind=packed&16;zero=packed&32;}
 uint32_t hit=bg&&sp&&zero&&x!=255;
 uint32_t index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
 if(!(flags&3)&&(v&0x3f00)==0x3f00){index=v&31;if((index&19)==16)index&=15;}
 return index|(hit?32:0);
}

__attribute__((import_module("env"),import_name("ppu_host"))) extern double host(uint32_t op,uint32_t a,uint32_t b);
static uint32_t s[16];
static double clocks[2];
/* Public scalar cells retain JavaScript number precision. Accessors expose
 * mutations immediately, including during synchronous/reentrant callbacks. */
static double public_state[7];
API uintptr_t shared_public_state(void){return (uintptr_t)public_state;}
static double ticks,batches,sprite_ticks,sprite_rows;
static uint32_t sprite_input[48],sprite_row[256];
API uintptr_t shared_sprite_input(void){return (uintptr_t)sprite_input;}
API uintptr_t shared_sprite_row(void){return (uintptr_t)sprite_row;}
API double shared_sprite_rows(void){return sprite_rows;}
API void shared_prepare_sprites(void){
 for(uint32_t x=0;x<256;x++)sprite_row[x]=0;
 for(uint32_t i=0;i<8;i++){
  uint32_t *sp=sprite_input+i*6;if(!sp[5])continue;
  uint32_t flags=((sp[3]&3)<<2)|((sp[3]&32)?16:0)|(sp[4]?32:0);
  for(uint32_t dx=0;dx<8&&sp[2]+dx<256;dx++){
   uint32_t x=sp[2]+dx;if(sprite_row[x])continue;
   uint32_t bit=(sp[3]&64)?dx:7-dx,px=((sp[0]>>bit)&1)|(((sp[1]>>bit)&1)<<1);
   if(px)sprite_row[x]=flags|px;
  }
 }
 sprite_rows++;
}
API uintptr_t shared_state(void){return (uintptr_t)s;}
API uintptr_t shared_clocks(void){return (uintptr_t)clocks;}
API double shared_tick_count(void){return ticks;}
API double shared_batch_count(void){return batches;}
API double shared_sprite_count(void){return sprite_ticks;}
API void shared_sprite_step(void){sprite_ticks++;}
static double host_crossings;
API double shared_host_crossings(void){return host_crossings;}
static double dispatch(uint32_t op,uint32_t a,uint32_t b){
 switch(op){
 case 1:return public_state[0];case 2:return public_state[1];
 case 3:return (public_state[2]||public_state[3])&&public_state[1]>=20&&public_state[1]<=260;
 case 7:return public_state[4];
 case 13:return public_state[2]||public_state[3];
 case 14:public_state[0]=a;return 0;
 case 15:public_state[1]=a;return 0;
 default:host_crossings++;return host(op,a,b);
 }
}
#define H(op,a,b) dispatch(op,a,b)
static void shift(void){for(uint32_t i=5;i<=8;i++)s[i]=(s[i]<<1)&65535u;}
static void load(void){s[5]=(s[5]&65280)|s[11];s[6]=(s[6]&65280)|s[12];s[7]=(s[7]&65280)|((s[10]&1)?255:0);s[8]=(s[8]&65280)|((s[10]&2)?255:0);}
/* ABI4: the exact source continuation owns observable sequencing and live
 * JS arithmetic. C counts and dispatches dots; pure admitted blocks below
 * are called by that continuation. No captured-coordinate C replay occurs. */
API void shared_advance(uint32_t n){
 batches++;
 for(uint32_t left=n;left;left--){host_crossings++;host(20,left,0);ticks++;}
 host_crossings++;host(21,0,0);
}
API void experimental_advance(uint32_t n){
 batches++;
 for(uint32_t left=n;left;left--){
  H(0,left,0);uint32_t d=H(1,0,0),line=H(2,0,0),run=H(3,0,0);
  if(line>=21&&line<=260&&d>=1&&d<=256){
   uint32_t x=d-1;
   if(public_state[3]&&(x>=8||public_state[6]))H(19,0,0);
   uint32_t flags=(public_state[2]?1:0)|(public_state[3]?2:0)|(public_state[5]?4:0)|(public_state[6]?8:0);
   uint32_t result=shared_pixel(x,s[2],s[5],s[6],s[7],s[8],flags,sprite_row[x],s[0]);
   H(4,x,result|((line-21)<<8));
  }
  if(run){
   if(d==257){H(5,0,0);s[0]=(s[0]&~0x041fu)|(s[1]&0x041f);H(6,0,0);}
   if(line==20&&d>=280&&d<=304)s[0]=(s[0]&~0x7be0u)|(s[1]&0x7be0);
   if((d>=1&&d<=256)||(d>=321&&d<=336)){
    shift();uint32_t phase=(d-1)&7;
    if(phase==0){H(8,shared_fetch(0,s[0],s[9],0),0);s[14]=1;}
    else if(phase==1)s[9]=H(9,1,0);
    else if(phase==2){H(8,shared_fetch(2,s[0],s[9],0),0);s[14]=2;}
    else if(phase==3){uint32_t value=H(9,2,0);s[10]=(value>>(((s[0]>>4)&4)|(s[0]&2)))&3;}
    else if(phase==4){uint32_t table=H(7,0,0);H(8,shared_fetch(4,s[0],s[9],table),0);s[14]=3;}
    else if(phase==5)s[11]=H(9,0,0);
    else if(phase==6){uint32_t table=H(7,0,0);H(8,shared_fetch(6,s[0],s[9],table),0);s[14]=4;}
    else{s[12]=H(9,0,0);load();s[0]=shared_scroll(s[0],1);}
    if(d==256)s[0]=shared_scroll(s[0],2);
   }else if(d>=257&&d<=320){H(10,d,0);sprite_ticks++;}
   else if(d==337||d==339)H(8,0x2000|(s[0]&0x0fff),0);
   else if(d==338||d==340)H(9,5,0);
   else if(d==0){if(s[15]){H(9,5,0);s[15]=0;}uint32_t tile=H(11,0x2000|(s[0]&0xfff),0),table=H(7,0,0);H(8,(table<<12)|(tile<<4)|((s[0]>>12)&7),0);}
  }else H(8,s[0]&16383,0);
  clocks[0]++;H(12,0,0);
  if(line==20&&d==339&&s[4]&&H(13,0,0)){s[15]=1;H(14,0,0);H(15,21,0);H(16,0,0);}
  else{uint32_t x=H(1,0,0)+1;H(14,x,0);if(x==341){H(14,0,0);if(line==261){H(15,0,0);H(17,0,0);s[4]=!s[4];}else{H(15,line+1,0);if(line>=20&&line<=260)H(16,0,0);}}}
  H(18,0,0);ticks++;
 }
 H(0,0,0);
}

static uint32_t oq[16],sn[64],si[32];
API uintptr_t owned_sprite_next(void){return (uintptr_t)sn;}
API uintptr_t owned_sprite_init(void){return (uintptr_t)si;}
static uint8_t och[1048576],onc[4096],ovram[32768];
static uint32_t orgb[64],ofb[61440];
static double owned_dots,owned_spans,owned_drives,owned_changes;
static uint32_t om[64];static double od[4];static double yields[8],local_reads;
static uint8_t oex[1024];
API uintptr_t owned_exram(void){return (uintptr_t)oex;}
API uintptr_t owned_mapper(void){return (uintptr_t)om;}
API uintptr_t owned_mapper_clocks(void){return (uintptr_t)od;}
API double owned_yields(uint32_t why){return why<8?yields[why]:0;}
API double owned_reads(void){return local_reads;}
/* om[0..7]: physical 1K CHR windows. 8: mapper, 9: CHR mask.
 * MMC3 10:phase,11:address,12:low,13:counter,14:latch,15:reload,
 * 16:blocked,17:enabled,18:asserted,19:sharp. od:ppuDot,epochDelta.
 * MMC5 10:ntMap,11:exMode,12:fillTile,13:fillColor,14:upper,
 * 15:extended,16:exTile,17:exLatch,18:lastRead+1,19:matches,
 * 20:reading,21:inFrame,22:line,23:target,24:pending,25:address,
 * 26:CHR-valid bitmask. ExRAM has separate authoritative storage. */
static void mapper_clock(double t){
 if(t==od[0])return;
 if(MAPPER_KIND==4&&t!=od[0]){
  uint32_t edges;
  if(t==od[0]+1){edges=++om[20]==3;if(edges)om[20]=0;}
  else{edges=(uint32_t)(__builtin_floor((t-1-om[10])/3)-__builtin_floor((od[0]-1-om[10])/3));double phase=t+2-om[10];om[20]=(uint32_t)(phase-__builtin_floor(phase/3)*3);}
  if(!(om[11]&4096))om[12]=om[12]+edges>3?3:om[12]+edges;
  od[0]=t;od[1]++;
 }else if(MAPPER_KIND==5){
  uint32_t ticks;
  if(t==od[0]+1){ticks=++om[28]==3;if(ticks)om[28]=0;}
  else{ticks=(uint32_t)(__builtin_floor(t/3)-__builtin_floor(od[0]/3));om[28]=(uint32_t)(t-__builtin_floor(t/3)*3);}
  for(uint32_t i=0;i<ticks;i++){
   if(om[20])om[27]=0;
   else if(++om[27]>=3){om[27]=3;om[21]=0;om[18]=0;om[19]=0;}
   om[20]=0;
  }
  od[0]=t;
 }
}
static void mapper_drive(uint32_t a){
 a&=16383;mapper_clock(clocks[0]);
 if(MAPPER_KIND==4){uint32_t high=a&4096,was=om[11]&4096;od[1]++;
  if(high&&!was&&om[12]>=3){uint32_t old=om[13],manual=om[15];
   om[13]=old==0||manual?om[14]:old-1;
   if(om[13]==0&&om[17]&&(om[19]||old>0||manual))om[18]=1;
   om[15]=0;om[16]=manual;}
  if(high||was)om[12]=0;om[11]=a;
 }else om[25]=a;
 s[13]=a;owned_drives++;
}
static uint32_t mapper_read(uint32_t a,uint32_t kind){
 a&=16383;local_reads++;
 if(a>=0x3f00){uint32_t i=a&31;if((i&19)==16)i&=15;return ovram[0x3f00+i];}
 if(MAPPER_KIND==5&&kind){
  om[20]=1;
  if(om[19]>=2){om[19]=0;if(!om[21]){om[21]=1;om[22]=0;om[24]=0;}
   else{om[22]=(om[22]+1)&255;if(om[22]==240){om[21]=0;om[22]=0;om[24]=0;om[18]=0;om[19]=0;om[27]=0;om[20]=1;}
    else if(om[23]&&om[22]==om[23])om[24]=1;}}
  else if(a>=0x2000&&a<0x3000&&a+1==om[18])om[19]++;else om[19]=0;
  om[18]=a+1;
  if(kind==1)om[16]=a&1023;
  if(kind==2&&om[15]){om[17]=oex[om[16]];return (om[17]>>6)*85;}
 }
 if(a<8192){
  if(MAPPER_KIND==5&&kind==3&&om[15])return och[(((om[14]<<6)|(om[17]&63))*4096+(a&4095))&om[9]];
  return och[om[(MAPPER_KIND==5&&kind!=3?32:0)+(a>>10)]+(a&1023)];
 }
 uint32_t n=(a-8192)&4095,page=n>>10;
 if(MAPPER_KIND==5){uint32_t src=(om[10]>>(page*2))&3,o=n&1023;
  return src<2?onc[src*1024+o]:src==2?(om[11]<2?oex[o]:0):o<960?om[12]:om[13]*85;}
 switch(oq[10]){case 0:page=0;break;case 1:page=1;break;case 2:page&=1;break;case 3:page>>=1;break;default:break;}
 return onc[(page<<10)|(n&1023)];
}
API uintptr_t owned_registers(void){return (uintptr_t)oq;}
API uintptr_t owned_chr(void){return (uintptr_t)och;}
API uintptr_t owned_ciram(void){return (uintptr_t)onc;}
API uintptr_t owned_palette(void){return (uintptr_t)(ovram+0x3f00);}
API uintptr_t owned_vram(void){return (uintptr_t)ovram;}
API uintptr_t owned_colors(void){return (uintptr_t)orgb;}
API uintptr_t owned_framebuffer(void){return (uintptr_t)ofb;}
API double owned_dot_count(void){return owned_dots;}
API double owned_span_count(void){return owned_spans;}
API double owned_drive_count(void){return owned_drives;}
API double owned_address_changes(void){return owned_changes;}
/* Return the completed prefix. Zero means the next dot needs an actual host
 * effect or source sprite continuation; the caller executes that source dot
 * synchronously, then resumes. No timestamped read replay is used. */
API uint32_t owned_advance(uint32_t n){
 if(n>3)return 0;
 uint32_t done=0;owned_spans++;
 while(done<n){
  uint32_t d=oq[0],line=oq[1],render=oq[2]||oq[3];
  uint32_t run=render&&line>=20&&line<=260;
  uint32_t odd=s[4];double clock=clocks[0];
  uint32_t source_reason=((line==0&&d==1)||(line==20&&d==1)||d==340||(line==20&&d==339&&odd&&render)||(render&&line>=20&&line<=260&&d==257))?1:0;
  if(source_reason){yields[source_reason]++;break;}
  
  // Non-bg fetch kinds use the source sprite CHR family in pattern space.
  // Yield the entire dot before composition, shifts, or mapper read effects.
  if(MAPPER_KIND==5&&run&&s[13]<8192&&((((d>=1&&d<=256)||(d>=321&&d<=336))&&(((d-1)&7)==1||((d-1)&7)==3))||d==338)){yields[7]++;break;}
  // Unknown MMC5 latch bits must throw from the original read, at its
  // original position after composition and shift, never during preparation.
  if(MAPPER_KIND==5&&run&&((d>=1&&d<=256)||(d>=321&&d<=336))){uint32_t phase=(d-1)&7;
   if((phase==5||phase==7)&&!(om[15])&&!(om[26]&(1u<<(s[13]>>10)))){yields[3]++;break;}}
  if(MAPPER_KIND==5&&run&&d>=258&&d<=320&&((d-257)&1)&&s[13]<8192&&!(om[40]&(1u<<(s[13]>>10)))){yields[3]++;break;}
  if(MAPPER_KIND==5&&run&&d==0){yields[4]++;break;}
  uint32_t result=0,visible=line>=21&&line<=260&&d>=1&&d<=256;
  if(visible){
   /* Dirty rows are needed only when this pixel actually consumes sprites.
    * Yield before mutation, including spans entering x=0 or unclipped x=8. */
   if(oq[15]&&oq[3]&&(d>=9||oq[5])){yields[5]++;break;}
   uint32_t flags=(oq[2]?1:0)|(oq[3]?2:0)|(oq[4]?4:0)|(oq[5]?8:0);
   result=shared_pixel(d-1,s[2],s[5],s[6],s[7],s[8],flags,sprite_row[d-1],s[0]);
   /* Status mutation can call user code. Yield before changing any dot state. */
   if(result&32){yields[6]++;break;}
  }
  if(visible){uint32_t index=result&31;
   ofb[(line-21)*256+d-1]=orgb[mapper_read(0x3f00+index,0)&(oq[9]?0x30:0x3f)];}
  if(run){
   if(line==20&&d>=280&&d<=304)s[0]=(s[0]&~0x7be0u)|(s[1]&0x7be0);
   if((d>=1&&d<=256)||(d>=321&&d<=336)){
    shift();uint32_t phase=(d-1)&7;
    if(phase==0){mapper_drive(shared_fetch(0,s[0],s[9],0));s[14]=1;}
    else if(phase==1)s[9]=mapper_read(s[13],1);
    else if(phase==2){mapper_drive(shared_fetch(2,s[0],s[9],0));s[14]=2;}
    else if(phase==3)s[10]=(mapper_read(s[13],2)>>(((s[0]>>4)&4)|(s[0]&2)))&3;
    else if(phase==4){mapper_drive(shared_fetch(4,s[0],s[9],oq[6]));s[14]=3;}
    else if(phase==5)s[11]=mapper_read(s[13],3);
    else if(phase==6){mapper_drive(shared_fetch(6,s[0],s[9],oq[6]));s[14]=4;}
    else{s[12]=mapper_read(s[13],3);load();s[0]=shared_scroll(s[0],1);}
    if(d==256)s[0]=shared_scroll(s[0],2);
   }else if(d>=258&&d<=320){
    uint32_t slot=(d-257)>>3,phase=(d-257)&7,*sp=sn+slot*8,*init=si+slot*4;
    if(phase==0){sp[5]=init[0]&1;sp[4]=(init[0]>>1)&1;sp[2]=init[1];sp[3]=init[2];sp[6]=init[3];mapper_drive(0x2000|(s[0]&4095));}
    else if(phase==1||phase==3){if(MAPPER_KIND==5)mapper_read(s[13],5);}
    else if(phase==2)mapper_drive(0x2000|(s[0]&4095));
    else if(phase==4)mapper_drive(sp[6]);
    else if(phase==5)sp[0]=mapper_read(s[13],4);
    else if(phase==6)mapper_drive(sp[6]|8);
    else sp[1]=mapper_read(s[13],4);
   }else if(d==337||d==339)mapper_drive(0x2000|(s[0]&4095));
   else if(d==338&&MAPPER_KIND==5)mapper_read(s[13],5);
   else if(d==0){uint32_t tile=mapper_read(0x2000|(s[0]&4095),0);
    mapper_drive((oq[6]<<12)|(tile<<4)|((s[0]>>12)&7));}
  }else mapper_drive(s[0]&16383);
  oq[0]++;clocks[0]++;mapper_clock(clocks[0]);owned_dots++;done++;
 }
 return done;
}
`;
export function sourceForMapper(mapper){
 if(mapper!==4&&mapper!==5)throw Error('Unqualified dot-kernel mapper');
 return template.replaceAll('MAPPER_KIND',mapper+'u');
}
export const compilerArgs=Object.freeze(["--target=wasm32","-O3","-std=c11","-ffreestanding","-fno-builtin","-nostdlib","-Wl,--no-entry","-Wl,--export-memory","-Wl,--initial-memory=1572864","-Wl,--max-memory=1572864","-Wl,--export=shared_pixel_abi","-Wl,--export=shared_planes","-Wl,--export=shared_scroll","-Wl,--export=shared_fetch","-Wl,--export=shared_pixel","-Wl,--export=shared_public_state","-Wl,--export=shared_sprite_input","-Wl,--export=shared_sprite_row","-Wl,--export=shared_sprite_rows","-Wl,--export=shared_prepare_sprites","-Wl,--export=shared_state","-Wl,--export=shared_clocks","-Wl,--export=shared_tick_count","-Wl,--export=shared_batch_count","-Wl,--export=shared_sprite_count","-Wl,--export=shared_sprite_step","-Wl,--export=shared_host_crossings","-Wl,--export=shared_advance","-Wl,--export=owned_exram","-Wl,--export=owned_mapper","-Wl,--export=owned_mapper_clocks","-Wl,--export=owned_yields","-Wl,--export=owned_reads","-Wl,--export=owned_registers","-Wl,--export=owned_chr","-Wl,--export=owned_ciram","-Wl,--export=owned_palette","-Wl,--export=owned_vram","-Wl,--export=owned_colors","-Wl,--export=owned_framebuffer","-Wl,--export=owned_dot_count","-Wl,--export=owned_span_count","-Wl,--export=owned_drive_count","-Wl,--export=owned_address_changes","-Wl,--export=owned_advance","-Wl,--export=owned_sprite_next","-Wl,--export=owned_sprite_init"]);
