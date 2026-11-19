import {exact,insist,freeze,isDigest} from './package.mjs';
export function bounded(p,ms=8000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Operation did not finish. Close this arcade before trying again.')),ms);Promise.resolve(p).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
const attempt=fn=>{try{return Promise.resolve(fn());}catch(e){return Promise.reject(e);}};
// Dynamic import cannot be cancelled. Stop awaiting it and consume late settlement.
export function cancellable(p,signal,ms=15000){return new Promise((resolve,reject)=>{
 let settled=false,timer;const done=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);fn(v);};
 const cancel=()=>done(reject,Object.assign(Error('Selection superseded'),{name:'AbortError'}));
 timer=setTimeout(()=>done(reject,Error('Package operation timed out')),ms);signal.addEventListener('abort',cancel,{once:true});
 Promise.resolve(p).then(v=>done(resolve,v),e=>done(reject,e));if(signal.aborted)cancel();
});}
export class ResourceScope {
 #items=[];#closed=false;#promise=null;
 defer(fn){insist(typeof fn==='function','Cleanup callback required');if(this.#closed){attempt(fn).catch(()=>{});throw Error('Resource scope already closed');}this.#items.push(fn);return fn;}
 listen(target,type,fn,options){target.addEventListener(type,fn,options);this.defer(()=>target.removeEventListener(type,fn,options));}
 close(){if(this.#promise)return this.#promise;this.#closed=true;const work=this.#items.splice(0).reverse().map(fn=>attempt(fn));this.#promise=Promise.allSettled(work).then(results=>{const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;});return this.#promise;}
}
export function validateState(s,previous=null){
 exact(s,['role','phase','epoch','reconnect','watch','play','message']);
 insist(['solo','host','guest','spectator'].includes(s.role)&&['inactive','connecting','active','reconnecting','ended','incompatible'].includes(s.phase)&&Number.isSafeInteger(s.epoch)&&s.epoch>=0&&['none','pending','recovered'].includes(s.reconnect)&&['unavailable','available'].includes(s.watch)&&['unavailable','available'].includes(s.play)&&typeof s.message==='string'&&s.message.length<=240&&!/[\u0000-\u001f\u007f]/.test(s.message),'Invalid session UI state');
 if(previous){insist(s.epoch>=previous.epoch,'Stale session epoch');if(s.role!==previous.role||(previous.phase==='reconnecting'&&s.phase==='active'))insist(s.epoch>previous.epoch,'Role changes and reconnect completion require a fresh epoch');}
 insist(s.phase!=='reconnecting'||s.reconnect==='pending','Reconnect state mismatch');return freeze({...s});
}
export const soloState=()=>validateState({role:'solo',phase:'inactive',epoch:0,reconnect:'none',watch:'unavailable',play:'unavailable',message:'Sharing is not available yet.'});
export function seatFor(p,role){if(role==='solo'||role==='host')return 1;if(role==='guest')return p.capabilities.play==='shared-hero'?1:p.capabilities.play==='host-p1-guest-p2'?2:0;return 0;}
export function validateAdapter(a,p){insist(a&&a.version===1&&a.packageId===p.id&&a.artifactDigest===p.artifactDigest,'Adapter identity/version mismatch');for(const k of ['load','start','pause','resume','reset','dispose','input','releaseAll','snapshot','surfaces'])insist(typeof a[k]==='function','Missing adapter lifecycle method: '+k);return a;}
export function validateSurfaces(s,p){
 exact(s,['view','video','audio']);insist(s.view?.nodeType===1,'Adapter must provide a DOM view');
 if(p.surfaces.video.kind==='none')insist(s.video===null,'Unexpected video surface');else insist(s.video?.nodeType===1&&s.video.tagName===(p.surfaces.video.kind==='canvas'?'CANVAS':'VIDEO'),'Video surface disagrees with package');
 if(p.surfaces.audio.kind==='none')insist(s.audio===null,'Unexpected audio surface');else insist(s.audio&&s.audio.kind===p.surfaces.audio.kind&&typeof s.audio.getNodes==='function','Audio surface disagrees with package');return s;
}
const inactive=s=>['connecting','reconnecting','ended','incompatible'].includes(s.phase);
export class GameHost {
 constructor(catalog,{loader,view=null,controls=null,changed=()=>{}}){this.catalog=catalog;this.loader=loader;this.view=view;this.controls=controls;this.changed=changed;this.active=null;this.queue=Promise.resolve();this.generation=0;this.transitioning=false;this.closed=false;this.poisoned=false;this.legacy=null;this.message='Choose a game from the shelf.';this.disposal=null;}
 emit(){try{this.changed(this.snapshot());}catch{}}
 snapshot(){const r=this.active?.closing?null:this.active,runtime=r?.adapter?.snapshot()||null,canControl=Boolean(r&&this.permitted(r,false));return Object.freeze({package:r?.pkg||null,runtime,replica:r?.adapter?.replica===true,session:r?.state||soloState(),pending:Boolean(r?.pending),loading:this.transitioning,closed:this.closed,blocked:this.poisoned,legacy:this.legacy,message:this.message,canControl,canSave:Boolean(canControl&&runtime?.ready&&!r.saving&&['solo','host'].includes(r.state.role)&&typeof r.adapter?.save==='function')});}
 permitted(r,remote){if(this.closed||this.poisoned||r.closing||r.awaitingSession||!r.loaded||r!==this.active||inactive(r.state))return false;if(remote)return Boolean(r.provider&&r.state.role==='host'&&r.state.phase==='active'&&seatFor(r.pkg,'guest'));return seatFor(r.pkg,r.state.role)>0&&(r.state.role!=='guest'||Boolean(r.provider&&r.state.phase==='active'));}
 load(id,options={}){return this.transition(id,options);}
 unload(reason='library'){return this.transition(null,{reason});}
 async transition(id,{href='',solo=false,reason='package-change'}={}){
  insist(!this.closed&&!this.poisoned,'Host is closed or cleanup failed');const pkg=id===null?null:this.catalog.get(id),ticket=++this.generation;
  this.transitioning=true;this.legacy=null;this.message=pkg?'Loading '+pkg.title+'…':'Returning to the game shelf…';
  const previous=this.shutdown(this.active,reason);previous.catch(()=>{});this.emit();
  const job=this.queue.then(async()=>{
   await previous;if(ticket!==this.generation||this.closed)return;insist(!this.poisoned,'Cleanup failed');
   if(!pkg){this.message='Choose a game from the shelf.';return;}
   // Adapters receive private, detached mount points. Only the current generation commits them.
   const mount=this.view?.ownerDocument?.createElement('div')||null,controlMount=this.controls?.ownerDocument?.createElement('div')||null;
   if(mount){mount.className='package-mount';mount.dataset.package=pkg.id;}
   const r={pkg,mount,controlMount,abort:new AbortController(),scope:new ResourceScope(),adapter:null,provider:null,unsubscribe:null,state:soloState(),held:new Map(),forwardedReleases:new Map(),media:new Set(),loaded:false,closing:false,awaitingSession:false,pending:false,releaseBusy:false,faulting:false,disposal:null};
   this.active=r;r.scope.defer(()=>{mount?.remove();controlMount?.remove();});this.emit();
   try{
    const module=await cancellable(attempt(()=>this.loader(pkg,r.abort.signal,{href,solo})),r.abort.signal);
    if(ticket!==this.generation||r.abort.signal.aborted){await this.shutdown(r,'cancelled');return;}
    insist(module.version===1&&typeof module.createAdapter==='function','Unsupported adapter API');
    const hint=!solo&&typeof module.legacy==='function'?module.legacy(pkg,href):null;
    if(hint){exact(hint,['href','message']);insist(typeof hint.href==='string'&&hint.href.startsWith(pkg.route)&&typeof hint.message==='string'&&hint.message.length<=240,'Invalid compatibility hint');r.awaitingSession=true;this.legacy=Object.freeze({...hint,package:pkg});}
    const context=Object.freeze({package:pkg,view:mount,controls:controlMount,signal:r.abort.signal,scope:r.scope,input:e=>this.localInput(r,e),release:why=>this.release(why,r),canControl:()=>this.permitted(r,false),changed:()=>{if(r===this.active&&!r.closing){const s=r.adapter?.snapshot();if(s&&!s.running)this.release('runtime-stopped',r);this.emit();}}});
    const a=module.createAdapter(context);r.adapter=a;validateAdapter(a,pkg);await cancellable(attempt(()=>a.load()),r.abort.signal);
    if(ticket!==this.generation||r.abort.signal.aborted){await this.shutdown(r,'cancelled');return;}
    validateSurfaces(a.surfaces(),pkg);if(r.awaitingSession)await cancellable(attempt(()=>a.pause()),r.abort.signal);
    if(ticket!==this.generation||r.abort.signal.aborted){await this.shutdown(r,'cancelled');return;}
    this.view?.append(mount);this.controls?.append(controlMount);r.loaded=true;this.message='Loaded '+pkg.title;
   }catch(e){
    await this.shutdown(r,'load-error');
    if(ticket!==this.generation||this.closed)return;
    this.legacy=null;this.message='Game unavailable: '+String(e.message||e).slice(0,200);throw e;
   }
  }).finally(()=>{if(ticket===this.generation){this.transitioning=false;this.emit();}});
  this.queue=job.catch(()=>{});return job;
 }
 release(reason='release',r=this.active){
  if(!r||r.releaseBusy)return;r.releaseBusy=true;const held=[...r.held.values()];r.held.clear();const errors=[];
  for(const item of held){if(item.forwarded)r.forwardedReleases.set(item.event.source,item.event);try{if(item.forwarded)r.provider?.sendInput({...item.event,pressed:false});else r.adapter?.input({...item.event,pressed:false});}catch(e){errors.push(e);}}
  try{r.adapter?.releaseAll(reason);}catch(e){errors.push(e);}try{r.provider?.releaseInputs(reason,r.state.epoch);}catch(e){errors.push(e);}r.releaseBusy=false;
  if(errors.length){this.poisoned=true;this.message='Input cleanup failed. Close this arcade before continuing.';}this.emit();
 }
 localInput(r,e){try{exact(e,['control','source','pressed']);return this.edge(r,{...e,seat:seatFor(r.pkg,r.state.role),epoch:r.state.epoch,role:r.state.role},false);}catch{return false;}}
 edge(r,e,remote){
  try{exact(e,['control','source','pressed','seat','epoch','role']);const descriptor=r.pkg.inputs.find(i=>i.id===e.control);if(!descriptor||typeof e.source!=='string'||!e.source.length||e.source.length>100||/[\u0000-\u001f\u007f]/.test(e.source)||typeof e.pressed!=='boolean'||e.epoch!==r.state.epoch)return false;
   const seat=seatFor(r.pkg,remote?'guest':r.state.role);if(!seat||e.seat!==seat||e.role!==(remote?'guest':r.state.role))return false;
   const key=(remote?'remote:':'local:')+e.source,old=r.held.get(key);
   if(!e.pressed){const retired=r.forwardedReleases.get(key);if(retired){if(retired.control!==e.control)return false;r.forwardedReleases.delete(key);if(!remote&&r.state.role==='guest')r.provider?.sendInput({...e,source:key});return true;}if(!old)return false;r.held.delete(key);if(old.forwarded)r.provider?.sendInput({...old.event,pressed:false});else r.adapter?.input({...old.event,pressed:false});return true;}
   if(old||r.forwardedReleases.has(key)||!this.permitted(r,remote)||r.held.size+r.forwardedReleases.size>=64)return false;
   const runtime=r.adapter.snapshot(),forwarded=!remote&&r.state.role==='guest';if(!forwarded&&(!runtime.ready||(!runtime.running&&descriptor.activation!=='start')))return false;
   const event=Object.freeze({...e,source:key});const accepted=forwarded?r.provider.sendInput(event):r.adapter.input(event);insist(!accepted||typeof accepted.then!=='function','Input callbacks must enqueue synchronously');if(accepted===false)return false;r.held.set(key,{event,forwarded});return true;
  }catch{this.release('input-error',r);return false;}
 }
 releaseRemote(r=this.active){if(!r||r.closing)return;const sources=[];for(const [key,item] of r.held){if(!key.startsWith('remote:'))continue;r.held.delete(key);sources.push(item.event.source);r.adapter?.input({...item.event,pressed:false});}r.adapter?.releaseSources?.(sources);this.emit();}
 input(e){return this.active?this.localInput(this.active,e):false;}
 control(action){
  const r=this.active;insist(r?.loaded&&!r.closing&&!this.closed&&!this.poisoned,'No ready package');insist(['start','pause','resume','reset'].includes(action),'Unknown lifecycle action');
  if(['guest','spectator'].includes(r.state.role)){insist(action==='start'&&r.provider&&(r.state.phase==='active'||r.state.role==='guest'&&r.state.phase==='reconnecting'&&Boolean(this.media())),'This role cannot control the game');return attempt(()=>r.provider.enableAudio());}
  insist(this.permitted(r,false),'Controls unavailable during this session state');if(action==='pause'||action==='reset')this.release(action,r);
  return attempt(()=>r.adapter[action]()).then(()=>this.emit(),e=>{if(r===this.active&&!r.closing){this.release('lifecycle-error',r);this.message=String(e.message||e).slice(0,200);this.emit();}throw e;});
 }
 async save(){
  const r=this.active;insist(r?.loaded&&!r.closing&&!this.closed&&!this.poisoned,'No ready package');
  insist(['solo','host'].includes(r.state.role)&&this.permitted(r,false),'This session cannot save the game');
  insist(r.adapter.snapshot()?.ready,'Game is not ready to save');insist(typeof r.adapter.save==='function','This game does not support saving');insist(!r.saving,'Save already in progress');
  r.saving=true;this.release('save',r);this.emit();
  try{const result=await attempt(()=>r.adapter.save());insist(r===this.active&&!r.closing&&this.permitted(r,false)&&['solo','host'].includes(r.state.role),'Save operation was superseded');this.message='Game saved on this browser.';return result;}
  catch(e){if(r===this.active&&!r.closing)this.message=String(e.message||e).slice(0,200);throw e;}
  finally{r.saving=false;this.emit();}
 }
 suspend(reason='focus-loss'){const r=this.active;this.release(reason,r);if(r?.adapter?.replica)return;if(r?.adapter&&!r.closing)attempt(()=>r.adapter.pause()).catch(()=>{if(r===this.active&&!r.closing){this.poisoned=true;this.emit();}});}
 state(r,value,initial=false){
  const next=validateState(value,initial?null:r.state),previous=r.state;const changed=next.role!==previous.role||next.phase!==previous.phase||next.epoch!==previous.epoch;if(changed){const localContinues=['solo','host'].includes(previous.role)&&['solo','host'].includes(next.role)&&!inactive(previous)&&!inactive(next);if(localContinues)this.releaseRemote(r);else this.release('session-transition',r);}r.state=next;r.adapter?.setSessionState?.(next);
  if(r.adapter?.replica?['ended','incompatible'].includes(next.phase):next.role==='guest'||next.role==='spectator'||inactive(next))attempt(()=>r.adapter.pause()).catch(()=>this.fault(r));this.emit();return next;
 }
 fault(r){if(r!==this.active||r.closing||r.faulting)return;r.faulting=true;r.state=Object.freeze({...r.state,role:'spectator',phase:'incompatible',watch:'unavailable',play:'unavailable',message:'Sharing is incompatible. Return to the library to reconnect.'});this.release('binding-error',r);attempt(()=>r.adapter?.pause()).catch(()=>{});r.faulting=false;this.emit();}
 bindSession(provider){
  const r=this.active;insist(r?.loaded&&!r.closing&&!r.provider&&!this.closed&&!this.poisoned,'Session binding unavailable');
  exact(provider,['version','packageId','artifactDigest','getState','subscribe','inviteWatch','invitePlay','sendInput','releaseInputs','enableAudio','getMedia','dispose']);
  insist(provider.version===1&&provider.packageId===r.pkg.id&&isDigest(provider.artifactDigest)&&provider.artifactDigest===r.pkg.artifactDigest,'Session package/version/digest mismatch');
  for(const k of ['getState','subscribe','inviteWatch','invitePlay','sendInput','releaseInputs','enableAudio','getMedia','dispose'])insist(typeof provider[k]==='function','Missing session method');
  const initial=validateState(provider.getState());r.provider=provider;r.awaitingSession=false;this.legacy=null;
  try{this.state(r,initial,true);r.unsubscribe=provider.subscribe(s=>{if(r!==this.active||r.closing||r.provider!==provider)return;try{this.state(r,s);}catch{this.fault(r);}});insist(typeof r.unsubscribe==='function','subscribe must return a disposer');}
  catch(e){this.fault(r);void this.shutdown(r,'binding-error').catch(()=>{});throw e;}
  return Object.freeze({version:1,input:e=>r===this.active&&!r.closing?this.edge(r,e,true):false,release:()=>this.releaseRemote(r),surfaces:()=>{insist(r===this.active&&!r.closing,'Binding disposed');return r.adapter.surfaces();},network:()=>{insist(r===this.active&&!r.closing,'Binding disposed');return r.adapter.network?.();},dispose:why=>this.shutdown(r,why||'session-disposed')});
 }
 async invite(kind){
  const r=this.active;if(!r?.provider||r.closing||r.pending||!['watch','play'].includes(kind)||!['host','solo'].includes(r.state.role)||inactive(r.state)||r.state[kind]!=='available'||(kind==='watch'?!r.pkg.capabilities.watch:r.pkg.capabilities.play==='none'))return false;
  const epoch=r.state.epoch;r.pending=true;this.emit();
  try{await cancellable(attempt(()=>r.provider[kind==='watch'?'inviteWatch':'invitePlay'](Object.freeze({package:r.pkg,epoch,signal:r.abort.signal}))),r.abort.signal);if(r===this.active&&!r.closing&&!r.abort.signal.aborted&&epoch===r.state.epoch)this.state(r,r.provider.getState());return r===this.active&&!r.closing&&epoch===r.state.epoch;}
  catch{if(r===this.active&&!r.closing)this.fault(r);return false;}finally{r.pending=false;this.emit();}
 }
 media(){const r=this.active;if(!r?.provider||r.closing||!['guest','spectator'].includes(r.state.role)||(r.state.phase!=='active'&&!(r.state.role==='guest'&&r.state.phase==='reconnecting')))return null;try{const media=r.provider.getMedia();if(media===null)return null;exact(media,['video','audio']);insist(media.video?.nodeType===1&&media.video.tagName==='VIDEO'&&media.audio?.nodeType===1&&['AUDIO','VIDEO'].includes(media.audio.tagName),'A shared stream requires game video and audio');r.media.add(media.video);r.media.add(media.audio);return media;}catch{this.fault(r);return null;}}
 shutdown(r,reason='dispose'){
  if(!r)return Promise.resolve();if(r.disposal)return r.disposal;
  let resolve,reject;r.disposal=new Promise((yes,no)=>{resolve=yes;reject=no;});r.disposal.catch(()=>{});
  r.closing=true;r.abort.abort(reason);this.release(reason,r);r.mount?.remove();r.controlMount?.remove();
  const work=[];if(r.unsubscribe)work.push(attempt(()=>r.unsubscribe()));r.unsubscribe=null;
  if(r.provider)work.push(attempt(()=>r.provider.dispose(reason)));if(r.adapter)work.push(attempt(()=>r.adapter.dispose(reason)));work.push(attempt(()=>r.scope.close()));
  for(const media of r.media)work.push(attempt(()=>{media.pause();for(const t of media.srcObject?.getTracks?.()||[])t.stop();media.srcObject=null;media.remove();}));r.media.clear();
  bounded(Promise.allSettled(work).then(results=>{const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;if(this.poisoned)throw Error('Resource cleanup failed');})).then(()=>{if(this.active===r)this.active=null;this.emit();resolve();},e=>{this.poisoned=true;this.message='Cleanup failed. Close this arcade before loading another game.';this.emit();reject(e);});return r.disposal;
 }
 dispose(reason='page-exit'){if(this.disposal)return this.disposal;this.closed=true;this.generation++;this.transitioning=false;this.legacy=null;this.disposal=this.shutdown(this.active,reason);this.emit();return this.disposal;}
}
