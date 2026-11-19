import {validateBinding,assignment,hex,insist,zero,full} from './policy.mjs';
import {createTransport} from './transport.mjs';
const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),v=>v.toString(16).padStart(2,'0')).join('');
const now=()=>performance.now();
const safeNotify=(f,e)=>{try{f?.(e);}catch{}};
function adapterCheck(a,b){insist(a&&a.version===1&&a.packageId===b.packageId&&a.artifactDigest===b.artifactDigest,'Adapter/package mismatch');for(const k of ['capture','admit','remote','release','remove','enabled'])insist(typeof a[k]==='function','Adapter method: '+k);}
export function prepareJoin(fragment){const m=typeof fragment==='string'&&/^#netplay3=([a-f0-9]{32})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(fragment);insist(m,'Invitation format');return {room:m[1],participant:m[2],invite:m[3],credential:random(32),join_id:random(16)};}
export function prepareRejoin(record){insist(record&&hex(record.room,32)&&hex(record.participant,32)&&hex(record.credential,64)&&hex(record.session,32),'Resume identity');return {room:record.room,participant:record.participant,credential:record.credential,session:record.session,join_id:random(16)};}
export async function createHostSession(value,adapter,{onEvent=()=>{},signal,transportFactory=createTransport,peerCallbacks=null}={}){
 const binding=validateBinding(value);adapterCheck(adapter,binding);insist(!signal?.aborted,'Cancelled');
 const t=transportFactory(binding,onEvent),c=await t.api('capabilities');t.configuration(c,false);insist(c.protocol===3&&JSON.stringify(validateBinding(c.binding))===JSON.stringify(binding),'Server package mismatch');insist(!signal?.aborted,'Cancelled');
 const auth=await t.api('create');insist(hex(auth.room,32)&&hex(auth.credential,64)&&auth.protocol===3&&auth.binding===binding.version&&auth.packageId===binding.packageId&&auth.artifactDigest===binding.artifactDigest,'Room response');
 const room=new HostRoom(binding,adapter,t,auth,onEvent,peerCallbacks);if(signal?.aborted){await room.end();throw Error('Cancelled');}
 if(signal){const cancel=()=>{void room.end();};signal.addEventListener('abort',cancel,{once:true});room.unlisten=()=>signal.removeEventListener('abort',cancel);}
 room.refresh();return room;
}
export class HostRoom {
 constructor(binding,adapter,transport,auth,notify,peerCallbacks=null){this.peerCallbacks=peerCallbacks;this.binding=binding;this.adapter=adapter;this.transport=transport;this.auth=auth;this.notify=notify;this.peers=new Map();this.blocked=new Set();this.slots=[];this.closed=false;this.last=now();this.polling=false;this.generation=0;this.ending=null;}
 root(action,extra={}){return this.transport.api(action,{...extra,room:this.auth.room,credential:this.auth.credential});}
 getState(){return Object.freeze({version:1,packageId:this.binding.packageId,artifactDigest:this.binding.artifactDigest,role:'host',phase:this.closed?'ended':'active',epoch:this.generation,participants:this.slots.map(a=>({...a})),watchAvailable:!this.closed&&this.slots.filter(a=>a.participant_role==='watch').length<4,playAvailable:!this.closed&&this.slots.filter(a=>a.participant_role==='play').length<1});}
 async invite(role){insist(!this.closed&&['watch','play'].includes(role),'Invitation unavailable');const generation=this.generation,d=await this.root('invite',{participant_role:role}),a=assignment(this.binding,d);insist(d.room===this.auth.room&&hex(d.invite,64)&&a.participant_role===role,'Invitation response');if(this.closed||generation!==this.generation)throw Error('Invitation cancelled');return {assignment:a,expiresInSeconds:300,fragment:'#netplay3='+d.room+'.'+a.participant+'.'+d.invite,route:this.binding.route};}
 inviteWatch(){return this.invite('watch');} invitePlay(){return this.invite('play');}
 drop(id,reason){const p=this.peers.get(id);this.peers.delete(id);try{this.adapter.remove(id);}finally{p?.stop(reason);}}
 release(){for(const p of this.peers.values())p.barrier();}
 audio(){for(const p of this.peers.values())try{p.attachAudio();}catch{p.suspend('Audio unavailable.','rebuild');}}
 async revoke(id){
  const a=this.slots.find(x=>x.participant===id)||this.peers.get(id)?.assignment;insist(a&&!this.closed,'Unknown participant');this.blocked.add(id);this.drop(id,'Participant revoked.');
  try{await this.root('revoke',{participant:id,session:a.session});this.slots=this.slots.filter(x=>x.participant!==id);safeNotify(this.notify,{type:'roster',state:this.getState()});}
  catch(e){if(e instanceof this.transport.ServiceError&&e.status===410)return;await this.end();throw Error('Revocation unconfirmed; sharing ended locally.');}
 }
 async refresh(){
  if(this.closed||this.polling)return;this.polling=true;
  try{
   const d=await this.root('roster');if(this.closed)return;insist(d.protocol===3&&Array.isArray(d.participants)&&d.participants.length<=5,'Roster response');
   const seen=new Set(),list=d.participants.map(x=>({...assignment(this.binding,x),joined:x.joined,peer_live:x.peer_live}));
   insist(list.filter(x=>x.participant_role==='watch').length<=4&&list.filter(x=>x.participant_role==='play').length<=1,'Roster capacity');
   for(const a of list){insist(!seen.has(a.participant)&&typeof a.joined==='boolean'&&typeof a.peer_live==='boolean'&&a.joined===Boolean(a.session),'Roster identity');seen.add(a.participant);}
   this.slots=list;
   for(const a of list){
    let p=this.peers.get(a.participant);if(p&&(p.session!==a.session||p.assignment.participant_role!==a.participant_role||p.assignment.player!==a.player)){this.drop(a.participant,'Session replaced.');p=null;}
    if(this.blocked.has(a.participant))continue;
    if(a.joined&&!p){
     if(a.participant_role==='play')this.adapter.admit(a);
     const callbacks={capture:()=>this.adapter.capture(),enabled:()=>this.adapter.enabled(),clearRemote:()=>this.adapter.release(a.participant),remote:controls=>this.adapter.remote(a.participant,a.session,a.player,controls),ended:peer=>{if(!this.closed&&this.peers.get(a.participant)===peer)void this.revoke(a.participant).catch(()=>{});}};
     Object.assign(callbacks,this.peerCallbacks?.(a)||{});
     p=new this.transport.Peer('host',{...this.auth,...a},callbacks);this.peers.set(a.participant,p);p.start();
    }
   }
   for(const id of [...this.peers.keys()])if(!seen.has(id))this.drop(id,'Participant ended.');
   this.last=now();safeNotify(this.notify,{type:'roster',state:this.getState()});
  }catch(e){if(!this.closed){for(const p of this.peers.values())p.suspend('Authorization interrupted. Remote input released.');if(this.transport.terminal(e)||now()-this.last>60000)void this.end();}}
  finally{this.polling=false;if(!this.closed)this.timer=setTimeout(()=>this.refresh(),2000);}
 }
 end(){
  if(this.ending)return this.ending;this.closed=true;this.generation++;clearTimeout(this.timer);this.unlisten?.();const ids=[...this.peers.keys()];
  for(const id of ids)try{this.drop(id,'Sharing ended.');}catch{}this.slots=[];safeNotify(this.notify,{type:'ended',state:this.getState()});
  this.ending=(async()=>{for(let i=0;i<3;i++){try{const d=await this.root('end');insist(d.ended===true,'End response');return {serverConfirmed:true};}catch(e){if(e instanceof this.transport.ServiceError&&e.status===410)return {serverConfirmed:true};}}return {serverConfirmed:false,leaseFallbackSeconds:60};})();return this.ending;
 }
 dispose(){return this.end();}
}
export async function joinParticipant(value,record,{video,onEvent=()=>{},signal}={}){
 const b=validateBinding(value);insist(!signal?.aborted&&video&&typeof video.play==='function'&&typeof video.pause==='function','Receiving media element required');
 insist(record&&hex(record.room,32)&&hex(record.participant,32)&&hex(record.credential,64)&&hex(record.join_id,32),'Join identity');
 const t=createTransport(b,onEvent),body={room:record.room,participant:record.participant,credential:record.credential,join_id:record.join_id};
 if(record.invite){insist(hex(record.invite,64),'Invite identity');body.invite=record.invite;}else{insist(hex(record.session,32),'Resume session');body.session=record.session;}
 const a=assignment(b,await t.api(record.invite?'join':'rejoin',body));insist(a.participant===record.participant&&a.session,'Join assignment');
 const auth={room:record.room,credential:record.credential,...a},held=new Map(),blocked=new Set();let enabled=false,epoch=0,closed=false,peer,unlisten=()=>{};
 const state=()=>{const s=zero(b);for(const control of held.values())s[control]=true;return s;};
 const clear=()=>{for(const source of held.keys())blocked.add(source);held.clear();epoch++;if(epoch>Number.MAX_SAFE_INTEGER)throw Error('UI generation exhausted');};
  // Connection evidence and decoded-picture evidence are deliberately separate.
  // A fresh authenticated disabled-input pulse can arrive before any video frame.
  const connectionAvailable=()=>Boolean(!closed&&peer&&!peer.closed&&peer.peerLive&&peer.healthy()&&now()-peer.lastServer<15000&&a.capabilities.video&&a.capabilities.audio);
  const hostPaused=()=>Boolean(a.participant_role==='play'&&connectionAvailable()&&peer.challenge&&!enabled&&!video.error&&!(video.srcObject?.getTracks()||[]).some(t=>t.kind==='video'&&t.readyState==='ended'));
  let pictureStream=null,pictureTrack=null,picturePC=null,decodedPicture=false,pictureFrozen=false,unwatchPicture=()=>{};
  const forgetPicture=()=>{unwatchPicture();unwatchPicture=()=>{};pictureStream=pictureTrack=picturePC=null;decodedPicture=false;pictureFrozen=false;};
  const mediaAvailable=()=>{
   const stream=video.srcObject,track=stream?.getTracks().find(t=>t.kind==='video'&&t.readyState==='live');
   const owned=Boolean(connectionAvailable()&&stream&&peer.media.includes(stream)&&track&&!video.error);
   if(!owned){forgetPicture();return false;}
   if(stream!==pictureStream||track!==pictureTrack||peer.pc!==picturePC){
    forgetPicture();pictureStream=stream;pictureTrack=track;picturePC=peer.pc;
    // Freeze the actual element on mute before it can render zero-information frames.
    // Watchers retain the original live-media behavior.
    const mute=()=>{if(a.participant_role==='play'&&decodedPicture&&connectionAvailable()&&video.srcObject===stream&&peer.pc===picturePC&&track.readyState==='live'&&!video.error){video.pause();pictureFrozen=true;}};
    track.addEventListener?.('mute',mute);
    unwatchPicture=()=>track.removeEventListener?.('mute',mute);
   }
   const frame=video.readyState>=2&&video.videoWidth>0;
   if(frame&&!track.muted)decodedPicture=true;
   const paused=hostPaused();
   if(paused&&decodedPicture&&frame){if(!pictureFrozen){video.pause();pictureFrozen=true;}return true;}
   if(!paused&&pictureFrozen&&!track.muted){pictureFrozen=false;video.play().catch(()=>safeNotify(onEvent,{type:'status',message:'Press Enable audio to start playback.'}));}
   return Boolean(frame&&!track.muted);
  };
 const getState=()=>Object.freeze({version:1,packageId:b.packageId,artifactDigest:b.artifactDigest,role:a.participant_role==='watch'?'spectator':'guest',phase:closed?'ended':peer?.healthy()&&peer.peerLive?'active':'reconnecting',epoch,assignment:a,mediaAvailable:mediaAvailable(),hostPaused:hostPaused(),inputEnabled:!closed&&a.capabilities.input&&enabled&&peer.permitted()});
 const emit=()=>safeNotify(onEvent,{type:'state',state:getState()});
 peer=new t.Peer('guest',auth,{video,state,clear:()=>{clear();emit();},enabled:v=>{if(enabled!==v){enabled=v;if(!v)clear();emit();}},stopped:()=>{closed=true;enabled=false;forgetPicture();clear();unlisten();emit();}});
 const resume={room:record.room,participant:a.participant,credential:record.credential,session:a.session,join_id:record.join_id,joined:true};
 const release=()=>{clear();peer.sendState(zero(b),true);emit();};
 const dispose=async({leave=false}={})=>{if(closed)return {serverConfirmed:false};release();closed=true;unlisten();peer.stop('Participant closed.');if(!leave)return {serverConfirmed:false,rejoinAfterSeconds:15};try{const d=await peer.request('leave');return {serverConfirmed:d.left===true};}catch(e){return {serverConfirmed:e instanceof t.ServiceError&&e.status===410};}};
 const input=e=>{
  if(!e||Object.keys(e).sort().join(',')!=='control,epoch,pressed,source'||typeof e.source!=='string'||!e.source.length||e.source.length>100||/[\x00-\x1f\x7f]/.test(e.source)||typeof e.pressed!=='boolean'||!b.inputs.some(i=>i.id===e.control)||!a.capabilities.input)return false;
  if(!e.pressed){blocked.delete(e.source);if(held.get(e.source)!==e.control)return false;held.delete(e.source);peer.sendState(state());return true;}
  if(closed||e.epoch!==epoch||!enabled||!peer.permitted()||blocked.has(e.source)||held.has(e.source)||held.size>=64)return false;held.set(e.source,e.control);peer.sendState(state());return true;
 };
 const result={version:1,packageId:b.packageId,artifactDigest:b.artifactDigest,resume,assignment:a,getState,input,release,retry:()=>peer.retry(),enableAudio:()=>{insist(mediaAvailable(),'Shared media unavailable');video.muted=false;return hostPaused()?Promise.resolve():video.play();},getMedia:()=>({video,audio:video}),dispose};
 if(signal?.aborted){await dispose({leave:true});throw Error('Cancelled');}
 if(signal){const cancel=()=>{void dispose();};signal.addEventListener('abort',cancel,{once:true});unlisten=()=>signal.removeEventListener('abort',cancel);}
 peer.start();emit();return result;
}
