import {readBytes,canonical,digest,insist} from './package.mjs';
import {validateBinding,assignment,full,zero} from '../netplay/policy.mjs';
import {createHostSession,joinParticipant,prepareJoin,prepareRejoin} from '../netplay/session.mjs';
export const storageKey=p=>'combined-participant:'+p.id+':'+p.artifactDigest;
export async function loadBinding(p,signal){
 const catalog=JSON.parse(new TextDecoder().decode(await readBytes('/games/netplay/catalog.json',524288,signal)));
 insist(catalog.format==='romjs-cartridge-roles/1','Network catalog version');const b=validateBinding(catalog.packages?.[p.id]);
 insist(b.packageFormat==='game-package/1'&&b.packageId===p.id&&b.artifactDigest===p.artifactDigest&&b.route===p.route,'Network/package identity');
 insist(b.capabilities.nativePlayers===p.capabilities.nativePlayers&&b.capabilities.play===(p.capabilities.play==='host-p1-guest-p2'?'independent':p.capabilities.play)&&b.capabilities.watch===p.capabilities.watch,'Network/package capabilities');
 const inputs=p.inputs.map(({id,label,kind})=>({id,label,kind}));insist(canonical(inputs)===canonical(b.inputs)&&await digest(new TextEncoder().encode(canonical(inputs)))===b.inputsDigest,'Network/package inputs');return b;
}
export function receiveIntent(p,href,solo){
 const u=new URL(href||location.href,location.origin);if(solo)return null;
 let saved=null;try{saved=JSON.parse(sessionStorage.getItem(storageKey(p))||'null');}catch{}
 if(u.hash.startsWith('#netplay')){const proposed=prepareJoin(u.hash);const record=saved?.room===proposed.room&&saved?.participant===proposed.participant?saved:proposed;sessionStorage.setItem(storageKey(p),JSON.stringify(record));return record;}
 if(u.searchParams.get('solo')==='1')return null;return saved?.room?saved:null;
}
export function receiverStatus(s){
 if(!s)return 'Connecting to shared game…';
 if(s.phase==='ended')return s.message||'Sharing ended.';
 if(s.phase==='incompatible')return 'Sharing unavailable. Return to the library.';
 return s.message||'Connecting to shared game…';
}
export function receiverModule(){return {version:1,createAdapter(ctx){
 let root,video,status,closed=false;const cleanup=()=>{closed=true;root?.remove();};ctx.scope.defer(cleanup);
 return {version:1,packageId:ctx.package.id,artifactDigest:ctx.package.artifactDigest,
 load(){root=document.createElement('div');status=document.createElement('p');status.dataset.sharedReceiverStatus='';status.setAttribute('role','status');status.textContent=receiverStatus(null);root.append(status);const k=ctx.package.surfaces.video.kind;video=k==='none'?null:document.createElement(k==='canvas'?'canvas':'video');if(video){video.hidden=true;root.append(video);}const mount=document.createElement('div');mount.dataset.sharedReceiverVideo='';root.append(mount);ctx.view.append(root);},
 setSessionState(s){if(!closed&&status)status.textContent=receiverStatus(s);},
 start(){},pause(){},resume(){},reset(){throw Error('Receiving sessions cannot reset a game');},dispose:cleanup,input(){return false;},releaseAll(){},
 snapshot:()=>({ready:!closed,running:!closed,loading:false,closed,message:'Shared stream receiver'}),
 surfaces:()=>({view:root,video,audio:ctx.package.surfaces.audio.kind==='none'?null:{kind:ctx.package.surfaces.audio.kind,getNodes:()=>ctx.package.surfaces.audio.kind==='web-audio'?{context:null,node:null}:{element:video}}})};
 }};}
