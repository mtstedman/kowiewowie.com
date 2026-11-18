import {BrowserSnesRunner} from './runner.mjs';
let runner=null,chain=Promise.resolve();
self.onmessage=({data:request})=>{chain=chain.then(async()=>{
 const {id,op}=request;let result;
 try{
  if(op==='init'){if(runner)throw Error('SNES worker already initialized');runner=await BrowserSnesRunner.create(request.config,{sampleRate:request.sampleRate});if(request.battery)await runner.importBattery(request.battery);result=runner.info();}
  else {if(!runner)throw Error('SNES worker not initialized');
   if(op==='frame'){for(let p=0;p<2;p++)runner.input(p+1,request.pads[p]);result=runner.step();}
   else if(op==='reset'){runner.reset();result=runner.info();}
   else if(op==='save')result=await runner.save();
   else if(op==='load'){await runner.load(request.record);result=runner.info();}
   else if(op==='battery')result=await runner.battery();
   else throw Error('Unknown SNES worker request');
  }
  const transfer=op==='frame'?[result.rgba.buffer,result.audio.buffer]:[];
  self.postMessage({id,result},transfer);
 }catch(error){self.postMessage({id,error:String(error.message||error)});}
}).catch(error=>self.postMessage({id:request.id,error:String(error.message||error)}));};
