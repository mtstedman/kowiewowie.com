import test from 'node:test';
import assert from 'node:assert/strict';
import {GameHost} from '../htdocs/games/arcade/host.mjs';
function fixture(replica=true){
 const pkg={id:'replica-fixture',title:'Replica fixture',artifactDigest:'a'.repeat(64),capabilities:{nativePlayers:2,play:'host-p1-guest-p2'},inputs:[{id:'a',activation:'held'}],surfaces:{video:{kind:'canvas'},audio:{kind:'none'}}};
 const calls={pause:0,start:0,save:0,reset:0,release:0,dispose:0,inputs:[],forwarded:[],audio:0};let running=true,listener,session;
 const network={status:()=>({ready:true,replica,frame:100,running})};
 const adapter={version:1,packageId:pkg.id,artifactDigest:pkg.artifactDigest,replica,network:()=>network,load(){},start(){calls.start++;running=true;},resume(){running=true;},pause(){calls.pause++;running=false;},reset(){calls.reset++;},save(){calls.save++;return true;},dispose(){calls.dispose++;},input(event){calls.inputs.push(event);return true;},releaseAll(){calls.release++;},snapshot:()=>({ready:true,running,loading:false,closed:false}),surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:'CANVAS'},audio:null})};
 const host=new GameHost({get:()=>pkg},{loader:async()=>({version:1,createAdapter:()=>adapter})});
 const value=(role,phase='active',epoch=1)=>({role,phase,epoch,reconnect:phase==='reconnecting'?'pending':'none',watch:'unavailable',play:'unavailable',message:'Fixture synchronized state'});
 const bind=(role,phase='active')=>{session=value(role,phase);return host.bindSession({version:1,packageId:pkg.id,artifactDigest:pkg.artifactDigest,getState:()=>session,subscribe:fn=>{listener=fn;return()=>{listener=null;};},inviteWatch(){},invitePlay(){},sendInput(event){calls.forwarded.push(event);return true;},releaseInputs(){},enableAudio(){calls.audio++;},getMedia:()=>null,dispose(){}});};
 return {host,pkg,calls,network,bind,update(role,phase,epoch){session=value(role,phase,epoch);listener(session);}};
}
test('active spectator replica keeps its emulator running without input or save authority',async()=>{
 const f=fixture();await f.host.load(f.pkg.id);const lease=f.bind('spectator');
 assert.equal(f.calls.pause,0);assert.equal(f.host.snapshot().runtime.running,true);assert.equal(f.host.snapshot().replica,true);assert.equal(f.host.snapshot().canControl,false);assert.equal(f.host.snapshot().canSave,false);
 assert.equal(f.host.input({control:'a',source:'watcher',pressed:true}),false);await assert.rejects(f.host.save(),/cannot save/);
 for(const action of ['pause','resume','reset'])await assert.rejects(async()=>f.host.control(action),/cannot control/);
 await f.host.control('start');assert.equal(f.calls.audio,1);assert.equal(f.calls.start,0);assert.equal(f.calls.save,0);assert.equal(f.calls.inputs.length,0);assert.equal(lease.network(),f.network);
 f.update('spectator','active',1);f.host.suspend('focus-loss');assert.equal(f.calls.pause,0);assert.equal(f.host.snapshot().runtime.running,true);await f.host.unload();assert.equal(f.calls.dispose,1);assert.throws(()=>lease.network(),/disposed/);
});
test('guest controls only enqueue provider inputs for the assigned second player',async()=>{
 const f=fixture();await f.host.load(f.pkg.id);f.bind('guest');assert.equal(f.host.snapshot().canControl,true);assert.equal(f.host.snapshot().canSave,false);
 assert(f.host.input({control:'a',source:'key',pressed:true}));assert.equal(f.calls.inputs.length,0);assert.equal(f.calls.forwarded.length,1);assert.deepEqual(f.calls.forwarded[0],{control:'a',source:'local:key',pressed:true,seat:2,epoch:1,role:'guest'});
 f.host.suspend('focus-loss');assert.equal(f.calls.forwarded.at(-1).pressed,false);assert.equal(f.calls.pause,0);assert.equal(f.host.snapshot().runtime.running,true);
 f.update('guest','reconnecting',2);assert.equal(f.calls.forwarded.at(-1).pressed,false);assert.equal(f.host.input({control:'a',source:'other',pressed:true}),false);assert.equal(f.calls.inputs.length,0);await assert.rejects(f.host.save(),/cannot save/);await f.host.dispose();
});
test('bootstrap and reconnect notifications do not pause replica catchup; terminal states do',async()=>{
 const f=fixture();await f.host.load(f.pkg.id);f.bind('spectator','connecting');
 assert.equal(f.calls.pause,0);assert.equal(f.host.snapshot().canControl,false);
 f.update('spectator','reconnecting',1);f.update('spectator','reconnecting',1);
 assert.equal(f.calls.pause,0,'Repeated pending UI notifications must not override the replication clock');assert.equal(f.host.snapshot().runtime.running,true);
 f.update('spectator','active',2);assert.equal(f.calls.pause,0);assert.equal(f.host.snapshot().canSave,false);
 f.update('spectator','ended',3);assert.equal(f.calls.pause,1);assert.equal(f.host.snapshot().runtime.running,false);await f.host.dispose();
});
test('solo cartridge retains ordinary local controls, saves and pause behavior',async()=>{
 const f=fixture(false);await f.host.load(f.pkg.id);assert(f.host.input({control:'a',source:'local-key',pressed:true}));assert.equal(f.calls.inputs.length,1);assert.equal(f.calls.forwarded.length,0);assert.equal(f.calls.inputs[0].seat,1);
 assert.equal(f.host.snapshot().canSave,true);await f.host.save();assert.equal(f.calls.save,1);await f.host.control('pause');assert.equal(f.calls.pause,1);assert.equal(f.host.snapshot().runtime.running,false);await f.host.control('resume');f.host.suspend('focus-loss');assert.equal(f.calls.pause,2);await f.host.dispose();
});
