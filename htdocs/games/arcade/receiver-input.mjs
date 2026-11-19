import {receiverModule as streamModule} from './session-bridge.mjs';
// This controller speaks descriptor IDs and AdapterContext.input only.
// It owns no game runtime, worker, transport, player seat or wire generation.
const KEYS=Object.freeze({KeyZ:'a',KeyX:'b',ShiftLeft:'select',ShiftRight:'select',Enter:'start',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'});
const DIRECTIONS=['up','down','left','right'];
const interactive=n=>Boolean(n?.closest?.('button,input,select,textarea,a,summary,[contenteditable]'));

export function receiverModule(options={}){
 const base=streamModule();
 return {version:1,createAdapter(ctx){
  const adapter=base.createAdapter(ctx);let controller=null;
  const cleanup=()=>{controller?.dispose();controller=null;};ctx.scope.defer(cleanup);
  return {...adapter,
   async load(){await adapter.load();if(ctx.signal.aborted)throw Error('Receiver selection ended');controller=mountReceiverInputs(ctx,options);},
   pause(){controller?.cancel();return adapter.pause();},
   releaseAll(reason){controller?.cancel();return adapter.releaseAll(reason);},
   dispose(reason){cleanup();return adapter.dispose(reason);}
  };
 }};
}

export function mountReceiverInputs(ctx,{getState=()=>null,stream=()=>null}={}){
 const doc=ctx.controls.ownerDocument,win=doc.defaultView;
 const declared=new Map(ctx.package.inputs.filter(i=>i.kind==='button').map(i=>[i.id,i]));
 const extended=['x','y','l','r'].every(id=>declared.has(id));
 const keys=extended?{...KEYS,KeyZ:'b',KeyX:'a',KeyA:'y',KeyS:'x',KeyQ:'l',KeyW:'r'}:KEYS;
 const root=doc.createElement('section'),help=doc.createElement('p'),pad=doc.createElement('div'),directions=doc.createElement('div'),actions=doc.createElement('div'),status=doc.createElement('p');
 root.id='receiver-controls';root.className='receiver-controls';root.tabIndex=0;root.hidden=true;root.setAttribute('role','region');root.setAttribute('aria-label','Shared game controls');
 help.id='receiver-input-help';help.className='quiet';root.setAttribute('aria-describedby',help.id);
 const descriptions=[];
 for(const [id,key] of [['up','Up arrow'],['down','Down arrow'],['left','Left arrow'],['right','Right arrow'],['a',extended?'X':'Z'],['b',extended?'Z':'X'],['x','S'],['y','A'],['l','Q'],['r','W'],['select','Shift'],['start','Enter']])if(declared.has(id))descriptions.push(declared.get(id).label+': '+key);
 help.textContent='Focus the shared screen or this controller for keyboard and gamepad input. '+descriptions.join(' · ')+'. Touch buttons can be held together. After switching away, release controls before pressing again.';
 pad.className='receiver-pad touch-overlay';pad.setAttribute('role','group');pad.setAttribute('aria-label','Shared game touch controls');
 directions.className='touch-dpad';actions.className='receiver-actions';pad.append(directions,actions);
 status.className='quiet';root.append(help,pad,status);ctx.controls.append(root);
 const buttons=new Map(),physical=new Map(),events=new AbortController();
 let closed=false,raf=0,screen=null,screenAttrs=null,last=null,padIdentity=null,padIndex=null,padBlocked=true;
 const stick=[false,false,false,false];
 const readState=()=>{try{return getState();}catch{return null;}};
 const guest=()=>readState()?.role==='guest';
 const available=s=>!closed&&!ctx.signal.aborted&&s?.role==='guest'&&s.phase==='active'&&ctx.canControl();
 const inside=n=>Boolean(n&&(root.contains(n)||(screen?.isConnected&&!screen.hidden&&screen.contains(n))));
 const focused=()=>!doc.hidden&&doc.hasFocus()&&inside(doc.activeElement);
 const usable=()=>available(readState())&&focused();
 const listen=(target,type,fn)=>target.addEventListener(type,fn,{signal:events.signal});
 function sendUp(source,item){if(item.accepted&&!closed&&!ctx.signal.aborted&&guest())ctx.input({control:item.control,source,pressed:false});}
 function up(source){const item=physical.get(source);if(!item)return;physical.delete(source);sendUp(source,item);}
 function down(source,control,kind){
  if(physical.has(source)||physical.size>=32||!declared.has(control)||!usable())return false;
  const item={control,kind,accepted:false,cancelled:false};physical.set(source,item);
  item.accepted=ctx.input({control,source,pressed:true})===true;return item.accepted;
 }
 function cancel(send=false){
  padBlocked=true;
  for(const [source,item] of physical){if(!item.cancelled&&send)sendUp(source,item);item.cancelled=true;}
  render();
 }
 function focusScreen(e){if(!interactive(e.target))screen?.focus({preventScroll:true});}
 function restoreScreen(){
  if(!screen)return;screen.removeEventListener('pointerdown',focusScreen);
  for(const [name,value] of screenAttrs){if(value===null)screen.removeAttribute(name);else screen.setAttribute(name,value);}
  screen=null;screenAttrs=null;
 }
 function sync(){
  const s=readState(),next=stream();
  if(next!==screen){restoreScreen();if(next){screen=next;screenAttrs=['tabindex','aria-label'].map(k=>[k,screen.getAttribute(k)]);screen.setAttribute('tabindex','0');screen.setAttribute('aria-label','Shared game screen');listen(screen,'pointerdown',focusScreen);}}
  if(last&&(s?.role!==last.role||s?.phase!==last.phase||s?.epoch!==last.epoch))cancel();
  last=s?{role:s.role,phase:s.phase,epoch:s.epoch}:null;return s;
 }
 function render(){
  const s=readState(),ready=available(s);root.hidden=s?.role!=='guest';
  for(const [id,b] of buttons){b.disabled=!ready;b.setAttribute('aria-pressed',String(ready&&[...physical.values()].some(v=>v.control===id&&v.accepted&&!v.cancelled)));}
 }
 function clearPad(){for(const [source,item] of [...physical])if(item.kind==='gamepad')up(source);padIdentity=null;padIndex=null;padBlocked=true;stick.fill(false);}
 function poll(s){
  if(s?.role!=='guest'){clearPad();return;}
  let devices;
  try{devices=Array.from(win.navigator.getGamepads?.()||[]).slice(0,8).filter(p=>p?.connected);}
  catch{clearPad();status.textContent='Controller access unavailable. Keyboard and touch controls are available.';return;}
  const pads=devices.filter(p=>p.mapping==='standard'&&Number.isInteger(p.index)&&p.index>=0);
  const p=pads.find(p=>p.index===padIndex)||pads[0];
  if(!p){clearPad();status.textContent=devices.length?'Controller has no standard mapping. Use standard/XInput mode, keyboard or touch.':'Connect a standard controller and press a button to detect it.';return;}
  const identity=p.index+':'+p.id;
  if(identity!==padIdentity){clearPad();padIdentity=identity;padIndex=p.index;}
  status.textContent=extended?'Standard controller connected. Bottom/right/left/top face: B/A/Y/X; shoulders: L/R; View: Select; Menu: Start.':'Standard controller connected. D-pad / left stick: directions; bottom face: A; right or left face: B; View: Select; Menu: Start. Only this package’s declared controls are enabled.';
  const button=n=>Boolean(p.buttons?.[n]?.pressed||p.buttons?.[n]?.value>.5);
  const x=Number.isFinite(p.axes?.[0])?p.axes[0]:0,y=Number.isFinite(p.axes?.[1])?p.axes[1]:0;
  [-y,y,-x,x].forEach((value,i)=>{stick[i]=value>(stick[i]?.30:.45);});
  const values={...(extended?{a:button(1),b:button(0),x:button(3),y:button(2),l:button(4),r:button(5)}:{a:button(0),b:button(1)||button(2)}),select:button(8),start:button(9),up:button(12)||stick[0],down:button(13)||stick[1],left:button(14)||stick[2],right:button(15)||stick[3]};
  const held=Object.keys(values).filter(id=>declared.has(id)&&values[id]);
  for(const [source,item] of [...physical])if(item.kind==='gamepad'&&!held.includes(item.control))up(source);
  if(!usable()){cancel(true);return;}
  if(padBlocked){if(!held.length)padBlocked=false;return;}
  for(const id of held)down('receiver:g:'+p.index+':'+id,id,'gamepad');
 }
 function frame(){if(closed)return;const s=sync();if(!focused())cancel(true);poll(s);render();raf=win.requestAnimationFrame(frame);}
 function dispose(){
  if(closed)return;cancel(true);closed=true;events.abort();win.cancelAnimationFrame(raf);
  for(const item of physical.values())if(item.node&&item.pointer!==undefined)try{if(item.node.hasPointerCapture(item.pointer))item.node.releasePointerCapture(item.pointer);}catch{}
  physical.clear();restoreScreen();root.remove();
 }
 ctx.scope.defer(dispose);
 for(const [id,i] of declared){
  const b=doc.createElement('button');b.type='button';b.textContent=i.label;b.dataset.receiverControl=id;b.setAttribute('aria-label',i.label+' shared game control');b.disabled=true;
  if(DIRECTIONS.includes(id)){b.className='dpad-'+id;directions.append(b);}else actions.append(b);buttons.set(id,b);
  listen(b,'pointerdown',e=>{
   sync();if(e.button!==0||!available(readState())||doc.hidden||!doc.hasFocus())return;
   e.preventDefault();root.focus({preventScroll:true});const source='receiver:p:'+e.pointerId;
   if(down(source,id,'pointer')){const item=physical.get(source);item.node=b;item.pointer=e.pointerId;try{b.setPointerCapture(e.pointerId);}catch{up(source);}}
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(b,type,e=>up('receiver:p:'+e.pointerId));
  listen(b,'click',e=>{if(e.detail===0&&!e.pointerType){sync();const source='receiver:activation:'+id;if(down(source,id,'activation'))up(source);else physical.delete(source);}});
 }
 listen(win,'keydown',e=>{
  if(!Object.hasOwn(keys,e.code)||!declared.has(keys[e.code])||e.isComposing||e.ctrlKey||e.altKey||e.metaKey||interactive(e.target))return;
  if(!focused())return;e.preventDefault();sync();if(!usable()||e.repeat)return;down('receiver:k:'+e.code,keys[e.code],'keyboard');
 });
 listen(win,'keyup',e=>{if(Object.hasOwn(keys,e.code))up('receiver:k:'+e.code);});
 listen(doc,'focusout',()=>queueMicrotask(()=>{if(!closed&&!focused())cancel(true);}));
 listen(win,'blur',()=>cancel(true));listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel(true);});
 listen(win,'gamepaddisconnected',e=>{if(e.gamepad?.index===padIndex)clearPad();});
 listen(win,'pagehide',dispose);listen(ctx.signal,'abort',dispose);
 listen(pad,'contextmenu',e=>e.preventDefault());
 sync();render();if(ctx.signal.aborted)dispose();else raf=win.requestAnimationFrame(frame);
 return Object.freeze({cancel:()=>cancel(false),dispose});
}
