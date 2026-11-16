import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),web=resolve(root,'htdocs');
const policy=JSON.parse(readFileSync(resolve(root,'receipts/browser-policy.json')));
const server=createServer((req,res)=>{try{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Security-Policy',policy.required);
 if(url.pathname==='/games/arcade/__save-test.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>NES save test</title><main></main>');return;}
 const file=resolve(web,'.'+decodeURIComponent(url.pathname));assert(file.startsWith(web+sep));res.setHeader('Content-Type',file.endsWith('.mjs')?'application/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(readFileSync(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port,ids=JSON.parse(readFileSync(resolve(web,'games/arcade/catalog.json'))).map(x=>x.id);
 async function mount(id){await page.goto(origin+'/games/arcade/__save-test.html');await page.evaluate(async id=>{
  const {verifyPackage,importAdapter}=await import('/games/arcade/package.mjs'),rows=await(await fetch('/games/arcade/catalog.json')).json(),r=rows.find(r=>r.id===id),p=await verifyPackage(await(await fetch(r.manifest)).json(),r.artifactDigest);
  const controller=new AbortController(),deferred=[];const module=await importAdapter(p,controller.signal);
  window.adapter=module.createAdapter({package:p,view:document.querySelector('main'),controls:document.querySelector('main'),scope:{defer:f=>deferred.push(f)},signal:controller.signal,input:()=>true,canControl:()=>true,changed(){}});
  window.cleanup=async()=>{for(const fn of deferred.reverse())await fn();controller.abort();};window.adapter.load();
 },id);await page.waitForFunction(()=>window.adapter.snapshot().ready||window.adapter.snapshot().message?.startsWith('Stopped'),{},{timeout:120000});assert.equal(await page.evaluate(()=>window.adapter.snapshot().ready),true,id+' ready');}
 const requested=process.argv.slice(2);for(const id of requested)assert(ids.includes(id),'Unknown game: '+id);
 for(const id of requested.length?requested:ids){
  await mount(id);await page.waitForTimeout(500);await page.locator('#nes-save').click();
  await page.waitForFunction(()=>document.querySelector('#nes-save-status').textContent.startsWith('Saved on'),{},{timeout:120000});
  assert.equal(await page.evaluate(()=>window.adapter.snapshot().running),false);
  await page.evaluate(()=>window.adapter.resume());await page.waitForTimeout(300);
  await page.locator('#nes-load').click();await page.waitForFunction(()=>document.querySelector('#nes-save-status').textContent.startsWith('Game loaded'),{},{timeout:120000});
  assert.equal(await page.evaluate(()=>window.adapter.snapshot().running),false);
  await page.evaluate(()=>window.cleanup());await mount(id);
  await page.locator('#nes-load').click();await page.waitForFunction(()=>document.querySelector('#nes-save-status').textContent.startsWith('Game loaded'),{},{timeout:120000});
  await page.evaluate(()=>window.adapter.resume());await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.adapter.snapshot().running),true);
  await page.evaluate(()=>window.adapter.setSessionState({role:'spectator'}));await page.waitForTimeout(50);assert.equal(await page.locator('#nes-save').isDisabled(),true);assert.equal(await page.locator('#nes-load').isDisabled(),true);
  await page.evaluate(()=>window.cleanup());assert.equal(await page.locator('.nes-view').count(),0);console.log(JSON.stringify({id,save:true,load:true,persisted_across_reload:true,resumed:true,spectator_blocked:true}));
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
