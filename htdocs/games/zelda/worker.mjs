import {createMachine} from "./composition-entry.mjs";
import {createProducer} from '../arcade/worker-stream-producer.mjs';
import {encodeRAM,decodeRAM} from './battery-codec.mjs';
let machine,producer,initialized=false;
postMessage({type:'battery-await-init'});
globalThis.onmessage=({data:d})=>{
 try{
  if(d?.type==='battery-init'){
   if(initialized)throw Error('Duplicate battery initialization');
   const saved=d.record===null?null:decodeRAM(d.record);machine=createMachine();
   if(typeof machine.exportBattery!=='function'||typeof machine.importBattery!=='function')throw Error('Machine battery accessor contract');
   encodeRAM(machine.exportBattery());if(saved)machine.importBattery(saved);
   for(let p=1;p<=2;p++)for(let b=0;b<8;b++)machine.setButton(p,b,false);
   producer=createProducer({machine,post:(d,t)=>postMessage(d,t),afterFrame:frames=>{if(frames%60===0)postMessage({type:'battery-data',request:0,record:encodeRAM(machine.exportBattery())});}});
   initialized=true;postMessage({type:'ready'});return;
  }
  if(d?.type==='battery-flush'){
   if(!initialized||!Number.isSafeInteger(d.request)||d.request<1)throw Error('Invalid battery flush');
   postMessage({type:'battery-data',request:d.request,record:encodeRAM(machine.exportBattery())});return;
  }
  if(!initialized)throw Error('Machine unavailable');producer.receive(d);
 }catch(e){producer?.dispose();postMessage({type:d?.type==='battery-flush'?'battery-error':'error',epoch:d?.epoch,seq:d?.seq,code:e.code||'INIT',message:String(e.message||e)});}
};
