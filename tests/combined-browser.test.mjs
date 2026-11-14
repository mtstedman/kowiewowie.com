import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.COMBINED_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.COMBINED_TEST_ORIGIN;
assert(/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin||''),'Use the generated disposable HTTPS lab');
const requestedBrowserMode=process.env.COMBINED_BROWSER_MODE||'isolated';
assert(['isolated','trusted-local'].includes(requestedBrowserMode),'Unknown browser fixture mode');
assert.equal(process.env.ROMJS_NETPLAY_TEST_ALLOW,'disposable-local-database','Disposable local lab required');
if(requestedBrowserMode==='trusted-local')assert.equal(process.env.COMBINED_TRUSTED_LOCAL,'authored-loopback-fixture','Trusted-local browser mode requires explicit fixture opt-in');
const browser=await chromium.launch({headless:true,chromiumSandbox:requestedBrowserMode==='isolated',timeout:30000,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
const browserModeReceipt={format:'combined-browser-mode/1',requested:requestedBrowserMode,effective:requestedBrowserMode,chromium_sandbox_requested:requestedBrowserMode==='isolated',sandbox_validated:false,host_security_changed:false,scope:'Trusted authored disposable loopback fixture only; no untrusted-package isolation validation'};
try{
 assert(process.env.COMBINED_BROWSER_MODE_RECEIPT,'Missing lab-owned mode receipt destination');
 writeFileSync(process.env.COMBINED_BROWSER_MODE_RECEIPT,JSON.stringify(browserModeReceipt)+'\n',{flag:'wx',mode:0o600});
}catch(e){await browser.close();throw e;}
const contexts=[];test.after(async()=>{await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();});
async function page(){const c=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',acceptDownloads:false});contexts.push(c);await c.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));await c.addInitScript(()=>{
 window.__probe={workers:0,liveWorkers:0,frames:[],frameCount:0,pcs:[],channels:0,ice:[],joins:[]};const q=window.__probe,W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);q.workers++;q.liveWorkers++;let dead=false;const terminate=this.terminate.bind(this);this.terminate=()=>{if(!dead){dead=true;q.liveWorkers--;}return terminate();};const send=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m?.type==='frame'){q.frameCount++;q.frames.push({buttons:m.buttons,buttons2:m.buttons2});if(q.frames.length>60)q.frames.shift();}return send(m,...rest);};}};
 const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...a){super(...a);q.pcs.push(this);this.addEventListener('datachannel',()=>q.channels++);}createDataChannel(...a){q.channels++;return super.createDataChannel(...a);}};
 const original=window.fetch.bind(window);window.fetch=async(...a)=>{const r=await original(...a),u=String(a[0]);if(u.includes('/api/v1/netplay/')){const d=await r.clone().json().catch(()=>null);if(r.ok&&u.endsWith('/ice'))q.ice.push({server_time:d.server_time,expires_at:d.expires_at});if(r.ok&&(u.endsWith('/join')||u.endsWith('/rejoin')))q.joins.push(d);}return r;};
 });const p=await c.newPage();p.setDefaultTimeout(120000);const cd=await c.newCDPSession(p);await cd.send('Emulation.setFocusEmulationEnabled',{enabled:true});return p;}
