// Authenticated UI lifecycle derivation; emulation and media pacing are unchanged.
export function createRuntime({root,onState=()=>{},WorkerClass=Worker}){
let closed=false,runtimeFrame=0;
// Aggregate controller edges each occupy a frame. Sources overlap by OR.
// Repeats and duplicate releases are idempotent. Overflow stops explicitly.
class SampledInput {
  constructor(){this.held=new Map();this.queues=Array.from({length:8},()=>[]);this.values=Array(8).fill(false);}
  hasButton(b){for(const v of this.held.values())if(v===b)return true;return false;}
  edge(b,value){if(this.queues[b].length>=32)throw Error('Input buffer full. Inputs cleared; use Reset and tap more slowly');this.queues[b].push(value);}
  press(source,b,repeat=false){
    if(repeat||this.held.has(source))return false;
    if(!Number.isInteger(b)||b<0||b>7)throw Error('Invalid controller button');
    if(this.held.size>=32)throw Error('Too many simultaneous controls. Inputs cleared; use Reset');
    if(!this.hasButton(b))this.edge(b,true);
    this.held.set(source,b);return true;
  }
  release(source){
    if(!this.held.has(source))return;
    const b=this.held.get(source);this.held.delete(source);
    if(!this.hasButton(b))this.edge(b,false);
  }
  sample(){return this.values.map((v,b)=>this.values[b]=this.queues[b].length?this.queues[b].shift():v);}
  clear(){this.held.clear();for(const q of this.queues)q.length=0;this.values.fill(false);}
}
const $=id=>root.querySelector('#nes-'+id),canvas=$('screen'),ctx=canvas.getContext('2d'),status=$('status');
const pads=[];
const input=new SampledInput(),remoteInput=new SampledInput(),remoteInput2=new SampledInput(),pointers=new Map(),sources=new Set();
let netplay=null;
function sampledButtons(){const local=input.sample(),remote=remoteInput.sample();return {buttons:local.map((value,b)=>value||remote[b]),buttons2:remoteInput2.sample()};}
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
const clock=()=>audioClockActive?ac.currentTime:performance.now()/1000;
function recycle(frame){if(frame?.rgba.buffer.byteLength===256*240*4&&freeVideo.length<20)freeVideo.push(frame.rgba.buffer);}
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
  silence();for(const frame of videoQueue)recycle(frame);videoQueue=[];mediaNext=clock()+bufferTarget;renderOffset=null;renderWall=null;
  measuredAt=performance.now();measuredCycles=lastCycles??0;measuredFrames=presented;
  clearTimeout(pumpTimer);pumpTimer=null;
}
function pump(){
  clearTimeout(pumpTimer);pumpTimer=null;
  if(!ready||!running||document.hidden||pending||synced!==epoch)return;
  const ahead=mediaNext-clock();
  if(ahead<=bufferTarget){const rgbaBuffer=freeVideo.pop();send('frame',{...sampledButtons(),rgbaBuffer},rgbaBuffer?[rgbaBuffer]:[]);}
  else pumpTimer=setTimeout(pump,Math.max(1,(ahead-bufferTarget)*1000));
}
function enqueue(d){
  const now=clock(),duration=d.audio.length?d.audio.length/2/48000:
    lastCycles===null?1/60.0988:(d.cycles-lastCycles)/CPU_HZ;
  // Rebase after a real underrun, never stretch samples or accumulate stale work.
  if(mediaNext<now+.003){bufferTarget=Math.min(.2,bufferTarget+.02);mediaNext=now+.012;fadeIn=true;}
  sound(d.audio,mediaNext);
  videoQueue.push({at:mediaNext,rgba:d.rgba,audio:d.audio,frames:d.frames});
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
function advanceEpoch(){if(epoch>=Number.MAX_SAFE_INTEGER)throw Error('Session identity exhausted; reload page');epoch++;}
function fail(e){
  netplay?.end("Host runtime stopped; sharing ended.");
  running=false;ready=false;loading=false;clearInputs();rebase();
  clearTimeout(timer);timer=null;pending=null;synced=-1;
  worker?.terminate();worker=null;notice='';
  show('Stopped: '+String(e)+'. Reset to retry.');
}
function send(type,extra={},transfer=[]){
  if(pending||!worker||!ready)return;
  if(seq>=Number.MAX_SAFE_INTEGER){fail('Request identity exhausted; reload page');return;}
  const message={type,epoch,seq:++seq,...extra};pending={type,epoch,seq:message.seq};
  timer=setTimeout(()=>fail(type==='frame'?'Frame worker timed out':'Input release timed out'),120000);
  try{worker.postMessage(message,transfer);}catch(e){fail(e.message||e);}
}
function sync(){if(ready&&!pending&&synced!==epoch)send('sync');}
function pause(reason='Paused'){
  if(closed)return;
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
  if(!ready||document.hidden)return;
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
  // Stale or duplicate replies must not complete a newer pending request.
  if(!pending||!d||d.epoch!==pending.epoch||d.seq!==pending.seq)return;
  const request=pending;pending=null;clearTimeout(timer);timer=null;
  if(d.type==='error'){fail((d.code||'RUNTIME')+': '+d.message);return;}
  if(request.type==='sync'){
    if(d.type!=='synced'){fail('Invalid release response');return;}
    synced=d.epoch;
  }else{
    if(d.type!=='frame'){fail('Invalid frame response');return;}
    if(d.epoch===epoch&&running){
      if(!(d.rgba instanceof Uint8ClampedArray)||d.rgba.length!==256*240*4||!(d.audio instanceof Float32Array)||d.audio.length%2||d.audio.length>96000||!Number.isSafeInteger(d.frames)||d.frames<0||!Number.isSafeInteger(d.cycles)||d.cycles<0){fail('Malformed frame payload');return;}
      try{enqueue(d);}
      catch(e){fail(e.message||e);return;}
    }
  }
  sync();pump();
}
function reset(){
  if(closed)return;
  netplay?.end("Host reset; sharing ended.");
  try{advanceEpoch();}catch(e){fail(e.message);return;}
  running=false;ready=false;loading=true;autoRender=true;audioUnlocked=false;audioClockActive=false;bufferTarget=BUFFER_SECONDS;clearInputs();lastCycles=null;presented=0;fps=0;speed=0;rebase();notice='';
  clearTimeout(timer);timer=null;pending=null;synced=-1;last=-Infinity;
  worker?.terminate();worker=null;ctx.clearRect(0,0,256,240);show('Loading translated game… First load may take a minute. Reset is available while loading.');
  try{
    const w=worker=new WorkerClass(new URL('./worker.mjs',import.meta.url),{type:'module'});
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
 if(disposed)return disposed;closed=true;running=false;ready=false;loading=false;autoRender=false;
 const failures=[],tryIt=fn=>{try{fn();}catch(e){failures.push(e);}};
 tryIt(clearInputs);clearTimeout(timer);clearTimeout(pumpTimer);timer=pumpTimer=null;cancelAnimationFrame(runtimeFrame);
 const oldWorker=worker;worker=null;tryIt(()=>{if(oldWorker){oldWorker.onmessage=oldWorker.onerror=oldWorker.onmessageerror=null;oldWorker.terminate();}});
 const oldSources=[...sources];tryIt(silence);for(const source of oldSources)tryIt(()=>{source.onended=null;source.disconnect();});sources.clear();videoQueue=[];freeVideo.length=0;pending=null;synced=-1;
 const oldAudio=ac;ac=null;audioUnlocked=false;audioClockActive=false;tryIt(()=>{if(oldAudio)oldAudio.onstatechange=null;master?.disconnect();});master=null;
 disposed=Promise.resolve().then(async()=>{if(oldAudio&&oldAudio.state!=='closed')await oldAudio.close();if(failures.length)throw failures[0];});return disposed;
}
const api=Object.freeze({reset,start,pause,dispose,releaseAll:clearInputs,held:b=>input.hasButton(b),clearRemote:()=>{remoteInput.clear();remoteInput2.clear();},input:(source,b,pressed,seat=1)=>{if(closed)return false;if(source.startsWith('remote:')){const q=seat===2?remoteInput2:remoteInput;if(!pressed){q.release(source);return true;}if(!ready||!running)return false;try{return q.press(source,b);}catch(e){q.clear();fail(e.message);return false;}}if(seat!==1)return false;if(pressed)return down(source,b);up(source);return true;},snapshot:()=>Object.freeze({ready,running,loading,closed,message:status.textContent}),audio:()=>({context:ac,node:master})});
runtimeFrame=requestAnimationFrame(tick);return api;
}
