import {createConsumer} from './worker-stream-consumer.mjs';
// Authenticated UI lifecycle derivation; emulation and media pacing are unchanged.
export function createRuntime({root,onState=()=>{},WorkerClass=Worker,workerURL}){
let closed=false,runtimeFrame=0,checkpointRequest=null;
function cancelCheckpoint(reason){if(!checkpointRequest)return;const r=checkpointRequest;checkpointRequest=null;clearTimeout(r.timer);r.reject(Error(reason));}
// Aggregate controller edges each occupy a frame. Sources overlap by OR.
// Repeats and duplicate releases are idempotent. Overflow stops explicitly.
class SampledInput {
  constructor(group,seat=1){this.group=group;this.seat=seat;this.held=new Map();}
  hasButton(b){for(const v of this.held.values())if(v===b)return true;return false;}
  edge(){}
  press(source,b,repeat=false){
    if(repeat||this.held.has(source))return false;
    if(!Number.isInteger(b)||b<0||b>7)throw Error('Invalid controller button');
    if(this.held.size>=32)throw Error('Too many simultaneous controls. Inputs cleared; use Reset');
    if(!this.hasButton(b))this.edge(b,true);
    this.held.set(source,b);stream.input(this.group+source,b,true,this.seat);return true;
  }
  release(source){
    if(!this.held.has(source))return;
    const b=this.held.get(source);this.held.delete(source);
    if(!this.hasButton(b))this.edge(b,false);stream.input(this.group+source,b,false,this.seat);
  }
  
  clear(){for(const source of [...this.held.keys()])this.release(source);}
}
const $=id=>root.querySelector('#nes-'+id),canvas=$('screen'),ctx=canvas.getContext('2d'),status=$('status');
const pads=[];
const input=new SampledInput('local:'),remoteInput=new SampledInput('remote1:'),remoteInput2=new SampledInput('remote2:',2),pointers=new Map(),sources=new Set();
let netplay=null;

const touchDpad={clear(){},render(){}};
const gamepad={clear(){},poll(){}};
ctx.imageSmoothingEnabled=false;
const scaleSelect=$('scale');
function setScale(value){
  const scale=value==='4'?'4':'2';canvas.dataset.scale=scale;scaleSelect.value=scale;
  try{localStorage.setItem('romjs-pixel-scale',scale);}catch{}
}
let savedScale='2';try{savedScale=localStorage.getItem('romjs-pixel-scale')||'2';}catch{}
setScale(savedScale);scaleSelect.onchange=()=>setScale(scaleSelect.value);
let worker=null,ready=false,loading=false,running=false,pending=null,timer=null;
let epoch=0,seq=0,synced=-1,last=-Infinity,ac=null,audioNext=0,notice='';
let autoRender=false,audioUnlocked=false,master=null,fadeIn=true,audioClockActive=false;
const CPU_HZ=1789772.7272727273,BUFFER_SECONDS=.08;
let mediaNext=0,pumpTimer=null,videoQueue=[],lastCycles=null;
let measuredAt=0,measuredCycles=0,measuredFrames=0,presented=0,speed=0,fps=0;
let renderOffset=null,renderWall=null,statusAt=0,bufferTarget=BUFFER_SECONDS;
const freeVideo=[];
const stream=createConsumer({send:wire});
const clock=()=>audioClockActive?ac.currentTime:performance.now()/1000;
function recycle(frame){if(frame)stream.recycle(frame.transport);}
function presentationClock(timestamp){
  const wall=timestamp/1000;
  if(!audioClockActive)return wall;
  const stamp=ac.getOutputTimestamp?.();
  const observed=stamp?.performanceTime>0?stamp.contextTime-stamp.performanceTime/1000:
    ac.currentTime-performance.now()/1000-(ac.outputLatency||0);
  if(renderOffset===null)renderOffset=observed;
  else {
    // Audio timestamps are noisy measurements, not permission to jump the video clock.
    // Slew at at most 1 ms/second while keeping the display on its vsync timestamps.
    const limit=Math.max(0,wall-renderWall)*.001;
    renderOffset+=Math.max(-limit,Math.min(limit,observed-renderOffset));
  }
  renderWall=wall;return wall+renderOffset;
}
function syncAudioClock(){
  const active=audioUnlocked&&ac?.state==='running';
  if(Boolean(active)===audioClockActive)return;
  const before=clock();audioClockActive=Boolean(active);
  const shift=clock()-before;
  silence();mediaNext+=shift;renderOffset=null;renderWall=null;
  // Preserve queued video and PCM when a gesture enables audio; do not flush a frame queue.
  for(const frame of videoQueue){frame.at+=shift;if(audioClockActive&&frame.at>ac.currentTime)sound(frame.audio,frame.at);}
  pump();
}
function rebase(){
  silence();for(const frame of videoQueue)recycle(frame);videoQueue=[];mediaNext=clock()+.012;renderOffset=null;renderWall=null;
  measuredAt=performance.now();measuredCycles=lastCycles??0;measuredFrames=presented;
  clearTimeout(pumpTimer);pumpTimer=null;
}
function pump(){
   clearTimeout(pumpTimer);pumpTimer=null;
   if(!ready||!running||document.hidden||synced!==epoch)return;
   try{stream.grant(mediaNext-clock(),bufferTarget);watchProgress();}catch(e){fail(e.message||e);return;}
   // A coarse timer also makes progress if RAF is throttled. It grants batches only.
   pumpTimer=setTimeout(pump,12);
 }
 function enqueue(d){
  if(lastCycles===null){measuredAt=performance.now();measuredCycles=d.cycles;measuredFrames=presented;}
  const now=clock(),duration=d.audio.length?d.audio.length/2/48000:
    lastCycles===null?1/60.0988:(d.cycles-lastCycles)/CPU_HZ;
  // Rebase after a real underrun, never stretch samples or accumulate stale work.
  if(mediaNext<now){bufferTarget=Math.min(.2,bufferTarget+.02);mediaNext=now+.012;fadeIn=true;}
  sound(d.audio,mediaNext);
  videoQueue.push({at:mediaNext,rgba:d.rgba,audio:d.audio,frames:d.frames,transport:d});
  mediaNext+=duration;lastCycles=d.cycles;
  const elapsed=(performance.now()-measuredAt)/1000;
  if(elapsed>=1){
    speed=(d.cycles-measuredCycles)/CPU_HZ/elapsed;
    fps=(presented-measuredFrames)/elapsed;
    measuredAt=performance.now();measuredCycles=d.cycles;measuredFrames=presented;
  }
}

function controls(){
  onState();
  touchDpad.render(ready&&running&&!document.hidden,b=>input.hasButton(b));
  $('start').disabled=!ready||running||document.hidden;
  $('pause').disabled=!ready||!running;
  for(const b of pads){const n=Number(b.dataset.button);b.disabled=!ready||document.hidden||(!running&&n!==3);b.setAttribute('aria-pressed',String(input.hasButton(n)));}
}
function show(text){status.textContent=text+(notice?' · '+notice:'');controls();}
function silence(){
  const now=ac?.currentTime??0;
  if(master){master.gain.cancelScheduledValues(now);master.gain.setValueAtTime(master.gain.value,now);master.gain.linearRampToValueAtTime(0,now+.005);}
  for(const s of sources){try{s.stop(now+.005);}catch{}}
  sources.clear();audioNext=0;fadeIn=true;
}
function clearInputs(){
  remoteInput.clear();remoteInput2.clear();netplay?.barrier();
  gamepad.clear();touchDpad.clear();input.clear();
  const captured=Array.from(pointers);pointers.clear();
  for(const [id,b] of captured){try{if(b.hasPointerCapture(id))b.releasePointerCapture(id);}catch{}}
}
function advanceEpoch(){if(epoch>=Number.MAX_SAFE_INTEGER)throw Error('Session identity exhausted; reload page');epoch++;stream.reset(-1);}
function fail(e){
  cancelCheckpoint("Game stopped");
  netplay?.end("Host runtime stopped; sharing ended.");
  running=false;ready=false;loading=false;stream.reset(-1);clearInputs();rebase();
  clearTimeout(timer);timer=null;pending=null;synced=-1;
  worker?.terminate();worker=null;notice='';
  show('Stopped: '+String(e)+'. Reset to retry.');
}
function wire(type,extra={},transfer=[]){
   if(closed||!worker||!ready)return;
   if(seq>=Number.MAX_SAFE_INTEGER)throw Error('Request identity exhausted; reload page');
   worker.postMessage({type,epoch,seq:++seq,...extra},transfer);
 }
 function watchProgress(progress=false){
   if(progress){clearTimeout(timer);timer=null;}
   const outstanding=ready&&running&&!document.hidden&&synced===epoch&&stream.snapshot().credits>0;
   if(!outstanding){if(!pending){clearTimeout(timer);timer=null;}return;}
   if(timer===null){const watchedEpoch=epoch;timer=setTimeout(()=>{
    timer=null;
    if(watchedEpoch===epoch&&ready&&running&&!document.hidden&&synced===epoch&&stream.snapshot().credits>0)fail('Frame worker timed out');
   },120000);}
 }
 function sync(){
   if(!ready||synced===epoch||pending?.epoch===epoch)return;
   clearTimeout(timer);stream.reset(epoch);
   try{wire('sync');pending={type:'sync',epoch,seq};timer=setTimeout(()=>fail('Input release timed out'),120000);}
   catch(e){fail(e.message||e);}
 }
 function pause(reason='Paused'){
  if(closed)return;
  cancelCheckpoint('Save operation interrupted');
  autoRender=false;
  try{advanceEpoch();}catch(e){fail(e.message);return;}
  running=false;clearInputs();rebase();notice='';last=-Infinity;
  if(ready){show(reason);sync();}else controls();
}
function sound(samples,at){
  if(!audioClockActive||!ac||ac.state!=='running'||!samples.length)return;
  const n=samples.length/2,b=ac.createBuffer(2,n,48000);
  for(let ch=0;ch<2;ch++){const a=b.getChannelData(ch);for(let i=0;i<n;i++)a[i]=samples[2*i+ch];}
  const source=ac.createBufferSource();source.buffer=b;source.connect(master);sources.add(source);
  if(fadeIn){master.gain.setValueAtTime(0,at);master.gain.linearRampToValueAtTime(1,at+.005);fadeIn=false;}
  source.onended=()=>{sources.delete(source);source.disconnect();};
  source.start(at);audioNext=at+n/48000;
}
function start(withAudio=true){
  if(closed)return;
  if(!ready||document.hidden||checkpointRequest)return;
  if(!running){running=true;last=-Infinity;notice='';rebase();show('Starting…');sync();pump();}
  if(!withAudio||!running)return;
  audioUnlocked=true;
  // Audio permission never delays input or determines engine running state.
  const g=epoch,w=worker;
  const audioError=()=>{if(g===epoch&&w===worker&&running){notice='Audio unavailable';if(!status.textContent.includes(notice))status.textContent+=' · '+notice;}};
  try{const A=window.AudioContext||window.webkitAudioContext;if(A){if(!ac){ac=new A({sampleRate:48000});master=ac.createGain();master.connect(ac.destination);netplay?.audio();ac.onstatechange=syncAudioClock;}Promise.resolve(ac.resume()).then(()=>{if(g===epoch&&w===worker)syncAudioClock();}).catch(audioError);}}
  catch{audioError();}
}
function receive(w,d){
  if(w!==worker)return;
  if(loading){
    if(d?.type==='error'){fail((d.code||'INIT')+': '+d.message);return;}
    if(d?.type!=='ready'){fail('Invalid initialization response');return;}
    clearTimeout(timer);timer=null;loading=false;ready=true;
    if(autoRender&&!document.hidden)start(false);else show('Paused. Use Engine resume or Game Start.');
    autoRender=false;sync();return;
  }
  if(!d||d.epoch!==epoch)return;
   if(d.type==='checkpoint'||d.type==='checkpoint-error'){
    const r=checkpointRequest;if(!r||r.epoch!==epoch||r.seq!==d.seq)return;
    checkpointRequest=null;clearTimeout(r.timer);
    if(d.type==='checkpoint-error'){r.reject(Error(d.message||'Save operation failed'));return;}
    lastCycles=null;rebase();if(d.rgba instanceof Uint8ClampedArray&&d.rgba.length===256*240*4)ctx.putImageData(new ImageData(d.rgba,256,240),0,0);show('Paused. Use Resume to continue.');r.resolve(d.record);return;
   }
   if(d.type==='error'){fail((d.code||'RUNTIME')+': '+d.message);return;}
   if(d.type==='synced'){
    if(!pending||d.seq!==pending.seq)return;
    pending=null;clearTimeout(timer);timer=null;synced=epoch;pump();return;
   }
   if(!running||synced!==epoch)return;
   try{if(stream.accept(d)){enqueue(d);watchProgress(true);}pump();}catch(e){fail(e.message||e);}
 }
 
function reset(){
  if(closed)return;
  cancelCheckpoint("Game reset");
  netplay?.end("Host reset; sharing ended.");
  try{advanceEpoch();}catch(e){fail(e.message);return;}
  running=false;ready=false;loading=true;autoRender=true;audioUnlocked=false;audioClockActive=false;bufferTarget=BUFFER_SECONDS;clearInputs();lastCycles=null;presented=0;fps=0;speed=0;rebase();notice='';
  clearTimeout(timer);timer=null;pending=null;synced=-1;last=-Infinity;
  worker?.terminate();worker=null;ctx.clearRect(0,0,256,240);show('Loading translated game… First load may take a minute. Reset is available while loading.');
  try{
    const w=worker=new WorkerClass(workerURL,{type:'module'});
    w.onerror=e=>{if(w===worker)fail(e.message||'Worker failed');};
    w.onmessageerror=()=>{if(w===worker)fail('Unreadable worker message');};
    w.onmessage=({data:d})=>receive(w,d);
  }catch(e){fail(e.message||e);}
}
function down(source,b,repeat=false){
  if(closed)return false;
  if(repeat||input.held.has(source)||!ready||document.hidden)return false;
  if(b===3)start();
  if(!running){show('Paused. Use Engine resume or Game Start.');return false;}
  try{const added=input.press(source,b);controls();return added;}
  catch(e){fail(e.message);return false;}
}
function up(source){try{input.release(source);controls();}catch(e){fail(e.message);}}
function tick(timestamp){
  if(closed)return;
  runtimeFrame=requestAnimationFrame(tick);
  gamepad.poll(ready&&!document.hidden&&document.hasFocus());
  if(!ready||!running||document.hidden)return;
  const now=presentationClock(timestamp);let frame;
  // A small phase deadband prevents a timestamp/sample rounding wobble from
  // skipping one frame and then holding its successor at the next refresh.
  if(videoQueue.length&&videoQueue[0].at<=now+.002)frame=videoQueue.shift();
  while(videoQueue.length&&videoQueue[0].at<=now-.002){recycle(frame);frame=videoQueue.shift();}
  if(frame){
    ctx.putImageData(new ImageData(frame.rgba,256,240),0,0);presented++;
    recycle(frame);
    if(timestamp-statusAt>=250){statusAt=timestamp;status.textContent='Running · '+fps.toFixed(1)+' FPS · '+Math.round(speed*100)+'% speed · frame '+frame.frames+(notice?' · '+notice:'');}
  }
  pump();
}

let disposed=null;
function dispose(){
 if(disposed)return disposed;cancelCheckpoint('Game unloaded');closed=true;running=false;ready=false;loading=false;autoRender=false;
 const failures=[],tryIt=fn=>{try{fn();}catch(e){failures.push(e);}};
 tryIt(clearInputs);clearTimeout(timer);clearTimeout(pumpTimer);timer=pumpTimer=null;cancelAnimationFrame(runtimeFrame);
 const oldWorker=worker;worker=null;tryIt(()=>{if(oldWorker){oldWorker.onmessage=oldWorker.onerror=oldWorker.onmessageerror=null;oldWorker.terminate();}});
 const oldSources=[...sources];tryIt(silence);for(const source of oldSources)tryIt(()=>{source.onended=null;source.disconnect();});sources.clear();videoQueue=[];freeVideo.length=0;pending=null;synced=-1;
 const oldAudio=ac;ac=null;audioUnlocked=false;audioClockActive=false;tryIt(()=>{if(oldAudio)oldAudio.onstatechange=null;master?.disconnect();});master=null;
 disposed=Promise.resolve().then(async()=>{if(oldAudio&&oldAudio.state!=='closed')await oldAudio.close();if(failures.length)throw failures[0];});return disposed;
}
function checkpoint(type,record){
 if(closed||!ready||checkpointRequest)return Promise.reject(Error('Game is not ready for a save operation'));
 pause('Saving / loading…');
 return new Promise((resolve,reject)=>{
  checkpointRequest={epoch,seq:seq+1,resolve,reject,timer:setTimeout(()=>cancelCheckpoint('Save operation timed out'),120000)};
  try{wire(type,{record});}catch(e){cancelCheckpoint(e.message);}
 });
}
const api=Object.freeze({exportCheckpoint:()=>checkpoint('checkpoint-export'),importCheckpoint:record=>checkpoint('checkpoint-import',record),reset,start,pause,dispose,releaseAll:clearInputs,held:b=>input.hasButton(b),clearRemote:()=>{remoteInput.clear();remoteInput2.clear();},input:(source,b,pressed,seat=1)=>{if(closed)return false;if(source.startsWith('remote:')){const q=seat===2?remoteInput2:remoteInput;if(!pressed){q.release(source);return true;}if(!ready||!running)return false;try{return q.press(source,b);}catch(e){q.clear();fail(e.message);return false;}}if(seat!==1)return false;if(pressed)return down(source,b);up(source);return true;},snapshot:()=>Object.freeze({ready,running,loading,closed,message:status.textContent,bufferTarget,stream:stream.snapshot()}),audio:()=>({context:ac,node:master})});
runtimeFrame=requestAnimationFrame(tick);return api;
}
