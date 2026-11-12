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
const $=id=>document.getElementById(id),canvas=$('screen'),ctx=canvas.getContext('2d'),status=$('status');
const pads=Array.from(document.querySelectorAll('[data-button]'));
const input=new SampledInput(),pointers=new Map(),sources=new Set();
let worker=null,ready=false,loading=false,running=false,pending=null,timer=null;
let epoch=0,seq=0,synced=-1,last=-Infinity,ac=null,audioNext=0,notice='';
function controls(){
  $('start').disabled=!ready||running||document.hidden;
  $('pause').disabled=!ready||!running;
  for(const b of pads){const n=Number(b.dataset.button);b.disabled=!ready||document.hidden||(!running&&n!==3);b.setAttribute('aria-pressed',String(input.hasButton(n)));}
}
function show(text){status.textContent=text+(notice?' · '+notice:'');controls();}
function silence(){for(const s of sources){try{s.stop();s.disconnect();}catch{}}sources.clear();audioNext=0;}
function clearInputs(){
  input.clear();
  const captured=Array.from(pointers);pointers.clear();
  for(const [id,b] of captured){try{if(b.hasPointerCapture(id))b.releasePointerCapture(id);}catch{}}
}
function advanceEpoch(){if(epoch>=Number.MAX_SAFE_INTEGER)throw Error('Session identity exhausted; reload page');epoch++;}
function fail(e){
  running=false;ready=false;loading=false;clearInputs();silence();
  clearTimeout(timer);timer=null;pending=null;synced=-1;
  worker?.terminate();worker=null;notice='';
  show('Stopped: '+String(e)+'. Reset to retry.');
}
function send(type,extra={}){
  if(pending||!worker||!ready)return;
  if(seq>=Number.MAX_SAFE_INTEGER){fail('Request identity exhausted; reload page');return;}
  const message={type,epoch,seq:++seq,...extra};pending={type,epoch,seq:message.seq};
  timer=setTimeout(()=>fail(type==='frame'?'Frame worker timed out':'Input release timed out'),1500);
  try{worker.postMessage(message);}catch(e){fail(e.message||e);}
}
function sync(){if(ready&&!pending&&synced!==epoch)send('sync');}
function pause(reason='Paused'){
  try{advanceEpoch();}catch(e){fail(e.message);return;}
  running=false;clearInputs();silence();notice='';last=-Infinity;
  if(ready){show(reason);sync();}else controls();
}
function sound(samples){
  if(!ac||ac.state!=='running'||!samples.length||audioNext>ac.currentTime+.15)return;
  const n=samples.length/2,b=ac.createBuffer(2,n,48000);
  for(let ch=0;ch<2;ch++){const a=b.getChannelData(ch);for(let i=0;i<n;i++)a[i]=samples[2*i+ch];}
  const s=ac.createBufferSource();s.buffer=b;s.connect(ac.destination);sources.add(s);
  s.onended=()=>{sources.delete(s);s.disconnect();};
  audioNext=Math.max(audioNext,ac.currentTime+.02);s.start(audioNext);audioNext+=n/48000;
}
function start(){
  if(!ready||running||document.hidden)return;
  running=true;last=-Infinity;notice='';show('Starting…');sync();
  // Audio permission never delays input or determines engine running state.
  const g=epoch,w=worker;
  const audioError=()=>{if(g===epoch&&w===worker&&running){notice='Audio unavailable';if(!status.textContent.includes(notice))status.textContent+=' · '+notice;}};
  try{const A=window.AudioContext||window.webkitAudioContext;if(A){ac??=new A({sampleRate:48000});Promise.resolve(ac.resume()).catch(audioError);}}
  catch{audioError();}
}
function receive(w,d){
  if(w!==worker)return;
  if(loading){
    if(d?.type==='error'){fail((d.code||'INIT')+': '+d.message);return;}
    if(d?.type!=='ready'){fail('Invalid initialization response');return;}
    clearTimeout(timer);timer=null;loading=false;ready=true;show('Ready. Use Engine start or Game Start.');sync();return;
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
      if(!(d.rgba instanceof Uint8ClampedArray)||d.rgba.length!==256*240*4||!(d.audio instanceof Float32Array)||d.audio.length%2||d.audio.length>96000||!Number.isSafeInteger(d.frames)||d.frames<0){fail('Malformed frame payload');return;}
      try{ctx.putImageData(new ImageData(d.rgba,256,240),0,0);sound(d.audio);show('Running · frame '+d.frames);}
      catch(e){fail(e.message||e);return;}
    }
  }
  sync();
}
function reset(){
  try{advanceEpoch();}catch(e){fail(e.message);return;}
  running=false;ready=false;loading=true;clearInputs();silence();notice='';
  clearTimeout(timer);timer=null;pending=null;synced=-1;last=-Infinity;
  worker?.terminate();worker=null;ctx.clearRect(0,0,256,240);show('Loading translated game…');
  try{
    const w=worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
    timer=setTimeout(()=>{if(w===worker)fail('Initialization timed out');},5000);
    w.onerror=e=>{if(w===worker)fail(e.message||'Worker failed');};
    w.onmessageerror=()=>{if(w===worker)fail('Unreadable worker message');};
    w.onmessage=({data:d})=>receive(w,d);
  }catch(e){fail(e.message||e);}
}
function down(source,b,repeat=false){
  if(repeat||input.held.has(source)||!ready||document.hidden)return false;
  if(b===3)start();
  if(!running){show('Paused. Use Engine resume or Game Start.');return false;}
  try{const added=input.press(source,b);controls();return added;}
  catch(e){fail(e.message);return false;}
}
function up(source){try{input.release(source);controls();}catch(e){fail(e.message);}}
function pointerUp(e){pointers.delete(e.pointerId);up('p:'+e.pointerId);}
$('start').onclick=start;$('pause').onclick=()=>pause();$('reset').onclick=reset;
const keys={KeyZ:0,KeyX:1,ShiftRight:2,ShiftLeft:2,Enter:3,ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7};
for(const event of ['keydown','keyup'])window.addEventListener(event,e=>{
  if(!Object.prototype.hasOwnProperty.call(keys,e.code))return;
  e.preventDefault();
  if(event==='keyup'){up('k:'+e.code);return;}
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
  down('k:'+e.code,keys[e.code],e.repeat);
});
for(const b of pads){
  b.onpointerdown=e=>{
    if(e.button!==0)return;e.preventDefault();
    if(!down('p:'+e.pointerId,Number(b.dataset.button)))return;
    pointers.set(e.pointerId,b);
    try{b.setPointerCapture(e.pointerId);}catch{pointerUp(e);}
  };
  b.onpointerup=b.onpointercancel=b.onlostpointercapture=pointerUp;
  // Keyboard/assistive activation is a tap. Ignore pointer-generated clicks.
  b.onclick=e=>{if(e.detail!==0||e.pointerType)return;const s='activation:'+b.dataset.button;if(down(s,Number(b.dataset.button)))up(s);};
}
window.addEventListener('pointerup',pointerUp);window.addEventListener('pointercancel',pointerUp);
window.addEventListener('blur',()=>pause('Paused after focus loss.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('Paused while hidden.');else controls();});
function tick(t){
  requestAnimationFrame(tick);
  if(ready&&running&&!document.hidden&&!pending&&synced===epoch&&t-last>=1000/60){last=t;send('frame',{buttons:input.sample()});}
}
requestAnimationFrame(tick);reset();