const until=(p,fn,arg,timeout=120000)=>p.waitForFunction(fn,arg,{timeout});
async function open(p,id){await p.goto(origin+'/games/arcade/?package='+id+'&solo=1');await until(p,()=>window.wowieGameHost?.getState().runtime?.ready);await p.locator('#start-game').click();await until(p,()=>window.wowieGameHost.getState().runtime.running);assert.equal(await p.locator('#sharing-controls').isVisible(),false);if(id!=='transport-diagnostic')await until(p,()=>{const n=document.getElementById('nes-fps');return n&&!n.hidden&&parseFloat(n.textContent)>0;});}
async function invite(host,kind){await host.locator('#invite-'+kind).click();await until(host,()=>!!document.getElementById('sharing-link')?.value);assert.equal(await host.getByRole('button',{name:'Copy invitation',exact:true}).isVisible(),true);const url=await host.locator('#sharing-link').inputValue();await host.evaluate(()=>{document.getElementById('sharing-link').value='';});return url;}
async function join(url){const p=await page();await p.goto(url);await until(p,()=>window.wowieGameHost?.getState().session.phase==='active');await p.locator('#start-game').click();return p;}
async function media(p){return p.evaluate(async()=>{const reports=[];for(const pc of __probe.pcs)if(pc.connectionState==='connected')reports.push(...(await pc.getStats()).values());const sum=(kind,key)=>reports.filter(r=>r.type==='inbound-rtp'&&r.kind===kind).reduce((a,r)=>a+(r[key]||0),0);const relay=reports.some(r=>r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated&&reports.some(c=>c.id===r.localCandidateId&&c.candidateType==='relay'));return {generation:__probe.pcs.length,video:sum('video','framesDecoded'),audio:sum('audio','totalSamplesReceived'),energy:sum('audio','totalAudioEnergy'),relay};});}
async function live(p){await until(p,()=>{const v=document.querySelector('#session-surface video');return v?.videoWidth>0&&!v.paused&&v.srcObject?.getAudioTracks().length===1;});const a=await media(p);await until(p,async before=>{let frames=0,samples=0,energy=0;for(const pc of __probe.pcs)if(pc.connectionState==='connected')for(const r of (await pc.getStats()).values())if(r.type==='inbound-rtp'){if(r.kind==='video')frames+=r.framesDecoded||0;if(r.kind==='audio'){samples+=r.totalSamplesReceived||0;energy+=r.totalAudioEnergy||0;}}const changed=__probe.pcs.length>before.generation;return frames>(changed?5:before.video+5)&&samples>(changed?1000:before.audio+1000)&&energy>(changed?0:before.energy);},a);const b=await media(p);assert(b.relay,'Actual relay-selected media required');return b;}
async function edge(p,label,pressed){if(!pressed){await p.mouse.up();return;}await p.evaluate(()=>{document.getElementById('help').open=true;});const button=p.locator('#input-buttons button[aria-label="'+label+' game control"]');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box);await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();}

// Observe actual worker inputs or diagnostic adapter inputs, never inject them.
const heldMatches=({two,a,right})=>{
 if(two){const h=globalThis.__diagnostic?.held||[];return h.length===Number(a)+Number(right)&&h.some(e=>e.seat===1&&e.control==='a'&&e.role==='host'&&e.source.startsWith('local:'))===a&&h.some(e=>e.seat===2&&e.control==='right'&&e.role==='guest'&&e.source.startsWith('remote:'))===right;}
 const f=__probe.frames.slice(-5);return f.length===5&&f.every(v=>Boolean(v.buttons[0])===a&&Boolean(v.buttons[7])===right&&v.buttons2.every(x=>!x));
};
const waitHeld=(host,two,a,right)=>until(host,heldMatches,{two,a,right});
async function proveIndependentHold(host,guest,two){
 await waitHeld(host,two,true,true);
 const epoch=await guest.evaluate(()=>wowieGameHost.getState().session.epoch);
 const before=await host.evaluate(two=>two?__diagnostic.frames:__probe.frameCount,two);
 for(let i=0;i<14;i++){
  await new Promise(resolve=>setTimeout(resolve,250));
  const current=await guest.evaluate(()=>({session:wowieGameHost.getState().session,enabled:!document.querySelector('#input-buttons button[aria-label="Right game control"]').disabled}));
  assert.equal(current.session.phase,'active');assert.equal(current.session.epoch,epoch,'Held input must not create session-release feedback');assert.equal(current.enabled,true);
  assert.equal(await host.evaluate(heldMatches,{two,a:true,right:true}),true,'Host A and guest Right must remain independently held for the complete observation window');
 }
 assert((await host.evaluate(two=>two?__diagnostic.frames:__probe.frameCount,two))>before,'Held assertions must observe advancing frames');
 await edge(guest,'Right',false);await waitHeld(host,two,true,false);
 await edge(guest,'Right',true);await waitHeld(host,two,true,true);
 await edge(host,'A',false);await waitHeld(host,two,false,true);
 await edge(host,'A',true);await waitHeld(host,two,true,true);
}

