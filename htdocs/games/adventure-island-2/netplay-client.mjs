// Baseline NES page compatibility glue. No UI creation or generic-host implementation.
import {binding} from './netplay-binding.mjs';
import {createHostSession,joinParticipant,prepareJoin,prepareRejoin} from '../netplay/session.mjs';
import {captureNESOutput,nesState} from '../netplay/nes-adapter.mjs';
export const storageKey='game-network-participant:'+binding.packageId+':'+binding.artifactDigest;
export function installHost(hooks){
 let host=null,pending=null,generation=0;const listeners=new Set(),emit=e=>{for(const f of listeners)try{f(e);}catch{}};
 const adapter={version:1,packageId:binding.packageId,artifactDigest:binding.artifactDigest,capture:()=>captureNESOutput(hooks.canvas,hooks.audio),enabled:hooks.enabled,admit:hooks.admit,remote:hooks.remote,release:hooks.clearRemote,remove:hooks.removeRemote};
 const open=()=>{if(host&&!host.closed)return Promise.resolve(host);if(pending)return pending;hooks.start();const g=generation;pending=createHostSession(binding,adapter,{onEvent:emit}).then(async h=>{if(g!==generation){await h.end();throw Error('Host creation cancelled');}host=h;return h;}).finally(()=>{pending=null;});return pending;};
 const end=()=>{generation++;const h=host;host=null;return h?h.end():Promise.resolve({serverConfirmed:false});};
 const pagehide=()=>{void end();};window.addEventListener('pagehide',pagehide);
 return {version:1,binding,create:open,inviteWatch:async()=> (await open()).inviteWatch(),invitePlay:async()=> (await open()).invitePlay(),revoke:id=>{if(!host)throw Error('No host session');return host.revoke(id);},getState:()=>host?.getState()||null,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},barrier:()=>host?.release(),audio:()=>host?.audio(),end,dispose:()=>{window.removeEventListener('pagehide',pagehide);listeners.clear();return end();}};
}
export async function guestSession(callbacks){
 let saved=null,current=null,pending=null,closed=false;const listeners=new Set(),sources=new Map();
 const emit=e=>{for(const f of listeners)try{f(e);}catch{}};
 try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
 if(location.hash.startsWith('#netplay3=')){const proposed=prepareJoin(location.hash);if(saved?.room!==proposed.room||saved?.participant!==proposed.participant)saved=proposed;sessionStorage.setItem(storageKey,JSON.stringify(saved));history.replaceState(history.state,'',location.pathname+location.search);}
 const release=()=>{sources.clear();callbacks.clear();current?.release();};
 const join=()=>{if(closed)throw Error('Receiver disposed');if(current&&!current.getState().phase.includes('ended')){current.retry();return Promise.resolve(current);}if(pending)return pending;if(!saved)throw Error('Invitation required');if(saved.joined)saved=prepareRejoin(saved);sessionStorage.setItem(storageKey,JSON.stringify(saved));
  pending=joinParticipant(binding,saved,{video:callbacks.video,onEvent:e=>{if(e.type==='state'){const usable=e.state.inputEnabled;callbacks.enabled(usable);if(!usable){sources.clear();callbacks.clear();}}emit(e);}}).then(async s=>{saved=s.resume;sessionStorage.setItem(storageKey,JSON.stringify(saved));if(closed){await s.dispose();throw Error('Receiver disposed');}current=s;return s;}).finally(()=>{pending=null;});return pending;};
 const blur=()=>release(),hidden=()=>{if(document.hidden)release();},pagehide=()=>{closed=true;release();void current?.dispose();};
 window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',pagehide);callbacks.enabled(false);
 return {version:1,binding,join,getState:()=>current?.getState()||null,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},retry:()=>current?.retry(),enableAudio:()=>current?.enableAudio(),release,changed(){if(!current)return;const values=nesState(callbacks.state()),s=current.getState();for(const [control,pressed] of Object.entries(values)){const old=sources.get(control)||false;if(old===pressed)continue;const accepted=current.input({control,source:'nes:'+control,pressed,epoch:s.epoch});if(accepted)sources.set(control,pressed);}},async end(){closed=true;release();window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',pagehide);sessionStorage.removeItem(storageKey);listeners.clear();return current?.dispose({leave:true});}};
}
