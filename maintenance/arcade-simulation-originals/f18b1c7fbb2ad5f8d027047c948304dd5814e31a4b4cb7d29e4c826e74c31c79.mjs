// Observe actual worker frame counters/execution times and PCM playback, never the FPS label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=process.env.ARCADE_SIMULATION_ROOT?path.resolve(process.env.ARCADE_SIMULATION_ROOT)+path.sep:fileURLToPath(new URL('../htdocs/',import.meta.url)),reports=[];
const output=process.env.ARCADE_SIMULATION_EVIDENCE;if(output&&!fs.statSync(output).isDirectory())throw Error('Evidence directory must exist');
const server=http.createServer((req,res)=>{try{let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(url.endsWith('/'))url+='index.html';const file=path.resolve(root,'.'+url);assert(file.startsWith(root));res.setHeader('Content-Security-Policy',snesBrowserCSP(url));res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true}),context=await browser.newContext();
await context.addInitScript(()=>{
 const now=()=>performance.timeOrigin+performance.now();
 const q=window.__simulationProbe={workers:[],live:0,frames:[],requests:[],audio:[],stalls:[],ready:[],phase:'initial'};
 const W=Worker;
 window.Worker=class extends W{
  constructor(url,options){
   // The wrapper records real worker posts and injects a test-only event-loop stall.
   // Original modules, emulation, timers, inputs and clocks remain unmodified.
   const source=`import ${JSON.stringify(String(url))};const send=self.postMessage.bind(self),receive=self.onmessage;self.postMessage=(d,...rest)=>{send({...d,__simulationProbe:{origin:performance.timeOrigin,postedAt:performance.timeOrigin+performance.now()}},...rest);};self.onmessage=event=>{if(event.data?.__simulationProbe!=='stall')return receive.call(self,event);const start=performance.now();while(performance.now()-start<event.data.ms){}send({__simulationStallDone:event.data.id,elapsed:performance.now()-start});};`;
   const bootstrap=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));super(bootstrap,{...options,type:'module'});q.workers.push(this);q.live++;
   let ended=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!ended){ended=true;q.live--;URL.revokeObjectURL(bootstrap);}return stop();};
   const pending=new Map(),post=this.postMessage.bind(this);this.postMessage=(d,...rest)=>{if(d?.op)pending.set(d.id,d.op);if(d?.op==='frame')q.requests.push({at:now(),phase:q.phase});return post(d,...rest);};
   this.addEventListener('message',event=>{const d=event.data;if(d?.__simulationStallDone){event.stopImmediatePropagation();q.stalls.push({id:d.__simulationStallDone,elapsed:d.elapsed});return;}
    const op=pending.get(d.id);pending.delete(d.id);if(d.type==='ready'||op==='init')q.ready.push(d.__simulationProbe?.postedAt??now());
    if(d.type!=='frame'&&op!=='frame')return;
    const frame=d.type==='frame'?d:d.result,simulation=d.simulation??frame?.simulation;
    q.frames.push({frame:d.type==='frame'?d.frames:frame?.frame,produced:d.type==='frame'?d.produced:simulation?.executed,at:d.__simulationProbe.origin+(d.executedAtMs??simulation?.executedAtMs),postedAt:d.__simulationProbe.postedAt,receivedAt:now(),audioSamples:frame?.audio?.length??0,phase:q.phase});
   });
  }
 };
 const start=AudioBufferSourceNode.prototype.start;
 AudioBufferSourceNode.prototype.start=function(at=0,...rest){if(this.buffer)q.audio.push({phase:q.phase,observedAt:now(),at,rate:this.playbackRate.value,nativeDuration:this.buffer.duration,effectiveDuration:this.buffer.duration/this.playbackRate.value,samples:this.buffer.length*this.buffer.numberOfChannels});return start.call(this,at,...rest);};
});
const period=1000/60;
function ceiling(times,label,strict=true){let left=0,max=0;for(let right=0;right<times.length;right++){assert(Number.isFinite(times[right]),label+' needs actual execution timestamps');if(right)assert(times[right]>=times[right-1],label+' moved backwards');while(times[left]<=times[right]-1000+.01)left++;max=Math.max(max,right-left+1);}if(strict)assert(max<=60,`${label}: ${max} actual frames in a rolling second`);return max;}
try{
 for(const id of ['super-mario-world','zelda-a-link-to-the-past','megaman']){
  console.log('Measuring actual emulation: '+id);
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  const phase=name=>page.evaluate(name=>{__simulationProbe.phase=name;return performance.timeOrigin+performance.now();},name);
  const running=()=>page.waitForFunction(()=>wowieGameHost.getState().runtime.running);
  await page.goto(origin+'/games/arcade/?package='+id+'&solo=1');await page.waitForFunction(()=>window.wowieGameHost?.getState().runtime?.ready);
  await phase('startup');await page.locator('#start-game').click();await running();await page.waitForTimeout(1200);
  const from=await phase('sustained');await page.waitForTimeout(10000);const to=await phase('before-worker-stall'),steadyRuntime=await page.evaluate(()=>wowieGameHost.getState().runtime);
  await page.evaluate(()=>__simulationProbe.workers.at(-1).postMessage({__simulationProbe:'stall',id:'worker-stall',ms:400}));await page.waitForFunction(()=>__simulationProbe.stalls.some(s=>s.id==='worker-stall'));
  await phase('after-worker-stall');await page.waitForTimeout(2000);
  await phase('pause');await page.locator('#pause').click();await page.waitForFunction(()=>!wowieGameHost.getState().runtime.running);await page.waitForTimeout(200);const pausedFrames=await page.evaluate(()=>__simulationProbe.frames.length);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>__simulationProbe.frames.length),pausedFrames,id+' emulated while paused');
  await phase('resume');await page.locator('#resume').click();await running();await page.waitForTimeout(1200);
  await phase('rapid-resume');for(let i=0;i<4;i++){await page.locator('#pause').click();await page.waitForTimeout(40);await page.locator('#resume').click();await page.waitForTimeout(40);}
  await phase('main-stall');await page.evaluate(()=>{const start=performance.now();while(performance.now()-start<300){}});await phase('after-main-stall');await page.waitForTimeout(1200);
  const data=await page.evaluate(()=>({frames:__simulationProbe.frames,requests:__simulationProbe.requests,audio:__simulationProbe.audio,stalls:__simulationProbe.stalls,ready:__simulationProbe.ready,runtime:wowieGameHost.getState().runtime}));
  if(output)fs.writeFileSync(path.join(output,id+'-trace.json'),JSON.stringify(data)+'\n',{flag:'wx'});
  assert(data.frames.length>600,id+' must run enough actual frames');for(let i=1;i<data.frames.length;i++)assert.equal(data.frames[i].frame,data.frames[i-1].frame+1,id+' actual machine frame counter did not advance by one');
  const maximum=ceiling(data.frames.map(f=>f.at),id),actual=data.frames.filter(f=>f.at>=from&&f.at<to).length,rate=actual/((to-from)/1000);assert(rate>=57&&rate<=60.1,`${id} sustained actual emulation rate ${rate.toFixed(3)} FPS`);
  const rpcPostsMaxRollingSecond=data.requests.length?ceiling(data.requests.map(f=>f.at),id+' dispatched RPCs',false):null;
  assert(data.audio.length>500,id+' missing PCM playback');for(const audio of data.audio)assert(audio.effectiveDuration>=period/1000-1e-7,id+' audio consumes an emulated frame faster than 1/60 second');
  assert(data.stalls[0].elapsed>=400);assert.deepEqual(errors,[]);
  const audioDurations=data.audio.map(a=>a.effectiveDuration),nativeDurations=data.audio.map(a=>a.nativeDuration),rates=data.audio.map(a=>a.rate);
  const report={id,actualFrames:data.frames.length,maxRollingSecond:maximum,sustained:{elapsedMs:to-from,frames:actual,fps:rate,runtime:steadyRuntime},rpcPostsMaxRollingSecond,audio:{scheduledBuffers:data.audio.length,minEffectiveSeconds:Math.min(...audioDurations),maxEffectiveSeconds:Math.max(...audioDurations),minNativeSeconds:Math.min(...nativeDurations),maxNativeSeconds:Math.max(...nativeDurations),minPlaybackRate:Math.min(...rates),maxPlaybackRate:Math.max(...rates)},workerStallMs:data.stalls[0].elapsed,mainStallMs:300,pauseStoppedActualEmulation:true,rapidResume:true,runtime:data.runtime,errors};
  await page.evaluate(()=>wowieGameHost.unload());assert.equal(await page.evaluate(()=>__simulationProbe.live),0);reports.push(report);console.log(JSON.stringify(report));await page.close();
 }
 const report={passed:true,observation:'Actual worker frame counters and execution timestamps, independent wall time and WebAudio scheduling; not canvas or FPS text',csp:'exact production nginx policy',reports};if(output)fs.writeFileSync(path.join(output,'simulation-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
