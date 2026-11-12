import {createMachine} from './machine.mjs';
let machine,epoch=-1,lastSeq=0;
function releaseAll(){if(machine)for(let b=0;b<8;b++)machine.setButton(1,b,false);}
try{machine=createMachine();releaseAll();postMessage({type:'ready'});}
catch(e){postMessage({type:'error',code:e.code||'INIT',message:String(e.message||e)});}
globalThis.onmessage=({data:d})=>{
  try{
    if(!machine)throw Error('Machine unavailable');
    if(!d||!Number.isSafeInteger(d.epoch)||d.epoch<0||!Number.isSafeInteger(d.seq)||d.seq<1)throw Error('Invalid transport identity');
    if(d.epoch<epoch||d.seq<=lastSeq)return;
    if(d.type==='sync'){
      epoch=d.epoch;lastSeq=d.seq;releaseAll();
      postMessage({type:'synced',epoch,seq:d.seq});return;
    }
    if(d.type!=='frame'||d.epoch!==epoch||!Array.isArray(d.buttons)||d.buttons.length!==8||d.buttons.some(v=>typeof v!=='boolean'))throw Error('Invalid sampled frame');
    lastSeq=d.seq;
    let rgba,audio,frames,cycles;
    try{
      for(let b=0;b<8;b++)machine.setButton(1,b,d.buttons[b]);
      const result=machine.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});
      rgba=machine.getRGBA(d.rgbaBuffer);audio=machine.takeAudio();const state=result.state;frames=state.frames;cycles=state.cycles;
    }finally{releaseAll();}
    postMessage({type:'frame',epoch,seq:d.seq,rgba,audio,frames,cycles},[rgba.buffer,audio.buffer]);
  }catch(e){
    try{releaseAll();}catch{}
    postMessage({type:'error',epoch:d?.epoch,seq:d?.seq,code:e.code||'RUNTIME',message:String(e.message||e)});
  }
};
