// Synthetic transport: no worker source or game engine is evaluated.
import assert from 'node:assert/strict';
export function batteryContract(namespaces){
 const codecs=namespaces.filter(n=>typeof n.encodeRAM==='function'&&typeof n.decodeRAM==='function'&&typeof n.validateRecord==='function'&&typeof n.storageKey==='string');
 if(!codecs.length)return null;
 assert.equal(codecs.length,1,'Ambiguous save codec');
 const configs=namespaces.filter(n=>Number.isSafeInteger(n.config?.identity?.ram_bytes));
 assert.equal(configs.length,1,'Save codec requires an explicit configuration');
 const bytes=configs[0].config.identity.ram_bytes;assert(bytes>0&&bytes<=65536,'Fixture RAM bound');
 const codec=codecs[0];codec.encodeRAM(new Uint8Array(bytes));
 return {codec,bytes};
}
export function workerTransport(getBattery,{flushMode='auto'}={}){
 assert(['auto','manual','error'].includes(flushMode),'Invalid flush mode');
 const workers=[],trace=[];
 class Worker{
  constructor(url,options){
   assert.equal(workers.filter(w=>!w.dead).length,0,'Only one live worker');
   assert.equal(options?.type,'module');this.url=String(url);this.dead=false;this.sent=[];this.initialized=false;this.pending=[];
   this.battery=getBattery();this.ram=this.battery?new Uint8Array(this.battery.bytes):null;
   workers.push(this);trace.push({event:'create',worker:workers.length-1});
   if(this.battery)queueMicrotask(()=>{if(!this.dead)this.receive({type:'battery-await-init'});});
  }
  postMessage(message){
   assert(!this.dead,'Message sent to terminated worker');const m=structuredClone(message);this.sent.push(m);trace.push({event:'send',type:m.type,worker:workers.indexOf(this)});
   if(m.type==='sync'){this.streamEpoch=m.epoch;this.streamCredits=0;}
    if(m.type==='grant'){
     assert.equal(m.epoch,this.streamEpoch,'Grant before release barrier');
     assert(Number.isSafeInteger(m.count)&&m.count>=1&&m.count<=4,'Bounded batch grant');
     assert(Array.isArray(m.returns)&&m.returns.length<=16,'Bounded ownership returns');
     this.streamCredits=(this.streamCredits||0)+m.count;
     assert(this.streamCredits<=16,'Reservations exceed capacity');
    }
    if(m.type==='input'){
     assert.equal(m.epoch,this.streamEpoch,'Input before release barrier');
     assert(Number.isSafeInteger(m.inputSeq)&&m.inputSeq>=1,'Monotonic input identity');
     const previous=this.lastInputEpoch===m.epoch?this.lastInputSeq:0;
     assert.equal(m.inputSeq,previous+1);this.lastInputEpoch=m.epoch;this.lastInputSeq=m.inputSeq;
    }
   if(m.type==='battery-init'){
    assert(this.battery&&!this.initialized,'Unexpected or duplicate save initialization');
    if(m.record!==null)this.ram.set(this.battery.codec.decodeRAM(m.record));
    this.initialized=true;return;
   }
   if(m.type==='battery-flush'){
    assert(this.battery&&this.initialized,'Flush before save initialization');
    assert(Number.isSafeInteger(m.request)&&m.request>0,'Invalid flush request');this.pending.push(m.request);
    if(flushMode!=='manual')queueMicrotask(()=>{if(!this.dead){if(flushMode==='error')this.receive({type:'battery-error',message:'Synthetic save failure'});else this.replyFlush();}});
   }
  }
  replyFlush(record){
   assert(!this.dead&&this.pending.length,'No live flush to answer');const request=this.pending.shift();
   const value=record===undefined?this.battery.codec.encodeRAM(this.ram):record;
   this.receive({type:'battery-data',request,record:value});
  }
  receive(message){
   assert(!this.dead,'Reply from terminated worker');
   if(message.type==='ready'&&this.battery)assert(this.initialized,'Ready before save handshake');
    if(message.type==='frame'&&message.epoch===this.streamEpoch){assert(this.streamCredits>0,'Unreserved frame');this.streamCredits--;}
    trace.push({event:'receive',type:message.type,worker:workers.indexOf(this)});
   this.onmessage?.({data:structuredClone(message)});
  }
  terminate(){this.dead=true;trace.push({event:'terminate',worker:workers.indexOf(this)});}
 }
 return {Worker,workers,trace};
}
