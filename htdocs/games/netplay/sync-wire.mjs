import {validateBinding,assignment,hex,insist,full} from './policy.mjs';
export const SYNC_LIMITS=Object.freeze({checkpointBytes:16*1024*1024,chunkBytes:16*1024,frameBatch:120,historyFrames:1800,messageBytes:32768,bufferedBytes:256*1024});
const number=v=>Number.isSafeInteger(v)&&v>=0;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function encode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function decode(text){insist(typeof text==='string'&&text.length<=Math.ceil(SYNC_LIMITS.chunkBytes/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(text),'Checkpoint chunk');const s=atob(text);return Uint8Array.from(s,c=>c.charCodeAt(0));}
const validFrame=f=>f&&number(f.frame)&&Array.isArray(f.pads)&&f.pads.length===2&&f.pads.every(n=>Number.isInteger(n)&&n>=0&&n<=65535)&&(f.hash===undefined||hex(f.hash,64));
// The signaling service authenticates the participant. Every channel message
// repeats that binding; a watcher can acknowledge or request a snapshot only.
export function createSyncWire(value,auth,{role,send,onMessage=()=>{},writable=()=>true,alive=()=>true,authorized=()=>true,onHeartbeat=()=>{}}={}){
 const binding=validateBinding(value),a=assignment(binding,auth);insist(['host','guest'].includes(role)&&typeof send==='function','Sync role');
 const identity={v:1,protocol:'game-sync/1',package:binding.packageId,artifact:binding.artifactDigest,inputsDigest:binding.inputsDigest,room:auth.room,participant:a.participant,participant_role:a.participant_role,player:a.player,session:a.session};
 let epoch='',frame=0,lastSeq=0,transfer=null,sending=false,closed=false,lastResync=-Infinity,rateAt=performance.now(),rate=0,inputCredit=120,inputAt=performance.now(),resyncAt=-Infinity;
 function post(type,data={}){if(closed||!alive()||!writable())return false;const raw=JSON.stringify({...data,...identity,type});insist(new TextEncoder().encode(raw).length<=SYNC_LIMITS.messageBytes,'Sync message size');try{return send(raw)!==false;}catch{return false;}}
 async function drained(){const start=performance.now();while(!writable()){insist(!closed&&alive(),'Sync closed');insist(performance.now()-start<15000,'Checkpoint backpressure timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
 const state=()=>({epoch,frame,sending,receiving:Boolean(transfer),closed});
 async function sendCheckpoint(snapshot){
  insist(role==='host'&&!sending&&!closed&&snapshot&&hex(snapshot.epoch,32)&&number(snapshot.frame),'Checkpoint authority');
  const bytes=snapshot.bytes;insist(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=SYNC_LIMITS.checkpointBytes,'Checkpoint size');
  const metadata=snapshot.metadata??{};insist(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&JSON.stringify(metadata).length<=8192,'Checkpoint metadata');
  sending=true;try{const checksum=await digest(bytes);insist(!closed,'Sync closed');epoch=snapshot.epoch;frame=snapshot.frame;lastSeq=0;
   await drained();insist(post('checkpoint-begin',{epoch,frame,bytes:bytes.length,sha256:checksum,metadata}),'Checkpoint send');
   for(let offset=0,index=0;offset<bytes.length;offset+=SYNC_LIMITS.chunkBytes,index++){await drained();insist(post('checkpoint-chunk',{epoch,index,data:encode(bytes.subarray(offset,offset+SYNC_LIMITS.chunkBytes))}),'Checkpoint send');}
   await drained();insist(post('checkpoint-end',{epoch,frame,sha256:checksum}),'Checkpoint send');return{epoch,frame,sha256:checksum};
  }finally{sending=false;}
 }
 function sendFrames(message){if(sending)return false;insist(role==='host'&&message?.epoch===epoch&&!closed,'Frame authority');const frames=message.frames;insist(Array.isArray(frames)&&frames.length>0&&frames.length<=SYNC_LIMITS.frameBatch&&frames.every(validFrame)&&frames.every((f,i)=>f.frame===(i?frames[i-1].frame:frame)+1),'Frame continuity');if(sending)return false;if(!post('frames',{epoch,frames}))return false;frame=frames.at(-1).frame;return true;}
 function sendInput(message){insist(role==='guest'&&a.participant_role==='play'&&message?.epoch===epoch&&number(message.frame)&&number(message.seq)&&message.seq>0&&full(binding,message.controls),'Input authority');return post('input',{epoch,frame:message.frame,seq:message.seq,controls:message.controls});}
 function requestResync(message={}){insist(role==='guest','Resync authority');if(performance.now()-lastResync<1000)return false;lastResync=performance.now();return post('resync',{epoch:message.epoch??epoch,frame:message.frame??frame,reason:String(message.reason??'bootstrap').slice(0,120)});}
 function sendControl(message){if(sending)return false;insist(role==='host'&&message?.epoch===epoch&&number(message.frame)&&['pause','resume','end'].includes(message.action),'Control authority');return post('control',{epoch,frame:message.frame,action:message.action});}
 async function receive(raw){
  insist(!closed&&typeof raw==='string'&&new TextEncoder().encode(raw).length<=SYNC_LIMITS.messageBytes,'Sync payload');const now=performance.now();if(now-rateAt>=1000){rateAt=now;rate=0;}insist(++rate<=2048,'Sync message rate');const d=JSON.parse(raw);insist(d&&Object.entries(identity).every(([k,v])=>d[k]===v),'Sync identity');
  if(d.type==='heartbeat'){insist(typeof d.enabled==='boolean','Sync heartbeat');onHeartbeat(d.enabled);return;}
  if(role==='host'){
   if(d.type==='input'){inputCredit=Math.min(120,inputCredit+(now-inputAt)*.12);inputAt=now;insist(inputCredit>=1,'Input rate');inputCredit--;insist(a.participant_role==='play'&&number(d.frame)&&number(d.seq)&&d.seq>0&&full(binding,d.controls),'Input authority');if(d.epoch!==epoch||d.seq<=lastSeq||!authorized())return;insist(d.frame<=frame+SYNC_LIMITS.frameBatch,'Input frame bound');lastSeq=d.seq;await onMessage({type:'input',epoch,frame:d.frame,seq:d.seq,controls:d.controls,player:a.player});return;}
   if(d.type==='resync'){insist(now-resyncAt>=1000,'Resync rate');resyncAt=now;insist((d.epoch===''||hex(d.epoch,32))&&number(d.frame)&&typeof d.reason==='string'&&d.reason.length<=120,'Resync request');await onMessage({type:'resync',epoch:d.epoch,frame:d.frame,reason:d.reason});return;}
   if(d.type==='ack'){insist(hex(d.epoch,32)&&number(d.frame)&&hex(d.sha256,64),'Checkpoint acknowledgment');if(d.epoch!==epoch)return;insist(d.frame<=frame,'Checkpoint acknowledgment frame');await onMessage({type:'ack',epoch,frame:d.frame,sha256:d.sha256});return;}
   throw Error('Guest message authority');
  }
  insist(hex(d.epoch,32),'Sync epoch');
  if(d.type==='checkpoint-begin'){insist(!transfer&&number(d.frame)&&Number.isInteger(d.bytes)&&d.bytes>0&&d.bytes<=SYNC_LIMITS.checkpointBytes&&hex(d.sha256,64)&&d.metadata&&typeof d.metadata==='object'&&!Array.isArray(d.metadata)&&JSON.stringify(d.metadata).length<=8192,'Checkpoint header');transfer={epoch:d.epoch,frame:d.frame,sha256:d.sha256,metadata:d.metadata,bytes:new Uint8Array(d.bytes),offset:0,index:0};return;}
  if(d.type==='checkpoint-chunk'){insist(transfer&&d.epoch===transfer.epoch&&d.index===transfer.index,'Checkpoint order');const bytes=decode(d.data);insist(bytes.length>0&&bytes.length<=SYNC_LIMITS.chunkBytes&&transfer.offset+bytes.length<=transfer.bytes.length,'Checkpoint chunk size');transfer.bytes.set(bytes,transfer.offset);transfer.offset+=bytes.length;transfer.index++;return;}
  if(d.type==='checkpoint-end'){const t=transfer;insist(t&&d.epoch===t.epoch&&d.frame===t.frame&&d.sha256===t.sha256&&t.offset===t.bytes.length,'Checkpoint completion');insist(await digest(t.bytes)===t.sha256,'Checkpoint checksum');insist(!closed,'Sync closed');transfer=null;epoch=t.epoch;frame=t.frame;await onMessage({type:'checkpoint',epoch,frame,bytes:t.bytes,metadata:t.metadata,sha256:t.sha256});post('ack',{epoch,frame,sha256:t.sha256});return;}
  insist(!transfer&&d.epoch===epoch,'Frame epoch');
  if(d.type==='frames'){insist(Array.isArray(d.frames)&&d.frames.length>0&&d.frames.length<=SYNC_LIMITS.frameBatch&&d.frames.every(validFrame)&&d.frames.every((f,i)=>f.frame===(i?d.frames[i-1].frame:frame)+1),'Frame continuity');frame=d.frames.at(-1).frame;await onMessage({type:'frames',epoch,frames:d.frames});return;}
  if(d.type==='control'){insist(number(d.frame)&&['pause','resume','end'].includes(d.action),'Control message');await onMessage({type:'control',epoch,frame:d.frame,action:d.action});return;}
  throw Error('Host message authority');
 }
 return{sendCheckpoint,sendFrames,sendInput,requestResync,sendControl,receive,state,heartbeat:enabled=>post('heartbeat',{enabled:Boolean(enabled)}),close(){closed=true;transfer=null;}};
}
