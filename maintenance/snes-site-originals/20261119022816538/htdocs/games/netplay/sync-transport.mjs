import {createTransport} from './transport.mjs';
import {createSyncWire,SYNC_LIMITS} from './sync-wire.mjs';
import {validateSDP,insist} from './policy.mjs';
// Reuse authenticated protocol-3 polling, authorization leases, ICE rotation,
// retries and revocation. This subclass replaces only the media/channel layer.
export function createSyncTransport(binding,notify=()=>{}){
 const base=createTransport(binding,notify);
 class Peer extends base.Peer{
  constructor(role,auth,callbacks={}){super(role,auth,{enabled:()=>false,state:()=>({}),clear:()=>{},clearRemote:()=>{},...callbacks});this.syncWire=null;this.syncPending=0;this.syncReady=false;}
  sdp(d,type){insist(d?.type===type,'Sync SDP type');const value=validateSDP({type,sdp:d?.sdp},this.watchOnly);insist((value.sdp.match(/^m=/gm)||[]).length===1&&/^m=application /m.test(value.sdp),'Data-only sync SDP');return value;}
  // Bulk relay checkpoints tolerate brief delivery gaps; player input keeps its two-second expiry.
  healthy(){return this.pc?.connectionState==='connected'&&this.dc?.readyState==='open'&&performance.now()-this.lastData<(this.watchOnly?15000:2000);}
  connect(config){
   this.lastData=performance.now();this.everOpen=false;const pc=this.pc=new RTCPeerConnection(config);
   pc.onconnectionstatechange=()=>{if(pc!==this.pc||this.closed)return;if(['disconnected','failed','closed'].includes(pc.connectionState))this.suspend('Game synchronization interrupted. Reconnecting…',pc.connectionState==='closed'?'rebuild':'restart');};
   pc.ontrack=e=>{e.track.stop();this.stop('Unexpected media on synchronized session.');};
   pc.ondatachannel=e=>{if(this.role==='host'||this.dc||pc!==this.pc||this.closed){e.channel.close();if(pc===this.pc&&!this.closed)this.stop('Unexpected sync channel.');return;}try{this.attachChannel(e.channel);}catch{e.channel.close();this.stop('Invalid sync channel.');}};
   if(this.role==='host')this.attachChannel(pc.createDataChannel('game-sync-v1',{ordered:true}));
  }
  attachChannel(dc){
   insist(dc.label==='game-sync-v1'&&dc.ordered&&dc.maxRetransmits===null&&dc.maxPacketLifeTime===null,'Reliable ordered sync channel');this.dc=dc;dc.bufferedAmountLowThreshold=SYNC_LIMITS.bufferedBytes/2;
   this.syncWire=createSyncWire(binding,{...this.auth,session:this.session},{role:this.role,send:raw=>{dc.send(raw);return true;},writable:()=>dc.bufferedAmount<SYNC_LIMITS.bufferedBytes,alive:()=>!this.closed&&this.dc===dc&&dc.readyState==='open',authorized:()=>this.permitted()&&this.cb.enabled(),onHeartbeat:enabled=>{this.lastData=performance.now();if(this.role==='guest'){this.suspended=!enabled;if(!this.watchOnly)this.cb.enabled(enabled&&this.peerLive&&performance.now()-this.lastServer<15000);}},onMessage:message=>{this.lastData=performance.now();return this.cb.syncMessage?.(message,this);}});
   let chain=Promise.resolve(),pending=0,pendingBytes=0;const wire=this.syncWire;
   dc.onopen=()=>{if(dc!==this.dc||this.closed)return;this.everOpen=true;this.lastData=performance.now();this.syncReady=true;Promise.resolve().then(()=>{if(dc===this.dc&&!this.closed)return this.cb.syncOpen?.(this);}).catch(()=>{if(dc===this.dc&&!this.closed)this.stop('Game synchronization could not start.');});wire.heartbeat(this.role==='host'&&this.cb.enabled());};
   dc.onclose=dc.onerror=()=>{if(dc===this.dc&&!this.closed)this.suspend('Game synchronization interrupted. Reconnecting…','rebuild');};
   dc.onmessage=e=>{if(dc!==this.dc||this.closed)return;if(typeof e.data!=='string'||e.data.length>SYNC_LIMITS.messageBytes||++pending>2048||(pendingBytes+=e.data.length)>SYNC_LIMITS.checkpointBytes*2){this.stop('Excessive sync backlog.');return;}chain=chain.then(async()=>{if(dc!==this.dc||this.closed)return;await wire.receive(e.data);if(dc===this.dc&&!this.closed)this.lastData=performance.now();}).catch(()=>{if(dc===this.dc&&!this.closed)this.stop('Invalid synchronized game data.');}).finally(()=>{pending--;pendingBytes-=e.data.length;});};
  }
  // Existing tick invokes pulse for hosts and sendState for guests. Both are
  // heartbeat-only here; actual input uses the validated sendInput method.
  tick(){if(this.watchOnly&&this.everOpen&&performance.now()-this.lastData>15000)this.suspend('Viewer synchronization interrupted. Reconnecting…','rebuild');super.tick();}
  pulse(){this.syncWire?.heartbeat(!this.suspended&&this.cb.enabled());}
  sendState(controls){this.syncWire?.heartbeat(false);this.cb.syncInput?.(controls);}
  attachAudio(){}
  barrier(){this.cb.clearRemote?.();}
  closeMedia(){const wasReady=this.syncReady;this.syncReady=false;this.syncWire?.close();this.syncWire=null;super.closeMedia();if(wasReady)this.cb.syncClose?.(this);}
  sendCheckpoint(snapshot){insist(this.syncWire,'Sync channel unavailable');return this.syncWire.sendCheckpoint(snapshot);}
  sendFrames(message){return this.syncWire?.sendFrames(message)??false;}
  sendInput(message){if(!this.permitted())return false;return this.syncWire?.sendInput(message)??false;}
  requestResync(message){return this.syncWire?.requestResync(message)??false;}
  sendControl(message){return this.syncWire?.sendControl(message)??false;}
  syncState(){return this.syncWire?.state()??{epoch:'',frame:0,closed:true};}
 }
 return{...base,Peer};
}
