// Real Chromium document + production shell, catalog loader, NES adapter and extracted runtime.
// Worker and automatic sharing attachment are controlled. Tests explicitly bind
// session providers; real sharing/transport is covered by the combined browser lab.
// No ROM execution or gameplay-fidelity claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=new URL('../',import.meta.url),origin='http://127.0.0.1:49152';
const rows=JSON.parse(await readFile(new URL('htdocs/games/arcade/catalog.json',root),'utf8')).filter(r=>["megaman","adventure-island-2"].includes(r.id));
const assets=new Map();
async function asset(path,dependency=false){let bytes;try{bytes=await readFile(new URL('htdocs'+path,root));}catch(e){if(!dependency)throw e;bytes=await readFile(new URL('../dependencies/htdocs'+path,root));}assets.set(path,bytes);}
for(const name of ['index.html','arcade.css','package.mjs','host.mjs','ui.mjs','nes-adapter.mjs','catalog.json'])await asset('/games/arcade/'+name);
for(const row of rows){await asset(row.manifest);for(const name of ['index.html','host-entry.mjs','host-runtime.mjs'])await asset('/games/'+row.id+'/'+name);for(const name of ['gamepad.mjs','touch-dpad.mjs'])await asset('/games/'+row.id+'/'+name,true);}
await asset('/games/megaman/progress/20261112-v3/stage.png',true);
await asset('/games/adventure-island-2/progress/20261114-ui/stage.png');
assets.set('/games/arcade/catalog.json',Buffer.from(JSON.stringify(rows)));
// Serve package-declared dependencies, including the sharing bridge.
for(const row of rows){const envelope=JSON.parse(assets.get(row.manifest));for(const dependency of Object.keys(envelope.manifest.files))if(!assets.has(dependency))await asset(dependency,true);}
await asset('/games/netplay/catalog.json');
assets.set('/games/arcade/sharing.mjs',Buffer.from('export function createSharing(){return {load:(p,signal,route,loader)=>loader(p,signal),attach:async()=>{},dispose:async()=>{}};}'));
const bounded=async(p,ms=5000)=>{let t;try{return await Promise.race([p,new Promise((_,r)=>{t=setTimeout(()=>r(Error('Browser fixture deadline')),ms);})]);}finally{clearTimeout(t);}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function instrument(){
 const state=window.__arcadeProbe={workers:[],audio:[],listeners:[],maximum:0};
 const add=window.addEventListener.bind(window);
 window.addEventListener=function(type,fn,options){if(['keydown','keyup'].includes(type))state.listeners.push({type,signal:options?.signal});return add(type,fn,options);};
 class ControlledWorker {
  constructor(url){this.url=String(url);this.dead=false;this.messages=[];state.workers.push(this);state.maximum=Math.max(state.maximum,state.workers.filter(w=>!w.dead).length);queueMicrotask(()=>{if(!this.dead)this.onmessage?.({data:{type:'ready'}});});}
  postMessage(m){if(this.dead)throw Error('Message to terminated worker');this.messages.push(m);if(m.type==='sync')queueMicrotask(()=>{if(!this.dead)this.onmessage?.({data:{type:'synced',epoch:m.epoch,seq:m.seq}});});}
  terminate(){this.dead=true;}
 }
 window.Worker=ControlledWorker;
 const Audio=window.AudioContext;window.AudioContext=class TrackedAudio extends Audio{constructor(...args){super(...args);state.audio.push(this);}};
 window.__sessionLog=[];
}
async function open(t,{href='/games/arcade/',gate=null,viewport={width:1280,height:900}}={}){
 const browser=await chromium.launch({headless:true,timeout:15000});t.after(()=>bounded(browser.close(),5000));
 const context=await browser.newContext({viewport,serviceWorkers:'block',acceptDownloads:false});const page=await context.newPage();page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(5000);
 const log={documents:0,popups:0,errors:[],unexpected:[]};page.on('request',r=>{if(r.isNavigationRequest())log.documents++;});page.on('popup',()=>log.popups++);page.on('pageerror',e=>log.errors.push(e.message));
 await page.addInitScript(instrument);
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());let path=u.pathname;if(path.endsWith('/'))path+='index.html';const body=assets.get(path);
  if(u.origin!==origin||req.method()!=='GET'||!body){log.unexpected.push(u.pathname);await route.abort();return;}
  if(gate&&u.pathname==='/games/megaman/host-entry.mjs'&&req.resourceType()==='script'&&!gate.used){gate.used=true;gate.entered.resolve();await bounded(gate.release.promise,10000);}
  const contentType=path.endsWith('.mjs')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html';
  await route.fulfill({status:200,contentType,headers:{'cache-control':'no-store'},body});
 });
 await page.goto(origin+href);await page.waitForFunction(()=>window.wowieGameHost&&!window.wowieGameHost.getState().loading);const document=await page.evaluateHandle(()=>document);
 const identity=await page.evaluate(()=>({origin:performance.timeOrigin,navigation:performance.getEntriesByType('navigation').length}));
 return {browser,context,page,log,document,identity};
}
async function uniqueControls(page){
 const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(node=>node.id));assert.equal(ids.length,new Set(ids).size,'Every mounted document ID must be unique, including hidden controls');
 for(const id of ['reset','pause']){const control=page.locator('#'+id);assert.equal(await control.count(),1);assert.equal(await control.isVisible(),await page.evaluate(()=>Boolean(window.wowieGameHost.getState().package))); assert.equal(await control.evaluate(node=>node.matches('#player > .toolbar > button')),true);}
}
async function same(s){await uniqueControls(s.page);assert.equal(await s.page.evaluate(d=>d===document,s.document),true);assert.deepEqual(await s.page.evaluate(()=>({origin:performance.timeOrigin,navigation:performance.getEntriesByType('navigation').length})),s.identity);assert.equal(s.log.documents,1);assert.equal(s.log.popups,0);assert.equal(s.page.frames().length,1);assert.equal(s.context.pages().length,1);assert.equal(new URL(s.page.url()).pathname,'/games/arcade/');assert.deepEqual(s.log.errors,[]);assert.deepEqual(s.log.unexpected,[]);}
async function loaded(page,id){await page.waitForFunction(id=>{const s=window.wowieGameHost.getState();return s.package?.id===id&&!s.loading&&s.runtime?.ready;},id);assert.equal(await page.locator('#surface .package-mount').count(),1);assert.equal(await page.locator('#surface .package-mount').getAttribute('data-package'),id);await uniqueControls(page);}
async function library(page){await page.waitForFunction(()=>{const s=window.wowieGameHost.getState();return !s.package&&!s.loading;});assert.equal(await page.locator('#surface .package-mount').count(),0);assert.equal(await page.locator('#idle-screen').isVisible(),false);assert.equal(await page.locator('#player>.toolbar').isVisible(),false);assert.equal(await page.locator('#game-title').textContent(),'Your next adventure');}
async function choose(page,id){await page.locator('label.cartridge:has(input[value="'+id+'"])').click();}
async function resources(page,live){const r=await page.evaluate(()=>{const p=window.__arcadeProbe;return {workers:p.workers.filter(x=>!x.dead).length,audio:p.audio.filter(x=>x.state!=='closed').length,listeners:p.listeners.filter(x=>!x.signal?.aborted).length,maximum:p.maximum};});assert.equal(r.workers,live);if(!live){assert.equal(r.audio,0);assert.equal(r.listeners,0);}assert(r.maximum<=1);}
async function bind(page,role='host'){await page.evaluate(role=>{const api=window.wowieGameHost,p=api.getPackage(),log=window.__sessionLog;const state={role,phase:'active',epoch:1,reconnect:'none',watch:'available',play:'available',message:'Fixture session'};const video=document.createElement('video'),audio=document.createElement('audio');window.__oldBinding=api;window.__lease=api.bindSession({version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>state,subscribe:()=>()=>log.push(p.id+':unsubscribe'),inviteWatch:()=>log.push(p.id+':watch'),invitePlay:()=>log.push(p.id+':play'),sendInput:e=>log.push({id:p.id,...e}),releaseInputs:()=>log.push(p.id+':release'),enableAudio:()=>{},getMedia:()=>({video,audio}),dispose:()=>log.push(p.id+':dispose')});},role);}
test('one canonical document: Mega Man -> Adventure Island -> library, history and teardown',{timeout:45000},async t=>{
 const s=await open(t),{page}=s;await choose(page,'megaman');await loaded(page,'megaman');await page.locator('#start-game').click();await bind(page);await page.locator('#invite-play').click();await page.locator('#invite-watch').click();
 await page.locator('.nes-view').focus();await page.keyboard.down('z');await page.waitForFunction(()=>document.querySelector('.nes-view [data-button="0"]').getAttribute('aria-pressed')==='true');
 const old=await page.evaluateHandle(()=>document.querySelector('.nes-view'));await same(s);
 await choose(page,'adventure-island-2');await loaded(page,'adventure-island-2');await page.keyboard.up('z');assert.equal(await page.evaluate(n=>n.isConnected,old),false);
 assert.equal(await page.evaluate(()=>window.__arcadeProbe.workers[0].dead),true);assert.equal(await page.evaluate(()=>window.__arcadeProbe.audio.length>0&&window.__arcadeProbe.audio.every(a=>a.state==='closed')),true);
 const log=await page.evaluate(()=>window.__sessionLog);for(const event of ['play','watch','unsubscribe','dispose','release'])assert(log.includes('megaman:'+event));assert.equal(log.filter(x=>x==='megaman:dispose').length,1);
 assert.equal(await page.evaluate(()=>window.__lease.input({control:'a',source:'stale',pressed:true,role:'guest',epoch:1,seat:1})),false);await resources(page,1);await same(s);
 await page.locator('#start-game').click();assert.equal(await page.locator('#reset').isEnabled(),true);assert.equal(await page.locator('#pause').isEnabled(),true);
 await bind(page,'spectator');await uniqueControls(page);assert.equal(await page.locator('#reset').isEnabled(),false);assert.equal(await page.locator('#pause').isEnabled(),false);await page.locator('#help summary').click();assert.equal(await page.locator('#input-buttons button:enabled').count(),0);await same(s);
 await page.locator('#change').click();await library(page);await resources(page,0);await same(s);
 await page.evaluate(()=>history.back());await loaded(page,'adventure-island-2');await same(s);await page.evaluate(()=>history.back());await loaded(page,'megaman');await same(s);await page.evaluate(()=>history.back());await library(page);await resources(page,0);await same(s);
 await choose(page,'megaman');await loaded(page,'megaman');await page.locator('#start-game').click();await bind(page);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.waitForFunction(()=>window.__arcadeProbe.workers.every(w=>w.dead)&&window.__arcadeProbe.audio.every(a=>a.state==='closed'));await resources(page,0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await loaded(page,'megaman');await same(s);await page.locator('#change').click();await library(page);await resources(page,0);
});
test('newest selection wins while a real module import is delayed, including mobile library cancellation',{timeout:40000},async t=>{
 const gate={entered:deferred(),release:deferred(),used:false};t.after(()=>gate.release.resolve());const s=await open(t,{gate,viewport:{width:390,height:844}}),{page}=s;
 await choose(page,'megaman');await bounded(gate.entered.promise);await choose(page,'adventure-island-2');await loaded(page,'adventure-island-2');await resources(page,1);await same(s);
 gate.release.resolve();const envelope=JSON.parse(assets.get(rows.find(r=>r.id==='megaman').manifest).toString());const entry=envelope.manifest.entry+'?v='+envelope.manifest.files[envelope.manifest.entry].sha256;
 await page.evaluate(async entry=>{await import(entry);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},entry);
 await loaded(page,'adventure-island-2');assert.equal(await page.evaluate(()=>window.__arcadeProbe.workers.some(w=>w.url.includes('/megaman/'))),false);await same(s);
 await page.evaluate(()=>{void window.wowieGameHost.select('megaman');void window.wowieGameHost.unload();});await library(page);await resources(page,0);await same(s);
});
for(const id of ['megaman','adventure-island-2'])test(id+': existing deep link becomes a canonical alias in its initial document',{timeout:25000},async t=>{
 const s=await open(t,{href:'/games/'+id+'/index.html?old=keep&solo=1#bookmark'});await loaded(s.page,id);const u=new URL(s.page.url());assert.equal(u.searchParams.get('package'),id);assert.equal(u.searchParams.get('old'),'keep');assert.equal(u.hash,'#bookmark');await same(s);await s.page.locator('#change').click();await library(s.page);await resources(s.page,0);await same(s);
});

// Presentation checks use the same production shell and controlled worker boundary.
// Captures show layout and authentic shelf images; the canvas is not gameplay evidence.
const reviewDirectory=/\/\.posse\/arcade-ui\/build-[a-f0-9]{32}\/replacements\/$/.test(fileURLToPath(root))?new URL('../review/',root):null;
if(reviewDirectory)await mkdir(reviewDirectory,{mode:0o700});
async function captureReview(page,name){
 if(!reviewDirectory)return;
 const bytes=await page.screenshot({type:'png',fullPage:false,animations:'disabled',timeout:5000});
 assert(bytes.length>0&&bytes.length<=8388608);
 await writeFile(new URL(name,reviewDirectory),bytes,{flag:'wx',mode:0o600});
}
async function presentation(page){return page.evaluate(()=>{
 const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
 const visible=node=>Boolean(node.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden';
 return {viewport:{width:innerWidth,height:innerHeight},scrollX,scrollY,overflow:document.documentElement.scrollWidth>innerWidth+1,
  player:rect(document.getElementById('player')),cards:[...document.querySelectorAll('.cartridge-choice')].map(rect),
  toolbar:rect(document.querySelector('#player>.toolbar')),canvas:document.querySelector('#surface canvas')?rect(document.querySelector('#surface canvas')):null,
  change:rect(document.getElementById('change')),visibleDisabled:[...document.querySelectorAll('button:disabled')].filter(visible).map(n=>n.id),
  visibleText:document.body.innerText};
 });}
// Test-only observation counts actual host.load calls as well as workers:
// cancellation could otherwise conceal duplicate requests behind one worker.
// The wrapper delegates with the original receiver, arguments and return value.
async function trackCartridgeLoads(page){await page.evaluate(async()=>{
 const {GameHost}=await import('/games/arcade/host.mjs');
 const load=GameHost.prototype.load;window.__arcadeProbe.loads=[];
 GameHost.prototype.load=function(id,...args){window.__arcadeProbe.loads.push(id);return Reflect.apply(load,this,[id,...args]);};
});}
async function loadMark(page){return page.evaluate(()=>({loads:window.__arcadeProbe.loads.length,workers:window.__arcadeProbe.workers.length}));}
async function oneLoad(s,before,id){
 await loaded(s.page,id);
 await s.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const after=await s.page.evaluate(before=>({loads:window.__arcadeProbe.loads.slice(before.loads),workers:window.__arcadeProbe.workers.length}),before);
 assert.deepEqual(after.loads,[id],'One action calls host.load exactly once');
 assert.equal(after.workers,before.workers+1,'One action creates exactly one runtime');
 await resources(s.page,1);await same(s);
}
for(const [name,viewport] of [['desktop',{width:1365,height:1000}],['mobile',{width:390,height:844}]])test(name+': immediate shelf, direct loading, keyboard and compact controls',{timeout:40000},async t=>{
 const s=await open(t,{viewport}),{page}=s;
 await trackCartridgeLoads(page);
 await page.waitForFunction(()=>document.querySelectorAll('.cartridge-label img').length===2&&[...document.querySelectorAll('.cartridge-label img')].every(i=>i.complete&&i.naturalWidth>0));
 const initial=await presentation(page);assert.equal(initial.scrollY,0);assert.equal(initial.overflow,false);assert(initial.player.height<=48);assert.equal(initial.cards.length,2);
 for(const card of initial.cards){assert(card.y>=0&&card.bottom<=viewport.height,'Both cartridges and their load controls fit in the first viewport');assert(card.x>=0&&card.right<=viewport.width);}
 assert.deepEqual(initial.visibleDisabled,[]);assert.equal(await page.locator('#player>.toolbar').isVisible(),false);
 assert.doesNotMatch(initial.visibleText,/unavailable|not available|package|digest|provider|fixture|evidence|runtime/i);
 assert.equal(await page.locator('img[src="/games/adventure-island-2/progress/20261114-ui/stage.png"]').count(),1);
 assert.equal(await page.locator('img[src="/games/megaman/progress/20261112-v3/stage.png"]').count(),1);
 await same(s);await captureReview(page,name+'-library.png');
 // Traverse the actual tab order; Space must load the initially checked cartridge.
 await page.locator('#library').focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.matches('input[name="package"][value="megaman"]')),true);
 assert.equal(await page.evaluate(()=>document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement.nextElementSibling).outlineWidth)>=2),true);
 assert.equal(await page.locator('input[value="megaman"]').isChecked(),true);
 assert.equal(await page.evaluate(()=>window.wowieGameHost.getPackage()),null);
 const spaceBefore=await loadMark(page);
 await page.keyboard.press('Space');await loaded(page,'megaman');await same(s);
 await oneLoad(s,spaceBefore,'megaman');
 assert.equal(await page.locator('input[name="package"]:checked').inputValue(),'megaman');
 await page.locator('#start-game').click();
 const playing=await presentation(page);assert.equal(playing.overflow,false);assert(playing.canvas.width>100&&playing.canvas.width<=426);assert(playing.canvas.height<=410);
 assert(playing.toolbar.height<=120);assert(playing.change.y>=0&&playing.change.bottom<=viewport.height);assert(playing.canvas.bottom<=viewport.height,'Canvas and essential controls fit together');
 assert.equal(await page.locator('#change').innerText(),'Change cartridge');assert.equal(await page.locator('#change').isEnabled(),true);
 assert.equal(await page.locator('#invite-row').isVisible(),false);assert.equal(await page.locator('#session-state').isVisible(),false);
 assert.doesNotMatch(playing.visibleText,/not available|provider|digest|fixture|evidence/i);
 await captureReview(page,name+'-loaded.png');
 // An explicit per-cartridge load switches directly without first selecting its radio.
 const buttonBefore=await loadMark(page);
 await page.locator('.load-cartridge[data-load-package="adventure-island-2"]').click();await loaded(page,'adventure-island-2');await same(s);
 await oneLoad(s,buttonBefore,'adventure-island-2');
 assert.equal(await page.locator('input[name="package"]:checked').inputValue(),'adventure-island-2');
 assert.equal(new URL(page.url()).searchParams.get('package'),'adventure-island-2');
 await page.locator('#change').click();await library(page);await resources(page,0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'library');
 const before=await page.evaluate(()=>window.__arcadeProbe.workers.length);
 const labelBefore=await loadMark(page);
 await page.locator('label.cartridge:has(input[value="megaman"])').click();await loaded(page,'megaman');await same(s);
 assert.equal(await page.evaluate(()=>window.__arcadeProbe.workers.length),before+1,'One cartridge activation creates one runtime');
 await oneLoad(s,labelBefore,'megaman');
 // Native arrow-key selection also loads the newly checked cartridge.
 const arrowBefore=await loadMark(page);
 await page.locator('input[value="megaman"]').focus();await page.keyboard.press('ArrowRight');await loaded(page,'adventure-island-2');await same(s);
 await oneLoad(s,arrowBefore,'adventure-island-2');
 await page.locator('#change').click();await library(page);await resources(page,0);await same(s);
 if(reviewDirectory)await writeFile(new URL(name+'.json',reviewDirectory),JSON.stringify({viewport,browser:s.browser.version(),scope:'UI layout with controlled emulator Worker; authentic shelf thumbnails; no gameplay or performance claim',captures:[name+'-library.png',name+'-loaded.png'],initial,playing})+'\n',{flag:'wx',mode:0o600});
});
for(const [name,viewport] of [['desktop',{width:1365,height:1000}],['mobile',{width:390,height:844}]])test(name+': initial Enter activation and held keys load once',{timeout:30000},async t=>{
 const s=await open(t,{viewport}),{page}=s;await trackCartridgeLoads(page);await library(page);await same(s);
 assert.equal(await page.locator('input[value="megaman"]').isChecked(),true);
 assert.equal(await page.evaluate(()=>window.wowieGameHost.getPackage()),null);
 await page.locator('#library').focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.matches('input[name="package"][value="megaman"]')),true);
 const enterBefore=await loadMark(page);
 await page.keyboard.down('Enter');await loaded(page,'megaman');
 // A second down without up is a real repeat event in Playwright.
 await page.keyboard.down('Enter');await page.keyboard.up('Enter');
 await oneLoad(s,enterBefore,'megaman');
 assert.equal(await page.locator('input[name="package"]:checked').inputValue(),'megaman');
 assert.equal(new URL(page.url()).searchParams.get('package'),'megaman');
 await page.locator('#change').click();await library(page);await resources(page,0);await same(s);
 assert.equal(await page.locator('input[value="megaman"]').isChecked(),true);
 await page.locator('#library').focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.matches('input[name="package"][value="megaman"]')),true);
 const spaceBefore=await loadMark(page);
 await page.keyboard.down('Space');await loaded(page,'megaman');
 await page.keyboard.down('Space');await page.keyboard.up('Space');
 await oneLoad(s,spaceBefore,'megaman');
 await page.locator('#change').click();await library(page);await resources(page,0);await same(s);
});
test('keyboard activation supersedes a delayed import without duplicate requests',{timeout:40000},async t=>{
 const gate={entered:deferred(),release:deferred(),used:false};t.after(()=>gate.release.resolve());
 const s=await open(t,{gate,viewport:{width:390,height:844}}),{page}=s;await trackCartridgeLoads(page);
 await page.locator('#library').focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.matches('input[name="package"][value="megaman"]')),true);
 await page.keyboard.down('Space');await bounded(gate.entered.promise);
 await page.keyboard.down('Space');await page.keyboard.up('Space');
 assert.deepEqual(await page.evaluate(()=>window.__arcadeProbe.loads),['megaman']);
 await page.keyboard.press('ArrowRight');await loaded(page,'adventure-island-2');await resources(page,1);await same(s);
 gate.release.resolve();const envelope=JSON.parse(assets.get(rows.find(r=>r.id==='megaman').manifest).toString());const entry=envelope.manifest.entry+'?v='+envelope.manifest.files[envelope.manifest.entry].sha256;
 await page.evaluate(async entry=>{await import(entry);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},entry);
 await loaded(page,'adventure-island-2');
 assert.deepEqual(await page.evaluate(()=>window.__arcadeProbe.loads),['megaman','adventure-island-2']);
 assert.equal(await page.evaluate(()=>window.__arcadeProbe.workers.length),1);
 assert.equal(await page.evaluate(()=>window.__arcadeProbe.workers.some(w=>w.url.includes('/megaman/'))),false);
 assert.equal(await page.locator('input[name="package"]:checked').inputValue(),'adventure-island-2');
 assert.equal(new URL(page.url()).searchParams.get('package'),'adventure-island-2');
 await resources(page,1);await same(s);
 await page.locator('#change').click();await library(page);await resources(page,0);await same(s);
});