async function forgedWatcher(p){const result=await p.evaluate(async()=>{const a=__probe.joins.at(-1),pkg=wowieGameHost.getPackage(),record=JSON.parse(sessionStorage.getItem('combined-participant:'+pkg.id+':'+pkg.artifactDigest));const body={package:pkg.id,artifact:pkg.artifactDigest,binding:a.binding,room:record.room,credential:record.credential,participant:a.participant,session:a.session,role:'guest',participant_role:'play',player:'player-1'};const r=await fetch('/api/v1/netplay/ice',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Netplay-Protocol':'3'},body:JSON.stringify(body)});return {status:r.status,input:a.capabilities.input,workers:__probe.workers,channels:__probe.channels};});assert.equal(result.status,403);assert.equal(result.input,false);assert.equal(result.workers,0);assert.equal(result.channels,0);await p.evaluate(()=>{document.querySelector('#input-buttons button')?.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:9,bubbles:true}));});assert.equal(await p.evaluate(()=>__probe.channels),0);}
for(const id of ['megaman','adventure-island-2'])test(id+': independent real media, watch/play, reconnect, revoke and same-document navigation',{timeout:420000},async()=>{
 const host=await page();await open(host,id);const timeOrigin=await host.evaluate(()=>performance.timeOrigin);const watcher=await join(await invite(host,'watch'));await live(watcher);await forgedWatcher(watcher);
 const guest=await join(await invite(host,'play'));await live(guest);assert.equal(await guest.evaluate(()=>__probe.workers),0);assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.role),'guest');
 await edge(host,'A',true);await edge(guest,'Right',true);await until(host,()=>__probe.frames.slice(-10).some(f=>f.buttons[0]&&f.buttons[7]&&f.buttons2.every(v=>!v)));await proveIndependentHold(host,guest,false);
 const epoch=await guest.evaluate(()=>wowieGameHost.getState().session.epoch);await guest.context().setOffline(true);await until(guest,()=>wowieGameHost.getState().session.phase==='reconnecting',null,45000);await until(host,()=>__probe.frames.length>=5&&__probe.frames.slice(-5).every(f=>f.buttons[0]&&!f.buttons[7]));await guest.context().setOffline(false);await until(guest,e=>wowieGameHost.getState().session.phase==='active'&&wowieGameHost.getState().session.epoch>e,epoch);await edge(guest,'Right',false);await edge(guest,'Right',true);await until(host,()=>__probe.frames.slice(-5).some(f=>f.buttons[7]));
 // Use DOM click for sharing operations so the host's separate mouse-held game input stays held.
 await host.locator('#sharing-roster li[data-role="play"] button').evaluate(b=>b.click());await until(guest,()=>wowieGameHost.getState().session.phase==='ended');await until(host,()=>__probe.frames.slice(-5).every(f=>f.buttons[0]&&!f.buttons[7]));await live(watcher);await edge(host,'A',false);await edge(guest,'Right',false);
 await watcher.evaluate(()=>wowieGameHost.unload());assert.equal(await watcher.locator('#sharing-controls').count(),0);assert.equal(await watcher.locator('#sharing-link').count(),0);await until(host,()=>!document.querySelector('#sharing-roster li[data-role="watch"]'));assert.equal(await watcher.evaluate(()=>__probe.pcs.every(p=>p.connectionState==='closed')),true);
 const second=await join(await invite(host,'watch'));await live(second);await host.locator('#sharing-end').click();await until(host,()=>document.getElementById('sharing-controls')?.hidden===true);assert.equal(await host.locator('#sharing-link').inputValue(),'');assert.equal(await host.locator('#sharing-roster li').count(),0);await until(second,()=>wowieGameHost.getState().session.phase==='ended');assert.equal(await second.evaluate(()=>__probe.pcs.every(p=>p.connectionState==='closed')),true);
 const other=id==='megaman'?'adventure-island-2':'megaman';await host.evaluate(id=>wowieGameHost.select(id),other);await until(host,id=>wowieGameHost.getPackage()?.id===id&&wowieGameHost.getState().runtime.ready,other);assert.equal(await host.evaluate(()=>performance.timeOrigin),timeOrigin);assert.equal(await host.evaluate(()=>__probe.liveWorkers),1);await host.goBack();await until(host,id=>wowieGameHost.getPackage()?.id===id&&wowieGameHost.getState().runtime?.ready,id);assert.equal(await host.evaluate(()=>performance.timeOrigin),timeOrigin);await host.evaluate(()=>wowieGameHost.unload());assert.equal(await host.evaluate(()=>__probe.liveWorkers),0);
 await Promise.all([host,watcher,guest,second].map(p=>p.context().close()));
});
test('diagnostic P1/P2 isolation and actual relay allocation renewal; not two-player gameplay',{timeout:840000},async()=>{
 const host=await page();await open(host,'transport-diagnostic');const guest=await join(await invite(host,'play'));await live(guest);await edge(host,'A',true);await edge(guest,'Right',true);
 await until(host,()=>__diagnostic.held.some(e=>e.seat===1&&e.control==='a')&&__diagnostic.held.some(e=>e.seat===2&&e.control==='right'));await proveIndependentHold(host,guest,true);assert.match(await host.locator('#surface').innerText(),/not real two-player gameplay/);
 const initial=await guest.evaluate(()=>({ice:__probe.ice.at(-1),pcs:__probe.pcs.length}));assert(initial.ice);const untilTime=Date.now()+(initial.ice.expires_at-initial.ice.server_time)*1000+15000;let previous=await media(guest);
 while(Date.now()<untilTime){await new Promise(r=>setTimeout(r,20000));const next=await live(guest);assert(next.generation>previous.generation||(next.video>previous.video&&next.audio>previous.audio));previous=next;}
 assert(await guest.evaluate(first=>__probe.ice.some(i=>i.expires_at>first.ice.expires_at)&&__probe.pcs.length>first.pcs,initial),'New credentials and a new peer connection are required');assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.phase),'active');
 await edge(guest,'Right',false);await edge(guest,'Right',true);await until(host,()=>__diagnostic.held.some(e=>e.seat===2));await host.locator('#sharing-roster li[data-role="play"] button').evaluate(b=>b.click());await until(host,()=>__diagnostic.held.some(e=>e.seat===1&&e.control==='a')&&!__diagnostic.held.some(e=>e.seat===2));await edge(host,'A',false);await host.locator('#sharing-end').click();await host.context().close();await guest.context().close();
});

