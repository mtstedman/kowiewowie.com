// Optional real Chromium + production host; controlled Worker only, no gameplay claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),plan=JSON.parse(read('tests/cartridge-library-plan.json'));
const assets=new Map(Object.keys(plan.browserAssets).map(p=>['/'+p.slice('htdocs/'.length),read(p)]));
const origin='http://127.0.0.1:49152';
test('all selected cartridges load/unload in one document; generated save protocol retains RAM',{timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true,timeout:15000});t.after(()=>browser.close());const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});const page=await context.newPage();page.setDefaultTimeout(10000);
 let documents=0;const errors=[];page.on('request',r=>{if(r.isNavigationRequest())documents++;});page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());let p=u.pathname;if(p.endsWith('/'))p+='index.html';if(q.method()!=='GET'||u.origin!==origin||!assets.has(p)){await r.abort();return;}await r.fulfill({status:200,contentType:p.endsWith('.mjs')||p.endsWith('.js')?'text/javascript':p.endsWith('.json')?'application/json':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html',body:assets.get(p)});});
 await page.addInitScript(({games})=>{
  window.__libraryWorkers=[];window.__saveValues=[];
  window.Worker=class{
   constructor(url){this.dead=false;this.url=new URL(url);this.game=games.find(g=>this.url.pathname.startsWith('/games/'+g.slug+'/'));this.record=null;__libraryWorkers.push(this);queueMicrotask(()=>{if(!this.dead)this.onmessage?.({data:{type:this.game?.battery?'battery-await-init':'ready'}});});}
   postMessage(d){if(this.dead)throw Error('Dead fixture worker');if(d.type==='battery-init'){this.record=d.record||{format:'romjs-battery/1',identity:this.game.identity,data:Array(8192).fill(0)};__saveValues.push(this.record.data[0]);queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}else if(d.type==='sync')queueMicrotask(()=>this.onmessage?.({data:{type:'synced',epoch:d.epoch,seq:d.seq}}));else if(d.type==='battery-flush'){this.record.data[0]=53;queueMicrotask(()=>this.onmessage?.({data:{type:'battery-data',request:d.request,record:this.record}}));}}
   terminate(){this.dead=true;}
  };
 },{games:plan.games});
 await page.goto(origin+'/games/arcade/');await page.waitForFunction(()=>window.wowieGameHost);const document=await page.evaluateHandle(()=>window.document),stamp=await page.evaluate(()=>performance.timeOrigin);
 for(const id of plan.newIds){
  await page.evaluate(id=>wowieGameHost.select(id),id);await page.waitForFunction(id=>wowieGameHost.getState().package?.id===id&&wowieGameHost.getState().runtime?.ready,id);
  assert.equal(await page.evaluate(d=>d===window.document,document),true);assert.equal(await page.evaluate(()=>performance.timeOrigin),stamp);assert.equal(new URL(page.url()).pathname,'/games/arcade/');
  await page.locator('#start-game').click();await page.locator('.nes-view').focus();await page.keyboard.down('z');await page.keyboard.up('z');await page.evaluate(()=>wowieGameHost.unload());assert.equal(await page.evaluate(()=>__libraryWorkers.filter(w=>!w.dead).length),0);
  if(plan.games.find(g=>g.slug===id).battery){await page.evaluate(id=>wowieGameHost.select(id),id);await page.waitForFunction(()=>wowieGameHost.getState().runtime?.ready);assert.equal(await page.evaluate(()=>__saveValues.at(-1)),53);await page.evaluate(()=>wowieGameHost.unload());}
 }
 assert.equal(documents,1);assert.deepEqual(errors,[]);assert.equal(page.frames().length,1);assert.equal(context.pages().length,1);
});
