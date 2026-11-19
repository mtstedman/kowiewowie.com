// Real browser layout: cartridges are uniform, and the page stays inside the cabinet art.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../htdocs/',import.meta.url));
const types={'.mjs':'text/javascript','.cjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((request,response)=>{
 let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(name.endsWith('/'))name+='index.html';
 const file=path.resolve(root,'.'+name);if(!file.startsWith(root)){response.writeHead(403).end();return;}
 response.setHeader('Content-Type',types[path.extname(name)]||'application/octet-stream');
 try{response.end(fs.readFileSync(file));}catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),reports=[];
try{for(const [name,width,height,rails]of [['desktop',1440,900,true],['laptop',1280,720,true],['portrait',820,1180,false],['phone',390,844,false]]){
 const page=await browser.newPage({viewport:{width,height}});
 await page.goto(`http://127.0.0.1:${server.address().port}/games/arcade/`);
 await page.waitForSelector('.cartridge-choice');await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode().catch(()=>{}))));
 const shelf=await page.evaluate(()=>{
  const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const style=getComputedStyle(document.documentElement),length=value=>{const probe=document.createElement('div');probe.style.cssText='position:absolute;visibility:hidden;width:'+value;document.body.append(probe);const size=probe.getBoundingClientRect().width;probe.remove();return size;};
  return {rail:length('var(--rail)'),marquee:length('var(--marquee)'),main:box(document.querySelector('main')),masthead:box(document.querySelector('.masthead a')),scrollWidth:document.documentElement.scrollWidth,
   cards:[...document.querySelectorAll('.cartridge-choice')].map(card=>({card:box(card),body:box(card.querySelector('.cartridge-body')),image:box(card.querySelector('img')),title:box(card.querySelector('strong')),button:box(card.querySelector('.load-cartridge'))}))};
 });
 assert(shelf.cards.length>=15,'Cartridge shelf is incomplete');
 const first=shelf.cards[0],close=(a,b,what)=>assert(Math.abs(a-b)<=.5,`${name}: ${what} differs (${a} vs ${b})`);
 for(const item of shelf.cards){
  for(const part of ['card','body','image','title','button'])for(const side of ['width','height'])close(item[part][side],first[part][side],part+' '+side);
  for(const part of ['image','title','button'])close(item[part].top-item.card.top,first[part].top-first.card.top,part+' offset');
  assert(item.button.top>=item.body.top&&item.button.bottom<=item.body.bottom&&item.button.left>=item.body.left&&item.button.right<=item.body.right,name+': load button must sit inside its cartridge');
  assert(item.card.left>=shelf.main.left-.5&&item.card.right<=shelf.main.right+.5,name+': cartridge leaves the page column');
 }
 const rows=new Map();for(const item of shelf.cards)rows.set(Math.round(item.card.top),(rows.get(Math.round(item.card.top))||0)+1);
 assert(Math.max(...rows.values())>=2,name+': shelf must have at least two columns');
 assert(shelf.scrollWidth<=width,name+': page scrolls sideways');
 assert(shelf.masthead.top>=shelf.marquee-1,name+': masthead starts under the marquee');
 if(rails){assert(shelf.rail>60,name+': cabinet rails expected');assert(shelf.main.left>=shelf.rail&&shelf.main.right<=width-shelf.rail,name+': page overlaps the cabinet rails');}
 else assert.equal(shelf.rail,0,name+': narrow screens have no rails');
 reports.push({name,columns:Math.max(...rows.values()),card:[first.card.width,first.card.height],rail:shelf.rail});await page.close();
}console.log(JSON.stringify({passed:true,reports}));}
finally{await browser.close();server.close();}
