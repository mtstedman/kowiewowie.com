// Actual NES emulation and production transport over disposable authenticated TURN.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.COMBINED_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.COMBINED_TEST_ORIGIN,mode=process.env.COMBINED_BROWSER_MODE||'isolated';
assert(/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin||''));
assert.equal(process.env.ROMJS_NETPLAY_TEST_ALLOW,'disposable-local-database');
assert(['isolated','trusted-local'].includes(mode));
if(mode==='trusted-local')assert.equal(process.env.COMBINED_TRUSTED_LOCAL,'authored-loopback-fixture');
const output=path.dirname(process.env.COMBINED_BROWSER_MODE_RECEIPT),contexts=[],browsers=[],reports=[],errors=[];
writeFileSync(process.env.COMBINED_BROWSER_MODE_RECEIPT,JSON.stringify({format:'combined-browser-mode/1',requested:mode,effective:mode,chromium_sandbox_requested:mode==='isolated',sandbox_validated:false,host_security_changed:false})+'\n',{flag:'wx',mode:0o600});
test.after(async()=>{const diagnostics=[];for(const context of contexts)for(const page of context.pages())try{diagnostics.push(await page.evaluate(()=>({session:window.wowieGameHost?{role:wowieGameHost.getState().session.role,phase:wowieGameHost.getState().session.phase,message:wowieGameHost.getState().session.message}:null,videos:[...document.querySelectorAll('video')].map(v=>({connected:v.isConnected,width:v.videoWidth,readyState:v.readyState,paused:v.paused,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,muted:t.muted,readyState:t.readyState}))})),bindings:window.__repair?.bindings,requests:window.__repair?.requests,rtcErrors:window.__repair?.rtcErrors,peers:window.__repair?.pcs.map(p=>({connection:p.connectionState,ice:p.iceConnectionState,signaling:p.signalingState}))})));}catch{}writeFileSync(path.join(output,'netplay-repair-diagnostics.json'),JSON.stringify(diagnostics,null,2));await Promise.allSettled(contexts.map(c=>c.close()));await Promise.allSettled(browsers.map(b=>b.close()));writeFileSync(path.join(output,'netplay-repair.json'),JSON.stringify({format:'netplay-browser-repair/1',reports,errors,scope:'Actual Contra emulation, one WebKit play participant and two independent WebKit/Chromium spectators; direct local play and authenticated loopback TURN for viewers, first-frame mounting, input ownership and cleanup. No production sessions or WAN quality claim.'},null,2));});
const until=(p,fn,arg,timeout=60000)=>p.waitForFunction(fn,arg,{timeout});
async function page(browser,name){
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});contexts.push(context);
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.addInitScript(()=>{
  const probe=window.__repair={workers:0,liveWorkers:0,frames:0,inputs:[],pcs:[],channels:0,bindings:[],requests:[],rtcErrors:[]};
  const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);probe.workers++;probe.liveWorkers++;let closed=false;const terminate=this.terminate.bind(this);this.terminate=()=>{if(!closed){closed=true;probe.liveWorkers--;}return terminate();};this.addEventListener('message',e=>{if(e.data?.type==='frame')probe.frames++;});const send=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m?.type==='input'){probe.inputs.push({seat:m.seat,button:m.button,pressed:m.pressed});if(probe.inputs.length>100)probe.inputs.shift();}return send(m,...rest);};}};
  const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...args){super(...args);probe.pcs.push(this);this.addEventListener('datachannel',()=>probe.channels++);}createDataChannel(...args){probe.channels++;return super.createDataChannel(...args);}async setRemoteDescription(...args){try{return await super.setRemoteDescription(...args);}catch(e){probe.rtcErrors.push({method:'setRemoteDescription',message:e.message});throw e;}}async setLocalDescription(...args){try{return await super.setLocalDescription(...args);}catch(e){probe.rtcErrors.push({method:'setLocalDescription',message:e.message});throw e;}}};
  const fetcher=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await fetcher(...args);if(String(args[0]).includes('/api/v1/netplay/')&&!response.ok){const body=await response.clone().json().catch(()=>({}));probe.requests.push({action:String(args[0]).split('/').at(-1),status:response.status,error:body.error,message:body.message});}return response;};
  const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{...descriptor,set(stream){if(this.hasAttribute('data-shared-receiver-media')&&stream)probe.bindings.push({connected:this.isConnected,tracks:stream.getTracks().map(t=>t.kind)});return descriptor.set.call(this,stream);}});
 });
 const p=await context.newPage();p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push({browser:name,message:e.message}));
 if(name==='chromium'){const cd=await context.newCDPSession(p);await cd.send('Emulation.setFocusEmulationEnabled',{enabled:true});}
 return p;
}
async function invite(host,kind){await host.locator('#invite-'+kind).click();await until(host,()=>Boolean(document.getElementById('sharing-link').value));const url=await host.locator('#sharing-link').inputValue();await host.evaluate(()=>{document.getElementById('sharing-link').value='';});return url;}
async function receive(p,url,role,label){
 await p.goto(url);await until(p,role=>window.wowieGameHost?.getState().session.role===role&&wowieGameHost.getState().session.phase==='active',role);
 await until(p,()=>{const video=document.querySelector('#session-surface video');return video?.isConnected&&video.readyState>=2&&video.videoWidth>0&&!video.paused;});
 await p.locator('#start-game').click();
 const result=await p.evaluate(async()=>{
  const video=document.querySelector('#session-surface video'),inbound=[],candidates=[],policies=[];
  for(const pc of __repair.pcs)if(pc.connectionState==='connected'){
   policies.push(pc.getConfiguration().iceTransportPolicy);const rows=[...(await pc.getStats()).values()];
   for(const r of rows){if(r.type==='inbound-rtp')inbound.push({kind:r.kind||r.mediaType,framesDecoded:r.framesDecoded||0,packetsReceived:r.packetsReceived||0,totalAudioEnergy:r.totalAudioEnergy??null});if(r.type==='candidate-pair'&&r.state==='succeeded'&&(r.nominated||r.selected))candidates.push({local:rows.find(c=>c.id===r.localCandidateId)?.candidateType,remote:rows.find(c=>c.id===r.remoteCandidateId)?.candidateType});}
  }
  return {role:wowieGameHost.getState().session.role,canControl:wowieGameHost.getState().canControl,workers:__repair.workers,channels:__repair.channels,bindings:__repair.bindings,width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,muted:video.muted,connected:video.isConnected,inbound,candidates,policies};
 });
 assert.equal(result.role,role);assert.equal(result.workers,0);assert(result.bindings.length>=2);assert(result.bindings.every(b=>b.connected&&b.tracks.length>0),'Every initial populated binding must already be mounted');
 if(role==='spectator'){assert(result.policies.every(p=>p==='relay'));assert(result.candidates.some(p=>p.local==='relay'&&p.remote==='relay'),'Both watcher ends must use authenticated TURN');}else{assert(result.policies.every(p=>p==='all'));assert(result.candidates.some(p=>p.local!=='relay'&&p.remote!=='relay'),'Local player connection should use the direct path');}assert.equal(result.muted,false);
 if(role==='spectator'){assert.equal(result.channels,0);assert.equal(result.canControl,false);assert.equal(await p.locator('#receiver-controls').isVisible(),false);}
 else assert.equal(result.canControl,true);
 await p.locator('#session-surface').screenshot({path:path.join(output,label+'.png')});reports.push({label,...result});return result;
}
test('NES host streams on first join to WebKit play and two independent WebKit/Chromium watchers',{timeout:240000},async()=>{
 const c=await chromium.launch({headless:true,chromiumSandbox:mode==='isolated',args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});browsers.push(c);
 const w=await webkit.launch({headless:true});browsers.push(w);
 const host=await page(c,'chromium');await host.goto(origin+'/games/arcade/?package=contra&solo=1');await until(host,()=>window.wowieGameHost?.getState().runtime?.ready);await host.locator('#start-game').click();await until(host,()=>__repair.frames>120);await host.locator('.nes-view').focus();await host.keyboard.press('Enter');
 const guest=await page(w,'webkit-play');await receive(guest,await invite(host,'play'),'guest','webkit-play');
 const watcher1=await page(w,'webkit-watch');await receive(watcher1,await invite(host,'watch'),'spectator','webkit-watch');
 const watcher2=await page(c,'chromium-watch');await receive(watcher2,await invite(host,'watch'),'spectator','chromium-watch');
 assert.equal(await host.locator('#sharing-roster li[data-role=watch]').count(),2);
 await guest.bringToFront();await guest.locator('#session-surface').focus();await guest.keyboard.down('ArrowRight');await until(host,()=>__repair.inputs.some(e=>e.seat===2&&e.button===7&&e.pressed));await guest.keyboard.up('ArrowRight');await until(host,()=>__repair.inputs.some(e=>e.seat===2&&e.button===7&&!e.pressed));
 reports.push({label:'independent-roles',nativeNES:true,guestSeat:2,watchers:2,guestPressRelease:true});
 await host.locator('#pause').click();await until(guest,()=>wowieGameHost.getState().session.message.includes('host paused'));await host.locator('#resume').click();await until(guest,()=>wowieGameHost.getState().session.phase==='active');
 await host.locator('#sharing-end').click();for(const p of [guest,watcher1,watcher2])await until(p,()=>wowieGameHost.getState().session.phase==='ended');
 await host.evaluate(()=>wowieGameHost.unload());assert.equal(await host.evaluate(()=>__repair.liveWorkers),0);assert.deepEqual(errors,[]);
 reports.push({label:'cleanup',allParticipantsEnded:true,workersStopped:true});
});
