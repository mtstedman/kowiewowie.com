import {createMachine} from "./composition-entry.mjs";
import {createProducer} from '../arcade/worker-stream-producer.mjs';
let producer;
try{
 const machine=createMachine();for(let p=1;p<=2;p++)for(let b=0;b<8;b++)machine.setButton(p,b,false);
 producer=createProducer({machine,post:(d,t)=>postMessage(d,t)});postMessage({type:'ready'});
}catch(e){postMessage({type:'error',code:e.code||'INIT',message:String(e.message||e)});}
globalThis.onmessage=({data:d})=>producer?.receive(d);
