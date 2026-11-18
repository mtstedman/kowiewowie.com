import test from 'node:test';
import assert from 'node:assert/strict';
import {GameHost} from '../htdocs/games/arcade/host.mjs';

function fixture({save=async()=>true,ready=true}={}){
 const pkg={id:'save-fixture',title:'Save fixture',artifactDigest:'1'.repeat(64),capabilities:{play:'shared-hero',nativePlayers:1},inputs:[],surfaces:{video:{kind:'none'},audio:{kind:'none'}}};
 const state={ready,running:false},calls={saved:0,disposed:0,released:0};
 const adapter={version:1,packageId:pkg.id,artifactDigest:pkg.artifactDigest,load(){},start(){state.running=true;},pause(){state.running=false;},resume(){state.running=true;},reset(){},dispose(){calls.disposed++;},input(){},releaseAll(){calls.released++;},snapshot:()=>({...state}),surfaces:()=>({view:{nodeType:1},video:null,audio:null})};
 if(save)adapter.save=()=>{calls.saved++;return save();};
 const host=new GameHost({get:()=>pkg},{loader:async()=>({version:1,createAdapter:()=>adapter})});
 return {host,pkg,adapter,state,calls};
}
const session=(role,phase='active')=>({role,phase,epoch:1,reconnect:phase==='reconnecting'?'pending':'none',watch:'available',play:'available',message:'Test session'});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:v=>resolve(v),reject:e=>reject(e)};};

test('host save supports solo/host, awaits durable completion and blocks a duplicate save',async()=>{
 for(const role of ['solo','host']){
  const gate=deferred(),{host,pkg,calls}=fixture({save:()=>gate.promise});
  await host.load(pkg.id);if(role==='host')host.state(host.active,session(role));
  assert.equal(host.snapshot().canSave,true);
  let finished=false;const saving=host.save().then(v=>{finished=true;return v;});
  await Promise.resolve();assert.equal(finished,false);assert.equal(host.snapshot().canSave,false);assert.equal(calls.saved,1);assert.equal(calls.disposed,0);
  await assert.rejects(host.save(),/already in progress/);
  gate.resolve('committed');assert.equal(await saving,'committed');assert.equal(host.snapshot().canSave,true);assert.equal(host.snapshot().package.id,pkg.id);
  await host.dispose();
 }
});

test('save failures remain errors and keep the loaded game available for retry',async()=>{
 const failure=Error('Quota exceeded'),gate=deferred(),{host,pkg,calls}=fixture({save:()=>gate.promise});
 await host.load(pkg.id);const saving=host.save();gate.reject(failure);await assert.rejects(saving,e=>e===failure);
 assert.equal(host.snapshot().package.id,pkg.id);assert.equal(host.snapshot().canSave,true);assert.equal(host.snapshot().message,'Quota exceeded');assert.equal(calls.disposed,0);
 await host.dispose();
});

test('save rejects guests, spectators, inactive sessions, unready games and adapters without saves',async()=>{
 for(const role of ['guest','spectator']){const {host,pkg,calls}=fixture();await host.load(pkg.id);host.state(host.active,session(role));assert.equal(host.snapshot().canSave,false);await assert.rejects(host.save(),/session/);assert.equal(calls.saved,0);await host.dispose();}
 for(const phase of ['connecting','reconnecting','ended','incompatible']){const {host,pkg,calls}=fixture();await host.load(pkg.id);host.state(host.active,session('host',phase));assert.equal(host.snapshot().canSave,false);await assert.rejects(host.save(),/session/);assert.equal(calls.saved,0);await host.dispose();}
 for(const options of [{ready:false},{save:null}]){const {host,pkg,calls}=fixture(options);await host.load(pkg.id);assert.equal(host.snapshot().canSave,false);await assert.rejects(host.save(),/ready|support/);assert.equal(calls.saved,0);await host.dispose();}
 const {host}=fixture();await assert.rejects(host.save(),/ready package/);assert.equal(host.snapshot().canSave,false);await host.dispose();
});

test('a save finishing after package removal is rejected as superseded',async()=>{
 const gate=deferred(),{host,pkg}=fixture({save:()=>gate.promise});await host.load(pkg.id);const saving=host.save();await host.unload();gate.resolve(true);await assert.rejects(saving,/superseded/);assert.equal(host.snapshot().package,null);assert.equal(host.snapshot().canSave,false);await host.dispose();
});
