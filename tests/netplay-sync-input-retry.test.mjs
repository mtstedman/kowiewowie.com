import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {joinSyncParticipant} from '../htdocs/games/netplay/sync-session.mjs';
import {createSyncWire,SYNC_LIMITS} from '../htdocs/games/netplay/sync-wire.mjs';
import {encodeReplicationState} from '../htdocs/games/arcade/replication-state.mjs';
const binding=JSON.parse(readFileSync(new URL('../htdocs/games/netplay/catalog.json',import.meta.url))).packages.contra;
const tick=()=>delay(2);
async function fixture(t,role='play'){
 let now=10000,serial=0,channel,session;const intervals=new Map(),timers=new Map(),received=[],originals=new Map();
 const assignment={protocol:3,catalog:binding.catalog,binding:binding.version,packageId:binding.packageId,artifactDigest:binding.artifactDigest,inputProfile:binding.inputProfile,inputsDigest:binding.inputsDigest,compatibility:binding.compatibility,participant:'a'.repeat(32),participant_role:role,player:role==='play'?binding.players.remote:null,session:'b'.repeat(32),capabilities:{video:true,audio:true,input:role==='play'}};
 const auth={...assignment,room:'c'.repeat(32),credential:'d'.repeat(64)},epoch='e'.repeat(32),round='f'.repeat(32);
 const sdp=type=>({type,sdp:'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 '+Array(32).fill('ab').join(':')+'\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n'});
 let hostWire;
 const globals={performance:{now:()=>now},setInterval(fn){intervals.set(++serial,fn);return serial;},clearInterval:id=>intervals.delete(id),setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),
  RTCPeerConnection:class{
   constructor(config){this.config=config;this.connectionState='connected';this.iceGatheringState='complete';this.signalingState='stable';}
   getConfiguration(){return this.config;}setConfiguration(config){this.config=config;}getTransceivers(){return [];}
   async setRemoteDescription(value){this.remoteDescription=value;channel={label:'game-sync-v1',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,readyState:'open',send:raw=>{void hostWire.receive(raw);},close(){this.readyState='closed';}};this.ondatachannel({channel});channel.onopen();}
   async createAnswer(){return sdp('answer');}async setLocalDescription(value){this.localDescription=value;}close(){this.connectionState='closed';}
  },
  fetch:async(url)=>{const action=String(url).split('/').at(-1);let data;if(action==='join')data=assignment;else if(action==='poll')data={...assignment,round,mode:'rebuild',recover:'none',peer_live:true,message:{round,description:sdp('offer')}};else if(action==='ice')data={...assignment,available:true,iceServers:[{urls:['turn:relay.invalid:3478'],username:'fixture',credential:'fixture'}],iceTransportPolicy:role==='watch'?'relay':'all',server_time:10,expires_at:610,refresh_after_seconds:420};else if(action==='signal')data={...assignment,accepted:true,round};else if(action==='leave')data={...assignment,left:true};else throw Error('Unexpected fixture action '+action);return new Response(JSON.stringify(data));}
 };
 for(const [key,value]of Object.entries(globals)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 hostWire=createSyncWire(binding,auth,{role:'host',send:raw=>{channel.onmessage({data:raw});return true;},onMessage:m=>received.push(m)});
 t.after(async()=>{await session?.dispose();hostWire.close();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 let frame=100;const network={follow:async snapshot=>{frame=snapshot.frame;},push:async rows=>({frame:frame=rows.at(-1).frame}),status:()=>({frame}),setPaused(){},enableAudio(){}};
 session=await joinSyncParticipant(binding,{room:auth.room,participant:auth.participant,credential:auth.credential,invite:'1'.repeat(64),join_id:'2'.repeat(32)},{network});
 for(let n=0;n<100&&!channel;n++)await tick();assert(channel);await tick();
 const snapshot={frame,hash:'3'.repeat(64),state:{fixture:true}};
 await hostWire.sendCheckpoint({epoch,frame,bytes:encodeReplicationState(snapshot),metadata:{packageId:binding.packageId,artifactDigest:binding.artifactDigest,hash:snapshot.hash}});
 for(let n=0;n<100&&!received.some(m=>m.type==='ack');n++)await tick();assert(received.some(m=>m.type==='ack'));
 hostWire.sendControl({epoch,frame,action:'resume'});hostWire.heartbeat(true);await tick();await tick();assert.equal(session.getState().phase,'active');
 return {session,received,channel,press:(source,pressed)=>session.input({source,control:'a',pressed,epoch:session.getState().epoch}),async heartbeat(){now+=250;hostWire.heartbeat(true);await tick();for(const fn of intervals.values())fn();await tick();},inputs:()=>received.filter(m=>m.type==='input')};
}
test('a failed release is retried as canonical zero input on the next healthy heartbeat',async t=>{
 const f=await fixture(t);assert(f.press('key-a',true));await tick();assert.equal(f.inputs().at(-1).controls.a,true);
 f.channel.bufferedAmount=SYNC_LIMITS.bufferedBytes;assert(f.press('key-a',false));await tick();assert.equal(f.inputs().at(-1).controls.a,true,'The blocked release has not reached the host yet');
 f.channel.bufferedAmount=0;await f.heartbeat();assert.equal(f.inputs().at(-1).controls.a,false);assert(f.inputs().at(-1).seq>f.inputs()[0].seq);
});
test('heartbeat retries preserve two-source OR and clear only after the final source releases',async t=>{
 const f=await fixture(t);assert(f.press('key-a',true));assert(f.press('pad-a',true));await tick();
 f.channel.bufferedAmount=SYNC_LIMITS.bufferedBytes;assert(f.press('key-a',false));f.channel.bufferedAmount=0;await f.heartbeat();assert.equal(f.inputs().at(-1).controls.a,true);
 f.channel.bufferedAmount=SYNC_LIMITS.bufferedBytes;assert(f.press('pad-a',false));f.channel.bufferedAmount=0;await f.heartbeat();assert.equal(f.inputs().at(-1).controls.a,false);
});
test('watcher heartbeats never emit player input or grant control authority',async t=>{
 const f=await fixture(t,'watch');assert.equal(f.session.getState().inputEnabled,false);assert.equal(f.press('forged',true),false);
 for(let n=0;n<3;n++)await f.heartbeat();assert.equal(f.inputs().length,0);
});

test('terminal cleanup cannot create new release epochs or revive state notifications',async t=>{
 const f=await fixture(t);await f.session.dispose();const before=f.session.getState();
 for(let i=0;i<20;i++)f.session.release();
 assert.equal(f.session.getState().phase,'ended');assert.equal(f.session.getState().epoch,before.epoch);
});
