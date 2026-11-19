import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=path.resolve(process.env.ARCADE_SAVE_HTDOCS||fileURLToPath(new URL('../htdocs/',import.meta.url)));
const output=process.env.ARCADE_SAVE_EVIDENCE;if(output)assert(fs.statSync(output).isDirectory());
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));res.setHeader('Content-Security-Policy',snesBrowserCSP(pathname));res.setHeader('Cache-Control','no-store');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']}),reports=[],errors=[];
const until=(p,fn,arg,timeout=30000)=>p.waitForFunction(fn,arg,{timeout});
async function stored(page,platform,id,slot){return page.evaluate(async({platform,id,slot})=>{
 const {createSaveStore}=await import('/games/arcade/save-store.mjs'),store=createSaveStore({platform,id});const record=await store.read(slot),metadata=(await store.list()).find(r=>r.slot===slot);
 const bytes=record.data instanceof Uint8Array?record.data:new TextEncoder().encode(JSON.stringify(record));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 return {digest,metadata,frame:record.frame??null,format:record.format};
 },{platform,id,slot});}
async function save(page,platform,slot){await page.getByLabel('Saved position',{exact:true}).selectOption(slot);await page.locator(platform==='nes'?'#nes-save':'[data-snes-save="save"]').click();await until(page,()=>document.querySelector('#nes-save-status,.snes-save-message')?.textContent.startsWith('Saved on'));}
async function load(page,platform,slot){await page.getByLabel('Saved position',{exact:true}).selectOption(slot);await page.locator(platform==='nes'?'#nes-load':'[data-snes-save="load"]').click();await until(page,()=>document.querySelector('#nes-save-status,.snes-save-message')?.textContent.startsWith('Game loaded'));}
async function prepare({id,platform}){
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push({id,message:e.message}));
 await page.addInitScript(()=>{window.__saveProof={frames:0,captures:0,pauses:0,startedAt:performance.now()};const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.type==='frame'||e.data?.result?.rgba)__saveProof.frames++;});const post=this.postMessage.bind(this);this.postMessage=(m,...args)=>{if(m?.type==='network-capture'||m?.op==='network-capture')__saveProof.captures++;return post(m,...args);};}};});
 const cd=await context.newCDPSession(page);await cd.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 const url=origin+'/games/arcade/?package='+id+'&solo=1';await page.goto(url);await until(page,()=>window.wowieGameHost?.getState().runtime?.ready);await page.locator('#start-game').click();await until(page,()=>__saveProof.frames>45);
 await save(page,platform,'slot1');
 // Seed the previous published storage format with a real engine checkpoint,
 // remove only this isolated fixture's new slot, then exercise migration on reload.
 const legacy=await page.evaluate(async({id,platform})=>{
  const {createSaveStore}=await import('/games/arcade/save-store.mjs'),record=await createSaveStore({platform,id}).read('slot1');
  let savedAt=null;if(platform==='nes'){const {saveCheckpoint,readLegacyCheckpoint}=await import('/games/arcade/checkpoint-store.mjs');await saveCheckpoint(id,record);savedAt=(await readLegacyCheckpoint(id)).savedAt;}else{const {snesSlot}=await import('/games/arcade/snes-storage.mjs');await snesSlot(id,'checkpoint',record);}
  await new Promise((resolve,reject)=>{const request=indexedDB.open('wowiekowie-arcade-saves',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('slots','readwrite');tx.objectStore('slots').delete(`${platform}:${id}:slot1`);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('Fixture reset failed'));};};});
  return {savedAt};
 },{id,platform});
 await page.reload();await until(page,()=>window.wowieGameHost?.getState().runtime?.ready);await until(page,()=>document.querySelector('.nes-save-controls select option')?.textContent.includes('empty')===false);
 const migrated=await stored(page,platform,id,'slot1');assert.equal(migrated.metadata.migrated,true);if(legacy.savedAt)assert.equal(migrated.metadata.savedAt,legacy.savedAt);
 await page.locator('#start-game').click();await until(page,()=>__saveProof.frames>30);await save(page,platform,'slot2');const second=await stored(page,platform,id,'slot2');
 await page.locator('#resume').click();const frame=await page.evaluate(()=>__saveProof.frames);await until(page,n=>__saveProof.frames>n+30,frame);await save(page,platform,'slot3');const third=await stored(page,platform,id,'slot3');assert.notEqual(second.digest,third.digest);
 await load(page,platform,'slot2');const recovery=await stored(page,platform,id,'recovery');assert.equal(recovery.digest,third.digest,'Load must save the exact pre-load state');
 await save(page,platform,'slot1');assert.equal((await stored(page,platform,id,'slot1')).digest,second.digest,'Loading restores the selected machine checkpoint');
 await load(page,platform,'recovery');await save(page,platform,'slot3');assert.equal((await stored(page,platform,id,'slot3')).digest,recovery.digest,'Recovery remains loadable while creating the next recovery point');
 const manual=[];for(const slot of ['slot1','slot2','slot3']){const item=await stored(page,platform,id,slot);assert(Number.isFinite(Date.parse(item.metadata.savedAt)));assert.match(item.metadata.screenshot,/^data:image\/webp;base64,/);manual.push({slot,savedAt:item.metadata.savedAt,thumbnail:true,digest:item.digest});}
 const retained=await page.evaluate(async({id,platform})=>{let record;if(platform==='nes'){const {readLegacyCheckpoint}=await import('/games/arcade/checkpoint-store.mjs');record=(await readLegacyCheckpoint(id)).record;}else{const {snesSlot}=await import('/games/arcade/snes-storage.mjs');record=await snesSlot(id,'checkpoint');}const data=record.data instanceof Uint8Array?record.data:new TextEncoder().encode(JSON.stringify(record));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');},{id,platform});assert.equal(retained,migrated.digest,'Original legacy storage is retained untouched');
 await page.locator('#resume').click();await page.evaluate(()=>{__saveProof.autoStart=performance.now();__saveProof.autoFrames=__saveProof.frames;__saveProof.watch=setInterval(()=>{if(!wowieGameHost.getState().runtime.running)__saveProof.pauses++;},100);});
 return {context,page,id,platform,manual,migration:true,recovery:true};
}
try{
 const games=await Promise.all([{id:'contra',platform:'nes'},{id:'super-mario-world',platform:'snes'}].map(prepare));
 await Promise.all(games.map(async({context,page,id,platform,manual,migration,recovery})=>{
  await until(page,()=>document.querySelector('#nes-save-status,.snes-save-message')?.textContent==='Autosaved on this browser.',null,85000);
  const automatic=await stored(page,platform,id,'autosave'),proof=await page.evaluate(()=>{clearInterval(__saveProof.watch);return {...__saveProof,elapsed:performance.now()-__saveProof.startedAt,frameDelta:__saveProof.frames-__saveProof.autoFrames};});
  assert(proof.elapsed>=59000,'Autosave must be driven by the real minute timer');assert(proof.captures>=1);assert(proof.frameDelta>1000);assert.equal(proof.pauses,0,'Autosave must not pause a running game');assert.match(automatic.metadata.screenshot,/^data:image\/webp;base64,/);
  if(output)await page.locator('.nes-save-controls').screenshot({path:path.join(output,id+'-save-slots.png')});
  reports.push({id,platform,manual,migration,recovery,autosave:{savedAt:automatic.metadata.savedAt,thumbnail:true,elapsedMs:proof.elapsed,executedFrames:proof.frameDelta,nonpausing:true}});
  await page.evaluate(()=>wowieGameHost.unload());await context.close();
 }));
 assert.deepEqual(errors,[]);const result={passed:true,scope:'Real NES and SNES checkpoints, IndexedDB durability, retained legacy stores, three manual slots, thumbnails, recovery before load and a real one-minute nonpausing autosave.',reports,errors};if(output)fs.writeFileSync(path.join(output,'save-browser-report.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}catch(error){if(output)fs.writeFileSync(path.join(output,'save-browser-failure.json'),JSON.stringify({passed:false,message:error.message,reports,errors},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
