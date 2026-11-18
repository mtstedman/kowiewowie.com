// Real browser/API/TURN fixture. No ROM/RAM patching or direct runtime input injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.COMBINED_PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.COMBINED_TEST_ORIGIN,mode=process.env.COMBINED_BROWSER_MODE||'isolated';
assert(/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin||''));
assert.equal(process.env.ROMJS_NETPLAY_TEST_ALLOW,'disposable-local-database');
assert(['isolated','trusted-local'].includes(mode));
if(mode==='trusted-local')assert.equal(process.env.COMBINED_TRUSTED_LOCAL,'authored-loopback-fixture');
const browser=await chromium.launch({headless:true,chromiumSandbox:mode==='isolated',args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
writeFileSync(process.env.COMBINED_BROWSER_MODE_RECEIPT,JSON.stringify({format:'combined-browser-mode/1',requested:mode,effective:mode,chromium_sandbox_requested:mode==='isolated',sandbox_validated:false,host_security_changed:false})+'\n',{flag:'wx',mode:0o600});
const contexts=[],reports=[],output=path.dirname(process.env.COMBINED_BROWSER_MODE_RECEIPT);
test.after(async()=>{await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();writeFileSync(path.join(output,'snes-sharing.json'),JSON.stringify({format:'snes-browser-sharing/1',reports,scope:'Real emulation, browser inputs and loopback authenticated relay; focus emulation keeps fixture tabs active. Not wide-area network quality or complete gameplay.'},null,2));});
async function page(){
 const c=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});contexts.push(c);
 await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await c.addInitScript(()=>{
  const q=window.__snesProbe={workers:0,liveWorkers:0,frames:[],frameCount:0,pcs:[],channels:0,joins:[]};
  const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);q.workers++;q.liveWorkers++;let closed=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!closed){closed=true;q.liveWorkers--;}return stop();};const send=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m?.op==='frame'){q.frameCount++;q.frames.push({pads:m.pads.slice()});if(q.frames.length>20)q.frames.shift();}return send(m,...rest);};}};
  const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(...a){super(...a);q.pcs.push(this);this.addEventListener('datachannel',()=>q.channels++);}createDataChannel(...a){q.channels++;return super.createDataChannel(...a);}};
  const fetcher=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await fetcher(...args);if(r.ok&&/\/api\/v1\/netplay\/(join|rejoin)$/.test(String(args[0])))q.joins.push(await r.clone().json());return r;};
 });
 const p=await c.newPage();p.setDefaultTimeout(60000);const cd=await c.newCDPSession(p);await cd.send('Emulation.setFocusEmulationEnabled',{enabled:true});return p;
}
const until=(p,fn,arg,timeout=60000)=>p.waitForFunction(fn,arg,{timeout});
async function open(p,id){await p.goto(origin+'/games/arcade/?package='+id+'&solo=1');await until(p,()=>window.wowieGameHost?.getState().runtime?.ready);await p.locator('#start-game').click();await until(p,()=>wowieGameHost.getState().runtime.running);}
async function frames(p,count){const start=await p.evaluate(()=>wowieGameHost.getState().runtime.generatedFrames);await until(p,n=>wowieGameHost.getState().runtime.generatedFrames>=n,start+count,Math.max(15000,count*40));}
async function press(p,host,key,count,rest=0){await p.keyboard.down(key);await frames(host,count);await p.keyboard.up(key);if(rest)await frames(host,rest);}
async function invite(host,kind){await host.locator('#invite-'+kind).click();await until(host,()=>!!document.getElementById('sharing-link').value);const url=await host.locator('#sharing-link').inputValue();await host.evaluate(()=>{document.getElementById('sharing-link').value='';});return url;}
async function join(url){const p=await page();await p.goto(url);await until(p,()=>window.wowieGameHost?.getState().session.phase==='active');await p.locator('#start-game').click();return p;}
async function media(p){
 const deadline=Date.now()+60000;let result;
 do{
  result=await p.evaluate(async()=>{const inbound=[];let relay=false;for(const pc of __snesProbe.pcs)if(pc.connectionState==='connected'){const rows=[...(await pc.getStats()).values()];for(const r of rows){if(r.type==='inbound-rtp')inbound.push({kind:r.kind,framesDecoded:r.framesDecoded,totalSamplesReceived:r.totalSamplesReceived,totalAudioEnergy:r.totalAudioEnergy});if(r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated&&rows.some(c=>c.id===r.localCandidateId&&c.candidateType==='relay'))relay=true;}}return {inbound,relay};});
  const video=result.inbound.filter(r=>r.kind==='video').reduce((n,r)=>n+(r.framesDecoded||0),0),audio=result.inbound.filter(r=>r.kind==='audio'),samples=audio.reduce((n,r)=>n+(r.totalSamplesReceived||0),0),energy=audio.reduce((n,r)=>n+(r.totalAudioEnergy||0),0);
  if(video>10&&samples>1000&&energy>1e-6&&result.relay)return result;
  await new Promise(resolve=>setTimeout(resolve,200));
 }while(Date.now()<deadline);
 assert.fail('No decoded non-silent relay media: '+JSON.stringify(result));
}
async function held(host,first,second){await until(host,([a,b])=>__snesProbe.frames.length>=5&&__snesProbe.frames.slice(-5).every(f=>f.pads[0]===a&&f.pads[1]===b),[first,second]);}
async function watcherDenied(watcher){assert.equal(await watcher.evaluate(()=>__snesProbe.workers),0);assert.equal(await watcher.evaluate(()=>__snesProbe.channels),0);assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().canControl),false);assert.equal(await watcher.locator('#receiver-controls').isVisible(),false);}
for(const id of ['super-mario-world','zelda-a-link-to-the-past'])test(id+': real relay video/audio, correct shared controls, pause/resume and cleanup',{timeout:300000},async()=>{
 const host=await page();let guest,watcher;const errors=[];host.on('pageerror',e=>errors.push(e.message));
 try{
  await open(host,id);const nativeTwo=id==='super-mario-world';
  // Enter SMW's normal two-player path and move through Mario's first turn.
  if(nativeTwo){await frames(host,600);await host.locator('.snes-view').focus();await press(host,host,'Enter',2,120);await press(host,host,'KeyX',2,60);await press(host,host,'ArrowDown',2,2);await press(host,host,'KeyX',2,900);await press(host,host,'KeyX',2,300);await press(host,host,'ArrowLeft',30,60);await press(host,host,'KeyX',2,180);await press(host,host,'ArrowRight',600,300);await host.locator('#surface canvas').screenshot({path:path.join(output,'smw-luigi-map.png')});}
  else await frames(host,600);
  watcher=await join(await invite(host,'watch'));const watcherMedia=await media(watcher);await watcherDenied(watcher);
  guest=await join(await invite(host,'play'));const guestMedia=await media(guest);assert.equal(await guest.evaluate(()=>__snesProbe.workers),0);assert.equal(await guest.evaluate(()=>wowieGameHost.getState().session.role),'guest');
  await host.locator('.snes-view').focus();await guest.locator('#session-surface').focus();
  if(nativeTwo){await press(guest,host,'ArrowLeft',30,60);await press(guest,host,'KeyX',2,180);await host.locator('#surface canvas').screenshot({path:path.join(output,'smw-remote-luigi-level.png')});}
  await host.keyboard.down('KeyZ');await guest.keyboard.down('ArrowRight');await held(host,nativeTwo?1:129,nativeTwo?128:0);
  await frames(host,90);await held(host,nativeTwo?1:129,nativeTwo?128:0);
  await guest.keyboard.up('ArrowRight');await held(host,1,0);await host.keyboard.up('KeyZ');await held(host,0,0);
  // The extended shoulder control must reach only the assigned emulated port.
  await guest.keyboard.down('KeyQ');await held(host,nativeTwo?0:1024,nativeTwo?1024:0);await guest.keyboard.up('KeyQ');await held(host,0,0);
  await host.locator('#pause').click();await until(host,()=>!wowieGameHost.getState().runtime.running);const before=await host.evaluate(()=>__snesProbe.frameCount);await new Promise(r=>setTimeout(r,250));assert.equal(await host.evaluate(()=>__snesProbe.frameCount),before);
  await host.locator('#resume').click();await until(host,()=>wowieGameHost.getState().runtime.running);await frames(host,20);await media(guest);
  await host.locator('#sharing-end').click();await until(guest,()=>wowieGameHost.getState().session.phase==='ended');await until(watcher,()=>wowieGameHost.getState().session.phase==='ended');
  await host.evaluate(()=>wowieGameHost.unload());assert.equal(await host.evaluate(()=>__snesProbe.liveWorkers),0);assert.equal(errors.length,0,errors.join('\n'));
  reports.push({id,passed:true,watcherMedia,guestMedia,remoteSeat:nativeTwo?2:1,independentNativePlayers:nativeTwo,receiverWorkers:0,watcherInputDenied:true,extendedShoulderVerified:true,pauseResume:true,cleanup:true,gameplayScreenshots:nativeTwo?['smw-luigi-map.png','smw-remote-luigi-level.png']:[]});
 }finally{await Promise.allSettled([host,guest,watcher].filter(Boolean).map(p=>p.context().close()));}
});
