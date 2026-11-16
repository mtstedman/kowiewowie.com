// NES-specific mappings remain outside the platform-neutral host.
// Private DOM IDs use nes-; the single active mount never shares host control IDs.
const buttons=['a','b','select','start','up','down','left','right'];
const keys={KeyZ:0,KeyX:1,ShiftRight:2,ShiftLeft:2,Enter:3,ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7};
// Compatibility metadata only. The host never navigates to this href.
export function legacy(pkg,href){const u=new URL(href||location.href,location.origin);let saved=null;try{saved=JSON.parse(sessionStorage.getItem('romjs-netplay-guest:'+pkg.route)||'null');}catch{}if(u.hash.startsWith('#netplay=')||(u.searchParams.get('solo')!=='1'&&saved?.room))return {href:pkg.route+'legacy.html'+u.search+u.hash,message:'A shared game link is waiting for sharing support. You can also play solo here.'};return null;}
export function createNESAdapter(ctx,createRuntime,GamepadInput,TouchDPad){
 const p=ctx.package;let runtime=null,root=null,pad=null,gamepad=null,raf=0,closed=false,disposal=null,meter=null,controls=[];const abort=new AbortController(),pointers=new Map();
 const listen=(target,type,fn)=>target.addEventListener(type,fn,{signal:abort.signal});
 const press=(source,n,repeat=false)=>!repeat&&!closed&&ctx.input({control:buttons[n],source,pressed:true});
 const release=source=>{for(const control of buttons)ctx.input({control,source,pressed:false});};
 const releaseAll=()=>{gamepad?.clear();pad?.clear();for(const [id,node] of pointers){try{if(node.hasPointerCapture(id))node.releasePointerCapture(id);}catch{}}pointers.clear();runtime?.releaseAll();};
 function frame(){
  if(closed)return;raf=requestAnimationFrame(frame);
  const state=runtime.snapshot(),rate=/([0-9]+(?:\.[0-9]+)?) FPS\b/.exec(state.message||'');
  const hidden=!state.running||!rate,text=rate?rate[1]+' FPS':'';
  if(meter.hidden!==hidden)meter.hidden=hidden;if(meter.textContent!==text)meter.textContent=text;
  const enabled=ctx.canControl()&&state.ready&&!document.hidden&&document.hasFocus();
  gamepad.poll(enabled);pad.render(enabled&&state.running,n=>runtime.held(n));
  for(const [b,n] of controls){const disabled=!enabled||(!state.running&&n!==3),held=String(runtime.held(n));if(b.disabled!==disabled)b.disabled=disabled;if(b.getAttribute('aria-pressed')!==held)b.setAttribute('aria-pressed',held);}
 }
 function dispose(){if(disposal)return disposal;closed=true;let finish,fail;disposal=new Promise((a,b)=>{finish=a;fail=b;});const errors=[];for(const fn of [()=>abort.abort(),()=>cancelAnimationFrame(raf),releaseAll,()=>root?.remove()])try{fn();}catch(e){errors.push(e);}Promise.resolve().then(()=>runtime?.dispose()).then(()=>{if(errors.length)fail(errors[0]);else finish();},fail);return disposal;}
 ctx.scope.defer(dispose);
 return {version:1,packageId:p.id,artifactDigest:p.artifactDigest,
  load(){if(ctx.signal.aborted||closed)throw Error('Cancelled');root=document.createElement('div');root.className='nes-view';root.tabIndex=0;root.setAttribute('role','region');root.setAttribute('aria-label',p.title+' game screen and controls');
   root.innerHTML='<div class="video-frame"><canvas id="nes-screen" width="256" height="240" aria-label="Game video"></canvas><output id="nes-fps" class="nes-fps" aria-label="Presented frames per second" aria-live="off" hidden></output></div><div hidden><button id="nes-start"></button><button id="nes-pause"></button><button id="nes-reset"></button><select id="nes-scale"><option value="2">2</option></select><p id="nes-status"></p></div><div id="nes-touch-overlay" class="touch-overlay" role="group" aria-label="Touch controller"><div id="nes-touch-dpad" class="touch-dpad" data-enabled="false" role="group" aria-label="Slide for directions and diagonals"><button class="dpad-up" data-direction="4" aria-label="Up" disabled>▲</button><button class="dpad-left" data-direction="6" aria-label="Left" disabled>◀</button><span class="dpad-center" aria-hidden="true"></span><button class="dpad-right" data-direction="7" aria-label="Right" disabled>▶</button><button class="dpad-down" data-direction="5" aria-label="Down" disabled>▼</button></div><div class="touch-menu"><button data-button="2" disabled>Select</button><button data-button="3" disabled>Start</button></div><div class="touch-actions"><button data-button="1" aria-label="B action" disabled>B</button><button data-button="0" aria-label="A action" disabled>A</button></div></div><p id="nes-controller-status" class="quiet"></p>';
   meter=root.querySelector('#nes-fps');controls=Array.from(root.querySelectorAll('[data-button]'),b=>[b,Number(b.dataset.button)]);
   ctx.view.append(root);runtime=createRuntime({root,onState:ctx.changed});pad=new TouchDPad(root.querySelector('#nes-touch-dpad'),{press,release});gamepad=new GamepadInput({press,release,status:text=>{root.querySelector('#nes-controller-status').textContent=text;}});
   listen(window,'keydown',e=>{if(!Object.hasOwn(keys,e.code)||!root.contains(document.activeElement)||e.target?.closest?.('button,input,select,textarea,a,summary,[contenteditable]')||e.isComposing||e.ctrlKey||e.altKey||e.metaKey)return;e.preventDefault();press('k:'+e.code,keys[e.code],e.repeat);});
   listen(window,'keyup',e=>{if(Object.hasOwn(keys,e.code))release('k:'+e.code);});
   for(const b of root.querySelectorAll('[data-button]')){listen(b,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const source='p:'+e.pointerId;if(press(source,Number(b.dataset.button))){pointers.set(e.pointerId,b);try{b.setPointerCapture(e.pointerId);}catch{release(source);}}});for(const event of ['pointerup','pointercancel','lostpointercapture'])listen(b,event,e=>{pointers.delete(e.pointerId);release('p:'+e.pointerId);});listen(b,'click',e=>{if(e.detail===0&&!e.pointerType){const source='activation:'+b.dataset.button;if(press(source,Number(b.dataset.button)))release(source);}});}
   listen(root,'contextmenu',e=>{if(e.target.closest('.touch-overlay'))e.preventDefault();});runtime.reset();raf=requestAnimationFrame(frame);
  },
  start(){runtime.start();if(runtime.input('host-start',3,true))runtime.input('host-start',3,false);root.focus({preventScroll:true});},
  resume(){runtime.start();root.focus({preventScroll:true});},pause(){releaseAll();runtime.pause();},reset(){releaseAll();runtime.reset();},dispose,
  input(e){const n=buttons.indexOf(e.control),allowed=e.seat===1||(e.seat===2&&p.capabilities.nativePlayers===2&&p.capabilities.play==='host-p1-guest-p2');if(closed||n<0||!allowed)return false;return runtime.input(e.source,n,e.pressed,e.seat);},releaseSources(){runtime?.clearRemote();},releaseAll,
  snapshot(){return runtime?runtime.snapshot():{ready:false,running:false,loading:true,closed};},
  surfaces(){return {view:root,video:root.querySelector('canvas'),audio:{kind:'web-audio',getNodes:()=>runtime.audio()}};}
 };
}
