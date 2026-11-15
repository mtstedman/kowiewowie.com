// OAM/DMC arbitration: https://www.nesdev.org/wiki/DMA
// Memory reader/output separation: https://www.nesdev.org/wiki/APU_DMC
// Reviewed against Mesen 2.1.1 NesCpu.cpp and DeltaModulationChannel.cpp;
// no hardware/reference execution equivalence is claimed.
const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
const integer=(v,max)=>{if(!Number.isSafeInteger(v)||v<0||v>max)fail('DMA_ARGUMENT','Invalid DMA integer');return v;};
export function createDMA(io){
 let o=null,d=null,last=-1,lastValue=0,locked=false;
 const stats={oamTransfers:0,oamCycles:0,dmcRequests:0,dmcCycles:0,dmcFetches:0,dmaStallCycles:0,dmcCancels:0,dmcAborts:0};
 const events=[];
 const event=(kind,address=null)=>{events.push({cycle:io.cycle(),kind,address});if(events.length>64)events.shift();};
 const get=()=> (io.cycle()&1)===1;
 function raw(a){
  let v;if((a===0x4016||a===0x4017)&&last===a)v=lastValue;else v=integer(io.read(a),255);
  last=a;lastValue=v;io.setBus(v);return v;
 }
 function transferRead(a,halt){
  // NES /OE remains asserted over contiguous joypad reads. Internal register
  // selection uses halted CPU high bits and DMA low five bits (NESdev DMA).
  if((halt&0xffe0)!==0x4000){
   if((a&0xffe0)===0x4000){last=-1;return io.getBus();}
   return raw(a);
  }
  const internal=0x4000|(a&31);
  if(internal===0x4015){const v=raw(internal);if(a!==internal)io.read(a);last=internal;lastValue=v;io.setBus(v);return v;}
  if(internal===0x4016||internal===0x4017){let v=raw(internal);if(a!==internal){const external=integer(io.read(a),255);v=(external&254)|(external&v&1);}last=internal;lastValue=v;io.setBus(v);return v;}
  return raw(a);
 }
 function pending(){return Boolean(o||d&&(d.stage!=='wait'||io.cycle()>=d.at));}
 function drain(a){
  let n=0;
  while(pending()){
   if(++n>8192)fail('DMA_LIMIT','DMA drain exceeds 8192 cycles');
   const oo=o,dd=d,oa=oo!==null,da=dd!==null&&(dd.stage!=='wait'||io.cycle()>=dd.at),og=oa&&oo.stage==='get',op=oa&&oo.stage==='put';
   const fetch=da&&dd.stage==='get'&&get();let complete=null,value=0;
   if(oa)stats.oamCycles++;if(da)stats.dmcCycles++;stats.dmaStallCycles++;
   if(fetch){value=transferRead(dd.address,a);event('dmc-get',dd.address);d=null;stats.dmcFetches++;complete=dd.done;}
   else if(og&&get()){oo.value=transferRead((oo.page<<8)|oo.index,a);oo.stage='put';event('oam-get',(oo.page<<8)|oo.index);}
   else if(op&&!get()){last=-1;io.writeOam(oo.value);io.setBus(oo.value);event('oam-put',0x2004);if(++oo.index===256){o=null;stats.oamTransfers++;}else oo.stage='get';}
   else{raw(a);event(oa&&oo.stage==='halt'?'halt':da&&dd.stage==='dummy'?'dummy':'align',a);}
   if(oa&&oo.stage==='halt')oo.stage='get';
   if(da&&!fetch){if(dd.stage==='wait')dd.stage='dummy';else if(dd.stage==='dummy')dd.stage='get';}
   io.tick();if(complete)complete(value);
  }
 }
 return Object.freeze({
  readCPU(a){integer(a,65535);if(locked)fail('DMA_REENTRANT','Reentrant bus cycle');locked=true;try{drain(a);const v=raw(a);io.tick();return v;}finally{locked=false;}},
  writeCPU(a,v){integer(a,65535);integer(v,255);if(locked)fail('DMA_REENTRANT','Reentrant bus cycle');locked=true;try{last=-1;io.writeCPU(a,v);io.setBus(v);io.tick();}finally{locked=false;}},
  requestOam(page){integer(page,255);if(o&&o.stage!=='halt')fail('DMA_CONTRACT','OAM request during active transfer');o={page,index:0,value:0,stage:'halt'};},
  requestDmc(address,at,done,cancelled=null){integer(address,65535);integer(at,Number.MAX_SAFE_INTEGER-8192);if(address<32768||typeof done!=='function'||(cancelled!==null&&typeof cancelled!=='function')||d)fail('DMA_CONTRACT','Invalid or duplicate DMC request');d={address,at,done,cancelled,stage:'wait'};stats.dmcRequests++;},
  cancelDmc(){if(!d)return 'idle';if(d.stage==='get'){event('dmc-stop-committed',d.address);return 'committed';}const old=d;d=null;const aborted=old.stage==='dummy';if(aborted)stats.dmcAborts++;else stats.dmcCancels++;event(aborted?'dmc-abort':'dmc-cancel',old.address);if(old.cancelled)old.cancelled();return aborted?'aborted':'cancelled';},
  stats:()=>({...stats}),
  snapshot:()=>({getParity:1,oam:o?{...o}:null,dmc:d?{address:d.address,at:d.at,stage:d.stage}:null,events:events.map(e=>({...e}))}),
  clear(){if(locked)fail('DMA_REENTRANT','Cannot clear in bus callback');o=null;d=null;last=-1;events.length=0;}
 });
}
// RP2A03 DMC reader/output timing. Clock convention is part of the contract.
// References: NESdev DMA oldid=23450; Mesen 2.1.1 DeltaModulationChannel.
export const dmcTimingContract=Object.freeze({revision:'rp2a03-dmc-stop-reload-1',defaultChip:'rp2a03h-late-g',getParity:1,clockOrder:'bus,ppu,dmc,papu,increment,dma-completion',stopDelay:'get write +3; put write +2',duplication:'implicit single-byte stop on reload boundary; late G/H only',hardwareQualified:false});
export function installDMC(channel,dma,now,options={}){
 for(const k of ['writeReg','setEnabled','clockDmc','nextSample','getLengthStatus','getIrqStatus'])if(typeof channel[k]!=='function')fail('DEVICE_CONTRACT','Unsupported DMC method '+k);
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='chip'))fail('DEVICE_CONTRACT','Invalid DMC options');
 const chip=options.chip??dmcTimingContract.defaultChip;
 if(!['rp2a03h-late-g','rp2a03-early-g'].includes(chip))fail('DEVICE_CONTRACT','Unsupported DMC silicon policy');
 const periods=[428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54];
 let period=428,timer=428,bits=8,shift=0,silent=true,buffer=null,outstanding=false,loop=false,irqEnabled=false,lastBoundary=-100,disableAt=null,loadAt=null;
 const history=[];
 function record(kind){history.push({cycle:now(),kind,remaining:channel.playLengthCounter});if(history.length>32)history.shift();}
 function mirror(){channel.data=shift;channel.hasSample=!silent;channel.dmaCounter=bits;channel.deltaCounter=channel.sample>>1;channel.dacLsb=channel.sample&1;}
 Object.assign(channel,{playStartAddress:0xc000,playAddress:0xc000,playLength:1,playLengthCounter:0,irqGenerated:false,lastFetchedByte:0,sample:0,deltaCounter:0,dacLsb:0,dmaFrequency:3424,shiftCounter:3424});
 function initSample(){channel.playAddress=channel.playStartAddress;channel.playLengthCounter=channel.playLength;}
 function request(at,kind='reload'){
  if(outstanding||buffer!==null||!channel.playLengthCounter)return;
  const address=channel.playAddress;
  outstanding=true;record(kind+'-request');
  dma.requestDmc(address,at,value=>{
   outstanding=false;
   // A committed physical read can finish after reader disable. It still has
   // bus side effects, but must not resurrect the counter, IRQ or buffer.
   if(!channel.playLengthCounter){record('discard-disabled-fetch');return;}
   buffer=value;channel.lastFetchedByte=value;
   channel.playAddress=address===65535?32768:address+1;
   channel.playLengthCounter--;
   const ended=channel.playLengthCounter===0&&!loop;
   if(!channel.playLengthCounter){if(loop)initSample();else if(irqEnabled)channel.irqGenerated=true;}
   record('fetch-complete');
   // Completion is after tick/increment: now()-1 is the physical get cycle.
   // Only a load can end a one-byte sample before its first reload.
   if(ended&&kind==='load'&&channel.playLength===1){
    if(lastBoundary===now()-1&&bits===8&&timer===period&&chip==='rp2a03h-late-g'){
     shift=value;silent=false;buffer=null;initSample();record('duplicate-load');
     request(now(),'duplicate');mirror();
    }else if(bits===1&&timer<=2){
     // Preserve the first byte for the imminent output reload. A temporary
     // reader restart allows its request to reach halt before disable.
     initSample();disableAt=now()+2;record('implicit-abort-armed');
    }
   }
  },()=>{outstanding=false;record('request-cancelled');});
 }
 function reload(){let at=now()+1;if(at&1)at++;if(loadAt!==null&&at<loadAt)at=loadAt;request(at,loadAt!==null&&now()<loadAt?'load':'reload');}
 channel.setEnabled=value=>{channel.isEnabled=Boolean(value);};
 channel.clockDmc=()=>{};
 channel.nextSample=channel.endOfSample=()=>fail('DEVICE_CONTRACT','Legacy immediate DMC fetch is forbidden');
 channel.getLengthStatus=()=>channel.playLengthCounter?1:0;
 channel.getIrqStatus=()=>channel.irqGenerated?1:0;
 channel.toJSON=channel.fromJSON=()=>fail('UNSUPPORTED_STATE_RESTORE','DMC-only serialization omits arbitration state');
 channel.writeReg=(a,v)=>{
  integer(v,255);
  if(a===0x4010){loop=Boolean(v&64);irqEnabled=Boolean(v&128);period=periods[v&15];channel.dmaFrequency=period*8;channel.playMode=loop?1:irqEnabled?2:0;if(!irqEnabled)channel.irqGenerated=false;}
  else if(a===0x4011){channel.sample=v&127;mirror();}
  else if(a===0x4012){channel.reg4012=v;channel.playStartAddress=0xc000|(v<<6);}
  else if(a===0x4013){channel.reg4013=v;channel.playLength=(v<<4)+1;}
  else if(a===0x4015){
   channel.irqGenerated=false;
   if(!(v&16)){
    // Consecutive writes do not postpone an already pending disable.
    if(disableAt===null)disableAt=now()+((now()&1)?3:2);
    record('explicit-stop-armed');
   }else if(!channel.playLengthCounter){
    initSample();loadAt=now()+3+((now()&1)?1:0);request(loadAt,'load');record('start');
   }
  }else fail('DEVICE_CONTRACT','Unsupported DMC register');
 };
 return Object.freeze({tick(){
  // Disabling is processed before this cycle's output timer. Requests already
  // in their halt cycle may abort; requests blocked by CPU writes cancel.
  if(disableAt!==null&&now()>=disableAt){
   disableAt=null;loadAt=null;channel.playLengthCounter=0;
   const disposition=dma.cancelDmc();record('disable-'+disposition);
  }
  if(loadAt!==null&&now()>=loadAt)loadAt=null;
  if(--timer>0)return;timer=period;
  if(!silent){if(shift&1){if(channel.sample<=125)channel.sample+=2;}else if(channel.sample>=2)channel.sample-=2;shift>>>=1;}
  if(--bits===0){bits=8;lastBoundary=now();silent=buffer===null;if(!silent){shift=buffer;buffer=null;reload();}}
  mirror();
 },snapshot:()=>({chip,period,timer,bits,shift,silent,buffer,outstanding,loop,irqEnabled,disableAt,loadAt,lastBoundary,bytesRemaining:channel.playLengthCounter,address:channel.playAddress,history:history.map(x=>({...x}))})});
}
