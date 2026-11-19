import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuestReplication} from '../htdocs/games/netplay/replication-guest.mjs';
import {createHostReplication} from '../htdocs/games/netplay/replication-host.mjs';
import {encodeReplicationState} from '../htdocs/games/arcade/replication-state.mjs';
const binding={packageId:'fixture',artifactDigest:'a'.repeat(64)},hash='b'.repeat(64),epoch='c'.repeat(32);
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const snapshot=frame=>({frame,state:{frame,data:new Uint8Array([1,2,3])},hash,identity:{system:'fixture'}});
const checkpoint=frame=>({type:'checkpoint',epoch,frame,bytes:encodeReplicationState(snapshot(frame)),metadata:{...binding,hash}});
function follower(push=async records=>({frame:records.at(-1).frame,hash:records.at(-1).hash??null}),options={}){
 let frame=0;const requests=[],pauses=[];
 const network={follow:async s=>{frame=s.frame;},push:async(records,options)=>{const result=await push(records,options);frame=result.frame;return result;},status:()=>({frame}),setPaused:paused=>pauses.push(paused)};
 const replica=createGuestReplication({...options,network,binding,requestResync:r=>requests.push(r)});
 return {replica,network,requests,pauses};
}
test('incoming frames remain consecutive while a native replay batch is in flight',async()=>{
 let finish;const calls=[];const f=follower(async (records,options)=>{assert.equal(options.followHost,true);assert.equal(options.presentCatchUp,true);calls.push(records.map(r=>r.frame));if(records[0].frame===11)await new Promise(resolve=>finish=resolve);return {frame:records.at(-1).frame,hash:records.at(-1).hash??null};});
 await f.replica.receive(checkpoint(10));await f.replica.receive({type:'control',epoch,frame:10,action:'resume'});
 await f.replica.receive({type:'frames',epoch,frames:[{frame:11,pads:[0,1]}]});
 await f.replica.receive({type:'frames',epoch,frames:[{frame:12,pads:[2,1]},{frame:13,pads:[2,0],hash}]});
 assert.equal(f.requests.length,0);finish();await flush();assert.equal(f.replica.state().frame,13);assert.equal(f.replica.state().ready,true);assert.deepEqual(calls.flat(),[11,12,13]);f.replica.close();
});
test('a faster player follows a slow or stalled host without invented frames or a local pacing delay',async()=>{
 const executed=[],modes=[];const f=follower(async(records,options)=>{executed.push(...records.map(r=>r.frame));modes.push(options);return {frame:records.at(-1).frame,hash:records.at(-1).hash};});
 try{
  await f.replica.receive(checkpoint(10));await f.replica.receive({type:'control',epoch,frame:10,action:'resume'});
  // The host clock is explicitly stepped; the replica finishes within each
  // step, then has unlimited event-loop turns in which it must remain idle.
  for(let frame=11;frame<=20;frame++){
   await f.replica.receive({type:'frames',epoch,frames:[{frame,pads:[frame%2,1]}]});await flush();
   assert.equal(f.replica.state().frame,frame);assert.equal(f.replica.state().queued,0);
   const count=executed.length;await flush();assert.equal(executed.length,count);
  }
  // A delivery burst is replayed immediately, even though no new host ticks
  // occur while the faster player catches up.
  await f.replica.receive({type:'frames',epoch,frames:Array.from({length:60},(_,i)=>({frame:21+i,pads:[0,i%2],...(i===59?{hash}:{})}))});await flush();
  assert.equal(f.replica.state().frame,80);assert.equal(f.replica.state().queued,0);assert(modes.some(m=>m.catchUp));assert(modes.every(m=>m.followHost));
  await flush();assert.deepEqual(executed,Array.from({length:70},(_,i)=>11+i));assert.equal(f.requests.length,0);
  await f.replica.receive({type:'frames',epoch,frames:[{frame:81,pads:[1,0]}]});await flush();assert.equal(f.replica.state().frame,81);
 }finally{f.replica.close();}
});
test('host sends each frame immediately and drains blocked peers independently without a heartbeat',async()=>{
 let record,frame=40;const host=createHostReplication({binding,network:{subscribeFrame:fn=>(record=fn,()=>{}),capture:async()=>snapshot(frame)},adapter:{enabled:()=>true,release(){},remote(){}}});
 function participant(id,role){const callbacks=host.callbacks({participant:id,participant_role:role}),sent=[];let ack,cursor=frame,writable=true;
  const peer={closed:false,healthy:()=>true,syncState:()=>({frame:cursor}),async sendCheckpoint(s){cursor=s.frame;return ack={type:'ack',epoch:s.epoch,frame:s.frame,sha256:hash};},sendFrames(s){if(!writable)return false;assert.equal(s.frames[0].frame,cursor+1);cursor=s.frames.at(-1).frame;sent.push(...s.frames);return true;},sendControl:()=>true,suspend(){},retry(){assert.fail('Unexpected transport retry');}};
  return {callbacks,peer,sent,ack:()=>callbacks.syncMessage(ack,peer),block:()=>{writable=false;},drain:()=>{writable=true;callbacks.syncWritable(peer);}};
 }
 try{const play=participant('player','play'),watch=participant('viewer','watch');for(const p of [play,watch]){p.callbacks.syncOpen(p.peer);await flush();p.ack();}
  watch.block();for(;frame<1900;){record({frame:++frame,pads:[0,1]});assert.equal(play.sent.at(-1).frame,frame,'Frame must leave in the producer callback, before any timer');}
  assert.equal(watch.sent.length,0);play.block();record({frame:++frame,pads:[1,0]});assert.equal(play.sent.at(-1).frame,frame-1);
  play.drain();assert.equal(play.sent.at(-1).frame,frame,'Drain sends the pending tail even when the host produces no more frames');
  assert.deepEqual(play.sent.map(r=>r.frame),Array.from({length:frame-40},(_,i)=>41+i));
  play.callbacks.syncClose(play.peer);const count=play.sent.length;play.drain();assert.equal(play.sent.length,count);
 }finally{host.dispose();}
});
test('hash divergence stops input readiness until a fresh checkpoint restores the canonical state',async()=>{
 let fail=true;const f=follower(async records=>{if(fail)throw Error('Replica state diverged');return {frame:records.at(-1).frame,hash:records.at(-1).hash??null};});
 await f.replica.receive(checkpoint(119));await f.replica.receive({type:'control',epoch,frame:119,action:'resume'});
 await f.replica.receive({type:'frames',epoch,frames:[{frame:120,pads:[0,0],hash}]});await flush();
 assert.equal(f.requests.length,1);assert.equal(f.replica.state().ready,false);assert.equal(f.replica.state().loaded,false);
 fail=false;await f.replica.receive(checkpoint(180));await f.replica.receive({type:'control',epoch,frame:180,action:'pause'});
 assert.equal(f.replica.state().ready,true);assert.equal(f.replica.state().paused,true);assert.equal(f.replica.state().frame,180);f.replica.close();
});
test('closing a replica prevents a late native completion from restoring readiness',async()=>{
 let finish;const f=follower(async records=>{await new Promise(resolve=>finish=resolve);return {frame:records.at(-1).frame};});
 await f.replica.receive(checkpoint(1));await f.replica.receive({type:'frames',epoch,frames:[{frame:2,pads:[0,0]}]});f.replica.close();finish();await flush();assert.equal(f.replica.state().ready,false);assert.equal(f.replica.state().frame,1);
});
test('host retains frames produced during a snapshot and accepts an early checkpoint acknowledgment',async()=>{
 let record,frame=40,callbacks,peer,finishTransfer;const frames=[],controls=[];
 const network={subscribeFrame:fn=>(record=fn,()=>{}),capture:async()=>snapshot(frame),status:()=>({frame})};
 const adapter={enabled:()=>true,release(){},remote(){throw Error('No remote inputs expected');}};
 const host=createHostReplication({network,adapter,binding});const assigned={participant:'one',participant_role:'watch'};callbacks=host.callbacks(assigned);
 peer={closed:false,healthy:()=>true,cursor:0,syncState(){return {frame:this.cursor};},async sendCheckpoint(s){this.cursor=s.frame;await new Promise(resolve=>finishTransfer=resolve);const ack={type:'ack',epoch:s.epoch,frame:s.frame,sha256:hash};callbacks.syncMessage(ack,this);return ack;},sendFrames(s){assert.equal(s.frames[0].frame,this.cursor+1);this.cursor=s.frames.at(-1).frame;frames.push(...s.frames);return true;},sendControl:s=>(controls.push(s),true),suspend(){},retry(){}};
 try{callbacks.syncOpen(peer);await flush();for(let i=0;i<4;i++){frame++;record({frame,pads:[i,0]});}assert.equal(frames.length,0);finishTransfer();await flush();assert.deepEqual(frames.map(r=>r.frame),[41,42,43,44]);assert.equal(controls.at(-1).frame,44);assert.equal(controls.at(-1).action,'resume');}
 finally{host.dispose();}
});

