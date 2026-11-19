import {encodeReplicationState as encodeSnapshot} from '../arcade/replication-state.mjs';
import {SYNC_LIMITS} from './sync-wire.mjs';
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
// One canonical input log belongs to the host. Every peer has an independent
// snapshot cursor; a slow viewer never stalls simulation or another player.
export function createHostReplication({network,adapter,binding,onError=()=>{}}){
 const peers=new Map(),history=[];let epoch=random(),closed=false,lastFrame=null,capturedFrame=0,lastRunning=Boolean(adapter.enabled()),unsubscribe;
 const frameNumber=()=>Math.max(lastFrame??0,capturedFrame);
 function report(error){try{onError(error);}catch{}}
 function control(entry){entry.controlPending=true;if(entry.ready&&entry.peer.healthy())entry.controlPending=!entry.peer.sendControl({epoch,frame:frameNumber(),action:adapter.enabled()?'resume':'pause'});}
 function resync(entry){entry.ready=false;entry.expected=null;adapter.release(entry.assignment.participant);void bootstrap(entry);}
 function acknowledge(entry,message){
  if(entry.ready)return;const expected=entry.expected;if(!expected){entry.earlyAck=message;return;}
  if(message.epoch!==epoch||message.frame!==expected.frame||message.sha256!==expected.sha256)return;
  entry.ready=true;entry.expected=null;entry.earlyAck=null;flush(entry);control(entry);
 }
 function reset(){epoch=random();history.length=0;lastFrame=null;capturedFrame=0;for(const entry of peers.values()){entry.ready=false;entry.generation++;adapter.release(entry.assignment.participant);void bootstrap(entry,true);}}
 function flush(entry){
  if(closed||!entry.ready||!entry.peer.healthy())return;
  const cursor=entry.peer.syncState().frame,records=history.filter(r=>r.frame>cursor);
  if(!records.length)return;
  if(records[0].frame!==cursor+1){resync(entry);return;}
  for(let i=0;i<records.length;i+=120)if(!entry.peer.sendFrames({epoch,frames:records.slice(i,i+120)}))return;
 }
 async function bootstrap(entry,force=false){
  if(closed||entry.peer.closed||entry.loading)return;
  if(!force&&(entry.expected?performance.now()-entry.expectedAt<15000:performance.now()-entry.lastSnapshot<1500))return;
  entry.lastSnapshot=performance.now();entry.ready=false;entry.loading=true;entry.expected=null;entry.earlyAck=null;
  adapter.release(entry.assignment.participant);const ticket=++entry.generation,capturedEpoch=epoch;
  try{
   const snapshot=await network.capture();
   if(closed||ticket!==entry.generation||capturedEpoch!==epoch||peers.get(entry.assignment.participant)!==entry)return;
   if(!Number.isSafeInteger(snapshot.frame)||snapshot.frame<0)throw Error('Invalid authoritative checkpoint frame');
   capturedFrame=Math.max(capturedFrame,snapshot.frame);
   const bytes=encodeSnapshot(snapshot);
   const sent=await entry.peer.sendCheckpoint({epoch,frame:snapshot.frame,bytes,metadata:{packageId:binding.packageId,artifactDigest:binding.artifactDigest,hash:snapshot.hash}});
   if(ticket===entry.generation&&capturedEpoch===epoch){entry.expected=sent;entry.expectedAt=performance.now();if(entry.earlyAck)acknowledge(entry,entry.earlyAck);}
  }catch(error){if(!closed&&!entry.peer.closed){entry.peer.suspend('Synchronizing game state…','rebuild');report(error);}}
  finally{entry.loading=false;if(!closed&&capturedEpoch!==epoch&&peers.get(entry.assignment.participant)===entry)void bootstrap(entry,true);}
 }
 unsubscribe=network.subscribeFrame(record=>{
  if(closed)return;
  if(record.type==='reset'){reset();return;}
  if(!Number.isSafeInteger(record.frame)||!Array.isArray(record.pads))return;
  if(lastFrame!==null&&record.frame!==lastFrame+1){reset();lastFrame=record.frame;return;}
  lastFrame=record.frame;history.push({frame:record.frame,pads:record.pads.slice(),...(record.hash?{hash:record.hash}:{})});if(history.length>SYNC_LIMITS.historyFrames)history.shift();
  for(const entry of peers.values())try{flush(entry);}catch(error){report(error);entry.peer.retry();}
 });
 const timer=setInterval(()=>{
  if(closed)return;const running=Boolean(adapter.enabled());
  if(running!==lastRunning){lastRunning=running;for(const entry of peers.values()){if(!running)adapter.release(entry.assignment.participant);control(entry);}}
  for(const entry of peers.values())if(entry.peer.healthy()){if(!entry.ready&&!entry.loading)void bootstrap(entry);else if(entry.ready){flush(entry);if(entry.controlPending)control(entry);}}
 },250);
 return {
  callbacks(assignment){return {
   syncOpen(peer){const previous=peers.get(assignment.participant);if(previous)previous.generation++;const entry={assignment,peer,generation:0,ready:false,loading:false,expected:null,lastSnapshot:-Infinity};peers.set(assignment.participant,entry);void bootstrap(entry,true);},
   syncMessage(message,peer){
    const entry=peers.get(assignment.participant);if(!entry||entry.peer!==peer||closed)return;
    if(message.type==='ack'){
     acknowledge(entry,message);return;
    }
    if(message.type==='resync'){resync(entry);return;}
    if(message.type==='input'&&assignment.participant_role==='play'&&entry.ready&&message.epoch===epoch&&adapter.enabled())adapter.remote(assignment.participant,assignment.session,assignment.player,message.controls);
   },
   syncClose(peer){const entry=peers.get(assignment.participant);if(entry?.peer===peer){entry.generation++;peers.delete(assignment.participant);adapter.release(assignment.participant);}}
  };},
  dispose(){if(closed)return;closed=true;clearInterval(timer);unsubscribe?.();for(const entry of peers.values()){entry.generation++;adapter.release(entry.assignment.participant);}peers.clear();history.length=0;},
  state:()=>({epoch,frame:frameNumber(),peers:peers.size})
 };
}
