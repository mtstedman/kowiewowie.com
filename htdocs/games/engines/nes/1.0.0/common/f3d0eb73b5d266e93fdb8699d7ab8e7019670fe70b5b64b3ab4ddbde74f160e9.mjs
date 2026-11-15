// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";
const installOwnedDotPPU=imports[0]["installOwnedDotPPU"];
const createStagedSession=imports[1]["createStagedSession"];
const createCodec=imports[2]["createCodec"];
const createOwnedExports=imports[3]["createOwnedExports"];




// Test observations live outside the public machine/state graph.
const observations=new WeakMap();
function backendStats(machine){const get=observations.get(machine);return get?get():null;}
function rememberBackend(machine,get){observations.set(machine,get);return machine;}
function installFactoryPPU(nes,bus,peek,write,host){
 const e=createOwnedExports();e.ppu_initialize();const codec=createCodec(e,{fixedMemory:true}),p=nes.ppu;
 function bytes(name,Type){return codec.typed(name,Type);}
 for(const [name,key,Type] of [['primary','spriteMem',Uint8Array],['secondary','secondaryOAM',Uint8Array],['frame','buffer',Uint32Array]]){
  const a=bytes(name,Type);a.set(p[key]);p[key]=a;
 }
 const storage={mirroring:host.mirroring,chr:bytes('chr',Uint8Array),ciram:bytes('ciram',Uint8Array),palette:bytes('palette',Uint8Array),rgb:bytes('rgb',Uint32Array)};
 storage.ciram.set(host.ciram);host.setCiram(storage.ciram.subarray(0,host.ciram.length));
 for(let i=0;i<8192;i++)storage.chr[i]=peek(i);
 function colors(){for(let i=0;i<32;i++)storage.palette[i]=peek(0x3f00+i);for(let i=0;i<64;i++)storage.rgb[i]=p.palTable.getEntry(i);}
 colors();let bridge;installOwnedDotPPU(nes,bus,peek,write,b=>{bridge=b;});
 const original=p.advanceDots;
 const session=createStagedSession({exports:e,bridge,p,cpu:nes.cpu,bus,storage,fixedMemory:true});
 let nesting=0,advancing=false,wasmCalls=0,jsCalls=0;
 // Device entry points retain existing JS bodies. Supported status/OAM writes
 // use scalar synchronization; other methods publish a complete boundary.
 // Nested calls stay in the same transaction, including DMA writes.
 const methods=new Set();for(let proto=p;proto&&proto!==Object.prototype;proto=Object.getPrototypeOf(proto))for(const name of Object.getOwnPropertyNames(proto))methods.add(name);
 const wrapped=new Map();
 function narrowDependencies(name){return name==='readStatusRegister'?p.setStatusFlag===wrapped.get('setStatusFlag')&&p._updateNmiOutput===wrapped.get('_updateNmiOutput'):name==='sramWrite'?p.spriteRamWriteUpdate===wrapped.get('spriteRamWriteUpdate'):name==='writeSRAMAddress';}
 for(const name of methods){
  if(name==='constructor'||name==='advanceDots'||typeof p[name]!=='function')continue;
  const fn=p[name];p[name]=function(...args){
   if(nesting)return fn.apply(this,args);
   if(!advancing&&narrowDependencies(name)&&session.canRegister(name,args)){
    nesting++;try{return session.register(name,fn,this,args);}finally{nesting--;}
   }
   session.leave();nesting++;
   try{return fn.apply(this,args);}finally{nesting--;}
  };wrapped.set(name,p[name]);
 }
 p.advanceDots=function(n){
  if(advancing||nesting){jsCalls++;return original(n);}
  advancing=true;
  try{
   if(!session.active){
    // This predicate reads closure flags directly, without exporting queues,
    // traces or bulk storage on every dot of a delayed-effect window.
    if(!bridge.safeInterval(n)){jsCalls++;return original(n);}
    colors();session.enter();
   }
   const result=n===3?session.advanceThree():session.advance(n);
   if(session.report.backend==='wasm')wasmCalls++;else jsCalls++;
   if(session.active)session.publishPosition();
   return result;
  }finally{advancing=false;}
 };
 return Object.freeze({
  boundary(){session.leave();},
  write(a){if(a<8192)storage.chr[a]=peek(a);else if(a>=0x3f00)colors();},
  stats:()=>({wasmCalls,jsCalls,threeCalls:session.report.threeCalls,active:session.active,reason:session.report.reason,registerFast:{...session.report.registerFast}})
 });
}

return Object.freeze(Object.defineProperties(Object.create(null),{"backendStats":{enumerable:true,get:()=>backendStats},"rememberBackend":{enumerable:true,get:()=>rememberBackend},"installFactoryPPU":{enumerable:true,get:()=>installFactoryPPU}}));
}
