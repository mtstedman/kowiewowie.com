import {createLibraryView} from './library-view.mjs';
import {loadCatalog,importAdapter,playDescription,insist} from './package.mjs';
import {GameHost} from './host.mjs';
import {createSharing} from './sharing.mjs';
const sharing=createSharing();
const $=id=>document.getElementById(id);let catalog,host,library,screen='library',changeSession=null,selected=null,lastPackage=null,navigation=0,pending=false,suspended=false,teardown=Promise.resolve();
const fail=e=>{const message='This game could not be opened. Try another cartridge.';$('player-state').textContent=message;$('navigation-status').textContent=message;const receiver=document.querySelector('[data-shared-receiver-status]');if(receiver)receiver.textContent='Shared game unavailable. Return to the library or use a fresh invitation.';};
function select(p){selected=p;library?.update(p,pending||suspended||host?.closed);}
function buttonsFor(p){$('input-buttons').replaceChildren();$('input-help').replaceChildren();for(const i of p.inputs){const b=document.createElement('button');b.textContent=i.label;b.dataset.activation=i.activation;b.setAttribute('aria-label',i.label+' game control');const source='help:'+i.id;const send=pressed=>host.input({control:i.id,source,pressed});b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(send(true)){try{b.setPointerCapture(e.pointerId);}catch{send(false);}}});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>send(false));b.addEventListener('click',e=>{if(e.detail===0&&!e.pointerType){send(true);send(false);}});$('input-buttons').append(b);const line=document.createElement('li');line.textContent=i.label+': '+i.hint;$('input-help').append(line);}}
function render(s){
 $('player').dataset.state=s.package||s.loading?'playing':'library';
 $('player').hidden=screen!=='player';$('library').hidden=screen!=='library';$('page-title').textContent=screen==='library'?'Choose a cartridge':'Game arcade';
 library?.update(selected,pending||suspended||s.closed||s.blocked||Boolean(changeSession));
 const p=s.package,r=s.runtime,session=s.session,media=host?.media();$('surface').hidden=Boolean(media);$('session-surface').hidden=!media;
 if(media){if(media.video.parentNode!==$('session-surface'))$('session-surface').replaceChildren(media.video);if(media.audio!==media.video&&media.audio.parentNode!==$('session-surface'))$('session-surface').append(media.audio);}else $('session-surface').replaceChildren();
 if(p!==lastPackage){lastPackage=p;$('game-title').textContent=p?.title||'Your next adventure';document.title=p?p.title+' · Game arcade':'Game arcade · wowiekowie.com';$('capability').textContent=p?(p.capabilities.nativePlayers===1?'Solo':p.capabilities.mode):'Choose a game';$('play-help').textContent=p?playDescription(p):'';if(p){$('usage').href=p.notes.usage;$('attribution').href=p.notes.attribution;buttonsFor(p);}else{for(const id of ['usage','attribution'])$(id).removeAttribute('href');$('input-buttons').replaceChildren();$('input-help').replaceChildren();}}
 $('idle-screen').hidden=Boolean(p);$('legacy').hidden=!s.legacy;if(s.legacy)$('legacy-copy').textContent=s.legacy.message;
 $('player-state').textContent=s.blocked?'This game could not be closed. Reopen the arcade to continue.':s.loading?'Loading cartridge…':r?.loading?'Loading '+p.title+'…':r?.ready?(r.running?'Now playing · ':'Ready · ')+p.title:s.message==='Choose a game from the shelf.'?'':s.message.startsWith('Game unavailable:')?'This game could not be opened. Try another cartridge.':s.message;
 $('diagnostic').textContent=p?'Start enables game audio. Pause whenever you need a break.':'';$('session-state').textContent=session.message;
 const stream=['guest','spectator'].includes(session.role),ready=Boolean(r?.ready&&!s.loading&&!s.closed&&!s.blocked&&!suspended);
 $('start-game').disabled=stream?!media:!ready||!s.canControl;$('start-game').textContent=stream?'Enable audio':r?.message==='Paused'?'Resume + audio':'Start + audio';$('resume').hidden=!ready||r.running||stream;$('resume').disabled=!s.canControl;$('pause').disabled=!ready||!r.running||!s.canControl||stream;$('reset').disabled=!p||s.loading||!s.canControl||stream;
 $('change').disabled=suspended||s.closed||pending||Boolean(changeSession)||screen!=='player';
 $('select-game').disabled=!ready||!s.canControl||session.role==='spectator'||(!r.running&&!stream)||Boolean(changeSession);
 $('select-game').hidden=stream&&session.role==='spectator';
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

}

