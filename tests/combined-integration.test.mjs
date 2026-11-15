import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Catalog,verifyPackage,canonical} from '../htdocs/games/arcade/package.mjs';
import {GameHost} from '../htdocs/games/arcade/host.mjs';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),hash=b=>createHash('sha256').update(b).digest('hex');
const rows=json('htdocs/games/arcade/catalog.json'),network=json('htdocs/games/netplay/catalog.json');
const packages=await Promise.all(rows.map(async r=>verifyPackage(json('htdocs'+r.manifest),r.artifactDigest)));
test('canonical members and browser/server catalogs match without circular members',()=>{assert.deepEqual(read('htdocs/games/netplay/catalog.json'),read('includes/api/classes/netplay-catalog.json'));assert(read('includes/api/classes/NetplayPolicy.php').toString().includes("DIGEST='"+hash(read('htdocs/games/netplay/catalog.json'))+"'"));for(const p of packages){assert.equal(network.packages[p.id].artifactDigest,p.artifactDigest);if(["megaman","adventure-island-2"].includes(p.id))assert.equal(p.capabilities.nativePlayers,1);for(const [url,r] of Object.entries(p.files)){const b=read('htdocs'+url);assert.equal(b.length,r.bytes,url);assert.equal(hash(b),r.sha256,url);assert(!/game-package\.json$|catalog\.json$|receipt\.json$/.test(url));}const {artifactDigest,...m}=p;assert.equal(hash(canonical(m)),artifactDigest);}});
test('remote release and roster updates preserve held local input',async()=>{const p=packages[0],catalog=new Catalog();catalog.register(p);const held=new Map();let all=0;const adapter={
 version:1,packageId:p.id,artifactDigest:p.artifactDigest,
 load(){},start(){},pause(){},resume(){},reset(){},dispose(){},
 input(e){if(e.pressed)held.set(e.source,e);else held.delete(e.source);return true;},
 releaseAll(){all++;held.clear();},
 snapshot:()=>({ready:true,running:true,loading:false,closed:false}),
 surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:'CANVAS'},audio:{kind:'web-audio',getNodes:()=>({context:null,node:null})}})
};
const h=new GameHost(catalog,{loader:async()=>({version:1,createAdapter:()=>adapter})});await h.load(p.id);let listener;const s={role:'host',phase:'active',epoch:1,reconnect:'none',watch:'available',play:'available',message:'Ready'};const lease=h.bindSession({version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>s,subscribe:f=>(listener=f,()=>{}),inviteWatch(){},invitePlay(){},sendInput(){return false;},releaseInputs(){},enableAudio(){},getMedia(){throw Error('Host');},dispose(){}});assert(h.input({control:'a',source:'local-key',pressed:true}));assert(lease.input({control:'right',source:'participant:right',pressed:true,seat:1,epoch:1,role:'guest'}));const before=all;listener({...s,message:'Viewer joined',watch:'unavailable'});assert.equal(held.size,2);lease.release();assert.equal(held.size,1);assert(held.has('local:local-key'));assert.equal(all,before);assert.equal(lease.input({control:'right',source:'forged',pressed:true,seat:1,epoch:0,role:'guest'}),false);await h.dispose();});
for(const p of packages.filter(p=>["megaman","adventure-island-2"].includes(p.id)))test(p.id+' private remote queue clears without releasing local P1',async()=>{const h=await runtimeHarness(fileURLToPath(new URL('htdocs'+p.route+'host-runtime.mjs',root))),r=h.runtime;await r.reset();const w=h.workers[0];w.receive({type:'ready'});await r.start(false);assert(r.input('local:held',0,true));assert(r.input('remote:peer:right',7,true,2));r.clearRemote();assert(r.held(0));assert(!r.held(7));await r.pause();assert(!r.held(0));await r.dispose();assert(w.dead);assert.equal(h.rafs.size,0);});

import {createBridge,hostAdapter} from '../htdocs/games/arcade/session-bridge.mjs';
import {createTransport} from '../htdocs/games/netplay/transport.mjs';

