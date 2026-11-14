import {GamepadInput} from './gamepad.mjs';
import {TouchDPad} from './touch-dpad.mjs';
import {guestSession} from './netplay-client.mjs';
let closed=false,guestFrame=0,guestDisposal=null;
const $=id=>document.getElementById(id),canvas=$('screen'),ctx=canvas.getContext('2d');
const held=new Map(),blocked=new Set();let allowed=false,session=null;
const state=()=>Array.from({length:8},(_,b)=>Array.from(held.values()).includes(b));
const usable=()=>!closed&&allowed&&!document.hidden&&document.hasFocus();
function render(){const values=state();for(const e of document.querySelectorAll('[data-button]')){e.disabled=!usable();e.setAttribute('aria-pressed',String(values[Number(e.dataset.button)]));}touch.render(usable(),b=>values[b]);}
function down(source,b,repeat=false){if(repeat||blocked.has(source)||held.has(source)||!usable())return false;if(held.size>=32){clear();session?.release();return false;}held.set(source,b);session?.changed();render();return true;}
function up(source){blocked.delete(source);if(held.delete(source))session?.changed();render();}
const touch=new TouchDPad($('touch-dpad'),{press:down,release:up});
const gamepad=new GamepadInput({press:down,release:up,status:text=>{$('controller-status').textContent=text;}});
function clear(){for(const source of held.keys())if(source.startsWith('k:'))blocked.add(source);held.clear();gamepad.clear();touch.clear();render();}
const video=document.createElement('video');video.id='netplay-media';video.playsInline=true;video.autoplay=true;video.muted=true;video.setAttribute('aria-hidden','true');document.body.append(video);
ctx.imageSmoothingEnabled=false;
for(const id of ['start','pause','reset'])$(id).disabled=true;
$('status').textContent='Guest stream. Your controls join the host controls.';
let scale='2';try{scale=localStorage.getItem('romjs-pixel-scale')==='4'?'4':'2';}catch{}
function scaling(){const s=$('scale').value==='4'?'4':'2';canvas.dataset.scale=s;try{localStorage.setItem('romjs-pixel-scale',s);}catch{}}
$('scale').value=scale;scaling();$('scale').onchange=scaling;
const query=matchMedia('(any-pointer: coarse)');
function touchMode(){const m=$('touch-mode').value,visible=m==='on'||m==='auto'&&(query.matches||navigator.maxTouchPoints>0);if(!visible){clear();session?.release();}$('touch-overlay').hidden=!visible;document.body.dataset.touch=String(visible);}
$('touch-mode').onchange=touchMode;query.addEventListener('change',touchMode);touchMode();
const keys={KeyZ:0,KeyX:1,ShiftRight:2,ShiftLeft:2,Enter:3,ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7};
for(const event of ['keydown','keyup'])window.addEventListener(event,e=>{if(!Object.hasOwn(keys,e.code))return;if(event==='keyup'){up('k:'+e.code);return;}if(e.target?.closest?.('input,textarea,select,[contenteditable]'))return;e.preventDefault();if(!e.isComposing&&!e.ctrlKey&&!e.altKey&&!e.metaKey)down('k:'+e.code,keys[e.code],e.repeat);});
for(const e of document.querySelectorAll('[data-button]')){
 e.onpointerdown=p=>{if(p.button!==0)return;p.preventDefault();if(down('p:'+p.pointerId,Number(e.dataset.button))){try{e.setPointerCapture(p.pointerId);}catch{up('p:'+p.pointerId);}}};
 e.onpointerup=e.onpointercancel=e.onlostpointercapture=p=>up('p:'+p.pointerId);
 e.onclick=p=>{if(p.detail!==0||p.pointerType)return;const source='activation:'+e.dataset.button;if(down(source,Number(e.dataset.button)))up(source);};
}
for(const event of ['pointerup','pointercancel'])window.addEventListener(event,e=>up('p:'+e.pointerId));
window.addEventListener('focus',render);
function tick(){if(closed)return;guestFrame=requestAnimationFrame(tick);gamepad.poll(usable());if(!document.hidden&&video.readyState>=2){ctx.imageSmoothingEnabled=false;ctx.drawImage(video,0,0,256,240);}}
session=await guestSession({video,state,clear,enabled(value){if(allowed!==value){allowed=value;if(!value)clear();render();}},stopped(){allowed=false;clear();ctx.clearRect(0,0,256,240);}});
render();guestFrame=requestAnimationFrame(tick);

function disposeGuest(){if(guestDisposal)return guestDisposal;closed=true;allowed=false;cancelAnimationFrame(guestFrame);query.removeEventListener('change',touchMode);clear();session?.release();video.pause();for(const track of video.srcObject?.getTracks?.()||[])track.stop();video.srcObject=null;video.remove();guestDisposal=Promise.resolve();return guestDisposal;}
window.wowieLegacyDispose=disposeGuest;window.addEventListener('pagehide',()=>{void disposeGuest();});