// Additional receiver proofs. The complete reviewed browser source above is unchanged.
// Only the physical gamepad API is simulated; input/host/transport implementations are real.
const receiverDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function receiverPadInstall(p){await p.evaluate(()=>{
 const prior=Object.getOwnPropertyDescriptor(navigator,'getGamepads');
 window.__receiverPad={index:0,id:'Disposable standard gamepad fixture',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 window.__receiverPadReads=0;
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{__receiverPadReads++;return [__receiverPad];}});
 window.__receiverRestorePad=()=>{if(prior)Object.defineProperty(navigator,'getGamepads',prior);else delete navigator.getGamepads;delete window.__receiverPad;};
});}
async function receiverPadSet(p,buttons=[],axes=[0,0],wait=true){
 const reads=await p.evaluate(({buttons,axes})=>{__receiverPad.axes=axes;__receiverPad.buttons=Array.from({length:17},(_,i)=>({pressed:buttons.includes(i),value:buttons.includes(i)?1:0}));return __receiverPadReads;},{buttons,axes});
 if(wait)await until(p,n=>__receiverPadReads>=n+2,reads,10000);
}
async function receiverObservation(host,guest,two,right){
 await waitHeld(host,two,true,right);
 const before=await host.evaluate(two=>two?__diagnostic.frames:__probe.frameCount,two);
 const epoch=await guest.evaluate(()=>wowieGameHost.getState().session.epoch);
 for(let n=0;n<8;n++){
  await receiverDelay(125);assert.equal(await host.evaluate(heldMatches,{two,a:true,right}),true,'Independent host A and receiver input must persist throughout observation');
  if(right){assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.epoch),epoch);assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.phase),'active');}
 }
 assert((await host.evaluate(two=>two?__diagnostic.frames:__probe.frameCount,two))>before);
}
async function receiverTouchPoint(p,id){const b=p.locator('#receiver-controls [data-receiver-control="'+id+'"]');await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();assert(box);return {x:box.x+box.width/2,y:box.y+box.height/2,id:41};}

