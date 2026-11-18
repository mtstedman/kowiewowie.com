import {snesSlot} from './snes-storage.mjs';
import {createFramePacer} from './frame-pacing.mjs';
import {createSimulationClock} from './simulation-clock.mjs';
// Bounded worker transport; one complete frame is in flight, at most 100 ms ahead.
export function createSnesRuntime({canvas,config,packageId,onState=()=>{},signal}) {
 let worker=null,workerBootstrap=null,context=null,master=null,ready=false,running=false,closed=false,loading=false,message='Loading SNES…';
 let nextId=0,pending=new Map(),frameBusy=false,epoch=0,raf=0,audioCursor=0,video=[],sources=new Map(),nodes=new Set(),lastBattery=0,batteryBusy=false,batteryPending=null,disposal=null;
 let generated=0,presented=0,audioSamples=0,underruns=0,lastMeter=0,fps=0;const presentation=createFramePacer();let simulation=null,simulationFrames=0,pumpTimer=null;
 const draw=canvas.getContext('2d',{alpha:false});let image=null;
 function changed(){onState();}
 function releaseBootstrap(){if(workerBootstrap){URL.revokeObjectURL(workerBootstrap);workerBootstrap=null;}}
 function rpc(op,fields={}){if(!worker)return Promise.reject(Error('SNES worker unavailable'));const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('SNES worker timed out'));},30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,op,...fields});});}
 function masks(){const result=[0,0];for(const s of sources.values())result[s.seat-1]|=1<<s.button;return result;}
 function stopAudio(){for(const node of nodes){try{node.stop();}catch{}}nodes.clear();audioCursor=0;video=[];}
 function fail(error){pause();message=error.message||String(error);changed();}
 function flushBattery(){if(batteryPending)return batteryPending;if(!ready||!worker)return Promise.resolve();batteryBusy=true;batteryPending=rpc('battery').then(record=>snesSlot(packageId,'battery',record)).finally(()=>{batteryBusy=false;batteryPending=null;});return batteryPending;}
 function accept(frame){
  const now=context.currentTime;
  if(audioCursor&&audioCursor<now)underruns++;
  // Prime a small audio lead once, then join every PCM buffer exactly.
  // Re-prime only after a real underrun; ordinary arrival jitter adds no silence.
  const start=audioCursor>now?audioCursor:now+.06,length=frame.audio.length/2,duration=Math.max(1/simulation.snapshot().hz,length/context.sampleRate);
  if(length){const buffer=context.createBuffer(2,length,context.sampleRate);for(let channel=0;channel<2;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<length;i++)data[i]=frame.audio[i*2+channel]/32768;}const node=context.createBufferSource();node.buffer=buffer;node.playbackRate.value=(length/context.sampleRate)/duration;node.connect(master);node.onended=()=>{nodes.delete(node);node.disconnect();};nodes.add(node);node.start(start);audioCursor=start+duration;}
  else audioCursor=start+duration;
  audioSamples+=frame.audio.length;video.push({showAt:start,frame});generated++;
 }
 function armPump(delay){clearTimeout(pumpTimer);pumpTimer=setTimeout(()=>{pumpTimer=null;pump();},Math.max(.1,delay));}
 function pump(){
  clearTimeout(pumpTimer);pumpTimer=null;if(!running||closed||frameBusy)return;
  if(video.length>=8||audioCursor-context.currentTime>=.085){armPump(5);return;}
  if(!simulation.take(performance.now())){armPump(simulation.delay(performance.now()));return;}
  frameBusy=true;const generation=epoch;
  rpc('frame',{pads:masks()}).then(frame=>{simulationFrames=frame.simulation?.executed??simulationFrames+1;if(running&&!closed&&generation===epoch)accept(frame);},fail).finally(()=>{frameBusy=false;if(running&&!closed)pump();});
 }
 function tick(timestamp=performance.now()){if(!running||closed)return;raf=requestAnimationFrame(tick);const now=context.currentTime;
  if(video.length&&video[0].showAt<=now&&presentation.take(timestamp)){
   // PCM was scheduled in full when each frame arrived. A late display uses
   // the newest due image once; superseded video never becomes a draw burst.
   let {frame}=video.shift();while(video.length&&video[0].showAt<=now)({frame}=video.shift());
   if(canvas.width!==frame.width||canvas.height!==frame.height){canvas.width=frame.width;canvas.height=frame.height;image=null;}
   if(!image)image=draw.createImageData(frame.width,frame.height);image.data.set(frame.rgba);draw.putImageData(image,0,0);presented++;
  }
  if(now-lastMeter>=1){message=`${presentation.snapshot(timestamp).fps.toFixed(1)} FPS`;lastMeter=now;changed();}
  if(now-lastBattery>5&&!batteryBusy){lastBattery=now;flushBattery().catch(e=>{message=e.message;changed();});}pump();
 }
 function pause(){running=false;epoch++;simulation?.pause();clearTimeout(pumpTimer);pumpTimer=null;cancelAnimationFrame(raf);sources.clear();stopAudio();changed();if(ready&&!closed)flushBattery().catch(e=>{message=e.message;changed();});}
 async function load(){if(loading||ready||closed)return;loading=true;changed();try{
  context=new AudioContext({latencyHint:'interactive',sampleRate:48000});master=context.createGain();master.connect(context.destination);
  const battery=await snesSlot(packageId,'battery');if(closed)throw Error('Cancelled');
  // A blob worker inherits the arcade document's reviewed script/Wasm policy.
  // The engine route's stricter response policy must not govern dynamic loader
  // imports inside this worker. The bootstrap imports only our fixed module URL.
  const moduleURL=new URL('../engines/snes/worker.mjs',import.meta.url).href;
  workerBootstrap=URL.createObjectURL(new Blob(['import '+JSON.stringify(moduleURL)+';'],{type:'text/javascript'}));
  worker=new Worker(workerBootstrap,{type:'module',name:'Posse SNES'});
  worker.onmessage=({data})=>{const wait=pending.get(data.id);if(!wait)return;pending.delete(data.id);clearTimeout(wait.timer);data.error?wait.reject(Error(data.error)):wait.resolve(data.result);};
  worker.onerror=event=>{const error=Error(event.message||'SNES worker failed');for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(error);}pending.clear();fail(error);};
  const info=await rpc('init',{config,sampleRate:context.sampleRate,battery});releaseBootstrap();if(closed)return;fps=info.fps;simulation=createSimulationClock({hz:Math.min(60,fps)});ready=true;message='Ready';
 }catch(error){message=error.message;throw error;}finally{loading=false;changed();}}
 async function start(){if(!ready||closed||running)return;const generation=epoch;await context.resume();if(closed||generation!==epoch)return;running=true;epoch++;simulation.resume(performance.now());presentation.resetClock();lastMeter=context.currentTime;message='Running';tick();changed();}
 async function reset(){if(!ready||closed)return;pause();await flushBattery();await rpc('reset');generated=presented=audioSamples=0;message='Ready';changed();}
 function input(source,button,pressed,seat=1){if(closed||!ready||![1,2].includes(seat)||!Number.isInteger(button)||button<0||button>11||typeof source!=='string')return false;const key=seat+':'+source+':'+button;if(!pressed){sources.delete(key);return true;}if(!running)return false;sources.set(key,{source,seat,button});return true;}
 function releaseAll(){sources.clear();}
 async function dispose(){if(disposal)return disposal;closed=true;pause();disposal=(async()=>{try{await flushBattery();}finally{worker?.terminate();worker=null;releaseBootstrap();for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(Error('SNES runtime disposed'));}pending.clear();master?.disconnect();await context?.close();ready=false;changed();}})();return disposal;}
 signal?.addEventListener('abort',()=>{dispose().catch(()=>{});},{once:true});
 return {load,start,pause,reset,dispose,input,releaseAll,clearRemote(){for(const [key,value]of sources)if(value.source.startsWith('remote:'))sources.delete(key);},held(button,seat=1){return [...sources.values()].some(s=>s.button===button&&s.seat===seat);},snapshot:()=>({ready,running,loading,closed,message,generatedFrames:generated,simulationFrames,simulationHz:simulation?.snapshot().hz??null,dispatchedFrames:simulation?.snapshot().executed??0,presentedFrames:presented,audioSamples,underruns,queuedFrames:video.length}),audio:()=>({context,node:master}),async exportCheckpoint(){pause();return rpc('save');},async importCheckpoint(record){pause();await rpc('load',{record});message='Saved game loaded';changed();}};
}
