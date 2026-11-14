import {loadCatalog,importAdapter,playDescription,insist} from './package.mjs';
import {GameHost} from './host.mjs';
import {createSharing} from './sharing.mjs';
const sharing=createSharing();
const $=id=>document.getElementById(id);let catalog,host,selected=null,lastPackage=null,navigation=0,pending=false,suspended=false,teardown=Promise.resolve();
const fail=e=>{$('player-state').textContent='This game could not be opened. Try another cartridge.';};
function select(p){selected=p;for(const radio of document.querySelectorAll('input[name="package"]'))radio.checked=radio.value===p.id;$('load').textContent='Load '+p.title;$('selection-state').textContent=p.title+' · '+(p.capabilities.nativePlayers===1?'Solo':p.capabilities.mode);}
function buttonsFor(p){$('input-buttons').replaceChildren();$('input-help').replaceChildren();for(const i of p.inputs){const b=document.createElement('button');b.textContent=i.label;b.dataset.activation=i.activation;b.setAttribute('aria-label',i.label+' game control');const source='help:'+i.id;const send=pressed=>host.input({control:i.id,source,pressed});b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(send(true)){try{b.setPointerCapture(e.pointerId);}catch{send(false);}}});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>send(false));b.addEventListener('click',e=>{if(e.detail===0&&!e.pointerType){send(true);send(false);}});$('input-buttons').append(b);const line=document.createElement('li');line.textContent=i.label+': '+i.hint;$('input-help').append(line);}}
function render(s){
 $('player').dataset.state=s.package||s.loading?'playing':'library';
 const p=s.package,r=s.runtime,session=s.session,media=host?.media();$('surface').hidden=Boolean(media);$('session-surface').hidden=!media;
 if(media){if(media.video.parentNode!==$('session-surface'))$('session-surface').replaceChildren(media.video);if(media.audio!==media.video&&media.audio.parentNode!==$('session-surface'))$('session-surface').append(media.audio);}else $('session-surface').replaceChildren();
 if(p!==lastPackage){lastPackage=p;$('game-title').textContent=p?.title||'Your next adventure';document.title=p?p.title+' · Game arcade':'Game arcade · wowiekowie.com';$('capability').textContent=p?(p.capabilities.nativePlayers===1?'Solo':p.capabilities.mode):'Choose a game';$('play-help').textContent=p?playDescription(p):'';if(p){$('usage').href=p.notes.usage;$('attribution').href=p.notes.attribution;buttonsFor(p);}else{for(const id of ['usage','attribution'])$(id).removeAttribute('href');$('input-buttons').replaceChildren();$('input-help').replaceChildren();}}
 $('idle-screen').hidden=Boolean(p);$('legacy').hidden=!s.legacy;if(s.legacy)$('legacy-copy').textContent=s.legacy.message;
 $('player-state').textContent=s.blocked?'This game could not be closed. Reopen the arcade to continue.':s.loading?'Loading cartridge…':r?.loading?'Loading '+p.title+'…':r?.ready?(r.running?'Now playing · ':'Ready · ')+p.title:s.message==='Choose a game from the shelf.'?'':s.message.startsWith('Game unavailable:')?'This game could not be opened. Try another cartridge.':s.message;
 $('diagnostic').textContent=p?'Start enables game audio. Pause whenever you need a break.':'';$('session-state').textContent=session.message;
 const stream=['guest','spectator'].includes(session.role),ready=Boolean(r?.ready&&!s.loading&&!s.closed&&!s.blocked&&!suspended);
 $('start-game').disabled=stream?!media:!ready||!s.canControl;$('start-game').textContent=stream?'Enable audio':'Start + audio';$('resume').hidden=!ready||r.running||stream;$('resume').disabled=!s.canControl;$('pause').disabled=!ready||!r.running||!s.canControl||stream;$('reset').disabled=!p||s.loading||!s.canControl||stream;
 $('change').disabled=suspended||s.closed||(!p&&!pending&&!s.loading);$('load').disabled=!selected||suspended||s.closed||s.blocked;
 for(const b of $('input-buttons').querySelectorAll('button'))b.disabled=!s.canControl||!ready||(session.role!=='guest'&&!r.running&&b.dataset.activation!=='start');
 const inviting=Boolean(p&&host.active?.provider&&!s.loading&&!s.pending&&!s.closed&&!s.blocked&&!suspended&&['solo','host'].includes(session.role)&&['inactive','active'].includes(session.phase));
 $('invite-watch').disabled=!inviting||session.watch!=='available'||!p?.capabilities.watch;
 $('invite-play').disabled=!inviting||session.play!=='available'||p?.capabilities.play==='none';
 $('watch-help').textContent='Watch live game video and audio.';
 const sharing=Boolean(p&&host.active?.provider);
 $('session-state').hidden=!sharing||!session.message;
 $('invite-watch').hidden=!(sharing&&session.watch==='available'&&p.capabilities.watch);
 $('invite-play').hidden=!(sharing&&session.play==='available'&&p.capabilities.play!=='none');
 $('invite-row').hidden=$('invite-watch').hidden&&$('invite-play').hidden;
 $('watch-help').hidden=$('invite-watch').hidden;$('play-help').hidden=$('invite-play').hidden;
 for(const control of document.querySelectorAll('.load-cartridge,input[name="package"]'))control.disabled=$('load').disabled;
}