for(const id of ['megaman','adventure-island-2','transport-diagnostic'])test(id+': receiver keyboard, gamepad and touch use the host boundary; watcher stays inputless',{timeout:300000},async()=>{
 const two=id==='transport-diagnostic',host=await page();let guest,watcher,cd;
 try{
  await open(host,id);watcher=await join(await invite(host,'watch'));await live(watcher);await forgedWatcher(watcher);
  guest=await join(await invite(host,'play'));await live(guest);
  assert.equal(await guest.evaluate(()=>__probe.workers),0);assert.equal(await watcher.evaluate(()=>__probe.workers),0);
  await guest.evaluate(()=>{document.getElementById('details').open=true;});await guest.locator('#touch-mode').selectOption('on');
  await until(guest,()=>wowieGameHost.getState().session.phase==='active');await receiverDelay(750);
  assert.equal(await guest.locator('#receiver-controls').isVisible(),true);assert.equal(await watcher.locator('#receiver-controls').isVisible(),false);
  await edge(host,'A',true);await guest.locator('#session-surface video').click();
  assert.equal(await guest.evaluate(()=>document.activeElement.id),'session-surface');
  await guest.keyboard.down('ArrowRight');await receiverObservation(host,guest,two,true);
  await edge(host,'A',false);await waitHeld(host,two,false,true);await edge(host,'A',true);await waitHeld(host,two,true,true);
  await guest.keyboard.up('ArrowRight');await waitHeld(host,two,true,false);
  // Losing stream/controller focus clears only receiver sources. Held-key repeat cannot rearm.
  await guest.keyboard.down('ArrowRight');await waitHeld(host,two,true,true);await guest.locator('#touch-mode').focus();await waitHeld(host,two,true,false);
  await guest.locator('#session-surface').focus();await guest.keyboard.down('ArrowRight');await receiverObservation(host,guest,two,false);
  await guest.keyboard.up('ArrowRight');await guest.keyboard.down('ArrowRight');await receiverObservation(host,guest,two,true);await guest.keyboard.up('ArrowRight');await waitHeld(host,two,true,false);
  await guest.locator('#touch-mode').focus();await guest.keyboard.down('ArrowRight');await receiverObservation(host,guest,two,false);await guest.keyboard.up('ArrowRight');
  // No special input injection seam: the real module polls navigator.getGamepads.
  await receiverPadInstall(guest);await guest.locator('#session-surface').focus();await receiverPadSet(guest);
  await receiverPadSet(guest,[15]);await receiverObservation(host,guest,two,true);
  await guest.locator('#touch-mode').focus();await waitHeld(host,two,true,false);await guest.locator('#session-surface').focus();await receiverObservation(host,guest,two,false);
  await receiverPadSet(guest);await receiverPadSet(guest,[],[.7,0]);await receiverObservation(host,guest,two,true);await receiverPadSet(guest);await waitHeld(host,two,true,false);
  // The outside-focus ArrowRight check can change the native select. Verify Off, then restore On for touch.
  const receiverTouchPad=guest.locator('#receiver-controls .receiver-pad'),receiverTouchRight=guest.locator('#receiver-controls [data-receiver-control="right"]');
  assert.equal(await receiverTouchPad.count(),1);assert.equal(await receiverTouchRight.count(),1);
  await guest.locator('#touch-mode').selectOption('off');assert.equal(await guest.locator('#touch-mode').inputValue(),'off');
  await receiverTouchPad.waitFor({state:'hidden',timeout:10000});
  assert.equal(await receiverTouchPad.isVisible(),false,'Off hides receiver touch controls');assert.equal(await receiverTouchRight.isVisible(),false,'Off hides the receiver touch target');
  await guest.locator('#touch-mode').selectOption('on');assert.equal(await guest.locator('#touch-mode').inputValue(),'on');
  // Setting changes release remote input; no public barrier acknowledgement is exposed. Retain the established active + 750ms settling pattern.
  await until(guest,()=>wowieGameHost.getState().session.phase==='active',undefined,10000);await receiverDelay(750);
  await until(guest,()=>{const s=wowieGameHost.getState(),b=document.querySelector('#receiver-controls [data-receiver-control="right"]');return s.session.role==='guest'&&s.session.phase==='active'&&s.canControl===true&&b?.disabled===false;},undefined,10000);
  await receiverTouchPad.waitFor({state:'visible',timeout:10000});await receiverTouchRight.waitFor({state:'visible',timeout:10000});
  assert.equal(await receiverTouchPad.isVisible(),true,'On shows receiver touch controls');assert.equal(await receiverTouchRight.isVisible(),true,'On restores the receiver touch target');
  assert.equal(await receiverTouchRight.isEnabled(),true,'Receiver touch target is enabled after the setting release has settled');
  // Real browser touch dispatch must produce a trusted touch pointer and reach the remote host.
  await guest.evaluate(()=>{window.__receiverTouches=[];document.addEventListener('pointerdown',e=>{if(e.target.closest('#receiver-controls'))__receiverTouches.push({type:e.pointerType,trusted:e.isTrusted});},{capture:true});});
  cd=await guest.context().newCDPSession(guest);await cd.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  let point=await receiverTouchPoint(guest,'right');await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await receiverObservation(host,guest,two,true);
  assert.equal(await guest.evaluate(()=>__receiverTouches.some(e=>e.type==='touch'&&e.trusted)),true);
  await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:2,y:2}]});await waitHeld(host,two,true,true);
  await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await waitHeld(host,two,true,false);
  point=await receiverTouchPoint(guest,'right');await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await waitHeld(host,two,true,true);
  await cd.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await receiverObservation(host,guest,two,false);
  await cd.send('Emulation.setTouchEmulationEnabled',{enabled:false});await cd.detach();cd=null;
  // Watchers retain no input channel even when all three input sources are attempted.
  await receiverPadInstall(watcher);await watcher.locator('#session-surface').focus();await watcher.keyboard.down('ArrowRight');await receiverPadSet(watcher,[15],[.7,0],false);
  await watcher.evaluate(()=>{const b=document.querySelector('#receiver-controls [data-receiver-control="right"]');if(!b)throw Error('Missing watcher control guard fixture');b.disabled=false;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:19,pointerType:'touch'}));b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:19,pointerType:'touch'}));});
  await receiverObservation(host,guest,two,false);await watcher.keyboard.up('ArrowRight');
  assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().session.role),'spectator');assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().canControl),false);
  assert.equal(await watcher.evaluate(()=>__probe.channels),0);assert.equal(await watcher.evaluate(()=>__probe.workers),0);await forgedWatcher(watcher);
  // The unchanged 3.5-second assertions still run in the original tests. Repeat them here after device changes.
  await edge(guest,'Right',true);await proveIndependentHold(host,guest,two);await edge(guest,'Right',false);await waitHeld(host,two,true,false);
  assert.equal(await guest.evaluate(()=>__probe.workers),0);await guest.evaluate(()=>wowieGameHost.unload());assert.equal(await guest.locator('#receiver-controls').count(),0);
  await waitHeld(host,two,true,false);await watcher.evaluate(()=>wowieGameHost.unload());assert.equal(await watcher.locator('#receiver-controls').count(),0);
 }finally{
  if(cd){await cd.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});await cd.detach().catch(()=>{});}
  for(const p of [guest,watcher])if(p&&!p.isClosed()){await p.keyboard.up('ArrowRight').catch(()=>{});await p.evaluate(()=>window.__receiverRestorePad?.()).catch(()=>{});}
  await edge(host,'A',false).catch(()=>{});await Promise.allSettled([guest,watcher,host].filter(Boolean).map(p=>p.context().close()));
 }
});
