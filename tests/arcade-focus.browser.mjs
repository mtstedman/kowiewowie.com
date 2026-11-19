// Real browser defaults and cartridge adapters: held arrows must not scroll.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=fileURLToPath(new URL('../htdocs/',import.meta.url));
const server=http.createServer((request,response)=>{
 let name=new URL(request.url,'http://localhost').pathname;if(name.endsWith('/'))name+='index.html';
 response.setHeader('Content-Security-Policy',snesBrowserCSP(name));
 response.setHeader('Content-Type',({'.mjs':'text/javascript','.cjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[path.extname(name)]||'application/octet-stream');
 try{response.end(fs.readFileSync(path.join(root,name)));}catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),reports=[];
try{for(const id of ['contra','super-mario-world']){
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.goto(`http://127.0.0.1:${server.address().port}/games/arcade/?package=${id}&solo=1`);
 await page.waitForFunction(()=>window.wowieGameHost?.getState().runtime?.ready);
 await page.locator('#start-game').click();await page.locator('#surface canvas').click();
 assert(await page.evaluate(()=>document.activeElement.matches('.nes-view,.snes-view')),'Screen click must focus the game panel');
 const before=await page.evaluate(()=>scrollY);
 for(let i=0;i<10;i++){await page.keyboard.down('ArrowDown');await page.waitForTimeout(40);}await page.keyboard.up('ArrowDown');await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>scrollY),before,'Holding Down scrolled the document');
 const selector=page.locator('.nes-save-controls select');await selector.focus();const selected=await selector.evaluate(node=>node.selectedIndex);await page.keyboard.press('ArrowDown');
 assert.equal(await selector.evaluate(node=>node.selectedIndex),selected+1,'Save selector lost normal keyboard behavior');
 await page.evaluate(()=>wowieGameHost.unload());await page.close();reports.push({id,focusedPanel:true,heldArrowScroll:false,saveSelectorKeyboard:true});
}console.log(JSON.stringify({passed:true,reports}));}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
