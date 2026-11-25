import {loadBinding,receiveIntent,createBridge} from './session-bridge.mjs';
import {createHostSyncSession,joinSyncParticipant} from '../netplay/sync-session.mjs';
// Optional services are a private test seam; the production caller uses defaults.
export function createSharing({loadBinding:readBinding=loadBinding,createBridge:makeBridge=(p,b,record,options)=>createBridge(p,b,record,{...options,replica:true,sessionFactory:createHostSyncSession,joinFactory:joinSyncParticipant})}={}){
 let current=null;
 const live=plan=>current===plan&&!plan.closed&&!plan.signal.aborted;
 function fail(plan){if(!live(plan))return;const n=document.getElementById('session-state');if(n){n.hidden=false;n.textContent='Sharing operation failed. Try again or return to the library.';}}
 function clearInvitation(plan){const u=plan.ui;if(!u)return;u.link.value='';u.link.hidden=true;u.copy.hidden=true;u.status.textContent='';plan.invited=null;}
 function cleanup(plan,reason='dispose'){
  if(plan.cleanup)return plan.cleanup;
  plan.closed=true;plan.signal.removeEventListener('abort',plan.abort);
  plan.events.abort();clearInvitation(plan);plan.ui?.roster.replaceChildren();plan.ui?.panel.remove();plan.ui=null;
  if(current===plan)current=null;
  plan.cleanup=Promise.resolve().then(()=>plan.bridge?.dispose(reason));
  // The host also awaits the bridge's idempotent disposal.
  plan.cleanup.catch(()=>{});return plan.cleanup;
 }
 function buildUI(plan){
  const panel=document.createElement('section');panel.id='sharing-controls';panel.hidden=true;panel.setAttribute('aria-label','Shared game');
  const link=document.createElement('input');link.id='sharing-link';link.type='text';link.readOnly=true;link.hidden=true;link.setAttribute('aria-label','Invitation link');
  const copy=document.createElement('button');copy.id='sharing-copy';copy.type='button';copy.textContent='Copy invitation';copy.hidden=true;
  const end=document.createElement('button');end.id='sharing-end';end.type='button';end.textContent='End sharing';
  const retry=document.createElement('button');retry.id='sharing-retry';retry.type='button';retry.textContent='Retry connection';retry.hidden=true;
  const status=document.createElement('p');status.id='sharing-copy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const roster=document.createElement('ul');roster.id='sharing-roster';panel.append(link,copy,end,retry,status,roster);
  const anchor=document.getElementById('session-state');if(anchor)anchor.after(panel);else(document.getElementById('player')||document.body).append(panel);
  plan.ui={panel,link,copy,end,retry,status,roster};
  copy.addEventListener('click',async()=>{
   if(!live(plan)||!link.value||panel.hidden)return;
   const value=link.value;copy.disabled=true;
   try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(value);if(live(plan)&&link.value===value)status.textContent='Invitation copied.';}
   catch{if(live(plan)&&link.value===value){link.focus();link.select();status.textContent='Select and copy the invitation link.';}}
   finally{if(live(plan))copy.disabled=false;}
  },{signal:plan.events.signal});
  end.addEventListener('click',async()=>{
   if(!live(plan)||!plan.bridge||plan.ending)return;
   plan.ending=true;end.disabled=true;clearInvitation(plan);roster.replaceChildren();
   try{await plan.bridge.end();}catch{fail(plan);}finally{plan.ending=false;if(live(plan))render(plan,{state:plan.bridge.provider.getState()});}
  },{signal:plan.events.signal});
  retry.addEventListener('click',()=>{if(live(plan))Promise.resolve().then(()=>plan.bridge?.retry()).catch(()=>fail(plan));},{signal:plan.events.signal});
 }
 function render(plan,e){
  if(!live(plan)||!plan.ui)return;
  const u=plan.ui;
  if(e.receiverVideo){const mount=document.querySelector('[data-shared-receiver-video]');if(mount)mount.append(e.receiverVideo);}
  if(e.state)plan.state=e.state;
  const state=plan.state,visible=Boolean(state&&['host','guest','spectator'].includes(state.role)&&!['inactive','ended','incompatible'].includes(state.phase));
  u.panel.hidden=!visible;u.end.disabled=plan.ending;u.end.textContent=state?.role==='host'?'End sharing':'Leave shared game';
  u.retry.hidden=!visible||!['guest','spectator'].includes(state?.role);
  if(!visible){clearInvitation(plan);u.roster.replaceChildren();plan.rosterKey='';}
  if(e.invite&&visible&&state.role==='host'){
   plan.invited=e.assignment?.participant||null;u.link.value=e.invite;u.link.hidden=false;u.copy.hidden=false;u.status.textContent='Invitation ready to copy.';
  }
  if(e.participants&&visible&&state.role==='host'){
   const signature=JSON.stringify(e.participants);
   if(signature!==plan.rosterKey){plan.rosterKey=signature;u.roster.replaceChildren();
    for(const a of e.participants){
     const li=document.createElement('li');li.dataset.participant=a.participant;li.dataset.role=a.participant_role;
     const label=document.createElement('span');label.textContent=(a.participant_role==='watch'?'Viewer':'Play participant')+(a.joined?' · joined':' · invited');
     const button=document.createElement('button');button.type='button';button.textContent='Revoke';button.setAttribute('aria-label','Revoke '+(a.participant_role==='watch'?'viewer':'play participant'));
     button.onclick=()=>{if(!live(plan))return;button.disabled=true;if(plan.invited===a.participant)clearInvitation(plan);Promise.resolve().then(()=>plan.bridge.revoke(a.participant)).catch(()=>{if(live(plan)){button.disabled=false;fail(plan);}});};
     li.append(label,button);u.roster.append(li);
    }
   }
  }
  if(e.end?.serverConfirmed===false){const n=document.getElementById('session-state');if(n){n.hidden=false;n.textContent='Sharing stopped locally. Server cleanup is awaiting confirmation or lease expiry.';}}
 }
 return {
  async load(p,signal,route={},importAdapter){
   if(current)await cleanup(current,'package-change');
   if(signal.aborted)throw Error('Selection superseded');
   if(p.capabilities.play==='none'&&!p.capabilities.watch){
    if(!route.solo&&new URL(route.href||location.href,location.origin).hash.startsWith('#netplay'))throw Error('Sharing is unavailable for this package');
    return importAdapter(p,signal);
   }
   const record=receiveIntent(p,route.href,route.solo);
   const plan={p,signal,record,bridge:null,ui:null,closed:false,cleanup:null,attaching:null,ending:false,state:null,events:new AbortController(),rosterKey:'',invited:null};
   plan.abort=()=>{void cleanup(plan,typeof signal.reason==='string'?signal.reason:'selection-aborted');};
   current=plan;signal.addEventListener('abort',plan.abort,{once:true});buildUI(plan);
   try{
    // Receiving clients run the same verified cartridge in a storage-isolated replica.
    const source=await importAdapter(p,signal);
    const module=record?{version:source.version,createAdapter:ctx=>source.createAdapter({...ctx,replica:true})}:source;
    if(!live(plan))throw Error('Selection superseded');return module;
   }catch(e){await cleanup(plan,'load-error');throw e;}
  },
  async attach(owner){
   const plan=current;if(!plan||!live(plan)||owner.getPackage()?.artifactDigest!==plan.p.artifactDigest)return;
   if(plan.attaching)return plan.attaching;
   plan.attaching=(async()=>{
    try{
     const b=await readBinding(plan.p,plan.signal);
     if(!live(plan)||owner.getPackage()?.artifactDigest!==plan.p.artifactDigest)return;
     plan.bridge=makeBridge(plan.p,b,plan.record,{signal:plan.signal,onUI:e=>render(plan,e)});
     render(plan,{state:plan.bridge.provider.getState()});
     await plan.bridge.attach(owner);
     if(!live(plan)){await plan.bridge.dispose(typeof plan.signal.reason==='string'?plan.signal.reason:'selection-aborted');return;}
     render(plan,{state:plan.bridge.provider.getState()});
    }catch(e){if(live(plan))fail(plan);if(plan.bridge)await plan.bridge.dispose('attach-error');if(plan.record)throw e;}
   })();return plan.attaching;
  },
  dispose(reason='dispose'){return current?cleanup(current,reason):Promise.resolve();}
 };
}
