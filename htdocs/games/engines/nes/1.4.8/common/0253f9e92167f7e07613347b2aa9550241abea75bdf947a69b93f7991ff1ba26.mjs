// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const createCodec=imports[0]["createCodec"];
const intervalFallback=imports[0]["intervalFallback"];

// The factory keeps each staged session lexical to one machine.
// No public ownership flags or game/title eligibility checks.
function createStagedSession({exports:e,bridge,p,cpu,bus,storage,fixedMemory=false}){
 const codec=createCodec(e,{fixedMemory});let sidecar=null,active=false;
 const originalAdvance=p.advanceDots;
 // Fixed memory and scalar descriptors are validated once by createCodec.
 const scalarView=fixedMemory?new DataView(e.memory.buffer):null;
 const dotOffset=codec.layout.dot.offset,lineOffset=codec.layout.scanline.offset,xOffset=codec.layout.x.offset;
 const currentDot=()=>scalarView?scalarView.getFloat64(dotOffset,true):codec.get('dot');
 function publishPosition(){
  p.scanline=scalarView?scalarView.getUint32(lineOffset,true):codec.get('scanline');
  p.curX=scalarView?scalarView.getUint32(xOffset,true):codec.get('x');
  bus.advancePPUClock?.(currentDot());
 }
 const report={threeCalls:0,backend:'js',reason:'not-entered',calls:0,events:[],registerFast:{readStatusRegister:0,sramWrite:0,writeSRAMAddress:0,scrollWrite:0,updateControlReg1:0,vramWrite:0,writeVRAMAddress:0}};
 // Membership is invariant for this session, including custom bridge fallback.
 const owned=new Set(['scanline','curX','vblankPending','sramAddress','spritesFound','sprite0InSecondary','hitSpr0','f_bgVisibility','f_spVisibility','f_bgClipping','f_spClipping','f_spriteSize','f_bgPatternTable','f_spPatternTable','f_dispType','f_addrInc','vramAddress','vramTmpAddress','firstWrite','regFH','cntFV','cntV','cntH','cntVT','cntHT','regFV','regV','regH','regVT','regHT']);
 function publish(){
  codec.read(sidecar);
  for(const k of Object.keys(sidecar.device))if(!owned.has(k))sidecar.device[k]=p[k];
  for(const k of Object.keys(sidecar.cpu))sidecar.cpu[k]=cpu[k];
  bridge.restoreBorrowed(sidecar);bus.advancePPUClock?.(sidecar.closure.dot);
 }
 let entryReason='unsupported-ownership-or-boundary-session';
 function enter(){if(active)throw Error('Staged session already entered');sidecar=bridge.borrowState();
  entryReason=intervalFallback(sidecar,0);
  if(entryReason){sidecar=null;return;}
  try{codec.write(sidecar,storage);active=true;}catch(error){entryReason='unrepresentable-state: '+error.message;sidecar=null;}
 }
 function leave(){if(active){publish();active=false;sidecar=null;}}
 function fallback(n,reason){leave();report.backend='js';report.reason=reason;report.calls++;return originalAdvance(n);}
 function advance(n){return run(n,false);}
 // Only the lexical factory calls this fixed-count entry. No caller eligibility flag.
 function advanceThree(){return run(3,fixedMemory);}
 function run(n,three){
  if(!active)return fallback(n,entryReason||'unsupported-ownership-or-boundary-session');
  // Entry and callback recapture establish queue/trace/OAM invariants. Narrow
  // register transactions cannot introduce delayed effects. Keep the clock fence.
  const reason=three?(currentDot()+3>=Number.MAX_SAFE_INTEGER-1?'clock-limit-partial-progress':null):intervalFallback(sidecar,n,currentDot());if(reason)return fallback(n,reason);
  report.backend='wasm';report.reason='private-owned-laboratory-session';report.calls++;
  if(!three){const begin=e.ppu_stage_begin(n);if(begin)throw Error('ppu_stage_begin: '+begin);}
  try{
   for(let yields=0;yields<=n+2;yields++){
    let rc;
    if(three&&yields===0){report.threeCalls++;rc=e.ppu_stage_three();}
    else rc=e.ppu_stage_resume();
    if(rc===0)return;
    if(rc!==4)throw Object.assign(Error('Staged PPU error '+rc),{code:rc===3?'PPU_CLOCK_LIMIT':'PPU_STAGE_ERROR'});
    const event=codec.get('event'),remaining=codec.get('event_remaining');
    publish();active=false; // reentry runs authoritative JS, never this scalar C invocation
    report.events.push({event,remaining});
    try{
     if(event===1)p._fireVblankSet(cpu,remaining);
     else if(event===2)p._fireVblankClear(cpu,remaining<=1);
     else throw Error('Unknown PPU event');
    }catch(error){
     // Authentic handler mutations and thrown error remain visible. Never ack
     // or overwrite them with the pre-callback sidecar.
     e.ppu_stage_abort();sidecar=null;throw error;
    }
    sidecar=bridge.borrowState();
    const unsupported=intervalFallback(sidecar,remaining);
    if(unsupported){
     e.ppu_stage_abort();sidecar=null;
     report.backend='js';report.reason='callback-'+unsupported;
     return originalAdvance(remaining);
    }
    codec.write(sidecar,storage);active=true;
    const ack=e.ppu_stage_ack();if(ack)throw Error('ppu_stage_ack: '+ack);
   }
   throw Error('Staged event limit');
  }catch(error){if(active){publish();active=false;sidecar=null;}e.ppu_stage_abort();throw error;}
 }
 // These entry points retain the exact JS register bodies. Only their inputs
 // and mapped mutations cross the boundary; access counters and OAM caches
 // already belong to the live sidecar. No queue, sprite or palette transfer.
 function canRegister(name,args=[]){
  if(!active)return false;
  // OAMADDR accepts negative zero as a JS Number; uint32 cannot retain it.
  if(name==='writeSRAMAddress')return !Object.is(args[0],-0);
  if(name==='readStatusRegister'||name==='scrollWrite'||name==='updateControlReg1'||name==='writeVRAMAddress')return true;
  if(name==='vramWrite'){
   const line=codec.get('scanline'),address=codec.get('address')&16383;
   return !((p.f_bgVisibility||p.f_spVisibility)&&line>=20&&line<=260)&&address>=8192&&address<16128;
  }
  if(name!=='sramWrite')return false;
  const line=codec.get('scanline');
  if((p.f_bgVisibility||p.f_spVisibility)&&line>=20&&line<=260)return true;
  const address=codec.get('sram_address');
  // Sprite zero's legacy cache callback needs a complete observation boundary.
  return address>=4&&address<=255&&codec.isShared('primary',p.spriteMem);
 }
 function register(name,fn,receiver,args){
  if(!canRegister(name,args))throw Error('Unsupported narrow register boundary');
  bridge.registerIn(name,codec);report.registerFast[name]++;
  try{return fn.apply(receiver,args);}finally{bridge.registerOut(name,codec);}
 }
 return Object.freeze({enter,advance,advanceThree,publishPosition,leave,canRegister,register,report,codec,get active(){return active;}});
}

return Object.freeze(Object.defineProperties(Object.create(null),{"createStagedSession":{enumerable:true,get:()=>createStagedSession}}));
}