export function captureSurfaces(s){
 insist(s.video&&typeof s.video.captureStream==='function','Package video capture unsupported');const stream=s.video.captureStream(),video=stream.getVideoTracks()[0];
 if(!video){stream.getTracks().forEach(t=>t.stop());throw Error('Video capture track missing');}
 let tap=null,elementStream=null,closed=false;
 const detach=()=>{if(!tap)return;try{tap.source.disconnect(tap.destination);}catch{}tap.destination.stream.getTracks().forEach(t=>t.stop());tap=null;};
 return {video,getAudio(){
  if(closed)return null;
  if(s.audio?.kind==='web-audio'){const pair=s.audio.getNodes();if(!pair.context||!pair.node){detach();return null;}if(tap?.source!==pair.node){detach();const destination=pair.context.createMediaStreamDestination();try{pair.node.connect(destination);}catch(e){destination.stream.getTracks().forEach(t=>t.stop());throw e;}tap={source:pair.node,destination};}return tap.destination.stream.getAudioTracks()[0]||null;}
  if(s.audio?.kind==='media-element'){const {element}=s.audio.getNodes();if(element===s.video)return stream.getAudioTracks()[0]||null;insist(typeof element?.captureStream==='function','Package audio capture unsupported');elementStream??=element.captureStream();return elementStream.getAudioTracks()[0]||null;}
  return null;
 },dispose(){if(closed)return;closed=true;detach();stream.getTracks().forEach(t=>t.stop());elementStream?.getTracks().forEach(t=>t.stop());}};
}
export function hostAdapter(p,b,lease,state,runtime){
 const participants=new Map(),seat=p.capabilities.play==='host-p1-guest-p2'?2:1;
 const release=id=>{const r=participants.get(id);if(!r)return;for(const c of b.inputs)if(r.values[c.id])lease.input({control:c.id,source:id+':'+c.id,pressed:false,seat,epoch:state().epoch,role:'guest'});r.values=zero(b);lease.release();};
 return {version:1,packageId:p.id,artifactDigest:p.artifactDigest,capture:()=>captureSurfaces(lease.surfaces()),enabled:()=>Boolean(runtime()?.ready&&runtime()?.running&&!document.hidden),
 admit(value){const a=assignment(b,value);insist(a.participant_role==='play'&&a.capabilities.input&&a.session&&a.player===b.players.remote,'Remote assignment');const old=participants.get(a.participant);if(old?.assignment.session===a.session)return;if(old)release(a.participant);insist(!participants.size||old,'Remote capacity');participants.set(a.participant,{assignment:a,values:zero(b)});},
 remote(id,session,player,values){const r=participants.get(id);insist(r&&r.assignment.session===session&&r.assignment.player===player&&full(b,values),'Remote authority');for(const c of b.inputs){const v=values[c.id];if(v===r.values[c.id])continue;const ok=lease.input({control:c.id,source:id+':'+c.id,pressed:v,seat,epoch:state().epoch,role:'guest'});if(v&&!ok){release(id);return;}r.values[c.id]=v;}},
 release,remove(id){release(id);participants.delete(id);}};
}
const shortWait=promise=>new Promise(resolve=>{const timer=setTimeout(()=>resolve({serverConfirmed:false,cleanupPending:true}),6000);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},()=>{clearTimeout(timer);resolve({serverConfirmed:false});});});
export function invitationMessage(p){
 const c=p.capabilities;
 return c.nativePlayers===2&&c.play==='host-p1-guest-p2'?(c.mode==='alternating'?'Invite someone to watch or take turns · Player 1 and Player 2.':'Invite someone to watch or join the game · Player 1 and Player 2.'):c.play==='shared-hero'?'Invite someone to watch or share this hero.':'Invite someone to watch this game.';
}
export function createBridge(p,b,record,{signal,onUI=()=>{}}={}){
 let lease=null,host=null,guest=null,opening=null,disposed=false,timer=null,releaseBusy=false,epoch=0,lastRawEpoch=0,receiverEnded=false;
 let retryTimer=null,retryWake=null,integration=null,disposal=null,joining=null,connecting=null,joinMessage=null,connectionMessage=null,operation=0;
 let state=Object.freeze({role:record?'spectator':'solo',phase:record?'connecting':'inactive',epoch:0,reconnect:'none',watch:record?'unavailable':'available',play:record?'unavailable':'available',message:record?'Connecting to shared game…':invitationMessage(p)});
 const listeners=new Set(),video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.setAttribute('aria-label','Shared game video and audio');video.setAttribute('data-shared-receiver-media','');
 const receiverMedia=()=>{if(disposed||signal?.aborted||receiverEnded||!guest)return null;const raw=guest.getState();return ['guest','spectator'].includes(raw.role)&&raw.phase==='active'&&raw.mediaAvailable===true?{video,audio:video}:null;};
 const notify=()=>{if(disposed)return;for(const f of listeners)try{f(state);}catch{}onUI({state,participants:host?.getState().participants||[]});};
 function update(){
  if(disposed||receiverEnded)return;if(host?.closed)host=null;
  if(record&&!guest&&joinMessage){const next={...state,phase:'reconnecting',reconnect:'pending',message:joinMessage};if(JSON.stringify(next)!==JSON.stringify(state)){state=Object.freeze({...next,epoch:++epoch});notify();}return;}
  const raw=guest?.getState()||host?.getState(),role=raw?.role||(record?'spectator':'solo');let phase=raw?.phase||(record?'connecting':'inactive');
  if(role==='guest'&&phase==='active'&&!raw.inputEnabled)phase='reconnecting';
  const rawEpoch=raw?.epoch??0,barrier=role!==state.role||phase!==state.phase||rawEpoch!==lastRawEpoch;lastRawEpoch=rawEpoch;
  if(barrier)epoch++;
  const next={role,phase,epoch,reconnect:phase==='reconnecting'?'pending':phase==='active'&&epoch>1?'recovered':'none',watch:!record&&phase!=='ended'&&(raw?.watchAvailable??true)?'available':'unavailable',play:!record&&phase!=='ended'&&(raw?.playAvailable??true)?'available':'unavailable',message:phase==='ended'?(connectionMessage||'Sharing ended.'):role==='spectator'?(phase==='active'?'Watching live · no controls.':'Connecting live video and audio…'):role==='guest'?(phase==='active'?(p.capabilities.play==='shared-hero'?'Sharing one hero · Player 1.':(p.capabilities.mode==='alternating'?'Connected as Player 2 · take turns.':'Connected to the assigned second player.')):'Reconnecting · controls released.'):host?'Sharing this game.':invitationMessage(p)};
  if(record&&phase!=='ended'){const media=receiverMedia();if(role==='guest'&&phase==='reconnecting'&&raw?.hostPaused===true)next.message=media?'Connected—host paused/away · Ask the host to Resume · controls released.':'Connected—host paused/away · No picture received yet. Ask the host to Resume · controls released.';else if(!media)next.message=connectionMessage||'Connecting live video and audio… · controls released.';}
   if(JSON.stringify(next)===JSON.stringify(state))return;state=Object.freeze(next);notify();
 }
 const event=e=>{if(disposed)return;if(e.type==='status'&&typeof e.message==='string')connectionMessage=e.message.slice(0,240);queueMicrotask(update);if(e.type==='roster')onUI({state,participants:e.state.participants});};
 async function open(){
  insist(!disposed&&!signal?.aborted&&!record&&lease,'Host session unavailable');if(host&&!host.closed)return host;if(opening)return opening;
  const ticket=operation,adapter=hostAdapter(p,b,lease,()=>state,()=>integration.getState().runtime);
  opening=createHostSession(b,adapter,{onEvent:event}).then(async h=>{if(disposed||signal?.aborted||ticket!==operation){await h.end();throw Error('Selection ended');}host=h;update();return h;}).finally(()=>{opening=null;});return opening;
 }
 async function invite(kind,context){
  insist(context.package.id===p.id&&context.package.artifactDigest===p.artifactDigest&&!context.signal.aborted&&!disposed,'Stale invitation context');
  const ticket=operation,h=await open(),result=await h.invite(kind);if(disposed||context.signal.aborted||ticket!==operation||host!==h){if(!h.closed)await h.revoke(result.assignment.participant);throw Error('Invitation cancelled');}
  const url=new URL('/games/arcade/',location.origin);url.searchParams.set('package',p.id);url.hash=result.fragment;onUI({invite:url.href,role:kind,assignment:result.assignment});
 }
 async function end(){
  if(disposed)return;const ticket=++operation;clearTimeout(retryTimer);retryWake?.();retryWake=null;
  if(record){receiverEnded=true;clearInterval(timer);const g=guest;guest=null;try{sessionStorage.removeItem(storageKey(p));}catch{}video.pause();video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;state=Object.freeze({...state,phase:'ended',epoch:++epoch,watch:'unavailable',play:'unavailable',message:'You left the shared game.'});notify();if(g)onUI({end:await shortWait(g.dispose({leave:true}))});return;}
  const h=host;host=null;if(h){const pending=h.end();update();const result=await shortWait(pending);if(!disposed&&ticket===operation)onUI({end:result});}else update();
 }
 function dispose(reason='dispose'){if(disposal)return disposal;disposal=disposeOnce(reason);return disposal;}
 async function disposeOnce(reason){
  if(disposed)return;disposed=true;operation++;clearInterval(timer);clearTimeout(retryTimer);retryWake?.();retryWake=null;listeners.clear();
  const h=host,g=guest;host=guest=null;const work=[],leave=reason!=='page-exit';if(h)work.push(h.end());if(g)work.push(g.dispose({leave}));if(record&&leave)try{sessionStorage.removeItem(storageKey(p));}catch{}
  if(joining)work.push(joining.catch(()=>{}));if(opening)work.push(opening.catch(()=>{}));video.pause();video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;video.remove();await shortWait(Promise.allSettled(work));
 }
 const provider=Object.freeze({version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},inviteWatch:c=>invite('watch',c),invitePlay:c=>invite('play',c),
 sendInput(e){
  if(disposed||signal?.aborted||receiverEnded||!guest||state.role!=='guest'||e.epoch!==state.epoch||e.role!=='guest'||e.seat!==(p.capabilities.play==='host-p1-guest-p2'?2:1))return false;
  const raw=guest.getState();
  // A transport callback can precede the queued UI update. Never translate an
  // old UI press into a fresh transport generation. Releases remain possible.
  if(e.pressed&&(state.phase!=='active'||raw.phase!=='active'||!raw.inputEnabled||raw.epoch!==lastRawEpoch))return false;
  return guest.input({control:e.control,source:e.source,pressed:e.pressed,epoch:raw.epoch});
 },
 releaseInputs(reason){
  // GameHost is acknowledging this provider's state notification. The transport
  // already owns that barrier; sending release:true here would create another
  // host wire epoch, another guest clear, and another notification indefinitely.
  if(reason==='session-transition'||releaseBusy||disposed)return;
  releaseBusy=true;try{guest?.release();host?.release();}finally{releaseBusy=false;}
 },enableAudio:()=>{if(record){insist(receiverMedia(),'Shared media unavailable');return guest.enableAudio();}return host?.audio();},getMedia:receiverMedia,dispose});
 async function connect(){
  if(connecting)return connecting;
  connecting=connectOnce().finally(()=>{connecting=null;});return connecting;
 }
 async function connectOnce(){
  insist(!disposed&&!signal?.aborted&&!receiverEnded,'Selection ended');
  if(record.joined)record=prepareRejoin(record);sessionStorage.setItem(storageKey(p),JSON.stringify(record));
  connectionMessage=null;joinMessage='Connecting to shared game…';update();
  try{
   let s;
   for(let attempt=0;attempt<11;attempt++){
    insist(!disposed&&!signal?.aborted&&!receiverEnded,'Selection ended');
    try{joining=joinParticipant(b,record,{video,onEvent:event}).then(async result=>{if(disposed||signal?.aborted||receiverEnded){await result.dispose({leave:true});return null;}return result;});s=await joining;joining=null;if(!s)return;break;}
    catch(e){joining=null;if(e.status!==409||e.code!=='still_active'||attempt===10)throw e;joinMessage='Waiting for the previous connection to close… Close any other tab using this invitation. Retrying automatically.';update();await new Promise(resolve=>{retryWake=resolve;retryTimer=setTimeout(resolve,2000);});retryWake=null;}
   }
   if(disposed||signal?.aborted||receiverEnded){await s.dispose({leave:true});return;}guest=s;joinMessage=null;sessionStorage.setItem(storageKey(p),JSON.stringify(s.resume));history.replaceState(history.state,'',location.pathname+location.search);update();
  }catch(e){
   joining=null;if(disposed||signal?.aborted||receiverEnded)return;
   if(e.status===409&&e.code==='still_active'){
    joinMessage='This invitation is active in another tab or window. Close that connection, wait 15 seconds, then choose Retry connection.';update();return;
   }
   receiverEnded=true;clearInterval(timer);state=Object.freeze({...state,phase:'ended',epoch:++epoch,message:e.code==='stale_session'?'This participant has reconnected elsewhere. Ask the host for a fresh invitation.':'Could not join. Ask the host for a fresh invitation or return to the library.'});notify();
  }
 }
 return {provider,end,revoke:id=>{insist(host,'No sharing session');return host.revoke(id);},retry:()=>guest?guest.retry():record&&!receiverEnded&&!disposed?connect():undefined,async attach(owner){
  insist(!disposed&&!signal?.aborted&&!integration,'Bridge attachment unavailable');integration=owner;lease=owner.bindSession(provider);timer=setInterval(update,250);
  if(!record){update();return;}onUI({state,receiverVideo:video});await connect();
 },dispose};
}
