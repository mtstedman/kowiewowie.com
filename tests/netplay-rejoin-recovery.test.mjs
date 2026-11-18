import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBridge,storageKey} from '../htdocs/games/arcade/session-bridge.mjs';
const catalog=JSON.parse(readFileSync(new URL('../htdocs/games/netplay/catalog.json',import.meta.url)));
const binding=catalog.packages.megaman;
const pkg={...JSON.parse(readFileSync(new URL('../htdocs/games/megaman/game-package.json',import.meta.url))).manifest,artifactDigest:binding.artifactDigest};
const hex=(digit,n)=>digit.repeat(n);
async function lab(t,{activeUntil=15000,conflict='still_active',firstJoin=false,pollFailure=false}={}){
 let clock=0,serial=0;const tasks=new Map(),intervals=new Map(),storage=new Map(),calls=[],states=[],originals=new Map();
 const record={room:hex('1',32),participant:hex('2',32),credential:hex('3',64),session:hex('4',32),join_id:hex('5',32),joined:true};
 if(firstJoin){delete record.session;delete record.joined;record.invite=hex('8',64);}
 const assigned={protocol:3,catalog:binding.catalog,binding:binding.version,packageId:binding.packageId,artifactDigest:binding.artifactDigest,inputProfile:binding.inputProfile,inputsDigest:binding.inputsDigest,compatibility:binding.compatibility,participant:record.participant,participant_role:'watch',player:null,session:hex('6',32),capabilities:{video:true,audio:true,input:false}};
 const globals={performance:{now:()=>clock},
  document:{createElement:()=>({setAttribute(){},pause(){},play:async()=>{},remove(){},srcObject:null})},
  location:{origin:'https://arcade.invalid',pathname:'/games/arcade/',search:'?package=megaman'},history:{state:null,replaceState(){}},
  sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)??null,removeItem:k=>storage.delete(k)},
  setTimeout(fn,delay){tasks.set(++serial,{fn,delay,due:clock+delay});return serial;},clearTimeout:id=>tasks.delete(id),
  setInterval(fn){intervals.set(++serial,fn);return serial;},clearInterval:id=>intervals.delete(id),
  fetch:async(url,options)=>{
   const action=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({action,body,at:clock});
   if(action==='rejoin'&&clock<activeUntil)return new Response(JSON.stringify({error:conflict}),{status:409});
   if(action==='rejoin'||action==='join')return new Response(JSON.stringify(assigned));
   if(action==='leave')return new Response(JSON.stringify({...assigned,left:true}));
   assert.equal(action,'poll');if(pollFailure==='ended')return new Response(JSON.stringify({error:'participant_ended'}),{status:410});if(pollFailure)throw Error('Fixture signaling unavailable');
   return new Response(JSON.stringify({...assigned,round:'',mode:'rebuild',recover:'none',peer_live:true,message:null}));
  }};
 for(const [key,value]of Object.entries(globals)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 const bridge=createBridge(pkg,binding,record,{onUI:e=>{if(e.state)states.push(e.state);}});
 const owner={bindSession(provider){provider.subscribe(s=>states.push(s));return {};}};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 t.after(async()=>{await bridge.dispose();await flush();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 async function tickRetry(){await flush();const entry=[...tasks].find(([,task])=>task.delay===2000);assert(entry,'Expected bounded retry timer');const [id,task]=entry;tasks.delete(id);clock=task.due;task.fn();await flush();}
 return {bridge,owner,states,calls,storage,record,flush,tickRetry,intervals,get now(){return clock;},clearConflict(){activeUntil=0;}};
}
test('reload waits for the existing lease, preserves retry identity and completes rejoin',async t=>{
 const l=await lab(t),opening=l.bridge.attach(l.owner);await l.flush();
 assert.match(l.bridge.provider.getState().message,/previous connection/);
 for(const fn of l.intervals.values())fn();assert.match(l.bridge.provider.getState().message,/previous connection/,'Periodic UI updates must retain retry status');
 while(l.now<16000)await l.tickRetry();await opening;
 const joins=l.calls.filter(c=>c.action==='rejoin');assert.equal(joins.length,9);
 assert.equal(new Set(joins.map(c=>c.body.join_id)).size,1);
 assert.equal(JSON.parse(l.storage.get(storageKey(pkg))).joined,true);
 assert.equal(l.bridge.provider.getState().role,'spectator');assert(!l.calls.some(c=>c.action==='leave'),'A newcomer cannot evict an active participant');
});
test('another active tab gets bounded retries and a working explicit Retry action',async t=>{
 const l=await lab(t,{activeUntil:Infinity}),opening=l.bridge.attach(l.owner);await l.flush();
 for(let n=0;n<10;n++)await l.tickRetry();await opening;
 assert.equal(l.calls.filter(c=>c.action==='rejoin').length,11);
 assert.match(l.bridge.provider.getState().message,/another tab or window/);
 for(const fn of l.intervals.values())fn();assert.match(l.bridge.provider.getState().message,/Retry connection/);
 assert(l.storage.has(storageKey(pkg)),'An expired retry window must preserve the pending resume transaction');
 l.clearConflict();await Promise.all([l.bridge.retry(),l.bridge.retry()]);await l.flush();
 assert.equal(l.calls.filter(c=>c.action==='rejoin').length,12,'Concurrent retry clicks share one join operation');
 assert.equal(JSON.parse(l.storage.get(storageKey(pkg))).joined,true);
});
test('a replaced session stops retrying and explains how to obtain a new invitation',async t=>{
 const l=await lab(t,{activeUntil:Infinity,conflict:'stale_session'});await l.bridge.attach(l.owner);
 assert.equal(l.calls.filter(c=>c.action==='rejoin').length,1);
 assert.equal(l.bridge.provider.getState().phase,'ended');assert.match(l.bridge.provider.getState().message,/reconnected elsewhere.*fresh invitation/);
 await l.bridge.retry();assert.equal(l.calls.length,1);
});
test('disposing during rejoin cancels retries and never starts a receiving peer',async t=>{
 const l=await lab(t,{activeUntil:Infinity}),opening=l.bridge.attach(l.owner);await l.flush();
 await l.bridge.dispose('page-exit');await opening;await l.flush();
 assert.equal(l.calls.length,1);assert.equal(l.intervals.size,0);
});
test('first-time watcher exposes signaling failures instead of an unexplained Connecting label',async t=>{
 const l=await lab(t,{firstJoin:true,pollFailure:true});await l.bridge.attach(l.owner);await l.flush();
 assert.equal(l.calls.filter(c=>c.action==='join').length,1);assert.equal(l.calls.filter(c=>c.action==='rejoin').length,0);
 assert.match(l.bridge.provider.getState().message,/Signaling unavailable.*retrying/);
});

test('terminal transport authorization errors retain their actionable message',async t=>{
 const l=await lab(t,{firstJoin:true,pollFailure:'ended'});await l.bridge.attach(l.owner);await l.flush();
 assert.equal(l.bridge.provider.getState().phase,'ended');assert.match(l.bridge.provider.getState().message,/authorization ended.*new invite/);
});
