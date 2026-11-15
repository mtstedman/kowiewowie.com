import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const origin=process.env.COMBINED_TEST_ORIGIN;assert(/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(origin||''));assert.equal(process.env.ROMJS_NETPLAY_TEST_ALLOW,'disposable-local-database');
const mode=process.env.COMBINED_BROWSER_MODE||'isolated';if(mode==='trusted-local')assert.equal(process.env.COMBINED_TRUSTED_LOCAL,'authored-loopback-fixture');
if(process.env.COMBINED_BROWSER_MODE_RECEIPT)writeFileSync(process.env.COMBINED_BROWSER_MODE_RECEIPT,JSON.stringify({format:'combined-browser-mode/1',requested:mode,effective:mode,chromium_sandbox_requested:mode==='isolated',sandbox_validated:false,host_security_changed:false})+'\n',{flag:'wx',mode:0o600});
const {chromium}=await import(process.env.COMBINED_PLAYWRIGHT_MODULE||'@playwright/test');
const wait=(p,f,a)=>p.waitForFunction(f,a,{timeout:120000});
test('Contra real two-player game, separate controller ports, play/watch invitations and cleanup',{timeout:300000},async()=>{
 const browsers=[],pages=[],errors=[];
 async function page(){const b=await chromium.launch({headless:true,chromiumSandbox:mode==='isolated'});browsers.push(b);const c=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await c.addInitScript(()=>{
   window.__contra={frames:0,requests:[],errors:[],workers:0};
   const W=Worker;
   window.Worker=class extends W{constructor(...a){
    super(...a);__contra.workers++;
    let epoch=-1;const pending=[],held=[new Map(),new Map()];
    this.addEventListener('message',({data:d})=>{
     if(d.type==='frame'&&d.epoch===epoch){
      // Observe real worker acknowledgements, after each controller edge is applied.
      while(pending.length&&pending[0].inputSeq<=d.appliedSeq){
       const edge=pending.shift(),sources=held[edge.seat-1];
       if(edge.pressed){if(!sources.has(edge.source))sources.set(edge.source,edge.button);}
       else sources.delete(edge.source);
      }
      const ports=held.map(sources=>Array.from({length:8},(_,b)=>[...sources.values()].includes(b)));
      __contra.frames=d.frames;
      __contra.requests.push({p1:ports[0],p2:ports[1],appliedSeq:d.appliedSeq});
      if(__contra.requests.length>1000)__contra.requests.shift();
     }
     if(d.type==='error')__contra.errors.push(d);
    });
    const send=this.postMessage.bind(this);
    this.postMessage=(d,...a)=>{
     if(d.type==='sync'){epoch=d.epoch;pending.length=0;held.forEach(s=>s.clear());}
     if(d.type==='input'&&d.epoch===epoch)pending.push({...d});
     if(d.type==='stop'){pending.length=0;held.forEach(s=>s.clear());}
     return send(d,...a);
    };
   }};
  });const p=await c.newPage();pages.push(p);p.setDefaultTimeout(120000);p.on('pageerror',e=>errors.push(e.message));return p;}
 const host=await page();let guest,watcher;
 async function frames(n){const end=await host.evaluate(n=>__contra.frames+n,n);await wait(host,end=>__contra.frames>=end||__contra.errors.length,end);assert.deepEqual(await host.evaluate(()=>__contra.errors),[]);}
 async function key(p,key,action){await p.keyboard.down(key);try{await action();}finally{await p.keyboard.up(key);}}
 async function invite(kind){await host.locator('#invite-'+kind).click();await wait(host,()=>!!document.querySelector('#sharing-link')?.value);const u=await host.locator('#sharing-link').inputValue();await host.evaluate(()=>document.querySelector('#sharing-link').value='');return u;}
 try{
  await host.goto(origin+'/games/arcade/?package=contra&solo=1');await wait(host,()=>window.wowieGameHost?.getState().runtime?.ready);await host.locator('#start-game').click();await frames(450);await host.locator('.nes-view').focus();await key(host,'Shift',()=>frames(6));await frames(14);await key(host,'Enter',()=>frames(60));await frames(470);
  const playURL=await invite('play'),watchURL=await invite('watch');guest=await page();watcher=await page();await guest.goto(playURL);await watcher.goto(watchURL);
  if(!await host.evaluate(()=>wowieGameHost.getState().runtime.running))await host.locator('#resume').click();
  for(const p of [guest,watcher])await wait(p,()=>window.wowieGameHost?.getState().session.phase==='active'&&document.querySelector('#session-surface video')?.videoWidth>0);
  assert.equal(await guest.evaluate(()=>wowieGameHost.getState().canControl),true);assert.equal(await watcher.evaluate(()=>wowieGameHost.getState().canControl),false);
  await host.evaluate(()=>__contra.requests.length=0);await guest.locator('#receiver-controls').focus();
  await key(guest,'ArrowRight',async()=>{await wait(host,()=>__contra.requests.some(x=>x.p2[7]&&!x.p1.some(Boolean)));await frames(18);});
  await wait(host,()=>__contra.requests.length&&__contra.requests.at(-1).p2.every(x=>!x));
  await host.locator('.nes-view').focus();await host.evaluate(()=>__contra.requests.length=0);
  await key(host,'ArrowLeft',async()=>{await wait(host,()=>__contra.requests.some(x=>x.p1[6]&&!x.p2.some(Boolean)));await key(guest,'z',async()=>{await wait(host,()=>__contra.requests.some(x=>x.p1[6]&&x.p2[0]&&!x.p1[0]&&!x.p2[6]));await frames(18);});});
  await wait(host,()=>__contra.requests.at(-1)?.p1.every(x=>!x)&&__contra.requests.at(-1)?.p2.every(x=>!x));
  await host.evaluate(()=>__contra.requests.length=0);await watcher.keyboard.press('ArrowRight');await frames(8);assert.equal(await host.evaluate(()=>__contra.requests.some(x=>x.p1.some(Boolean)||x.p2.some(Boolean))),false);
  for(const p of [guest,watcher])assert.equal(await p.evaluate(()=>__contra.workers),0);
  await host.locator('#pause').click();await wait(guest,()=>wowieGameHost.getState().session.phase==='reconnecting');await host.locator('#resume').click();await wait(guest,()=>wowieGameHost.getState().session.phase==='active');await frames(30);
  if(process.env.CONTRA_BROWSER_EVIDENCE){await host.locator('canvas').screenshot({path:process.env.CONTRA_BROWSER_EVIDENCE+'/host-two-player.png'});await guest.screenshot({path:process.env.CONTRA_BROWSER_EVIDENCE+'/guest.png'});await watcher.screenshot({path:process.env.CONTRA_BROWSER_EVIDENCE+'/watcher.png'});}
  await host.locator('#sharing-end').click();for(const p of [guest,watcher])await wait(p,()=>wowieGameHost.getState().session.phase==='ended');assert.deepEqual(errors,[]);assert.deepEqual(await host.evaluate(()=>__contra.errors),[]);
 }finally{for(const p of pages)await p.evaluate(()=>window.wowieGameHost?.unload()).catch(()=>{});await Promise.allSettled(browsers.map(b=>b.close()));}
});
