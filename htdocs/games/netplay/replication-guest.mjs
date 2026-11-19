import {decodeReplicationState as decodeSnapshot} from '../arcade/replication-state.mjs';
import {SYNC_LIMITS} from './sync-wire.mjs';
// The receive callback only queues frames. Rendering and native replay must not
// block receipt of heartbeats, pause controls, or the next checkpoint.
export function createGuestReplication({network,binding,onChange=()=>{},requestResync=()=>{},viewer=false}){
 let epoch='',frame=0,receivedFrame=0,target=Infinity,queue=[],generation=0,draining=false,ready=false,loaded=false,closed=false,paused=true,error='',resyncs=0,lagSince=null;
 const notify=()=>{try{onChange();}catch{}};
 const state=()=>({epoch,frame,ready,loaded,paused,queued:queue.length,error,resyncs});
 function request(reason){if(closed)return;lagSince=null;generation++;queue=[];ready=false;loaded=false;error=reason;network.setPaused?.(true);resyncs++;requestResync({epoch,frame,reason});notify();}
 function settle(){if(loaded&&frame>=target&&!ready){ready=true;error='';notify();}if(loaded&&paused&&queue.length===0)network.setPaused?.(true);}
 async function drain(){
  if(draining||closed||!loaded)return;draining=true;const ticket=generation;
  try{
   while(queue.length&&!closed&&ticket===generation){
    // Initial bootstrap is silent; established replicas keep showing progress
    // during catch-up. Native frames stay ordered and audio is never sped up.
    const catchUp=queue.length>2&&(!ready||queue.length>(viewer?30:6));
    let count=catchUp?Math.min(120,Math.max(1,queue.length-2)):Math.min(6,queue.length);
    const hashIndex=queue.slice(0,count).findIndex(r=>r.hash);if(hashIndex>=0)count=hashIndex+1;
    const batch=queue.splice(0,count);
    if(batch[0].frame!==frame+1)throw Error('Missing synchronized frame');
    const result=await network.push(batch,{catchUp,followHost:true,presentCatchUp:ready});
    if(ticket!==generation||closed)return;
    if(result?.frame!==batch.at(-1).frame)throw Error('Replica frame counter mismatch');
    frame=batch.at(-1).frame;if(queue.length<=30)lagSince=null;
    const expected=batch.at(-1).hash;
    if(expected&&result?.hash!==expected)throw Error('Game state diverged');
    settle();
   }
  }catch(e){if(!closed&&ticket===generation)request(String(e.message||e).slice(0,120));}
  finally{draining=false;if(!closed&&loaded&&queue.length)void drain();}
 }
 return {
  async receive(message){
   if(closed)return;
   if(message.type==='checkpoint'){
    const metadata=message.metadata;
    if(metadata?.packageId!==binding.packageId||metadata?.artifactDigest!==binding.artifactDigest)throw Error('Checkpoint cartridge mismatch');
    const snapshot=decodeSnapshot(message.bytes);
    if(snapshot?.frame!==message.frame||snapshot.hash!==metadata.hash)throw Error('Checkpoint frame mismatch');
    const ticket=++generation;epoch=message.epoch;frame=receivedFrame=message.frame;target=Infinity;queue=[];ready=false;loaded=false;error='';paused=true;notify();
    await network.follow(snapshot);
    if(closed||ticket!==generation)return;
    loaded=true;notify();return;
   }
   if(message.epoch!==epoch)return;
   if(message.type==='frames'){
    if(!loaded)return;
    let expected=receivedFrame+1;
    for(const record of message.frames){if(record.frame<expected)continue;if(record.frame!==expected){request('Missing synchronized frame');return;}queue.push(record);receivedFrame=record.frame;expected++;}
    if(!viewer&&ready&&queue.length>30){const now=performance.now();lagSince??=now;if(now-lagSince>=1000){request('Synchronizing Player 2 with the host');return;}}else lagSince=null;
    if(queue.length>SYNC_LIMITS.historyFrames){request('Catching up from a fresh snapshot');return;}
    void drain();return;
   }
   if(message.type==='control'){
    if(message.action==='end'){this.close();return;}
    paused=message.action==='pause';target=message.frame;
    if(!paused)network.setPaused?.(false);
    settle();notify();void drain();
   }
  },
  state,
  disconnected(){if(closed)return;generation++;queue=[];ready=false;loaded=false;paused=true;network.setPaused?.(true);notify();},
  retry(){request('Refreshing synchronized game');},
  close(){if(closed)return;closed=true;generation++;queue=[];ready=false;loaded=false;network.setPaused?.(true);notify();}
 };
}