async function loadCartridge(p){
 await request(p.id);
 if(!suspended&&!pending&&host.snapshot().package?.id===p.id)$('player').scrollIntoView({block:'start',behavior:'instant'});
}
function expose(){const owner=host,generation=owner.generation;window.wowieGameHost=Object.freeze({version:1,getPackage:()=>owner.snapshot().package,getState:()=>owner.snapshot(),select:id=>request(id),unload:()=>request(null),bindSession:provider=>{insist(owner===host&&owner.generation===generation,'Selection changed; obtain the current host binding');return owner.bindSession(provider);},dispose:reason=>owner.dispose(reason)});}
function makeHost(){host=new GameHost(catalog,{loader:(p,signal,route)=>sharing.load(p,signal,route,importAdapter),view:$('surface'),controls:$('adapter-controls'),changed:render});lastPackage=null;expose();}
function selectionURL(id,href,solo){const u=new URL(href,location.origin);u.pathname='/games/arcade/';u.searchParams.delete('package');u.searchParams.delete('cartridge');if(id)u.searchParams.set('package',id);if(solo){u.hash='';if(id)u.searchParams.set('solo','1');else u.searchParams.delete('solo');}return u.pathname+u.search+u.hash;}
async function request(id,{historyMode='push',solo=true,href=location.href,focus=false}={}){
 if(suspended)return;const p=id===null?null:catalog.get(id),ticket=++navigation;pending=true;$('navigation-status').textContent='';if(p){screen='player';select(p);}render(host.snapshot());
 const target=selectionURL(id,href,solo);
 if(historyMode!=='none'){const state={arcade:1,package:id};if(historyMode==='replace')history.replaceState(state,'',target);else if(target!==location.pathname+location.search+location.hash)history.pushState(state,'',target);}
 try{await (p?host.load(p.id,{href:new URL(target,location.origin).href,solo}):host.unload('library'));if(ticket!==navigation||suspended)return;expose();if(p)await sharing.attach(window.wowieGameHost);if(ticket!==navigation||suspended)return;if(p&&host.snapshot().package?.id===p.id)window.dispatchEvent(new Event('wowiekowie-gamehost-ready'));else if(!p){$('navigation-status').textContent='Loading cartridges…';await library.load();if(ticket!==navigation||suspended)return;screen='library';document.body.dataset.expanded='false';$('bigger').textContent='Make it bigger';$('bigger').setAttribute('aria-pressed','false');$('navigation-status').textContent='';window.dispatchEvent(new Event('wowiekowie-gamehost-library'));if(focus)$('library').focus();}}
 catch(e){if(ticket===navigation&&!suspended)fail(e);}
 finally{if(ticket===navigation){pending=false;render(host.snapshot());}}
}
async function restoreRoute(){if(suspended)return;if(changeSession){history.pushState({arcade:1,package:changeSession.active.pkg.id},'',changeSession.href);return;}try{const route=catalog.route(location.href);if(route.canonical)history.replaceState({arcade:1,package:route.id},'',route.canonical);await request(route.id,{historyMode:'none',solo:false});}catch(e){await request(null,{historyMode:'none'});fail(e);}}
function changeBusy(busy){for(const id of ['save-and-change','leave-without-save','cancel-change'])$(id).disabled=busy;}
async function offerChange(){
 if(changeSession||pending||suspended)return;
 const state=host.snapshot();if(!state.canSave){await request(null,{focus:true});return;}
 if(document.fullscreenElement)await document.exitFullscreen();
 const session={active:host.active,href:location.href,running:Boolean(state.runtime?.running),busy:false};changeSession=session;
 try{await host.control('pause');if(host.active!==session.active){changeSession=null;return;}$('change-status').textContent='';changeBusy(false);$('change-dialog').showModal();$('save-and-change').focus();}
 catch(e){changeSession=null;fail(e);}render(host.snapshot());
}
async function cancelChange(){
 const session=changeSession;if(!session||session.busy)return;changeSession=null;$('change-dialog').close();
 if(session.running&&host.active===session.active)try{await host.control('resume');}catch(e){fail(e);}
 render(host.snapshot());$('change').focus();
}
async function finishChange(save){
 const session=changeSession;if(!session||session.busy)return;session.busy=true;changeBusy(true);
 try{if(save){$('change-status').textContent='Saving…';await host.save();}if(host.active!==session.active)throw Error('The active game changed.');await request(null,{focus:true});if(host.snapshot().package)throw Error('Could not close this game.');changeSession=null;$('change-dialog').close();render(host.snapshot());$('library').focus();}
 catch(e){session.busy=false;changeBusy(false);$('change-status').textContent='Could not '+(save?'save':'close')+' the game. '+(e.message||'Try again.');}
}
try{
 catalog=await loadCatalog();library=createLibraryView({root:$('library'),catalog,onLoad:loadCartridge,canActivate:id=>!suspended&&!changeSession&&!host.closed&&!host.poisoned&&(pending?selected?.id!==id:host.snapshot().package?.id!==id)});makeHost();
 for(const [id,action] of [['start-game','start'],['resume','resume'],['pause','pause'],['reset','reset']])$(id).addEventListener('click',()=>{try{void host.control(action==='start'&&['solo','host'].includes(host.snapshot().session.role)&&host.snapshot().runtime?.message==='Paused'?'resume':action).catch(fail);}catch(e){fail(e);}});
 $('change').addEventListener('click',()=>void offerChange());
 $('cancel-change').addEventListener('click',()=>void cancelChange());
 $('change-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!changeSession?.busy)void cancelChange();});
 $('save-and-change').addEventListener('click',()=>void finishChange(true));
 $('leave-without-save').addEventListener('click',()=>void finishChange(false));
 $('bigger').addEventListener('click',()=>{const expanded=document.body.dataset.expanded!=='true';document.body.dataset.expanded=String(expanded);$('bigger').textContent=expanded?'Make it smaller':'Make it bigger';$('bigger').setAttribute('aria-pressed',String(expanded));});
 const selectSource='toolbar:select';
 $('select-game').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(host.input({control:'select',source:selectSource,pressed:true}))try{e.currentTarget.setPointerCapture(e.pointerId);}catch{host.input({control:'select',source:selectSource,pressed:false});}});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])$('select-game').addEventListener(event,()=>host.input({control:'select',source:selectSource,pressed:false}));
 $('select-game').addEventListener('click',e=>{if(e.detail===0&&!e.pointerType&&host.input({control:'select',source:selectSource,pressed:true}))setTimeout(()=>host.input({control:'select',source:selectSource,pressed:false}),80);});
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