async function inputLifecycleLab(t,two,initialPaused=false){
 const original=packages[0];let pkg=original;
 if(two){const {artifactDigest,...m}=structuredClone(original);m.capabilities={...m.capabilities,nativePlayers:2,mode:'simultaneous',play:'host-p1-guest-p2'};const d=hash(canonical(m));pkg=await verifyPackage({manifest:m,artifactDigest:d},d);}
 const binding={...structuredClone(network.packages[pkg.id]),artifactDigest:pkg.artifactDigest};
 if(two){binding.compatibility='native-two/1';binding.capabilities={...binding.capabilities,nativePlayers:2,play:'independent'};binding.players={local:'player-1',remote:'player-2'};}
 function fixtureHex(n){return Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('hex');}
 const assigned={protocol:3,catalog:binding.catalog,binding:binding.version,packageId:binding.packageId,artifactDigest:binding.artifactDigest,inputProfile:binding.inputProfile,inputsDigest:binding.inputsDigest,compatibility:binding.compatibility,participant:fixtureHex(16),participant_role:'play',player:binding.players.remote,session:fixtureHex(16),capabilities:{video:true,audio:true,input:true}};
 const record={room:fixtureHex(16),participant:assigned.participant,credential:fixtureHex(32),invite:fixtureHex(32),join_id:fixtureHex(16)},round=fixtureHex(16);
 const fingerprint=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(':');
 const sdp=type=>({type,sdp:'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 '+fingerprint+'\r\n'+['audio','video'].map(k=>'m='+k+' 9 UDP/TLS/RTP/SAVPF 96\r\na='+(type==='offer'?'sendonly':'recvonly')+'\r\n').join('')+'m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n'});
 let clock=10000,serial=0,host,guest,peer,channel;
 const intervals=new Map(),timeouts=new Map(),queue=[],packets=[],saved=new Map(),storage=new Map(),connections=[],mediaElements=[];
 const turn=()=>new Promise(resolve=>setImmediate(resolve));
 const globals={
  performance:{now:()=>clock},
  setInterval:fn=>{const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
  setTimeout:fn=>{const id=++serial;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id),
  document:{hidden:false,createElement:()=>{const v={nodeType:1,tagName:'VIDEO',setAttribute(){},play:async function(){this.paused=false;},pause(){this.paused=true;},remove(){},srcObject:null,readyState:0,videoWidth:0,paused:true};mediaElements.push(v);return v;}},
  location:{origin:'https://127.0.0.1:9443',pathname:'/games/arcade/',search:''},history:{state:null,replaceState(){}},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  MediaStream:class{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}addTrack(track){this.tracks.push(track);}removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}},
  RTCPeerConnection:class{
   constructor(config){connections.push(this);this.config=config;this.connectionState='connected';this.iceGatheringState='complete';}
   getConfiguration(){return this.config;}setConfiguration(config){this.config=config;}
   getTransceivers(){return [{direction:'recvonly'},{direction:'recvonly'}];}
   async setRemoteDescription(value){
    this.remoteDescription=value;
    channel={label:'game-input-v3',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',bufferedAmount:0,
     send:text=>{const d=JSON.parse(text);packets.push({type:d.type,release:d.release,epoch:d.epoch,controls:d.controls});const target=peer,recipient=peer.dc;queue.push(()=>{if(!target.closed&&target.dc===recipient&&recipient?.readyState==='open')target.receive(text);});},
     close(){this.readyState='closed';}};
    this.ondatachannel({channel});channel.onopen();
   }
   async createAnswer(){return sdp('answer');}async setLocalDescription(value){this.localDescription=value;}
   close(){this.connectionState='closed';}
  },
  fetch:async(url,options)=>{
   assert(String(url).startsWith('/api/v1/netplay/'));const action=String(url).split('/').at(-1),body=JSON.parse(options.body);
   assert.equal(body.package,pkg.id);assert.equal(body.artifact,pkg.artifactDigest);
   let result;
   if(action==='join')result=assigned;
   else if(action==='poll')result={...assigned,round,mode:'rebuild',peer_live:true,recover:'none',message:{round,description:sdp('offer')}};
   else if(action==='ice')result={...assigned,available:true,iceServers:[{urls:['turn:relay.example.invalid:3478'],username:fixtureHex(8),credential:fixtureHex(16)}],iceTransportPolicy:'relay',server_time:10,expires_at:610,refresh_after_seconds:420};
   else if(action==='signal')result={...assigned,accepted:true,round};
   else if(action==='leave')result={...assigned,left:true};
   else throw Error('Unexpected fixture service action: '+action);
   return new Response(JSON.stringify(result));
  }
 };
 for(const [key,value] of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 t.after(async()=>{try{await guest?.dispose('page-exit');await host?.dispose();peer?.stop('fixture-end');}finally{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}});
 const held=new Map(),receiverHeld=new Map();
 async function makeHost(sink){
  const catalog=new Catalog();catalog.register(pkg);
  const h=new GameHost(catalog,{loader:async()=>({version:1,createAdapter:()=>({
   version:1,packageId:pkg.id,artifactDigest:pkg.artifactDigest,load(){},start(){},pause(){},resume(){},reset(){},dispose(){},
   input(e){if(e.pressed)sink.set(e.source,e);else sink.delete(e.source);return true;},releaseAll(){sink.clear();},
   snapshot:()=>({ready:true,running:true,loading:false,closed:false}),
   surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:'CANVAS'},audio:{kind:'web-audio',getNodes:()=>({context:null,node:null})}})
  })})});await h.load(pkg.id);return h;
 }
 host=await makeHost(held);
 const hostState={role:'host',phase:'active',epoch:1,reconnect:'none',watch:'available',play:'available',message:'Fixture host'};
 const lease=host.bindSession({version:1,packageId:pkg.id,artifactDigest:pkg.artifactDigest,getState:()=>hostState,subscribe:()=>()=>{},inviteWatch(){},invitePlay(){},sendInput(){return false;},releaseInputs(){peer?.barrier();},enableAudio(){},getMedia(){throw Error('Host media');},dispose(){}});
 const adapter=hostAdapter(pkg,binding,lease,()=>hostState,()=>host.snapshot().runtime);adapter.admit(assigned);
 const transport=createTransport(binding);
 peer=new transport.Peer('host',{...assigned,room:record.room,credential:fixtureHex(32)},{enabled:()=>!initialPaused,clearRemote:()=>adapter.release(assigned.participant),remote:values=>adapter.remote(assigned.participant,assigned.session,assigned.player,values)});
 peer.pc={connectionState:'connected',close(){this.connectionState='closed';}};
 peer.dc={readyState:'open',bufferedAmount:0,send:text=>{const target=channel;queue.push(()=>{if(target?.readyState==='open'&&typeof target.onmessage==='function')target.onmessage({data:text});});},close(){this.readyState='closed';}};
 peer.peerLive=true;peer.suspended=false;peer.barrier();
 assert(host.input({control:'a',source:'host-a',pressed:true}));
 guest=await makeHost(receiverHeld);
 const bridge=createBridge(pkg,binding,record);
 await bridge.attach({bindSession:provider=>guest.bindSession(provider),getState:()=>guest.snapshot(),getPackage:()=>pkg});
 for(let i=0;i<50&&!channel;i++)await turn();assert(channel,'Real receiving session must negotiate its fixture data channel');
 async function drain(){
  for(let round=0;round<32;round++){
   let count=0;while(queue.length){assert(++count<512,'Release feedback must not flood a delivery turn');queue.shift()();}
   await turn();if(!queue.length)return;
  }
  assert.fail('Input feedback did not settle');
 }
 async function beat(){clock+=250;for(const fn of [...intervals.values()])fn();peer.lastServer=clock;peer.pulse();await drain();}
 for(let i=0;i<3;i++)await beat();
 if(initialPaused){assert.equal(guest.snapshot().session.role,'guest');assert.equal(guest.snapshot().session.phase,'reconnecting');assert.equal(guest.snapshot().canControl,false);}else{assert.equal(guest.snapshot().session.role,'guest');assert.equal(guest.snapshot().session.phase,'active');assert.equal(guest.snapshot().canControl,true);}
 const input=(pressed,control='right',source='guest-right')=>guest.input({control,source,pressed});
 function check(remote){
  assert.equal(held.size,remote?2:1);const local=held.get('local:host-a');assert(local);assert.equal(local.control,'a');assert.equal(local.seat,1);assert.equal(local.role,'host');
  const forwarded=held.get('remote:'+assigned.participant+':right');
  if(remote){assert(forwarded);assert.equal(forwarded.control,'right');assert.equal(forwarded.seat,two?2:1);assert.equal(forwarded.role,'guest');}else assert.equal(forwarded,undefined);
  assert.equal(receiverHeld.size,0,'Receiver must forward inputs without running its game adapter');
 }
 return {host,guest,peer,queue,packets,input,check,beat,drain,intervals,timeouts,bridge,connections,mediaElements};
}
for(const two of [false,true])test('provider barriers settle and physical release rearms '+(two?'independent P1/P2':'shared P1')+' input',{timeout:10000},async t=>{
 const lab=await inputLifecycleLab(t,two),{guest,peer,input,beat,drain,check,packets,queue}=lab;
 const releases=()=>packets.filter(p=>p.release===true).length;
 assert.equal(releases(),0,'Provider notifications must not echo wire release requests');
 assert(input(true));await drain();check(true);
 const epoch=guest.snapshot().session.epoch,wire=peer.epoch;
 for(let i=0;i<16;i++){await beat();check(true);assert.equal(guest.snapshot().session.epoch,epoch);assert.equal(peer.epoch,wire);}
 assert.equal(releases(),0);
 assert(input(false));await drain();check(false);assert(input(true));await drain();check(true);
 // Deliver the real new transport epoch before its queued bridge notification.
 peer.barrier();const barrier=peer.epoch;peer.pulse();assert.equal(queue.length,1);queue.shift()();
 assert.equal(input(true,'b','stale-window'),false,'Old UI generation must not be translated to the new raw generation');
 await drain();await beat();check(false);assert(guest.snapshot().session.epoch>epoch);assert.equal(peer.epoch,barrier);assert.equal(releases(),0);
 assert.equal(input(true),false,'A still-held source cannot resurrect after a barrier');
 assert.equal(input(false,'a'),false,'An unrelated control cannot acknowledge the retired source');
 assert.equal(input(true),false);assert(input(false));assert(input(true));await drain();check(true);
 const before=releases();guest.release('focus-loss');await drain();await beat();await beat();check(false);
 assert.equal(releases(),before+1,'Explicit local cleanup must still request one transport barrier');
 const settled=guest.snapshot().session.epoch,settledWire=peer.epoch;
 for(let i=0;i<16;i++){await beat();check(false);assert.equal(guest.snapshot().session.epoch,settled);assert.equal(peer.epoch,settledWire);}
 assert.equal(releases(),before+1);assert.equal(input(true),false);assert(input(false));assert(input(true));await drain();check(true);
 await guest.unload();await drain();check(false);assert.equal(input(true),false);assert.equal(lab.intervals.size,0,'Disposed bridge and receiving peer must stop their timers');
});

