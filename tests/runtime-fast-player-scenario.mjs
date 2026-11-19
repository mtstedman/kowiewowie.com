// Evaluated inside the real-ROM browser fixture. Deliberately pace delivery
// below the replica's capacity, then release a backlog and stop the host.
export async function fastPlayerScenario(){
 const {createGuestReplication}=await import('/games/netplay/replication-guest.mjs');
 const {encodeReplicationState}=await import('/games/arcade/replication-state.mjs');
 host.pause();const end=await host.network.capture();
 const binding={packageId:'fast-player-test',artifactDigest:'a'.repeat(64)},epoch='e'.repeat(32),resyncs=[],calls=[];
 const replica=createGuestReplication({binding,network:{...follower.network,push:async(rows,options)=>{
  const start=performance.now(),result=await follower.network.push(rows,options);
  calls.push({frames:rows.length,ms:performance.now()-start,catchUp:options.catchUp,followHost:options.followHost});return result;
 }},requestResync:r=>resyncs.push(r)});
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async frame=>{const deadline=performance.now()+10000;while(replica.state().frame!==frame){if(performance.now()>deadline||resyncs.length)throw Error('Fast player did not converge: '+JSON.stringify(replica.state()));await wait(2);}};
 try{
  await replica.receive({type:'checkpoint',epoch,frame:savedSnapshot.frame,bytes:encodeReplicationState(savedSnapshot),metadata:{...binding,hash:savedSnapshot.hash}});
  await replica.receive({type:'control',epoch,frame:savedSnapshot.frame,action:'resume'});
  const rows=records.filter(r=>r.frame>savedSnapshot.frame&&r.frame<=end.frame),slow=rows.splice(0,20),paced=[];
  // A faster player finishes each frame before the next authoritative one is
  // available. Rendering callbacks keep running during each host-side gap.
  const pacedStart=performance.now();
  for(const row of slow){await replica.receive({type:'frames',epoch,frames:[row]});await until(row.frame);await wait(40);paced.push({host:row.frame,player:follower.network.status().frame});}
  const pacedHostFPS=slow.length*1000/(performance.now()-pacedStart);
  const start=performance.now(),before=draws.follower,count=rows.length;
  while(rows.length)await replica.receive({type:'frames',epoch,frames:rows.splice(0,120)});
  await until(end.frame);const catchUpMs=performance.now()-start;
  await wait(250);const caught=follower.network.status().frame,hash=(await follower.network.hash()).hash,drawn=draws.follower-before;
  const callsBefore=calls.length;await wait(250);
  return {paced,pacedHostFPS,catchUpFrames:count,catchUpMs,catchUpFPS:count*1000/catchUpMs,drawn,hostFrame:end.frame,playerFrame:caught,idleFrame:follower.network.status().frame,idlePushes:calls.length-callsBefore,hash,expectedHash:end.hash,resyncs,calls};
 }finally{replica.close();}
}