test('a paused late join paints the final catch-up frames at live speed',async()=>{
 const modes=[];const f=follower(async(records,options)=>{modes.push({frames:records.map(r=>r.frame),catchUp:options.catchUp});return {frame:records.at(-1).frame,hash};});
 await f.replica.receive(checkpoint(10));await f.replica.receive({type:'control',epoch,frame:20,action:'pause'});
 await f.replica.receive({type:'frames',epoch,frames:Array.from({length:10},(_,i)=>({frame:11+i,pads:[0,0]}))});await flush();
 assert.equal(f.replica.state().ready,true);assert.equal(modes[0].catchUp,true);assert.deepEqual(modes.filter(m=>!m.catchUp).flatMap(m=>m.frames),[19,20]);f.replica.close();
});
test('host retries throttled resync and buffered pause controls without new frames',async()=>{
 let captures=0,allowControl=false;const controls=[];let callbacks;
 const host=createHostReplication({binding,network:{subscribeFrame:()=>()=>{},capture:async()=>{captures++;return snapshot(40);}},adapter:{enabled:()=>false,release(){},remote(){}}});
 const peer={closed:false,healthy:()=>true,syncState:()=>({frame:40}),async sendCheckpoint(s){const ack={type:'ack',epoch:s.epoch,frame:s.frame,sha256:hash};queueMicrotask(()=>callbacks.syncMessage(ack,this));return ack;},sendFrames:()=>true,sendControl:s=>{if(allowControl)controls.push(s);return allowControl;},suspend(){},retry(){}};
 callbacks=host.callbacks({participant:'viewer',participant_role:'watch'});
 try{callbacks.syncOpen(peer);await flush();assert.equal(captures,1);allowControl=true;await new Promise(r=>setTimeout(r,300));assert.equal(controls.at(-1).action,'pause');
 callbacks.syncMessage({type:'resync'},peer);assert.equal(captures,1);await new Promise(r=>setTimeout(r,1500));assert.equal(captures,2);assert.equal(controls.at(-1).frame,40);}
 finally{host.dispose();}
});

