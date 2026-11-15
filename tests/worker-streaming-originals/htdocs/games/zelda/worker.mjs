import {encodeRAM,decodeRAM} from './battery-codec.mjs';
import {createMachine} from './engine/machine.mjs';
let machine,epoch=-1,lastSeq=0;
function releaseAll(){if(machine)for(let port=1;port<=2;port++)for(let b=0;b<8;b++)machine.setButton(port,b,false);}
let batteryInitialized=false;
postMessage({type:'battery-await-init'});
globalThis.onmessage=({data:d})=>{
  try{
    if(d?.type==='battery-init'){
      if(batteryInitialized)throw Error('Duplicate battery initialization');
      const saved=d.record===null?null:decodeRAM(d.record);
      machine=createMachine();
      if(typeof machine.exportBattery!=='function'||typeof machine.importBattery!=='function')throw Error('Machine battery accessor contract');
      encodeRAM(machine.exportBattery());if(saved)machine.importBattery(saved);
      batteryInitialized=true;releaseAll();postMessage({type:'ready'});return;
    }
    if(d?.type==='battery-flush'){
      if(!batteryInitialized||!Number.isSafeInteger(d.request)||d.request<1)throw Error('Invalid battery flush');
      postMessage({type:'battery-data',request:d.request,record:encodeRAM(machine.exportBattery())});return;
    }
    if(!machine||!batteryInitialized)throw Error('Machine unavailable');
    if(!d||!Number.isSafeInteger(d.epoch)||d.epoch<0||!Number.isSafeInteger(d.seq)||d.seq<1)throw Error('Invalid transport identity');
    if(d.epoch<epoch||d.seq<=lastSeq)return;
    if(d.type==='sync'){
      epoch=d.epoch;lastSeq=d.seq;releaseAll();
      postMessage({type:'synced',epoch,seq:d.seq});return;
    }
    if(d.type!=='frame'||d.epoch!==epoch||!Array.isArray(d.buttons)||d.buttons.length!==8||d.buttons.some(v=>typeof v!=='boolean')||!Array.isArray(d.buttons2)||d.buttons2.length!==8||d.buttons2.some(v=>typeof v!=='boolean'))throw Error('Invalid sampled frame');
    lastSeq=d.seq;
    let rgba,audio,frames,cycles;
    try{
      for(let b=0;b<8;b++){machine.setButton(1,b,d.buttons[b]);machine.setButton(2,b,d.buttons2[b]);}
      const result=machine.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});
      rgba=machine.getRGBA(d.rgbaBuffer);audio=machine.takeAudio();const state=result.state;frames=state.frames;cycles=state.cycles;
    }finally{releaseAll();}
    postMessage({type:'frame',epoch,seq:d.seq,rgba,audio,frames,cycles},[rgba.buffer,audio.buffer]);
    if(frames%60===0)postMessage({type:'battery-data',request:0,record:encodeRAM(machine.exportBattery())});
  }catch(e){
    try{releaseAll();}catch{}
    postMessage({type:'error',epoch:d?.epoch,seq:d?.seq,code:e.code||'RUNTIME',message:String(e.message||e)});
  }
};
