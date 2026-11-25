// Real cores, production CSP/isolation, and the existing shared arcade controls.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {chromium} from '@playwright/test';import {startArcadeServer} from './arcade-local-server.mjs';
const out=process.env.ARCADE_ADDITIONS_EVIDENCE;
if(out&&!fs.statSync(out).isDirectory())throw Error('Evidence directory must exist');
const site=await startArcadeServer(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1200,height:900}});
await context.addInitScript(()=>{
 const probe=window.__additionProbe={workers:[],audio:[],requests:[],keyboard:null};const W=Worker,A=AudioContext;
 window.Worker=class extends W{constructor(...args){super(...args);const r={live:true};probe.workers.push(r);const terminate=this.terminate.bind(this);this.terminate=()=>{r.live=false;terminate();};const send=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m.ctl)probe.keyboard=new Int32Array(m.ctl);return send(m,...rest);};}};
 window.AudioContext=class extends A{constructor(...args){super(...args);probe.audio.push(this);}};
});
const page=await context.newPage(),errors=[],reports=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:45000});
const state=()=>page.evaluate(()=>wowieGameHost.getState());
const press=key=>page.keyboard.press(key,{delay:120});
const shot=async name=>{if(out)await page.locator('#surface canvas').screenshot({path:path.join(out,name+'.png')});};
async function select(id){await page.evaluate(id=>wowieGameHost.select(id),id);await wait(id=>wowieGameHost.getState().package?.id===id&&wowieGameHost.getState().runtime?.ready,id);}
async function unload(){await page.evaluate(()=>wowieGameHost.unload());assert.equal((await state()).package,null);assert.deepEqual(await page.evaluate(()=>({workers:__additionProbe.workers.filter(w=>w.live).length,audio:__additionProbe.audio.filter(a=>a.state!=='closed').length})),{workers:0,audio:0});}
try{
 await page.goto(site.origin+'/games/arcade/');await wait(()=>window.wowieGameHost&&!wowieGameHost.getState().loading);
 assert(await page.evaluate(()=>crossOriginIsolated));for(const id of ['commander-keen','donkey-kong-country'])assert.equal(await page.locator('[data-load-package="'+id+'"]').count(),1);
 await select('commander-keen');await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.emulatedMs>=6000);
 for(const key of ['Space','Enter','Enter']){await press(key);await page.waitForTimeout(1000);}
 await page.keyboard.down('ArrowDown');await page.waitForTimeout(350);await page.keyboard.up('ArrowDown');await page.keyboard.down('ArrowRight');await page.waitForTimeout(1800);await page.keyboard.up('ArrowRight');await press('ControlLeft');await page.waitForTimeout(1600);await shot('keen-level');
 const before=await page.locator('#surface canvas').screenshot();await page.keyboard.down('ArrowRight');await press('ControlLeft');await page.waitForTimeout(600);await page.keyboard.up('ArrowRight');assert.notDeepEqual(await page.locator('#surface canvas').screenshot(),before,'Gameplay input changes video');
 await page.locator('#pause').click();assert.equal((await state()).runtime.running,false);await page.waitForTimeout(180);const paused=(await state()).runtime.emulatedMs;await page.waitForTimeout(300);assert.equal((await state()).runtime.emulatedMs,paused,'Paused machine clock must stop');
 await page.locator('#start-game').click();assert.equal(await page.evaluate(()=>document.activeElement.tagName),'CANVAS');const head=await page.evaluate(()=>Atomics.load(__additionProbe.keyboard,0));await press('ArrowRight');await wait(head=>Atomics.load(__additionProbe.keyboard,0)>head&&Atomics.load(__additionProbe.keyboard,0)===Atomics.load(__additionProbe.keyboard,1),head);await shot('keen-resumed');
 assert.equal((await state()).canSave,false);assert.equal(await page.locator('#invite-row').isVisible(),false);
 await page.locator('#reset').click();assert.equal((await state()).runtime.running,false);assert.equal((await state()).runtime.emulatedMs,0);await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.emulatedMs>=1000);await unload();
 reports.push({id:'commander-keen',gameplayInput:true,pauseClock:true,resumeFocus:true,inputConsumed:true,freshReset:true,cleanup:true});
 await select('donkey-kong-country');await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.presentedFrames>=1800);
 for(const key of ['Enter','Enter','Enter','x','x','x','x']){await press(key);await page.waitForTimeout(3500);}
 await page.keyboard.down('ArrowRight');await press('z');await page.waitForTimeout(600);await page.keyboard.up('ArrowRight');await shot('dkc-level');
 assert((await state()).runtime.presentedFrames>1800);assert.equal((await state()).canSave,true);
 await page.locator('[data-snes-save="save"]').click();await wait(()=>document.querySelector('.snes-save-message')?.textContent.includes('Saved'));
 await page.locator('[data-snes-save="load"]').click();await wait(()=>document.querySelector('.snes-save-message')?.textContent.includes('loaded'));assert.equal((await state()).runtime.running,false);await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.running);
 await page.setViewportSize({width:390,height:844});assert(await page.locator('#surface canvas').isVisible());assert(await page.locator('[data-snes-button="0"]').count());await shot('dkc-mobile');await unload();reports.push({id:'donkey-kong-country',runs:true,saveLoad:true,resume:true,mobile:true,cleanup:true});
 // The new isolation headers must also permit an existing console package.
 await select('super-mario-world');await page.locator('#start-game').click();await wait(()=>wowieGameHost.getState().runtime.presentedFrames>=60);await unload();reports.push({id:'super-mario-world',existingGameUnderIsolation:true});
 assert.deepEqual(errors,[]);const report={passed:true,reports,errors};if(out)fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();await site.close();}
