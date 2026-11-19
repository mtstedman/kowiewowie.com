// Bounded streaming producer. Credits permit ownership, never faster emulation.
import {createSimulationClock} from './simulation-clock.mjs';
import {replicationSnapshot,validateReplicationSnapshot,validateFrameRecords,hashReplicationState} from './replication-state.mjs';
export const CAPACITY=16, RGBA_BYTES=256*240*4;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
export function createTaskScheduler(Channel=globalThis.MessageChannel,{setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}={}){
 if(typeof Channel!=='function')throw Error('MessageChannel unavailable');
 const channel=new Channel(),tasks=new Map();let serial=0,closed=false;
 channel.port1.onmessage=({data:id})=>{const entry=tasks.get(id);tasks.delete(id);if(!closed&&entry)entry.task();};
 return {
  schedule(task,delay=0){
   if(closed)throw Error('Scheduler disposed');
   const id=++serial,entry={task,timer:null};tasks.set(id,entry);
   if(delay>0)entry.timer=setTimer(()=>{entry.timer=null;if(tasks.has(id)&&!closed)channel.port2.postMessage(id);},Math.max(.1,delay));
   else channel.port2.postMessage(id);
   return id;
  },
  cancel(id){const entry=tasks.get(id);if(entry&&entry.timer!==null)clearTimer(entry.timer);tasks.delete(id);},
  dispose(){closed=true;for(const entry of tasks.values())if(entry.timer!==null)clearTimer(entry.timer);tasks.clear();channel.port1.onmessage=null;channel.port1.close();channel.port2.close();},
 };
}
export function createProducer({machine,post,schedule,cancel,now=()=>performance.now(),afterFrame=()=>{}}){
 const scheduler=schedule?null:createTaskScheduler(),simulation=createSimulationClock();
 if(schedule&&typeof cancel!=='function')throw Error('Injected scheduler requires cancellation');
 schedule??=scheduler.schedule;cancel??=scheduler.cancel;
 let generation=0,replica=false,networkEnabled=false,replicationPosts=Promise.resolve(),replayTasks=Promise.resolve();
 let epoch=-1,seq=0,inputSeq=0,appliedSeq=0,timer=null,closed=false,failed=false;
 let credits=0,produced=0,time=0,lastCycles=null,nextId=0;
 const leases=new Map(),pool=[],audioPool=[],held=[new Map(),new Map()];
 const queues=Array.from({length:16},()=>[]),values=Array(16).fill(false);
 function capture(){const state=machine.exportCheckpoint(),frame=machine.getState().frames,picture={width:256,height:240,rgba:new Uint8Array(machine.getRGBA())};return replicationSnapshot(frame,state).then(snapshot=>({...snapshot,picture}));}
 function emitRecord(frame,pads){if(!networkEnabled||replica)return;const e=epoch,state=frame%120===0?machine.exportCheckpoint():null;replicationPosts=replicationPosts.then(async()=>{const record={frame,pads};if(state)record.hash=await hashReplicationState(state);if(!closed)post({type:'network-frame',epoch:e,record});}).catch(error);}
 function reply(d,result,error){if(!closed)post({type:'network-result',epoch:d.epoch,seq:d.seq,result,error});}
 async function replay(d){
  if(!replica)throw Error('Replica is not initialized');validateFrameRecords(d.records,machine.getState().frames,255);
  const g=generation;
  for(const record of d.records){
   if(closed||g!==generation)throw Error('Replica replay interrupted');
   if(d.catchUp!==true&&d.followHost!==true){simulation.resume(now());while(simulation.delay(now())>0)await new Promise(resolve=>setTimeout(resolve,Math.max(.1,simulation.delay(now()))));}
   if(closed||g!==generation)throw Error('Replica replay interrupted');
   for(let p=1;p<=2;p++)for(let b=0;b<8;b++)machine.setButton(p,b,Boolean(record.pads[p-1]&(1<<b)));
   const executedAtMs=now();if(d.catchUp!==true&&d.followHost!==true&&!simulation.take(executedAtMs))throw Error('Replica simulation clock changed during input sampling');
   const result=machine.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});if(d.catchUp!==true&&d.followHost!==true)simulation.complete(now());
   const rgba=machine.getRGBA(),audio=machine.takeAudio(),{frames,cycles}=result.state;
   if(frames!==record.frame)throw Error('Replica frame mismatch');
   if(record.hash&&await hashReplicationState(machine.exportCheckpoint())!==record.hash)throw Error('Replica state diverged at frame '+frames);
   if(d.catchUp!==true||d.presentCatchUp===true){const pcm=d.catchUp===true?new Float32Array(0):audio;post({type:'replica-frame',epoch:d.epoch,rgba,audio:pcm,frames,cycles,executedAtMs,catchUp:d.catchUp===true},[rgba.buffer,pcm.buffer]);}
   afterFrame(frames);if(d.catchUp===true&&frames%8===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(d.catchUp===true)simulation.pause();return {frame:machine.getState().frames,hash:d.records.at(-1).hash??null};
 }
 function release(){for(let p=1;p<=2;p++)for(let b=0;b<8;b++)machine.setButton(p,b,false);}
 function stop(){simulation.pause();generation++;if(timer!==null)cancel(timer);timer=null;credits=0;}
 function clear(){for(const h of held)h.clear();for(const q of queues)q.length=0;values.fill(false);if(!replica)release();}
 function error(e){stop();failed=true;scheduler?.dispose();try{clear();}catch{}post({type:'error',epoch,seq,code:e.code||'STREAM',message:String(e.message||e)});}
 function wake(){if(timer===null&&credits>0&&!closed&&!failed){const capturedGeneration=generation;timer=schedule(()=>{if(capturedGeneration===generation)step();},simulation.delay(now()));}}
 function step(){timer=null;if(!credits||closed||failed)return;
  try{
   if(simulation.delay(now())>0){wake();return;}
   for(let i=0;i<16;i++){if(queues[i].length){const edge=queues[i].shift();values[i]=edge.value;}machine.setButton(1+(i>>3),i%8,values[i]);}
   appliedSeq=Math.min(inputSeq,...queues.filter(q=>q.length).map(q=>q[0].seq-1));
   const executedAtMs=now();
   if(!simulation.take(executedAtMs))throw Error('Simulation clock changed during input sampling');
   const result=machine.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});
   simulation.complete(now());
   const audioBytes=machine.audioLength?.()*4,audioIndex=audioPool.findIndex(b=>b.byteLength===audioBytes);
   const rgba=machine.getRGBA(pool.pop()),audio=machine.takeAudio(audioIndex<0?undefined:audioPool.splice(audioIndex,1)[0]),{frames,cycles}=result.state;
   if(!(rgba instanceof Uint8ClampedArray)||rgba.byteLength!==RGBA_BYTES||rgba.byteOffset!==0||rgba.buffer.byteLength!==RGBA_BYTES||!(audio instanceof Float32Array)||audio.length%2||audio.length>96000||audio.byteOffset!==0||audio.buffer.byteLength!==audio.byteLength||rgba.buffer===audio.buffer||!integer(frames)||!integer(cycles)||lastCycles!==null&&cycles<=lastCycles)throw Error('Malformed machine output');
   const duration=audio.length?audio.length/96000:lastCycles===null?1/60.0988:(cycles-lastCycles)/1789772.7272727273;
   if(!(duration>0&&duration<=.2))throw Error('Invalid frame duration');
   credits--;produced++;const id=++nextId;leases.set(id,{epoch, audioBytes:audio.byteLength});
   post({type:'frame',epoch,id,produced,executedAtMs,at:time,duration,rgba,audio,frames,cycles,inputSeq,appliedSeq},[rgba.buffer,audio.buffer]);
   time+=duration;lastCycles=cycles;emitRecord(frames,[values.slice(0,8).reduce((n,v,b)=>n|(Number(v)<<b),0),values.slice(8).reduce((n,v,b)=>n|(Number(v)<<b),0)]);afterFrame(frames);wake();
  }catch(e){error(e);}
 }
 function receive(d){if(closed||failed)return;
  try{
   if(!d||!integer(d.epoch)||!integer(d.seq,1))throw Error('Invalid transport identity');
   if(d.epoch<epoch||d.seq<=seq)return;
   if(d.type==='sync'){
    stop();epoch=d.epoch;seq=d.seq;clear();inputSeq=appliedSeq=0;time=0;lastCycles=null;leases.clear();pool.length=0;audioPool.length=0;
    post({type:'synced',epoch,seq});return;
   }
   if(d.epoch!==epoch)throw Error('Release barrier required');seq=d.seq;
   if(d.type==='network-enable'){networkEnabled=d.enabled===true;reply(d,{enabled:networkEnabled});return;}
   if(d.type==='network-capture'){capture().then(result=>reply(d,result),e=>reply(d,null,e.message));return;}
   if(d.type==='network-follow'){
    replica=true;stop();clear();leases.clear();pool.length=audioPool.length=0;
    replayTasks=replayTasks.then(async()=>{const record=await validateReplicationSnapshot(d.snapshot);machine.importCheckpoint(record);const frame=machine.getState().frames;if(frame!==d.snapshot.frame)throw Error('Checkpoint frame mismatch');const hash=await hashReplicationState(machine.exportCheckpoint());if(hash!==d.snapshot.hash)throw Error('Restored checkpoint state mismatch');return {frame,hash,picture:d.snapshot.picture};});
    replayTasks=replayTasks.then(result=>reply(d,result),e=>reply(d,null,e.message));return;
   }
   if(d.type==='network-replay'){replayTasks=replayTasks.then(()=>replay(d)).then(result=>reply(d,result),e=>reply(d,null,e.message));return;}
   if(d.type==='checkpoint-export'||d.type==='checkpoint-import'){
    // The preceding sync barrier cancels production and releases both players.
    if(credits||timer!==null)throw Error('Checkpoint requires a paused release barrier');
    try{
     if(d.type==='checkpoint-import'){machine.importCheckpoint(d.record);clear();lastCycles=null;time=0;leases.clear();pool.length=0;audioPool.length=0;}
     const record=d.type==='checkpoint-export'?machine.exportCheckpoint():undefined;
     const rgba=d.type==='checkpoint-import'?machine.getRGBA():undefined;
     post({type:'checkpoint',epoch,seq,record,frames:machine.getState().frames,rgba},rgba?[rgba.buffer]:[]);
    }catch(e){post({type:'checkpoint-error',epoch,seq,message:String(e.message||e)});}
    return;
   }
   if(d.type==='stop'){stop();clear();return;}
   if(d.type==='input'){
    if(!integer(d.inputSeq,1)||d.inputSeq!==inputSeq+1||typeof d.source!=='string'||!d.source.length||d.source.length>256||![1,2].includes(d.seat)||!integer(d.button)||d.button>7||typeof d.pressed!=='boolean')throw Error('Invalid input update');
    inputSeq=d.inputSeq;const h=held[d.seat-1],old=h.get(d.source),b=d.pressed?d.button:old;
    if(d.pressed&&old!==undefined)return;if(!d.pressed&&old===undefined)return;
    if(d.pressed&&h.size>=64)throw Error('Input sources overflow');
    const before=[...h.values()].includes(b);if(d.pressed)h.set(d.source,b);else h.delete(d.source);
    const after=[...h.values()].includes(b),q=queues[(d.seat-1)*8+b];
    if(before!==after){if(q.length>=32)throw Error('Input edge overflow');q.push({value:after,seq:inputSeq});}return;
   }
   if(d.type==='grant'){
    if(replica)return;
    const returned=d.returns??[];
    if(!integer(d.count,1)||d.count>4||!Array.isArray(returned)||returned.length>CAPACITY)throw Error('Invalid grant batch');
    const ids=new Set(),buffers=new Set([...pool,...audioPool]);
    for(const r of returned){
     const lease=r&&leases.get(r.id);
     if(!lease||lease.epoch!==epoch||ids.has(r.id)||!(r.rgba instanceof ArrayBuffer)||r.rgba.byteLength!==RGBA_BYTES||!(r.audio instanceof ArrayBuffer)||r.audio.byteLength!==lease.audioBytes||r.rgba===r.audio||buffers.has(r.rgba)||buffers.has(r.audio))throw Error('Invalid buffer ownership');
     ids.add(r.id);buffers.add(r.rgba);buffers.add(r.audio);
    }
    if(credits+leases.size-returned.length+d.count>CAPACITY)throw Error('Credit overflow');
    // Validate every return and the resulting capacity before committing the batch.
    for(const r of returned){leases.delete(r.id);pool.push(r.rgba);if(audioPool.length===CAPACITY)audioPool.shift();audioPool.push(r.audio);}
    credits+=d.count;simulation.resume(now());wake();return;
   }
   throw Error('Unknown transport message');
  }catch(e){error(e);}
 }
 return {receive,dispose(){closed=true;stop();scheduler?.dispose();clear();leases.clear();pool.length=0;audioPool.length=0;},snapshot:()=>({epoch,credits,outstanding:leases.size,produced,inputSeq,appliedSeq,failed,scheduled:timer!==null})};
}