async function loadCartridge(p){
 await request(p.id);
 if(!suspended&&!pending&&host.snapshot().package?.id===p.id)$('player').scrollIntoView({block:'start',behavior:'instant'});
}
function expose(){const owner=host,generation=owner.generation;window.wowieGameHost=Object.freeze({version:1,getPackage:()=>owner.snapshot().package,getState:()=>owner.snapshot(),select:id=>request(id),unload:()=>request(null),bindSession:provider=>{insist(owner===host&&owner.generation===generation,'Selection changed; obtain the current host binding');return owner.bindSession(provider);},dispose:reason=>owner.dispose(reason)});}
function makeHost(){host=new GameHost(catalog,{loader:(p,signal,route)=>sharing.load(p,signal,route,importAdapter),view:$('surface'),controls:$('adapter-controls'),changed:render});lastPackage=null;expose();}
function selectionURL(id,href,solo){const u=new URL(href,location.origin);u.pathname='/games/arcade/';u.searchParams.delete('package');u.searchParams.delete('cartridge');if(id)u.searchParams.set('package',id);if(solo){u.hash='';if(id)u.searchParams.set('solo','1');else u.searchParams.delete('solo');}return u.pathname+u.search+u.hash;}
async function request(id,{historyMode='push',solo=true,href=location.href,focus=false}={}){
 if(suspended)return;const p=id===null?null:catalog.get(id),ticket=++navigation;pending=true;if(p)select(p);
 const target=selectionURL(id,href,solo);
 if(historyMode!=='none'){const state={arcade:1,package:id};if(historyMode==='replace')history.replaceState(state,'',target);else if(target!==location.pathname+location.search+location.hash)history.pushState(state,'',target);}
 try{await (p?host.load(p.id,{href:new URL(target,location.origin).href,solo}):host.unload('library'));if(ticket!==navigation||suspended)return;expose();if(p)await sharing.attach(window.wowieGameHost);if(ticket!==navigation||suspended)return;if(p&&host.snapshot().package?.id===p.id)window.dispatchEvent(new Event('wowiekowie-gamehost-ready'));else if(!p){window.dispatchEvent(new Event('wowiekowie-gamehost-library'));if(focus)$('library').focus();}}
 catch(e){if(ticket===navigation&&!suspended)fail(e);}
 finally{if(ticket===navigation){pending=false;render(host.snapshot());}}
}
async function restoreRoute(){if(suspended)return;try{const route=catalog.route(location.href);if(route.canonical)history.replaceState({arcade:1,package:route.id},'',route.canonical);await request(route.id,{historyMode:'none',solo:false});}catch(e){await request(null,{historyMode:'none'});fail(e);}}
try{
 catalog=await loadCatalog();makeHost();
 for(const p of catalog.list()){const label=document.createElement('label');label.className='cartridge';const radio=document.createElement('input');radio.type='radio';radio.name='package';radio.value=p.id;radio.setAttribute('aria-label',p.title+' cartridge');radio.setAttribute('aria-describedby','shelf-instruction');
 // request selects synchronously before awaiting the host. Both native events
 // share this guard so one activation cannot start two loads. A different
 // pending selection is still allowed to supersede the current request.
 const activateCartridge=()=>{
  if(!radio.checked||radio.disabled||suspended)return;
  const state=host.snapshot();
  if(state.closed||state.blocked||(pending?selected?.id===p.id:state.package?.id===p.id))return;
  void loadCartridge(p);
 };
 radio.addEventListener('click',activateCartridge);
 radio.addEventListener('change',activateCartridge);
 // Native Space does nothing on an already checked radio in Chromium.
 // Explicitly activate on keydown and suppress native/default key handling,
 // including repeats and keyup, while leaving native arrow navigation intact.
 radio.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat)radio.click();}});
 radio.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')e.preventDefault();});const body=document.createElement('span');body.className='cartridge-body';const face=document.createElement('span');face.className='cartridge-label';const brand=document.createElement('span');brand.className='series';brand.textContent=p.publisher+' · '+p.platform;const title=document.createElement('strong');title.textContent=p.title;face.append(brand,title);if(p.image){const img=document.createElement('img');img.src=p.image;img.alt=p.title+' gameplay';img.loading='eager';img.decoding='async';img.width=256;img.height=240;face.append(img);}else{const space=document.createElement('span');space.className='label-space';space.setAttribute('aria-hidden','true');face.append(space);}const meta=document.createElement('span');meta.className='cartridge-meta';meta.textContent=p.year+' · '+(p.capabilities.nativePlayers===1?'Solo':p.capabilities.mode);face.append(meta);const grip=document.createElement('span');grip.className='cartridge-grip';grip.setAttribute('aria-hidden','true');body.append(face,grip);label.append(radio,body);const choice=document.createElement('div');choice.className='cartridge-choice';
 const load=document.createElement('button');load.type='button';load.className='load-cartridge';load.dataset.loadPackage=p.id;load.textContent='Load game';load.setAttribute('aria-label','Load '+p.title);load.addEventListener('click',()=>void loadCartridge(p));
 choice.append(label,load);$('shelf').append(choice);}
 $('load').addEventListener('click',()=>{if(selected)void request(selected.id);});
 for(const [id,action] of [['start-game','start'],['resume','resume'],['pause','pause'],['reset','reset']])$(id).addEventListener('click',()=>{try{void host.control(action).catch(fail);}catch(e){fail(e);}});
 $('change').addEventListener('click',()=>void request(null,{focus:true}));
 $('legacy-solo').addEventListener('click',()=>{const p=host.snapshot().package;if(p)void request(p.id);});
 $('invite-watch').addEventListener('click',()=>void host.invite('watch'));$('invite-play').addEventListener('click',()=>void host.invite('play'));
 $('fullscreen').disabled=typeof $('player').requestFullscreen!=='function';$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('player').requestFullscreen();}catch{fail('Fullscreen is unavailable in this browser.');}});document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';});
 $('touch-mode').addEventListener('change',()=>{host.release('touch-mode');$('player').dataset.touch=$('touch-mode').value;});
 window.addEventListener('blur',()=>host.suspend('focus-loss'));document.addEventListener('visibilitychange',()=>{if(document.hidden)host.suspend('hidden');});
 window.addEventListener('pagehide',()=>{navigation++;pending=false;suspended=true;teardown=host.dispose('page-exit');teardown.catch(()=>{});});
 window.addEventListener('pageshow',async e=>{if(!e.persisted||!suspended)return;const ticket=++navigation;try{await teardown;if(ticket!==navigation)return;makeHost();suspended=false;await restoreRoute();}catch(error){fail(error);}});
 window.addEventListener('popstate',()=>void restoreRoute());
 const route=catalog.route(location.href);history.replaceState({arcade:1,package:route.id},'',route.canonical||location.pathname+location.search+location.hash);select(catalog.get(route.id||catalog.list()[0].id));render(host.snapshot());await request(route.id,{historyMode:'none',solo:false});
}catch(e){fail(e);$('details').open=true;}
