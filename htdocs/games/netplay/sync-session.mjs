import {createHostSession} from './session.mjs';
import {createSyncTransport} from './sync-transport.mjs';
import {validateBinding,assignment,hex,insist,zero} from './policy.mjs';
import {createHostReplication} from './replication-host.mjs';
import {createGuestReplication} from './replication-guest.mjs';
const notify=(fn,event)=>{try{fn(event);}catch{}};
export async function createHostSyncSession(binding,adapter,{network,onEvent=()=>{},signal}={}){
 insist(network&&typeof network.capture==='function'&&typeof network.subscribeFrame==='function','Cartridge synchronization unavailable');
 const replication=createHostReplication({network,adapter,binding,onError:error=>notify(onEvent,{type:'status',message:'Refreshing shared game state…'})});
 try{
  const room=await createHostSession(binding,adapter,{onEvent,signal,transportFactory:createSyncTransport,peerCallbacks:a=>replication.callbacks(a)});
  const end=room.end.bind(room);room.end=()=>{replication.dispose();return end();};return room;
 }catch(error){replication.dispose();throw error;}
}
export async function joinSyncParticipant(value,record,{network,onEvent=()=>{},signal}={}){
 const binding=validateBinding(value);
 insist(network&&typeof network.follow==='function'&&typeof network.push==='function','Local emulator unavailable');
 insist(!signal?.aborted&&record&&hex(record.room,32)&&hex(record.participant,32)&&hex(record.credential,64)&&hex(record.join_id,32),'Join identity');
 const transport=createSyncTransport(binding,onEvent),body={room:record.room,participant:record.participant,credential:record.credential,join_id:record.join_id};
 if(record.invite){insist(hex(record.invite,64),'Invite identity');body.invite=record.invite;}else{insist(hex(record.session,32),'Resume session');body.session=record.session;}
 const assigned=assignment(binding,await transport.api(record.invite?'join':'rejoin',body));
 insist(assigned.participant===record.participant&&assigned.session,'Join assignment');
 const held=new Map(),blocked=new Set();let closed=false,epoch=0,enabled=false,seq=0,peer,replication,unlisten=()=>{};
 const controls=()=>{const result=zero(binding);for(const id of held.values())result[id]=true;return result;};
 const clear=()=>{for(const source of held.keys())blocked.add(source);held.clear();epoch++;};
 const connected=()=>!closed&&peer&&!peer.closed&&peer.healthy()&&peer.peerLive&&performance.now()-peer.lastServer<15000;
 const getState=()=>{
  const local=replication?.state(),available=Boolean(connected()&&local?.ready),hostPaused=Boolean(available&&local.paused);
  return {version:1,packageId:binding.packageId,artifactDigest:binding.artifactDigest,role:assigned.participant_role==='watch'?'spectator':'guest',phase:closed?'ended':available?'active':'reconnecting',epoch,assignment:assigned,mediaAvailable:available,hostPaused,inputEnabled:Boolean(available&&!hostPaused&&assigned.capabilities.input&&enabled&&peer.permitted()),replication:local};
 };
 let previous='';
 const emit=()=>{const s=getState(),key=[s.phase,s.inputEnabled,s.hostPaused,s.replication?.epoch].join('|');if(key!==previous){previous=key;clear();s.epoch=epoch;}notify(onEvent,{type:'state',state:s});};
 const send=values=>{const local=replication.state();if(!local.epoch||!assigned.capabilities.input)return false;return peer.sendInput({epoch:local.epoch,frame:local.frame,seq:++seq,controls:values});};
 replication=createGuestReplication({network,binding,onChange:emit,requestResync:message=>peer?.requestResync(message)});
 peer=new transport.Peer('guest',{room:record.room,credential:record.credential,...assigned},{
  clear(){clear();},state:controls,enabled(value){if(enabled!==value){enabled=value;if(!value)clear();emit();}},
  syncInput(values){if(connected()&&replication.state().ready)send(values);},
  syncOpen(){replication.disconnected();seq=0;emit();},syncMessage:message=>replication.receive(message),syncClose(){enabled=false;clear();replication.disconnected();emit();},
  stopped(){closed=true;enabled=false;clear();replication.close();unlisten();emit();}
 });
 const release=()=>{if(closed)return;clear();if(connected())send(zero(binding));emit();};
 const dispose=async({leave=false}={})=>{
  if(closed)return {serverConfirmed:false};release();closed=true;unlisten();replication.close();peer.stop('Participant closed.');
  if(!leave)return {serverConfirmed:false,rejoinAfterSeconds:15};
  try{const result=await peer.request('leave');return {serverConfirmed:result.left===true};}catch(error){return {serverConfirmed:error instanceof transport.ServiceError&&error.status===410};}
 };
 const result={version:1,packageId:binding.packageId,artifactDigest:binding.artifactDigest,assignment:assigned,resume:{room:record.room,participant:assigned.participant,credential:record.credential,session:assigned.session,join_id:record.join_id,joined:true},getState,
  input(event){
   if(!event||Object.keys(event).sort().join(',')!=='control,epoch,pressed,source'||typeof event.source!=='string'||!event.source.length||event.source.length>100||/[\x00-\x1f\x7f]/.test(event.source)||typeof event.pressed!=='boolean'||!binding.inputs.some(i=>i.id===event.control)||!assigned.capabilities.input)return false;
   if(!event.pressed){blocked.delete(event.source);if(held.get(event.source)!==event.control)return false;held.delete(event.source);send(controls());return true;}
   if(event.epoch!==epoch||!getState().inputEnabled||blocked.has(event.source)||held.has(event.source)||held.size>=64)return false;
   held.set(event.source,event.control);if(!send(controls())){held.delete(event.source);return false;}return true;
  },release,retry:()=>{replication.retry();peer.retry();},enableAudio:()=>network.enableAudio(),getMedia:()=>null,dispose
 };
 if(signal?.aborted){await dispose({leave:true});throw Error('Cancelled');}
 if(signal){const cancel=()=>{void dispose();};signal.addEventListener('abort',cancel,{once:true});unlisten=()=>signal.removeEventListener('abort',cancel);}
 peer.start();emit();return result;
}