import './receiver-input.test.mjs';

// Controlled browser/relay boundaries; actual bridge, session and input transport.
// These additions do not replace any existing assertion above.
test('paused connected receiver retains authenticated media and audio without input authority',{timeout:10000},async t=>{
 const lab=await inputLifecycleLab(t,false),{guest,peer,input,beat,drain,bridge,connections,mediaElements}=lab;
 const pc=connections[0],video=mediaElements.find(v=>v.srcObject);
 assert(pc&&video);assert.equal(guest.media(),null,'No fabricated video before a track/frame is available');
 const track={kind:'video',readyState:'live',muted:false,stop(){this.readyState='ended';}};
 pc.ontrack({track});video.readyState=2;video.videoWidth=256;await beat();
 const original=guest.media();assert.equal(original.video,video);const connection=pc;
 assert(input(true));await drain();lab.check(true);
 peer.cb.enabled=()=>false;peer.cb.clearRemote();await beat();await beat();
 assert.equal(guest.snapshot().session.phase,'reconnecting');assert.equal(guest.snapshot().canControl,false);
 assert.match(guest.snapshot().session.message,/Connected—host paused\/away/);
 assert.equal(guest.media().video,video);assert.equal(connections[0],connection);
 assert.equal(input(true,'b','blocked-while-away'),false);lab.check(false);
 // A muted live track does not erase a previously authenticated decoded picture.
 track.muted=true;await beat();assert.equal(guest.media().video,video);assert.equal(video.paused,true);
 assert.match(guest.snapshot().session.message,/Connected—host paused\/away/);
 await guest.control('start');assert.equal(video.muted,false);assert.equal(video.paused,true);
 for(const action of ['pause','resume','reset'])await assert.rejects(async()=>guest.control(action));
 const stale=guest.snapshot().session.epoch;
 track.muted=false;peer.cb.enabled=()=>true;await beat();await beat();
 assert.equal(guest.snapshot().session.phase,'active');assert.equal(guest.snapshot().canControl,true);
 assert(guest.snapshot().session.epoch>stale);assert.equal(guest.media().video,video);assert.equal(connections.length,1);
 assert.equal(video.paused,false);
 assert.equal(input(true),false,'Held source remains retired across the pause');assert(input(false));assert(input(true));await drain();lab.check(true);
 assert.equal(bridge.provider.sendInput({control:'b',source:'stale',pressed:true,epoch:stale,role:'guest',seat:1}),false);
 input(false);await drain();
 pc.connectionState='connecting';await beat();assert.equal(guest.media(),null);
 assert.doesNotMatch(guest.snapshot().session.message,/Connected—host paused/);
 assert.equal(input(true,'b','connecting'),false);
 pc.connectionState='connected';peer.cb.enabled=()=>false;await beat();
 track.readyState='ended';await beat();assert.equal(guest.media(),null);assert.match(guest.snapshot().session.message,/Connecting/);
 track.readyState='live';video.readyState=0;await beat();assert.equal(guest.media(),null);
 video.readyState=2;await beat();assert.equal(guest.media().video,video);
 // An authenticated signaling rejection traverses the real terminal cleanup.
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'stale_session'}),{status:409});
 for(const [id,fn] of [...lab.timeouts]){lab.timeouts.delete(id);fn();}
 await drain();await beat();
 assert.equal(guest.snapshot().session.phase,'ended');assert.equal(guest.media(),null);
 assert.equal(video.srcObject,null);assert.equal(track.readyState,'ended');assert.equal(pc.connectionState,'closed');
 assert.equal(input(true,'b','revoked'),false);await guest.unload();assert.equal(lab.intervals.size,0);
});
test('joining an already paused host reports connection before the first frame and resumes the same peer',{timeout:10000},async t=>{
 const lab=await inputLifecycleLab(t,false,true),{guest,peer,input,beat,drain,bridge,connections,mediaElements}=lab;
 const pc=connections[0],video=mediaElements.find(v=>v.srcObject),stream=video.srcObject;
 const track={kind:'video',readyState:'live',muted:true,stop(){this.readyState='ended';}};
 pc.ontrack({track});await beat();await beat();
 assert.equal(pc.connectionState,'connected');assert.equal(video.readyState,0);assert.equal(video.videoWidth,0);
 assert.equal(guest.snapshot().session.phase,'reconnecting');assert.equal(guest.snapshot().canControl,false);
 assert.match(guest.snapshot().session.message,/Connected—host paused\/away/);
 assert.match(guest.snapshot().session.message,/Ask the host to Resume/);
 assert.equal(guest.media(),null);assert.equal(bridge.provider.getMedia(),null);
 assert.equal(input(true,'b','no-frame'),false);lab.check(false);
 await assert.rejects(async()=>guest.control('start'));
 for(const action of ['pause','resume','reset'])await assert.rejects(async()=>guest.control(action));
 // Muted-track metadata is not evidence of an actual received picture.
 video.readyState=2;video.videoWidth=256;await beat();assert.equal(guest.media(),null);
 video.readyState=0;video.videoWidth=0;
 const stale=guest.snapshot().session.epoch;
 peer.cb.enabled=()=>true;track.muted=false;video.readyState=2;video.videoWidth=256;await beat();await beat();
 assert.equal(guest.snapshot().session.phase,'active');assert.equal(guest.snapshot().canControl,true);
 assert(guest.snapshot().session.epoch>stale);assert.equal(connections.length,1);assert.equal(connections[0],pc);
 assert.equal(guest.media().video,video);assert.equal(video.srcObject,stream);
 assert.equal(bridge.provider.sendInput({control:'b',source:'old',pressed:true,epoch:stale,role:'guest',seat:1}),false);
 assert(input(true));await drain();lab.check(true);assert(input(false));await drain();lab.check(false);
 peer.cb.enabled=()=>false;await beat();track.muted=true;await beat();
 assert.equal(guest.media().video,video);assert.equal(video.paused,true);assert.equal(guest.snapshot().canControl,false);
 const originalStream=video.srcObject;video.srcObject=new MediaStream([track]);await beat();
 assert.equal(guest.media(),null,'An unowned stream cannot borrow decoded-picture evidence');
 video.srcObject=originalStream;await beat();assert.equal(guest.media(),null,'Restored muted stream needs new decoded evidence');
 track.muted=false;await beat();assert.equal(guest.media().video,video);
 // The fake service does not renew the receiving authorization lease during beats.
 for(let i=0;i<65;i++)await beat();
 assert.equal(guest.media(),null);assert.doesNotMatch(guest.snapshot().session.message,/Connected—host paused/);
 assert.equal(input(true,'b','stale-lease'),false);await assert.rejects(async()=>guest.control('start'));
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'stale_session'}),{status:409});
 for(const [id,fn] of [...lab.timeouts]){lab.timeouts.delete(id);fn();}
 await drain();await beat();assert.equal(guest.snapshot().session.phase,'ended');assert.equal(guest.media(),null);
 assert.equal(video.srcObject,null);assert.equal(track.readyState,'ended');assert.equal(pc.connectionState,'closed');
 await guest.unload();assert.equal(lab.intervals.size,0);
});
