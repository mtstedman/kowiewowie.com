import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Root-only headed Chromium, disposable HTTPS/API/relay lab. No focus emulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const origin=process.env.COMBINED_TEST_ORIGIN;
assert(/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin||''),'Disposable HTTPS loopback origin required');
assert.equal(process.env.ROMJS_NETPLAY_TEST_ALLOW,'disposable-local-database');
const requestedBrowserMode=process.env.COMBINED_BROWSER_MODE||'isolated';
assert(['isolated','trusted-local'].includes(requestedBrowserMode));
if(requestedBrowserMode==='trusted-local')assert.equal(process.env.COMBINED_TRUSTED_LOCAL,'authored-loopback-fixture');
const browserModeReceipt={format:'combined-browser-mode/1',requested:requestedBrowserMode,effective:requestedBrowserMode,chromium_sandbox_requested:requestedBrowserMode==='isolated',sandbox_validated:false,host_security_changed:false,scope:'Native Chromium windows, authored loopback fixture; no hostile-package isolation claim'};
if(process.env.COMBINED_BROWSER_MODE_RECEIPT)writeFileSync(process.env.COMBINED_BROWSER_MODE_RECEIPT,JSON.stringify(browserModeReceipt)+'\n',{flag:'wx',mode:0o600});

const {chromium}=await import(process.env.COMBINED_PLAYWRIGHT_MODULE||'@playwright/test');
const rows=JSON.parse(readFileSync(new URL('../htdocs/games/arcade/catalog.json',import.meta.url)));
const wait=(p,f,arg)=>p.waitForFunction(f,arg,{timeout:60000,polling:100});
test('real tab focus loss keeps paused receiver video, same-peer resume, watcher denial and revoke cleanup',{timeout:300000},async()=>{
 const native=[];const browser={close:async()=>{for(const n of native){try{await n.browser?.close();}catch{}try{process.kill(-n.proc.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,200));rmSync(n.profile,{recursive:true,force:true});}}};
 async function nativeContext(){
  const profile=mkdtempSync(join(tmpdir(),'posse-native-focus-'));const proc=spawn(chromium.executablePath(),[...(requestedBrowserMode==='trusted-local'?['--no-sandbox']:[]),'--disable-background-networking','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--ozone-platform=x11','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--ignore-certificate-errors','about:blank'],{stdio:'ignore',detached:true});const n={profile,proc};native.push(n);let port;const deadline=Date.now()+30000;while(Date.now()<deadline){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}if(proc.exitCode!==null)throw Error('Native Chromium exited');await new Promise(r=>setTimeout(r,100));}assert(port);n.browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true});return n.browser.contexts()[0];
 }

 const contexts=[],errors=[];
 async function page(){
  const c=await nativeContext();contexts.push(c);
  await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await c.addInitScript(()=>{
   const q=window.__connectionRepair={pcs:[],channels:[],workers:0,blurs:[],videos:[],frames:0};
   const create=document.createElement.bind(document);document.createElement=(...args)=>{const node=create(...args);if(node.tagName==='VIDEO')q.videos.push(node);return node;};
   window.addEventListener('blur',e=>q.blurs.push({trusted:e.isTrusted,focused:document.hasFocus()}));
   const PC=RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...a){super(...a);q.pcs.push(this);this.addEventListener('datachannel',e=>q.channels.push(e.channel));}createDataChannel(...a){const d=super.createDataChannel(...a);q.channels.push(d);return d;}};
   const W=Worker;window.Worker=class extends W{constructor(...a){super(...a);q.workers++;const send=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m?.type==='frame')q.frames++;return send(m,...rest);};}};
  });const p=await c.newPage();const front=p.bringToFront.bind(p);const title='PosseNativeFocus'+contexts.length;p.bringToFront=async()=>{await front();await p.evaluate(t=>document.title=t,title);const ids=execFileSync('xdotool',['search','--sync','--name',title],{encoding:'utf8',timeout:10000}).trim().split('\n');assert.equal(ids.length,1);execFileSync('xdotool',['windowfocus','--sync',ids[0]]);};p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));return p;
 }
 async function invitation(host,kind){await host.bringToFront();await host.locator('#invite-'+kind).click();await wait(host,()=>!!document.querySelector('#sharing-link')?.value);const u=await host.locator('#sharing-link').inputValue();await host.evaluate(()=>document.querySelector('#sharing-link').value='');return u;}
 async function relay(p){return p.evaluate(async()=>{for(const pc of __connectionRepair.pcs){const stats=[...(await pc.getStats()).values()];if(stats.some(r=>r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated&&stats.some(c=>c.id===r.localCandidateId&&c.candidateType==='relay')))return true;}return false;});}
 async function pixels(p){return p.evaluate(()=>{const v=document.querySelector('#session-surface video');if(!v||v.readyState<2||!v.videoWidth)throw Error('No decoded picture');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL();});}
 let host,guest,watcher;
 try{
  host=await page();await host.goto(origin+'/games/arcade/?package='+encodeURIComponent(rows[0].id)+'&solo=1');await host.bringToFront();await wait(host,()=>window.wowieGameHost?.getState().runtime?.ready);await host.locator('#start-game').click();
  const watchURL=await invitation(host,'watch'),playURL=await invitation(host,'play');
  // Both receiving pages remain blank until native focus loss has paused the host.
  guest=await page();watcher=await page();await host.bringToFront();
  if(!await host.evaluate(()=>wowieGameHost.getState().runtime.running))await host.locator('#resume').click();
  await wait(host,()=>document.hasFocus()&&wowieGameHost.getState().runtime.running);
  await host.evaluate(()=>__connectionRepair.blurs.length=0);await guest.bringToFront();await new Promise(r=>setTimeout(r,1000));console.log('NATIVE_FOCUS_DIAGNOSTIC',JSON.stringify({host:await host.evaluate(()=>({focused:document.hasFocus(),hidden:document.hidden,blurs:__connectionRepair.blurs,runtime:wowieGameHost.getState().runtime})),guest:await guest.evaluate(()=>({focused:document.hasFocus(),hidden:document.hidden}))}));
  await wait(host,()=>!document.hasFocus()&&__connectionRepair.blurs.some(e=>e.trusted)&&!wowieGameHost.getState().runtime.running);
  const pausedFrames=await host.evaluate(()=>__connectionRepair.frames);
  await guest.goto(playURL);await watcher.goto(watchURL);
  await wait(guest,()=>window.wowieGameHost?.getState().session.role==='guest');
  await wait(guest,()=>__connectionRepair.pcs.some(p=>p.connectionState==='connected')&&wowieGameHost.getState().session.message.includes('Ask the host to Resume'));
  assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.phase),'reconnecting');
  assert.equal(await guest.evaluate(()=>wowieGameHost.getState().canControl),false);
  assert.equal(await guest.locator('#session-surface').isVisible(),false);
  assert.equal(await guest.locator('#surface').isVisible(),true);
  assert.match(await guest.locator('[data-shared-receiver-status]').textContent(),/No picture received yet.*Ask the host to Resume/);
  assert.equal(await guest.locator('#start-game').isEnabled(),false);
  assert.equal(await guest.locator('#receiver-controls button:enabled').count(),0);
  const joined=await guest.evaluate(()=>{const v=__connectionRepair.videos.find(v=>v.srcObject);if(!v)throw Error('Missing receiver element');window.__joinedPC=__connectionRepair.pcs.find(p=>p.connectionState==='connected');window.__joinedVideo=v;return {count:__connectionRepair.pcs.length,width:v.videoWidth,readyState:v.readyState,tracks:v.srcObject.getTracks().map(t=>({kind:t.kind,state:t.readyState,muted:t.muted}))};});
  assert.equal(joined.width,0);assert.equal(joined.readyState,0);
  assert(joined.tracks.some(t=>t.kind==='video'&&t.state==='live'&&t.muted));
  assert.equal(await host.evaluate(()=>__connectionRepair.frames),pausedFrames,'Joining must not advance the paused engine');
  await host.bringToFront();await host.locator('#resume').click();
  await wait(guest,()=>wowieGameHost.getState().session.phase==='active'&&!document.querySelector('#session-surface').hidden&&document.querySelector('#session-surface video')?.videoWidth>0);
  await wait(watcher,()=>wowieGameHost.getState().session.phase==='active'&&!document.querySelector('#session-surface').hidden);
  assert(await relay(guest));assert(await relay(watcher));
  assert.equal(await guest.evaluate(()=>__connectionRepair.pcs.length),joined.count);
  assert.equal(await guest.evaluate(()=>__joinedPC.connectionState==='connected'&&document.querySelector('#session-surface video')===__joinedVideo),true);
  await wait(guest,async()=>{for(const pc of __connectionRepair.pcs)for(const r of (await pc.getStats()).values())if(r.type==='inbound-rtp'&&r.kind==='video'&&r.framesDecoded>2)return true;return false;});
  const count=await guest.evaluate(()=>{window.__repairOriginalPC=__connectionRepair.pcs.find(p=>p.connectionState==='connected');window.__repairOriginalVideo=document.querySelector('#session-surface video');return __connectionRepair.pcs.length;});
  await host.evaluate(()=>__connectionRepair.blurs.length=0);
  await guest.bringToFront();
  await wait(host,()=>!document.hasFocus()&&__connectionRepair.blurs.some(e=>e.trusted)&&!wowieGameHost.getState().runtime.running);
  await wait(guest,()=>wowieGameHost.getState().session.phase==='reconnecting'&&wowieGameHost.getState().session.message.includes('Connected—host paused/away'));
  assert.equal(await guest.locator('#session-surface').isVisible(),true);
  assert.equal(await guest.evaluate(()=>document.querySelector('#session-surface video')===__repairOriginalVideo&&__repairOriginalPC.connectionState==='connected'),true);
  assert.equal(await guest.evaluate(()=>wowieGameHost.getState().canControl),false);
  assert.equal(await guest.locator('#receiver-controls button:enabled').count(),0);
  assert.equal(await guest.locator('#session-surface video').evaluate(v=>v.paused),true);
  const picture=await pixels(guest),stoppedFrames=await host.evaluate(()=>__connectionRepair.frames);
  // Paused canvas tracks need not become muted in Chromium. Record that observation;
  // verify retained real pixels regardless. Muted-track handling has separate unit coverage.
  await new Promise(r=>setTimeout(r,5000));console.log('NATURAL_TRACK_MUTE_OBSERVED',await guest.evaluate(()=>__repairOriginalVideo.srcObject.getVideoTracks().some(t=>t.readyState==='live'&&t.muted)));
  assert.equal(await guest.locator('#session-surface').isVisible(),true);
  assert.equal(await pixels(guest),picture,'The previously decoded picture remains displayed throughout the native pause');
  assert.equal(await host.evaluate(()=>__connectionRepair.frames),stoppedFrames);
  await guest.locator('#start-game').click();assert.equal(await guest.locator('#session-surface video').evaluate(v=>v.muted),false);
  assert.equal(await guest.locator('#session-surface video').evaluate(v=>v.paused),true);
  assert.match(await host.locator('#start-game').textContent(),/Resume/);
  assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().canControl),false);
  assert.equal(await watcher.evaluate(()=>__connectionRepair.channels.length),0);
  for(const p of [guest,watcher])assert.equal(await p.evaluate(()=>__connectionRepair.workers),0);
  await host.bringToFront();await host.locator('#resume').click();
  await wait(guest,()=>wowieGameHost.getState().session.phase==='active'&&wowieGameHost.getState().canControl);
  await wait(guest,()=>!__repairOriginalVideo.paused&&__repairOriginalVideo.srcObject.getVideoTracks().some(t=>!t.muted));
  assert.equal(await guest.evaluate(()=>__connectionRepair.pcs.length),count);
  assert.equal(await guest.evaluate(()=>__repairOriginalPC.connectionState==='connected'&&document.querySelector('#session-surface video')===__repairOriginalVideo),true);
  await host.locator('#sharing-roster li[data-role="play"] button').click();
  await wait(guest,()=>wowieGameHost.getState().session.phase==='ended');
  assert.equal(await guest.locator('#session-surface').isVisible(),false);
  assert.doesNotMatch(await guest.locator('#surface').textContent(),/Connecting/);
  assert.equal(await guest.evaluate(()=>__connectionRepair.pcs.every(p=>p.connectionState==='closed')),true);
  assert.equal(await guest.locator('#receiver-controls button:enabled').count(),0);
  assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().session.role),'spectator');
  await host.locator('#sharing-end').click();await wait(watcher,()=>wowieGameHost.getState().session.phase==='ended');
  assert.doesNotMatch(await watcher.locator('#surface').textContent(),/Connecting/);assert.deepEqual(errors,[]);
 }finally{
  for(const p of [guest,watcher,host])if(p&&!p.isClosed())await p.evaluate(()=>window.wowieGameHost?.unload()).catch(()=>{});
  await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();
 }
});
