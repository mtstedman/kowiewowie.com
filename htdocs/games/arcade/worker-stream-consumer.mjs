import {CAPACITY,RGBA_BYTES} from './worker-stream-producer.mjs';
// Reservations include frames still in the worker, in transit, and queued on page.
export function createConsumer({send}){
 let epoch=-1,credits=0,received=0,lastId=0,nextAt=0,lastFrames=-1,lastCycles=-1,inputSeq=0,appliedSeq=0,stale=0;
 let duration=1/60.0988,grantMessages=0,returnedBuffers=0;const owned=new Map(),returns=[];
 const safe=(x,min=0)=>Number.isSafeInteger(x)&&x>=min;
 function reset(e){epoch=e;credits=0;owned.clear();returns.length=0;lastId=0;nextAt=0;lastFrames=lastCycles=-1;inputSeq=appliedSeq=0;duration=1/60.0988;}
 function input(source,button,pressed,seat){if(epoch<0)return;send('input',{source,button,pressed,seat,inputSeq:++inputSeq});}
 function grant(ahead,target){
  if(epoch<0)return 0;
  if(!Number.isFinite(ahead)||!Number.isFinite(target)||target<=0)throw Error('Invalid media lead');
  // Round up by less than one frame, reserving in-flight work exactly once.
  // Extra slots support presentation latency, not a higher media target.
  // Retain an absolute 200ms cap even for high caller targets.
  const count=Math.min(4,CAPACITY-credits-owned.size,Math.ceil((Math.min(target,.2,CAPACITY*duration)-Math.max(0,ahead))/duration)-credits);
  if(count<1)return 0;
  const batch=returns.slice(),transfer=batch.flatMap(r=>[r.rgba,r.audio]);
  send('grant',{count,returns:batch},transfer);
  returns.length=0;credits+=count;grantMessages++;returnedBuffers+=batch.length;return count;
 }
 function accept(d){
  if(d?.epoch!==epoch){stale++;return false;}
  if(d.type!=='frame'||credits<1||!safe(d.id,1)||d.id<=lastId||!safe(d.produced,1)||!safe(d.frames)||d.frames<=lastFrames||!safe(d.cycles)||d.cycles<=lastCycles||!Number.isFinite(d.at)||Math.abs(d.at-nextAt)>1e-7||!Number.isFinite(d.duration)||d.duration<=0||d.duration>.2||!(d.rgba instanceof Uint8ClampedArray)||d.rgba.length!==RGBA_BYTES||d.rgba.byteOffset!==0||d.rgba.buffer.byteLength!==RGBA_BYTES||!(d.audio instanceof Float32Array)||d.audio.length%2||d.audio.length>96000||d.audio.byteOffset!==0||d.audio.byteLength!==d.audio.buffer.byteLength||d.rgba.buffer===d.audio.buffer||!safe(d.inputSeq)||d.inputSeq>inputSeq||!safe(d.appliedSeq)||d.appliedSeq>d.inputSeq||d.appliedSeq<appliedSeq)throw Error('Malformed streaming frame');
  if(d.audio.length&&Math.abs(d.duration-d.audio.length/96000)>1e-7)throw Error('Invalid audio timestamp');
  credits--;received++;lastId=d.id;lastFrames=d.frames;lastCycles=d.cycles;nextAt=d.at+d.duration;duration=d.duration;appliedSeq=d.appliedSeq;owned.set(d.id,d);return true;
 }
 function recycle(d){
  if(!d||d.epoch!==epoch)return;
  if(owned.get(d.id)!==d)throw Error('Duplicate or foreign frame recycle');
  if(returns.length>=CAPACITY)throw Error('Return queue overflow');
  owned.delete(d.id);returns.push({id:d.id,rgba:d.rgba.buffer,audio:d.audio.buffer});
 }
 return {reset,input,grant,accept,recycle,snapshot:()=>({received,queued:owned.size,credits,bound:CAPACITY,inputSeq,appliedSeq,stale,pendingReturns:returns.length,grantMessages,returnedBuffers})};
}
