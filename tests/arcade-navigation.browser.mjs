// Real adapters/storage and production CSP; probe only observes worker and save boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=fileURLToPath(new URL('../htdocs/',import.meta.url)),reports=[];
const output=process.env.ARCADE_NAVIGATION_EVIDENCE;if(output&&!fs.statSync(output).isDirectory())throw Error('Evidence directory must exist');
const server=http.createServer((req,res)=>{try{let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(url.endsWith('/'))url+='index.html';const file=path.resolve(root,'.'+url);assert(file.startsWith(root));res.setHeader('Content-Security-Policy',snesBrowserCSP(url));res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{
 window.__navigationProbe={document:crypto.randomUUID(),live:0,created:0,pads:[],checkpointWrites:0,failSave:false,libraryFetches:0};const q=__navigationProbe;
 const W=Worker;window.Worker=class extends W{constructor(...a){super(...a);q.live++;q.created++;let closed=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!closed){closed=true;q.live--;}return stop();};const send=this.postMessage.bind(this);this.postMessage=(data,...rest)=>{if(data?.op==='frame')q.pads=data.pads.slice();return send(data,...rest);};}};
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(String(key).endsWith(':checkpoint')||value?.format==='nes-local-save/1'){if(q.failSave)throw new DOMException('Fixture storage full','QuotaExceededError');q.checkpointWrites++;}return put.call(this,value,key);};
 const fetcher=fetch;window.fetch=(url,...rest)=>{if(String(url).endsWith('/games/arcade/library.html'))q.libraryFetches++;return fetcher(url,...rest);};
});
const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:60000});
const state=()=>page.evaluate(()=>wowieGameHost.getState());
async function ready(id){await wait(id=>wowieGameHost?.getPackage()?.id===id&&wowieGameHost.getState().runtime?.ready,id);assert(await page.locator('#player').isVisible());assert(!(await page.locator('#library').isVisible()));}
async function load(id){await page.locator('[data-load-package="'+id+'"]').click();await ready(id);}
async function start(){await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.running);}
async function library(){await wait(()=>window.wowieGameHost&&!wowieGameHost.getState().package&&!document.getElementById('library').hidden&&document.querySelectorAll('.load-cartridge').length>0);assert(!(await page.locator('#player').isVisible()));assert.equal(await page.evaluate(()=>__navigationProbe.live),0);}
async function offer(){await page.locator('#change').click();await wait(()=>document.getElementById('change-dialog').open);assert.equal((await state()).runtime.running,false);}
async function leave(save){await offer();await page.locator(save?'#save-and-change':'#leave-without-save').click();await library();assert.equal(await page.locator('#change-dialog').evaluate(d=>d.open),false);}
try{
 await page.goto(origin+'/games/arcade/');await library();const documentId=await page.evaluate(()=>__navigationProbe.document);assert.equal(await page.evaluate(()=>__navigationProbe.libraryFetches),1);
 await load('super-mario-world');await start();await wait(()=>wowieGameHost.getState().runtime.presentedFrames>=60);
 const toolbar=await page.locator('#select-game').evaluate(n=>n.nextElementSibling.id);assert.equal(toolbar,'start-game');
 const box=await page.locator('#select-game').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await wait(()=>Boolean(__navigationProbe.pads[0]&4));await page.mouse.up();await wait(()=>!(__navigationProbe.pads[0]&4));
 const beforeSize=await page.locator('#surface canvas').boundingBox();await page.locator('#bigger').click();assert.equal(await page.locator('body').getAttribute('data-expanded'),'true');const afterSize=await page.locator('#surface canvas').boundingBox();assert(afterSize.width>beforeSize.width,'Make it bigger must increase the displayed game size');await page.locator('#bigger').click();
 const activeURL=page.url(),created=await page.evaluate(()=>__navigationProbe.created);await offer();assert.equal(page.url(),activeURL);assert.equal(await page.evaluate(()=>__navigationProbe.created),created);await page.locator('#cancel-change').click();await wait(()=>wowieGameHost.getState().runtime.running);assert.equal(page.url(),activeURL);
 await page.evaluate(()=>__navigationProbe.failSave=true);await offer();await page.locator('#save-and-change').click();await wait(()=>document.getElementById('change-status').textContent.startsWith('Could not save'));assert.equal((await state()).package.id,'super-mario-world');assert.equal(await page.locator('#change-dialog').evaluate(d=>d.open),true);assert.equal(page.url(),activeURL);assert.equal(await page.evaluate(()=>__navigationProbe.live),1);await page.evaluate(()=>__navigationProbe.failSave=false);await page.locator('#cancel-change').click();await wait(()=>wowieGameHost.getState().runtime.running);
 await leave(true);assert.equal(await page.evaluate(()=>__navigationProbe.checkpointWrites),1);assert.equal(await page.evaluate(()=>__navigationProbe.libraryFetches),1);assert.equal(await page.evaluate(()=>__navigationProbe.document),documentId);
 await load('super-mario-world');await page.locator('[data-snes-save="load"]').click();await wait(()=>document.querySelector('.snes-save-message').textContent.startsWith('Game loaded'));await page.locator('#resume').click();await wait(()=>wowieGameHost.getState().runtime.running);const writes=await page.evaluate(()=>__navigationProbe.checkpointWrites);await leave(false);assert.equal(await page.evaluate(()=>__navigationProbe.checkpointWrites),writes);
 await page.goBack();await ready('super-mario-world');await page.goBack();await library();await page.goForward();await ready('super-mario-world');await page.goForward();await library();assert.equal(await page.evaluate(()=>__navigationProbe.document),documentId);
 console.log('SNES navigation/save/failure/history passed; loading NES');
 await load('megaman');await start();await leave(true);assert.equal(await page.evaluate(()=>__navigationProbe.checkpointWrites),writes+1);
 reports.push({scenario:'desktop',sameDocument:true,ajaxLibrary:true,separateViews:true,selectDelivered:true,bigger:{before:beforeSize.width,after:afterSize.width},cancelPreservesGame:true,storageFailurePreservesGame:true,snesSaveReload:true,nesSaveBeforeLeave:true,leaveWithoutSave:true,history:true,zeroWorkersAfterUnload:true});
 if(output)await page.screenshot({path:path.join(output,'library.png'),fullPage:true});
 const direct=await context.newPage();await direct.goto(origin+'/games/arcade/?package=zelda-a-link-to-the-past&solo=1');await direct.waitForFunction(()=>window.wowieGameHost?.getState().runtime?.ready);assert.equal(await direct.evaluate(()=>__navigationProbe.libraryFetches),0);await direct.locator('#start-game').click();await direct.waitForFunction(()=>wowieGameHost.getState().runtime.running);await direct.setViewportSize({width:390,height:844});
 for(const id of ['select-game','start-game','bigger','change']){const b=await direct.locator('#'+id).boundingBox();assert(b.x>=0&&b.x+b.width<=390,id+' remains inside mobile viewport');}
 if(output)await direct.screenshot({path:path.join(output,'player-mobile.png'),fullPage:true});await direct.locator('#change').click();await direct.locator('#leave-without-save').click();await direct.waitForFunction(()=>!wowieGameHost.getState().package&&!document.getElementById('library').hidden);assert.equal(await direct.evaluate(()=>__navigationProbe.libraryFetches),1);assert.equal(await direct.evaluate(()=>__navigationProbe.live),0);reports.push({scenario:'direct-mobile',libraryFetchedOnlyAfterUnload:true,toolbarFits:true});await direct.close();
 assert.deepEqual(errors,[]);const result={passed:true,csp:'exact production nginx policy',reports,errors};if(output)fs.writeFileSync(path.join(output,'navigation-report.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}catch(error){console.error('Browser failure state',JSON.stringify(await page.evaluate(()=>({state:window.wowieGameHost?.getState(),status:document.getElementById('player-state')?.textContent})).catch(()=>null)));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
