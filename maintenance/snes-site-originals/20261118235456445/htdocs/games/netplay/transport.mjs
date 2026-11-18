import {validateBinding,assignment,validateSDP,full as validState,zero as emptyState} from './policy.mjs';
export function createTransport(value,notify=()=>{}){
 const binding=validateBinding(value),now=()=>performance.now();
 const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),v=>v.toString(16).padStart(2,'0')).join('');
 const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
 const full=v=>validState(binding,v),zero=()=>emptyState(binding);
 const message=text=>{try{notify({type:'status',message:String(text).slice(0,240)});}catch{}};
class ServiceError extends Error{constructor(status,code){super('Signaling request failed');this.status=status;this.code=code;}}
async function api(action,body={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),5000);
 try{
  const r=await fetch('/api/v1/netplay/'+action,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-Netplay-Protocol':'3'},body:JSON.stringify({...body,package:binding.packageId,artifact:binding.artifactDigest,binding:binding.version}),signal:abort.signal});
  if(!r.body)throw Error('Missing response');
  const reader=r.body.getReader(),chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>80000){await reader.cancel();throw Error('Response limit');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!r.ok)throw new ServiceError(r.status,typeof d?.error==='string'?d.error:'service_error');
  if(!d||typeof d!=='object'||Array.isArray(d))throw Error('Invalid response');return d;
 }finally{clearTimeout(timer);}
}
function terminal(e){return e instanceof ServiceError&&([401,403,410].includes(e.status)||['binding_changed','stale_session'].includes(e.code));}
function description(d,type){
 if(!d||d.type!==type||typeof d.sdp!=='string'||new TextEncoder().encode(d.sdp).length>32768||!d.sdp.startsWith('v=0')||(d.sdp.match(/^a=candidate:/gm)||[]).length>64)throw Error('Invalid description');
 return {type,sdp:d.sdp};
}
function configuration(c,credentials=true){
 if(!c||c.available!==true||!Array.isArray(c.iceServers)||c.iceServers.length>8)throw Error('Relay unavailable');
 let relay=false;
 for(const s of c.iceServers){
  if(!s||!Array.isArray(s.urls)||!s.urls.length||s.urls.length>6)throw Error('ICE configuration');
  for(const u of s.urls){const m=typeof u==='string'&&/^(stuns?|turns?):[A-Za-z0-9.-]+:([0-9]{1,5})(\?transport=(udp|tcp))?$/.exec(u);if(!m||u.length>250||Number(m[2])<1||Number(m[2])>65535)throw Error('ICE URL');}
  if(s.urls.some(u=>/^turns?:/.test(u))){relay=true;if(credentials&&(typeof s.username!=='string'||s.username.length>150||typeof s.credential!=='string'||s.credential.length>100))throw Error('Relay credentials');}
 }
 if(!relay||!['all','relay'].includes(c.iceTransportPolicy??'all'))throw Error('ICE policy');
 return {iceServers:c.iceServers,bundlePolicy:'max-bundle',iceCandidatePoolSize:0,iceTransportPolicy:c.iceTransportPolicy??'all'};
}
class TransportTimeout extends Error{}
function bounded(p,ms=15000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new TransportTimeout('Transport timeout')),ms);Promise.resolve(p).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
async function gathered(pc){
 if(pc.iceGatheringState==='complete')return;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('ICE gathering timed out')),12000);
  const change=()=>{if(pc.iceGatheringState==='complete')finish();else if(pc.connectionState==='closed')finish(Error('Peer closed'));};
  function finish(e){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);pc.removeEventListener('connectionstatechange',change);e?reject(e):resolve();}
  pc.addEventListener('icegatheringstatechange',change);pc.addEventListener('connectionstatechange',change);change();
 });
}
const ufrags=d=>(d?.sdp.match(/^a=ice-ufrag:[^\r\n]+/gm)||[]).sort().join('|');
class Peer{
 constructor(role,auth,cb){
  this.assignment=assignment(binding,auth);this.watchOnly=this.assignment.participant_role==='watch';
  Object.assign(this,{role,auth,cb,session:auth.session||'',closed:false,pc:null,dc:null,round:'',mode:'rebuild',task:null,revision:0,media:[],tap:null,audio:null,polling:false,lastServer:now(),lastData:now(),peerLive:false,suspended:true,epoch:'',seq:0,lastSeq:0,challenge:'',previous:'',armed:false,rateAt:now(),rateCount:0,credit:120,creditAt:now(),recover:'none',nextBegin:0,begin:null,beginBusy:false,refreshAt:Infinity,roundAt:now(),pending:null,remoteDone:false,localDone:false,failedRound:false,sendBusy:false,nextSend:0,everOpen:false});
 }
 async request(action,extra={}){
  const session=this.session,d=await api(action,{...extra,room:this.auth.room,credential:this.auth.credential,role:this.role,session,participant:this.assignment.participant,participant_role:this.assignment.participant_role,player:this.assignment.player});
  const a=assignment(binding,d);if(a.participant!==this.assignment.participant||a.participant_role!==this.assignment.participant_role||a.player!==this.assignment.player||a.session!==session)throw new ServiceError(409,'stale_session');return d;
 }
 sdp(d,type){return validateSDP(description(d,type),this.watchOnly);}
 healthy(){return this.pc?.connectionState==='connected'&&(this.watchOnly||this.dc?.readyState==='open'&&now()-this.lastData<2000);}
 permitted(){return !this.watchOnly&&!this.closed&&!this.suspended&&this.peerLive&&now()-this.lastServer<15000&&this.healthy();}
 start(){
  this.watch=setInterval(()=>{try{this.tick();}catch{this.stop('Invalid input or media state. Create a new invite.');}},250);
  this.poll();
 }
 suspend(text,mode='restart'){
  if(this.closed)return;
  if(!this.suspended){this.suspended=true;if(this.role==='host')this.barrier();else{this.cb.enabled(false);this.cb.clear();}}
  this.cb.clearRemote?.();
  if(mode==='rebuild'||this.recover==='none')this.recover=mode;
  message(text);
 }
 retry(){if(this.closed)return;this.suspend('Retrying the shared connection…',this.healthy()?'restart':'rebuild');this.nextBegin=0;}
 tick(){
  if(this.closed)return;
  if(now()-this.lastServer>60000){this.stop('Host authorization could not be renewed. Create a new invite; offline play continues.');return;}
  if(now()-this.lastServer>15000)this.suspend('Signaling interrupted. Controls released; retrying…');
  if(!this.watchOnly&&this.everOpen&&this.pc&&now()-this.lastData>2000)this.suspend('Peer heartbeat interrupted. Controls released; recovering…',this.dc?.readyState==='closed'?'rebuild':'restart');
  if(this.role==='host'&&this.peerLive&&this.healthy()&&now()-this.lastServer<15000&&this.suspended){this.suspended=false;this.barrier();message(this.watchOnly?'Viewer connected.':'Play participant connected.');}
  if(this.role==='host')this.attachAudio();
  if(this.dc?.readyState==='open'){if(this.role==='host')this.pulse();else this.sendState(this.permitted()?this.cb.state():zero());}
  const complete=this.localDone&&this.remoteDone;
  if(this.round&&!this.failedRound&&now()-this.roundAt>45000&&(!complete||!this.healthy())){
   this.failedRound=true;this.suspend('Connection update incomplete. Retrying; local play continues.',this.healthy()?'restart':'rebuild');
  }
  if(this.role==='guest'&&complete&&now()>=this.refreshAt&&this.recover==='none')this.recover='rebuild';
  const canBegin=this.round===''||this.failedRound||complete;
  if(this.role==='host'&&this.session&&this.peerLive&&canBegin&&!this.task&&!this.beginBusy&&now()>=this.nextBegin&&(this.begin||this.round===''||this.recover!=='none'||now()>=this.refreshAt))this.beginRound();
  if(this.pending&&!this.sendBusy&&now()>=this.nextSend)this.sendPending();
 }
 async beginRound(){
  if(this.closed||this.beginBusy)return;this.beginBusy=true;this.nextBegin=now()+10000;
  const session=this.session;
  if(!this.begin)this.begin={previous:this.round,round:random(16),mode:this.round===''||this.recover==='rebuild'||now()>=this.refreshAt?'rebuild':'restart'};
  const op=this.begin;
  try{
   const result=await this.request('begin',op);
   if(this.closed||session!==this.session)return;
   if(result.round!==op.round||result.accepted!==true)throw Error('Round acknowledgment');
   // Keep the idempotent request until poll observes the authoritative new round.
  }catch(e){
   if(this.closed||session!==this.session)return;
   if(terminal(e))this.stop('Room authorization ended. Rejoin with a new invite.');
   else{if(e instanceof ServiceError&&e.status===409&&this.begin===op)this.begin=null;this.suspend('Connection update unavailable. Retrying…');}
  }finally{this.beginBusy=false;}
 }
 async poll(){
  if(this.closed||this.polling)return;this.polling=true;const requestedSession=this.session;
  try{
   const d=await this.request('poll',{recover:this.role==='guest'?this.recover:'none',round:this.round});
   if(this.closed||this.session!==requestedSession)return;
   if((d.session!==''&&!hex(d.session,32))||(d.round!==''&&!hex(d.round,32))||!['restart','rebuild'].includes(d.mode)||typeof d.peer_live!=='boolean'||!['none','restart','rebuild'].includes(d.recover))throw Error('Poll contract');
   this.lastServer=now();this.peerLive=d.peer_live;
   if(d.session!==this.session){
    if(this.role!=='host')throw new ServiceError(409,'stale_session');
    this.revision++;this.closeMedia();this.session=d.session;this.round='';this.task=null;this.begin=null;this.pending=null;this.refreshAt=Infinity;this.recover='none';this.suspended=true;
   }
   if(!this.peerLive){this.closeMedia();this.suspend('Waiting for participant heartbeat. Remote input released.','rebuild');}
   if(d.round!==this.round){
    this.revision++;this.round=d.round;this.mode=d.mode;this.roundAt=now();this.pending=null;this.remoteDone=false;this.localDone=false;this.failedRound=false;this.recover='none';this.task=null;this.nextSend=0;
    if(this.begin?.round===d.round)this.begin=null;
    if(d.mode==='rebuild'){this.closeMedia();this.suspended=true;}
   }
   if(this.role==='host'&&d.recover!=='none'&&(d.recover==='rebuild'||this.recover==='none'))this.recover=d.recover;
   if(this.session&&this.round&&!this.task&&!this.failedRound&&(!this.localDone||!this.remoteDone)){
    const revision=this.revision,task={revision};this.task=task;
    this.negotiate(d.message,revision).catch(e=>{
     if(this.closed||revision!==this.revision)return;
     if(terminal(e))this.stop('Room authorization ended. Rejoin with a new invite.');
     else{
      this.failedRound=true;
      // A timed-out native operation is not cancellable; never reuse its connection.
      if(e instanceof TransportTimeout){this.closeMedia();this.suspend('Transport operation stalled. Rebuilding the shared connection…','rebuild');}
      else this.suspend('Relay or ICE update failed. Controls released; retrying…',this.healthy()?'restart':'rebuild');
     }
    }).finally(()=>{if(this.task===task)this.task=null;});
   }
  }catch(e){if(!this.closed){if(terminal(e))this.stop('Room authorization ended. Open a new invite to reconnect.');else this.suspend('Signaling unavailable. Controls released; retrying…');}}
  finally{this.polling=false;if(!this.closed)this.pollTimer=setTimeout(()=>this.poll(),2000);}
 }
 async freshIce(revision){
  const started=now(),d=await this.request('ice');
  if(this.closed||revision!==this.revision)throw Error('Superseded');
  const config=configuration(d);
  if(!Number.isSafeInteger(d.server_time)||!Number.isSafeInteger(d.expires_at)||d.expires_at-d.server_time<60||d.expires_at-d.server_time>600||!Number.isInteger(d.refresh_after_seconds)||d.refresh_after_seconds<1||d.refresh_after_seconds>420)throw Error('Credential lifetime');
  this.refreshAt=started+d.refresh_after_seconds*1000;return config;
 }
 valid(pc,revision){return !this.closed&&pc===this.pc&&revision===this.revision;}
 async negotiate(item,revision){
  if(this.role==='host'&&!this.localDone&&!this.pending){
   const config=await this.freshIce(revision);if(this.closed||revision!==this.revision)return;
   if(!this.pc)this.connect(config);const pc=this.pc,prior=ufrags(pc.currentLocalDescription);
   if(pc.signalingState==='have-local-offer')await bounded(pc.setLocalDescription({type:'rollback'}));
   if(!this.valid(pc,revision))return;
   pc.setConfiguration({...pc.getConfiguration(),iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy});
   if(prior)pc.restartIce();
   const offer=await bounded(pc.createOffer({iceRestart:Boolean(prior)}));if(!this.valid(pc,revision))return;
   if(prior&&ufrags(offer)===prior)throw Error('ICE credentials unchanged');
   await bounded(pc.setLocalDescription(offer));if(!this.valid(pc,revision))return;
   await gathered(pc);if(!this.valid(pc,revision))return;
   this.pending={round:this.round,description:this.sdp(pc.localDescription,'offer')};
  }
  if(!item||this.remoteDone||(this.pending&&this.role==='guest'))return;
  if(item.round!==this.round)throw Error('Stale description');
  if(this.role==='guest'){
   const config=await this.freshIce(revision);if(this.closed||revision!==this.revision)return;
   if(!this.pc)this.connect(config);const pc=this.pc;
   pc.setConfiguration({...pc.getConfiguration(),iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy});
   await bounded(pc.setRemoteDescription(this.sdp(item.description,'offer')));if(!this.valid(pc,revision))return;
   for(const t of pc.getTransceivers())t.direction='recvonly';
   const answer=await bounded(pc.createAnswer());if(!this.valid(pc,revision))return;
   await bounded(pc.setLocalDescription(answer));if(!this.valid(pc,revision))return;
   await gathered(pc);if(!this.valid(pc,revision))return;
   this.remoteDone=true;this.pending={round:this.round,description:this.sdp(pc.localDescription,'answer')};
  }else{
   if(!this.localDone)return;const pc=this.pc;
   await bounded(pc.setRemoteDescription(this.sdp(item.description,'answer')));if(!this.valid(pc,revision))return;
   this.remoteDone=true;
  }
 }
 async sendPending(){
  const item=this.pending,revision=this.revision;if(!item||this.closed)return;this.sendBusy=true;
  try{
   const result=await this.request('signal',item);
   if(result.accepted!==true||result.round!==item.round)throw Error('Signal acknowledgment');
   if(!this.closed&&revision===this.revision&&this.pending===item){this.pending=null;this.localDone=true;}
  }catch(e){if(!this.closed&&revision===this.revision){
   if(terminal(e))this.stop('Room authorization ended.');
   else{this.suspend('Negotiation delivery interrupted. Retrying the same description…');if(e instanceof ServiceError&&e.status===409){this.pending=null;this.failedRound=true;}}
  }}finally{this.sendBusy=false;this.nextSend=now()+2000;}
 }
 connect(config){
  this.lastData=now();this.everOpen=false;this.epoch='';this.seq=0;this.lastSeq=0;this.challenge='';this.previous='';this.armed=false;
  const pc=this.pc=new RTCPeerConnection(config);
  pc.onconnectionstatechange=()=>{
   if(pc!==this.pc||this.closed)return;
   if(['disconnected','failed','closed'].includes(pc.connectionState))this.suspend('Peer transport interrupted. Controls released; recovering…',pc.connectionState==='closed'?'rebuild':'restart');
  };
  if(this.role==='host'){
   const lease=this.captureLease=this.cb.capture();
   if(!lease||lease.video?.kind!=='video'||typeof lease.getAudio!=='function'||typeof lease.dispose!=='function')throw Error('Adapter capture contract');
   const stream=new MediaStream([lease.video]);this.media.push(stream);
   pc.addTransceiver(lease.video,{direction:'sendonly',streams:[stream],sendEncodings:[{maxBitrate:2500000}]});
   const track=lease.getAudio();if(track&&track.kind!=='audio')throw Error('Adapter audio track');
   if(track){const audioStream=new MediaStream([track]);this.audio=pc.addTransceiver(track,{direction:'sendonly',streams:[audioStream]}).sender;this.audioTrack=track;}
   else this.audio=pc.addTransceiver('audio',{direction:'sendonly'}).sender;
   pc.ondatachannel=e=>{e.channel.close();if(pc===this.pc&&!this.closed)this.stop('Unexpected input channel.');};
   if(!this.watchOnly)this.attachChannel(pc.createDataChannel('game-input-v3',{ordered:true}));
  }else{
   const stream=new MediaStream();this.media.push(stream);this.cb.video.srcObject=stream;
   pc.ontrack=e=>{if(pc!==this.pc||this.closed)return;if(stream.getTracks().includes(e.track))return;for(const old of stream.getTracks().filter(t=>t.kind===e.track.kind))stream.removeTrack(old);stream.addTrack(e.track);this.cb.video.play().catch(()=>message('Press Enable guest audio/video to start playback.'));};
   pc.ondatachannel=e=>{if(pc!==this.pc||this.closed){e.channel.close();return;}if(this.watchOnly){e.channel.close();this.stop('Watcher data channel rejected.');return;}try{if(this.dc)throw Error('Extra channel');this.attachChannel(e.channel);}catch{e.channel.close();this.stop('Invalid input channel.');}};
  }
 }
 attachAudio(){
  if(this.role!=='host'||!this.audio||this.closed||!this.captureLease||this.audioUpdating)return;
  const lease=this.captureLease,pc=this.pc,revision=this.revision,track=lease.getAudio();
  if(track&&track.kind!=='audio')throw Error('Adapter audio track');if(track===this.audioTrack)return;
  this.audioUpdating=true;
  bounded(this.audio.replaceTrack(track)).then(()=>{if(this.valid(pc,revision)&&this.captureLease===lease)this.audioTrack=track;},()=>{if(this.valid(pc,revision))this.suspend('Updating game audio.','rebuild');}).finally(()=>{if(this.captureLease===lease)this.audioUpdating=false;});
 }
 detachAudio(){const lease=this.captureLease;this.captureLease=null;this.audioTrack=null;this.audioUpdating=false;try{lease?.dispose();}catch{}}
 attachChannel(dc){
  if(this.watchOnly||dc.label!=='game-input-v3'||!dc.ordered||dc.maxRetransmits!==null||dc.maxPacketLifeTime!==null){dc.close();throw Error('Reliable ordered channel required');}this.dc=dc;
  dc.onopen=()=>{if(dc!==this.dc||this.closed)return;this.everOpen=true;this.lastData=now();if(this.role==='host')this.barrier();else this.cb.clear();};
  dc.onclose=dc.onerror=()=>{if(dc===this.dc&&!this.closed)this.suspend('Input transport interrupted. Controls released; rebuilding…','rebuild');};
  dc.onmessage=e=>{if(dc!==this.dc||this.closed)return;try{this.receive(e.data);}catch{this.stop('Invalid or excessive input traffic. Sharing stopped.');}};
 }
 send(d){
  if(this.closed||this.dc?.readyState!=='open')return false;
  const text=JSON.stringify({...d,v:3,package:binding.packageId,artifact:binding.artifactDigest,room:this.auth.room,participant:this.assignment.participant,participant_role:this.assignment.participant_role,player:this.assignment.player,inputsDigest:binding.inputsDigest});if(text.length>8192)throw Error('Input payload');
  if(this.dc.bufferedAmount>16384){this.suspend('Input transport congested. Controls released; rebuilding…','rebuild');return false;}
  try{this.dc.send(text);return true;}catch{this.suspend('Input transport interrupted. Controls released; recovering…','rebuild');return false;}
 }
 barrier(){if(this.watchOnly||this.role!=='host'||this.closed)return;this.cb.clearRemote();this.epoch=random(16);this.lastSeq=0;this.armed=false;this.challenge='';this.previous='';}
 pulse(){
  if(this.watchOnly||this.role!=='host'||this.closed)return;this.attachAudio();if(!this.epoch||this.lastSeq>9000000)this.barrier();
  this.previous=this.challenge;this.previousAt=this.challengeAt;this.challenge=random(16);this.challengeAt=now();
  this.send({v:3,type:'pulse',session:this.session,epoch:this.epoch,challenge:this.challenge,enabled:this.permitted()&&this.cb.enabled()});
 }
 sendState(controls,release=false){
  if(this.watchOnly||this.role!=='guest'||!this.challenge||!full(controls)||this.closed)return;
  const t=now();this.credit=Math.min(120,this.credit+(t-this.creditAt)*.12);this.creditAt=t;
  if(this.credit<1){this.stop('Input rate exceeded. Release controls and rejoin.');return;}this.credit--;
  if(this.seq>=10000000){this.suspend('Resetting input sequence…','rebuild');return;}
  this.send({v:3,type:'state',session:this.session,epoch:this.epoch,challenge:this.challenge,seq:++this.seq,controls,release});
 }
 receive(raw){
  if(typeof raw!=='string'||raw.length>8192)throw Error('Payload');const t=now();
  if(t-this.rateAt>=1000){this.rateAt=t;this.rateCount=0;}if(++this.rateCount>240)throw Error('Rate');
  const d=JSON.parse(raw);if(this.watchOnly||!d||d.v!==3||d.package!==binding.packageId||d.artifact!==binding.artifactDigest||d.room!==this.auth.room||d.participant!==this.assignment.participant||d.participant_role!=='play'||d.player!==this.assignment.player||d.inputsDigest!==binding.inputsDigest||d.session!==this.session||!hex(d.epoch,32))throw Error('Identity');
  if(this.role==='guest'){
   if(d.type!=='pulse'||!hex(d.challenge,32)||typeof d.enabled!=='boolean')throw Error('Pulse');
   if(d.epoch!==this.epoch){this.challenge='';this.epoch=d.epoch;this.seq=0;this.cb.clear();}
   this.lastData=t;this.challenge=d.challenge;
   const usable=d.enabled&&this.peerLive&&t-this.lastServer<15000&&this.pc?.connectionState==='connected';
   this.suspended=!usable;this.cb.enabled(usable);this.sendState(usable?this.cb.state():zero());
  }else{
   if(d.type!=='state'||!full(d.controls)||typeof d.release!=='boolean'||!Number.isSafeInteger(d.seq)||d.seq<1||d.seq>10000000)throw Error('State');
   if(d.epoch!==this.epoch||d.seq<=this.lastSeq)return;
   if(!((d.challenge===this.challenge&&t-this.challengeAt<1000)||(d.challenge===this.previous&&t-this.previousAt<1000)))return;
   this.lastSeq=d.seq;this.lastData=t;
   if(d.release){this.barrier();return;}
   if(!this.permitted()||!this.cb.enabled()){this.cb.clearRemote();this.armed=false;return;}
   if(!this.armed){if(Object.values(d.controls).some(Boolean))return;this.armed=true;}
   this.cb.remote(d.controls);
  }
 }
 closeMedia(){
  this.cb.clearRemote?.();this.cb.clear?.();if(this.role==='guest')this.cb.enabled(false);this.challenge='';this.previous='';this.armed=false;this.everOpen=false;
  const dc=this.dc;this.dc=null;if(dc){dc.onopen=dc.onmessage=dc.onclose=dc.onerror=null;dc.close();}
  const pc=this.pc;this.pc=null;if(pc){pc.onconnectionstatechange=pc.ontrack=pc.ondatachannel=null;pc.close();}
  this.detachAudio();this.audio=null;for(const stream of this.media)for(const t of stream.getTracks())t.stop();this.media=[];
  if(this.cb.video){this.cb.video.pause();this.cb.video.srcObject=null;}
 }
 stop(reason){
  if(this.closed)return;this.closed=true;this.revision++;clearInterval(this.watch);clearTimeout(this.pollTimer);this.pending=null;this.closeMedia();message(reason);this.cb.stopped?.();
  this.cb.ended?.(this);
 }
}
 return {api,Peer,configuration,ServiceError,terminal};
}
