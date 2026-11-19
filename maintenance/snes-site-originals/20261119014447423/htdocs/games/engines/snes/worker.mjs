import {BrowserSnesRunner} from './runner.mjs';
import {createSnesFrameExecutor} from './frame-executor.mjs';
import {replicationSnapshot,validateReplicationSnapshot,validateFrameRecords,hashReplicationState} from '../../arcade/replication-state.mjs';
let runner=null,executor=null,chain=Promise.resolve(),replica=false,network=false,replicaReady=false;
const capture=async()=>{const state=await runner.save(),snapshot=await replicationSnapshot(state.frame,state),core=runner.live(),width=core._s9xwasm_frame_width(),height=core._s9xwasm_frame_height();if(width>0&&width<=512&&height>0&&height<=478)snapshot.picture={width,height,rgba:core.HEAPU8.slice(core._s9xwasm_frame_rgba(),core._s9xwasm_frame_rgba()+width*height*4)};return snapshot;};
self.onmessage=({data:request})=>{chain=chain.then(async()=>{
 const {id,op}=request;let result;
 try{
  if(op==='init'){if(runner)throw Error('SNES worker already initialized');replica=request.replica===true;runner=await BrowserSnesRunner.create(request.config,{sampleRate:request.sampleRate});if(request.battery&&!replica)await runner.importBattery(request.battery);executor=createSnesFrameExecutor(runner);result={...runner.info(),simulationHz:executor.snapshot().hz};}
  else {if(!runner)throw Error('SNES worker not initialized');
   if(op==='frame'){
    if(replica)throw Error('Replica requires authoritative frames');result=await executor.frame(request.pads);
    if(network){result.replication={frame:runner.frame,pads:[...request.pads]};if(runner.frame%120===0)result.replication.hash=(await capture()).hash;}
   }
   else if(op==='network-enable'){network=request.enabled===true;result={enabled:network};}
   else if(op==='network-capture')result=await capture();
   else if(op==='network-follow'){const state=await validateReplicationSnapshot(request.snapshot);await runner.load(state);if(runner.frame!==request.snapshot.frame)throw Error('Checkpoint frame mismatch');const hash=await hashReplicationState(await runner.save());if(hash!==request.snapshot.hash)throw Error('Restored checkpoint state mismatch');replica=true;replicaReady=true;result={frame:runner.frame,hash,picture:request.snapshot.picture};}
   else if(op==='network-replay'){
    if(!replica||!replicaReady)throw Error('Replica is not initialized');validateFrameRecords(request.records,runner.frame,4095);
    for(const record of request.records){
     let frame;
     if(request.catchUp===true||request.followHost===true){for(let p=0;p<2;p++)runner.input(p+1,record.pads[p]);frame=runner.step();}
     else frame=await executor.frame(record.pads);
     if(runner.frame!==record.frame)throw Error('Replica frame mismatch');
     if(record.hash&&await hashReplicationState(await runner.save())!==record.hash)throw Error('Replica state diverged at frame '+record.frame);
     if(request.catchUp!==true)self.postMessage({type:'replica-frame',result:frame},[frame.rgba.buffer,frame.audio.buffer]);
     if(request.catchUp===true&&record.frame%8===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(request.catchUp===true)executor.pause();result={frame:runner.frame,hash:request.records.at(-1).hash??null};
   }
   else if(op==='reset'){runner.reset();result=runner.info();}
   else if(op==='save')result=await runner.save();
   else if(op==='load'){await runner.load(request.record);result=runner.info();}
   else if(op==='battery'){if(replica)throw Error('Replica battery persistence is disabled');result=await runner.battery();}
   else throw Error('Unknown SNES worker request');
  }
  const transfer=op==='frame'?[result.rgba.buffer,result.audio.buffer]:[];
  self.postMessage({id,result},transfer);
 }catch(error){self.postMessage({id,error:String(error.message||error)});}
}).catch(error=>self.postMessage({id:request.id,error:String(error.message||error)}));};
