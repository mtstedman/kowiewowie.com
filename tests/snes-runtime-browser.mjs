import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=fileURLToPath(new URL('../htdocs/',import.meta.url));
const server=http.createServer((req,res)=>{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);res.setHeader('Content-Security-Policy',snesBrowserCSP(pathname));if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});const reports=[];
const evidence=process.env.SNES_BROWSER_EVIDENCE;if(evidence&&!fs.statSync(evidence).isDirectory())throw Error('Evidence directory must already exist');
try{
 const context=await browser.newContext();
 for(const id of ['super-mario-world','zelda-a-link-to-the-past']){
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/violates.*Content Security Policy|Refused to.*Content Security Policy/.test(m.text()))console.error(m.text());});
  await page.goto(origin+'/games/arcade/?package='+id+'&solo=1');
  await page.waitForFunction(id=>window.wowieGameHost?.getPackage()?.id===id&&window.wowieGameHost.getState().runtime?.ready,id,{timeout:30000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>window.wowieGameHost?.getState())));throw error;});
  await page.locator('#start-game').click();
  await page.waitForFunction(()=>window.wowieGameHost.getState().runtime?.presentedFrames>=180,null,{timeout:15000});
  const before=await page.evaluate(()=>window.wowieGameHost.getState().runtime);
  if(evidence)await page.locator('.snes-view canvas').screenshot({path:path.join(evidence,id+'.png')});
  assert(before.generatedFrames>=180&&before.audioSamples>0);assert(before.queuedFrames<=8);
  await page.locator('[data-snes-save="save"]').click();
  await page.waitForFunction(()=>document.querySelector('.snes-save-message')?.textContent.startsWith('Saved on'));
  assert.equal(await page.evaluate(()=>window.wowieGameHost.getState().runtime.running),false);
  await page.locator('#resume').click();
  await page.waitForTimeout(200);
  await page.locator('[data-snes-save="load"]').click();
  await page.waitForFunction(()=>document.querySelector('.snes-save-message')?.textContent.startsWith('Game loaded'));
  await page.locator('#resume').click();await page.waitForTimeout(200);
  const after=await page.evaluate(()=>window.wowieGameHost.getState().runtime);assert(after.running);
  await page.evaluate(()=>window.wowieGameHost.unload());
  assert.equal(await page.locator('.snes-view').count(),0);assert.deepEqual(errors,[]);
  reports.push({id,before,after,checkpoint:true,disposed:true,errors});await page.close();
 }
 const report={passed:true,csp:'production per-route policy: arcade blob allowance; engine worker response self-only',reports};if(evidence)fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