test('player bootstrap, resync and disconnect never acquire or resume the host clock',async()=>{
 let running=true,holds=0,record,frame=40;const captures=[],controls=[],inputs=[];
 const network={subscribeFrame:fn=>(record=fn,()=>{}),pauseForSync(){holds++;running=false;return()=>{running=true;};},capture:async()=>{captures.push(running);return snapshot(frame);}};
 const host=createHostReplication({network,binding,adapter:{enabled:()=>running,release(){},remote(...args){inputs.push(args);}}});
 function participant(id,role){const callbacks=host.callbacks({participant:id,participant_role:role,session:'session',player:'p2'});let sent,cursor=frame;const frames=[];const peer={closed:false,healthy:()=>true,syncState:()=>({frame:cursor}),async sendCheckpoint(s){cursor=s.frame;sent={type:'ack',epoch:s.epoch,frame:s.frame,sha256:hash};return sent;},sendFrames(s){assert.equal(s.frames[0].frame,cursor+1);cursor=s.frames.at(-1).frame;frames.push(...s.frames);return true;},sendControl:s=>(controls.push(s),true),suspend(){},retry(){}};return{callbacks,peer,frames,ack:()=>callbacks.syncMessage(sent,peer),bad:()=>callbacks.syncMessage({...sent,sha256:'0'.repeat(64)},peer),input:()=>callbacks.syncMessage({type:'input',epoch:host.state().epoch,controls:{a:true}},peer)};}
 try{
  const play=participant('player','play');play.callbacks.syncOpen(play.peer);await flush();
  assert.equal(holds,0);assert.equal(running,true);assert.deepEqual(captures,[true]);
  for(let i=0;i<4;i++)record({frame:++frame,pads:[1,0]});
  play.bad();play.input();assert.equal(inputs.length,0);assert.equal(play.frames.length,0);
  play.ack();await flush();assert.deepEqual(play.frames.map(r=>r.frame),[41,42,43,44]);assert.equal(controls.at(-1).action,'resume');play.input();assert.equal(inputs.length,1);
  play.callbacks.syncMessage({type:'resync'},play.peer);play.input();assert.equal(inputs.length,1);assert.equal(running,true);assert.equal(holds,0);
  play.callbacks.syncClose(play.peer);play.callbacks.syncOpen(play.peer);await flush();assert.equal(running,true);assert.equal(holds,0);
  // A manual host pause during recovery must not be undone by a late ack.
  running=false;play.ack();await flush();assert.equal(running,false);assert.equal(controls.at(-1).action,'pause');play.callbacks.syncClose(play.peer);assert.equal(running,false);
  const watch=participant('viewer','watch');watch.callbacks.syncOpen(watch.peer);await flush();watch.ack();assert.equal(holds,0);assert.equal(running,false);
 }finally{host.dispose();assert.equal(running,false);}
});

