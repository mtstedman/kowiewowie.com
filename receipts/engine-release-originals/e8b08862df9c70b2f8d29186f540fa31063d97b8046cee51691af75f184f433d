import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),web=resolve(root,'htdocs');
const policy=JSON.parse(readFileSync(resolve(root,'receipts/browser-policy.json')));
const config=readFileSync(resolve(root,'deploy/nginx/wowiekowie.com.conf'),'utf8');
assert.ok(config.includes('map $uri $shared_engine_csp'));
assert.ok(config.includes('default "'+policy.baseline+'";'));
assert.ok(config.includes('~'+policy.routePattern+' "'+policy.required+'";'));
assert.ok(config.includes('add_header Content-Security-Policy $shared_engine_csp always;'));
function directives(text){return Object.fromEntries(text.split(';').map(x=>x.trim().split(/\s+/)).filter(x=>x[0]).map(([k,...v])=>[k,v]));}
const before=directives(policy.baseline),after=directives(policy.required);
assert.deepEqual(after['script-src'],[...before['script-src'],'blob:']);
assert.deepEqual(after['worker-src'],["'self'",'blob:']);
for(const [key,value]of Object.entries(before))if(key!=='script-src')assert.deepEqual(after[key],value);
assert.ok(!policy.required.includes("'unsafe-inline'")&&!policy.required.includes("'unsafe-eval'"));
const route=new RegExp(policy.routePattern);assert.ok(route.test('/games/arcade/'));assert.ok(!route.test('/games/arcade-other/'));
let mode='required',tamper=null;
const compatibilityFixtures=new Map([
 ['/games/diagnostic/entry.mjs','export const marker="generic";export function createAdapter(){return "generic";}'],
 ['/games/diagnostic/composition.json','{}']
]);
const server=createServer((req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  const selected=route.test(path)?policy.required:policy.baseline;
  const csp=mode==='baseline'?policy.baseline:mode==='no-worker'?selected.replace("worker-src 'self' blob:","worker-src 'self'"):selected;
  res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');
  if(path==='/games/arcade/__shared-engine-test.html'||path==='/__shared-engine-test.html'){
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Shared engine functional check</title>');return;
  }
  if(compatibilityFixtures.has(path)){
   const bytes=compatibilityFixtures.get(path);if(bytes===null){res.writeHead(404).end();return;}
   res.setHeader('Content-Type',path.endsWith('.mjs')?'application/javascript':'application/json');res.end(bytes);return;
  }
  const file=resolve(web,'.'+decodeURIComponent(path));if(!file.startsWith(web+sep)){res.writeHead(403).end();return;}
  let bytes=readFileSync(file);if(path===tamper)bytes=Buffer.concat([bytes,Buffer.from(' ')]);
  res.setHeader('Content-Type',path.endsWith('.mjs')||path.endsWith('.js')?'application/javascript':path.endsWith('.json')?'application/json':'application/octet-stream');
  res.end(bytes);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));server.requestTimeout=20000;server.headersTimeout=21000;
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(30000);
 const origin='http://127.0.0.1:'+server.address().port;
 async function probe(selected,worker){mode=selected;await page.goto(origin+'/games/arcade/__shared-engine-test.html');return page.evaluate(async worker=>{
  const url=URL.createObjectURL(new Blob([worker?'postMessage({ok:true});':'export const ok=true;'],{type:'text/javascript'}));let instance;
  try{if(!worker)return (await import(url)).ok;return await new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);try{instance=new Worker(url,{type:'module'});instance.onmessage=()=>{clearTimeout(t);resolve(true);};instance.onerror=e=>{e.preventDefault();clearTimeout(t);resolve(false);};}catch{clearTimeout(t);resolve(false);}});}catch{return false;}finally{instance?.terminate();URL.revokeObjectURL(url);}
 },worker);}
 assert.equal(await probe('baseline',false),false,'Baseline must block Blob modules');
 assert.equal(await probe('no-worker',true),false,'Explicit worker directive must block Blob workers');
 assert.equal(await probe('required',false),true);assert.equal(await probe('required',true),true);
 const outside=await page.request.get(origin+'/__shared-engine-test.html');assert.equal(outside.headers()['content-security-policy'],policy.baseline);
 mode='required';await page.goto(origin+'/games/arcade/__shared-engine-test.html');
 const ids=JSON.parse(readFileSync(resolve(root,'compatibility-audit.json'))).map(g=>g.id);
 async function compatibilityCase(kind,sidecar){
  compatibilityFixtures.set('/games/diagnostic/composition.json',sidecar);
  return page.evaluate(async ({kind,sidecar})=>{
   const {verifyPackage,importAdapter,canonical,digest}=await import('/games/arcade/package.mjs');
   const rows=await (await fetch('/games/arcade/catalog.json')).json();
   const template=(await (await fetch(rows[0].manifest)).json()).manifest;
   const entry='/games/diagnostic/entry.mjs',composition='/games/diagnostic/composition.json';
   const source='export const marker="generic";export function createAdapter(){return "generic";}';
   const pin=async text=>{const bytes=new TextEncoder().encode(text);return {bytes:bytes.length,sha256:await digest(bytes)};};
   const files={[entry]:await pin(source)};
   if(kind!=='generic')files[composition]=await pin(sidecar===null?'{}':sidecar);
   const manifest={...template,id:'diagnostic',route:'/games/diagnostic/',entry,files};
   const artifactDigest=await digest(new TextEncoder().encode(canonical(manifest)));
   const p=await verifyPackage({manifest,artifactDigest},artifactDigest);
   const requested=[],fetchOriginal=globalThis.fetch,create=URL.createObjectURL,revoke=URL.revokeObjectURL,owned=new Set();
   globalThis.fetch=function(url,...args){requested.push(String(url));return fetchOriginal.call(this,url,...args);};
   URL.createObjectURL=function(blob){const u=create.call(URL,blob);owned.add(u);return u;};
   URL.revokeObjectURL=function(u){owned.delete(u);return revoke.call(URL,u);};
   try{
    try{
     const adapter=await importAdapter(p,new AbortController().signal);
     const deferred=[];let marker;try{marker=adapter.createAdapter({scope:{defer:fn=>deferred.push(fn)}});}finally{for(const fn of deferred.reverse())await fn();}
     return {loaded:true,marker,requested,owned:owned.size};
    }catch(e){return {loaded:false,error:String(e.message),requested,owned:owned.size};}
   }finally{globalThis.fetch=fetchOriginal;URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
  },{kind,sidecar});
 }
 const generic=await compatibilityCase('generic','{}');
 assert.equal(generic.loaded,true);assert.equal(generic.marker,'generic');assert.equal(generic.owned,0);
 assert.deepEqual(generic.requested,['/games/diagnostic/entry.mjs'],'Generic uses original verified-entry fetch without sidecar probing');
 const strictSidecar=JSON.stringify({format:'nes-composition/1',binding:{},moduleGraph:{'/games/diagnostic/entry.mjs':[]}});
 const modular=await compatibilityCase('modular',strictSidecar);
 assert.equal(modular.loaded,true);assert.equal(modular.marker,'generic');assert.equal(modular.owned,0);
 assert.ok(modular.requested.includes('/games/diagnostic/composition.json'),'Inventoried sidecar uses strict graph loading');
 for(const [label,sidecar]of [['missing',null],['malformed','{'],['invalid','{}'],['incompatible',JSON.stringify({format:'nes-composition/999',binding:{},moduleGraph:{}})],['invalid graph',JSON.stringify({format:'nes-composition/1',binding:{},moduleGraph:{}})]]){
  const rejected=await compatibilityCase('modular',sidecar);assert.equal(rejected.loaded,false,label+' inventoried composition must fail closed');assert.equal(rejected.owned,0);
 }
  // Isolated, byte-pinned strict graphs exercise ownership without starting a game.
  for(const phase of ['before-create','normal','during-import']){
   const source=phase==='during-import'
    ? 'globalThis.__overlayEntered();await globalThis.__overlayGate;export function createAdapter(){globalThis.__overlayCreates++;return "fixture";}'
    : 'export function createAdapter(){globalThis.__overlayCreates++;return "fixture";}';
   compatibilityFixtures.set('/games/diagnostic/entry.mjs',source);
   compatibilityFixtures.set('/games/diagnostic/composition.json',strictSidecar);
   const result=await page.evaluate(async ({phase,source,sidecar})=>{
    const {verifyPackage,importAdapter,canonical,digest}=await import('/games/arcade/package.mjs');
    const rows=await (await fetch('/games/arcade/catalog.json')).json();
    const template=(await (await fetch(rows[0].manifest)).json()).manifest;
    const pin=async text=>{const bytes=new TextEncoder().encode(text);return {bytes:bytes.length,sha256:await digest(bytes)};};
    const entry='/games/diagnostic/entry.mjs',composition='/games/diagnostic/composition.json';
    const manifest={...template,id:'diagnostic',route:'/games/diagnostic/',entry,files:{[entry]:await pin(source),[composition]:await pin(sidecar)}};
    const artifactDigest=await digest(new TextEncoder().encode(canonical(manifest)));
    const p=await verifyPackage({manifest,artifactDigest},artifactDigest);
    const controller=new AbortController(),signal=controller.signal,owned=new Set(),revoked=new Map();
    const create=URL.createObjectURL,revoke=URL.revokeObjectURL,add=signal.addEventListener,remove=signal.removeEventListener;
    const listeners=new Set();let created=0,release,timer;
    globalThis.__overlayCreates=0;
    const entered=new Promise(resolve=>{globalThis.__overlayEntered=resolve;});
    globalThis.__overlayGate=new Promise(resolve=>{release=resolve;});
    signal.addEventListener=function(type,fn,options){if(type==='abort')listeners.add(fn);return add.call(this,type,fn,options);};
    signal.removeEventListener=function(type,fn,options){if(type==='abort')listeners.delete(fn);return remove.call(this,type,fn,options);};
    URL.createObjectURL=function(blob){const u=create.call(URL,blob);owned.add(u);created++;return u;};
    URL.revokeObjectURL=function(u){owned.delete(u);revoked.set(u,(revoked.get(u)||0)+1);return revoke.call(URL,u);};
    const check=(value,message)=>{if(!value)throw Error(phase+': '+message);};
    let loading;
    try{
     loading=importAdapter(p,signal);
     if(phase==='during-import'){
      // Settle rejection immediately while the fixture's top-level await is gated.
      const settled=loading.then(()=>({loaded:true}),error=>({loaded:false,error:String(error.message)}));
      await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Import gate timeout')),10000);})]);clearTimeout(timer);
      check(owned.size>0,'graph must own URLs during import');controller.abort();
      check(owned.size===0,'abort must immediately release graph during import');release();
      const outcome=await settled;check(!outcome.loaded&&/cancel/i.test(outcome.error),'post-import cancellation rejection');
     }else{
      const adapter=await loading;check(owned.size>0,'graph retained before createAdapter');
      const deferred=[];
      if(phase==='before-create'){
       controller.abort();check(owned.size===0,'abort before createAdapter releases URLs');
       let rejected=false;try{adapter.createAdapter({scope:{defer:fn=>deferred.push(fn)}});}catch(e){rejected=/cancel/i.test(e.message);}
       check(rejected,'cancelled createAdapter rejected');check(globalThis.__overlayCreates===0,'cancelled adapter must not run');
      }else{
       check(adapter.createAdapter({scope:{defer:fn=>deferred.push(fn)}})==='fixture','adapter result');
       check(globalThis.__overlayCreates===1,'adapter called once');check(deferred.length===1,'scope owns cleanup');
       deferred[0]();deferred[0]();check(owned.size===0,'normal scope cleanup');controller.abort();
      }
     }
     check(created>0,'fixture allocated URLs');check(owned.size===0,'all URLs released');
     check([...revoked.values()].every(n=>n===1)&&revoked.size===created,'cleanup is idempotent');
     check(listeners.size===0,'abort listener removed');return {phase,created};
    }finally{
     clearTimeout(timer);release();controller.abort();if(loading)await loading.catch(()=>{});
     URL.createObjectURL=create;URL.revokeObjectURL=revoke;signal.addEventListener=add;signal.removeEventListener=remove;
     delete globalThis.__overlayEntered;delete globalThis.__overlayGate;delete globalThis.__overlayCreates;
    }
   },{phase,source,sidecar:strictSidecar});
   assert.equal(result.phase,phase);assert.ok(result.created>0);
  }
  for(const id of ids){
  await page.evaluate(async id=>{
   const check=(v,m)=>{if(!v)throw Error(m);};
   const {verifyPackage,importAdapter}=await import('/games/arcade/package.mjs');
   const {authenticatedGraph}=await import('/games/arcade/authenticated-loader.mjs');
   const rows=await (await fetch('/games/arcade/catalog.json')).json(),row=rows.find(r=>r.id===id);
   const envelope=await (await fetch(row.manifest)).json(),p=await verifyPackage(envelope,row.artifactDigest);
   const owned=new Set(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;
   URL.createObjectURL=function(blob){const u=create.call(URL,blob);owned.add(u);return u;};
   URL.revokeObjectURL=function(u){owned.delete(u);return revoke.call(URL,u);};
   let graph,worker;
   try{
    const adapter=await importAdapter(p,new AbortController().signal);check(typeof adapter.createAdapter==='function','Authenticated adapter export');
    const deferred=[];try{adapter.createAdapter({package:p,scope:{defer:fn=>deferred.push(fn)}});}finally{for(const fn of deferred.reverse())await fn();}
    check(owned.size===0,'Adapter Blob cleanup');
    graph=await authenticatedGraph(p);const url=graph.moduleURL(p.route+'worker.mjs');check(url.startsWith('blob:'),'Authenticated Worker URL');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker ready timeout: '+id)),30000);worker=new Worker(url,{type:'module'});worker.onmessage=({data})=>{if(data.type==='battery-await-init'){worker.postMessage({type:'battery-init',record:null});}else if(data.type==='ready'){clearTimeout(timer);resolve();}else if(data.type==='error'){clearTimeout(timer);reject(Error(data.message));}};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};});
   }finally{worker?.terminate();graph?.dispose();check(owned.size===0,'Worker Blob cleanup');URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
  },id);
  tamper='/games/'+id+'/cartridge/data.mjs';
  const rejected=await page.evaluate(async id=>{const {verifyPackage,importAdapter}=await import('/games/arcade/package.mjs');const rows=await (await fetch('/games/arcade/catalog.json')).json(),r=rows.find(r=>r.id===id),p=await verifyPackage(await (await fetch(r.manifest)).json(),r.artifactDigest);try{await importAdapter(p,new AbortController().signal);return false;}catch(e){return /integrity|limit/i.test(e.message);}},id);
  assert.equal(rejected,true,id+' tampered bytes rejected');tamper=null;
 }
 console.log(JSON.stringify({status:'passed',games:ids.length,checks:['generic verified-entry compatibility','strict modular graph loading','invalid inventoried composition rejection','scoped CSP configuration','blocked Blob module and Worker policies','authenticated adapter imports','all seven authenticated module workers ready','tamper rejection','Blob cleanup','generic battery initialization handshake','abort before createAdapter','abort during import','idempotent scope cleanup and listener removal']}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