test('viewers retain ordered visible frames through half-second lag while players catch up promptly',async()=>{
 for(const viewer of [false,true]){const modes=[],frames=[];const f=follower(async(records,options)=>{modes.push(options.catchUp);frames.push(...records.map(r=>r.frame));return {frame:records.at(-1).frame};},{viewer});
 await f.replica.receive(checkpoint(10));await f.replica.receive({type:'control',epoch,frame:10,action:'resume'});await f.replica.receive({type:'frames',epoch,frames:Array.from({length:20},(_,i)=>({frame:11+i,pads:[0,0]}))});await flush();
 assert.deepEqual(frames,Array.from({length:20},(_,i)=>11+i));assert.equal(modes.some(Boolean),!viewer);f.replica.close();}
});

test('only sustained player lag requests a new handshake; spectator backlog stays independent',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=0;Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
 try{for(const viewer of [false,true]){let finish;now=0;const f=follower(async records=>{await new Promise(r=>finish=r);return{frame:records.at(-1).frame};},{viewer});await f.replica.receive(checkpoint(10));await f.replica.receive({type:'control',epoch,frame:10,action:'resume'});
 await f.replica.receive({type:'frames',epoch,frames:[{frame:11,pads:[0,0]}]});await f.replica.receive({type:'frames',epoch,frames:Array.from({length:31},(_,i)=>({frame:12+i,pads:[0,0]}))});assert.equal(f.requests.length,0,'A short arrival burst is not sustained lag');now=1001;await f.replica.receive({type:'frames',epoch,frames:[{frame:43,pads:[0,0]}]});assert.equal(f.requests.length,viewer?0:1);f.replica.close();finish();await flush();}
 }finally{Object.defineProperty(globalThis,'performance',original);}
});
