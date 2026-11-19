import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationClock} from '../htdocs/games/arcade/simulation-clock.mjs';
import {createSnesFrameExecutor} from '../htdocs/games/engines/snes/frame-executor.mjs';

function assertRollingLimit(times){
 let first=0;
 for(let i=0;i<times.length;i++){
  while(times[first]<times[i]-1000)first++;
  assert(i-first+1<=60,`Actual execution exceeded sixty frames in one second at ${times[i]}ms`);
 }
}

test('native SNES steps retain near sixty FPS for two minutes with timer jitter and frame cost',async()=>{
 let now=0,waits=0;const steps=[];
 const runner={info:()=>({fps:60.0988}),input(){},step(){steps.push(now);now+=3;return {frame:steps.length};}};
 const executor=createSnesFrameExecutor(runner,{now:()=>now,wait:async ms=>{now+=Math.ceil(ms)+[.2,.5,1][waits++%3];}});
 while(now<120000){const result=await executor.frame([0,0]);assert.equal(result.simulation.executedAtMs,steps.at(-1));assert.equal(result.simulation.executed,steps.length);}
 assert(steps[0]>=1000/60,'Initial request minted execution credit');
 assertRollingLimit(steps);
 assert(steps.length/120>=59.5,`Timer jitter reduced native rate to ${steps.length/120}`);
 assert(steps.length<=7200);
});

test('high-refresh scheduling and repeated pause/resume never mint simulation credits',()=>{
 for(const refresh of [60,144,240]){
  const clock=createSimulationClock(),steps=[];let now=0,paused=false;
  clock.resume(now);
  // Independent timers deliver due work between display callbacks. Calling
  // take from a faster display can never authorize additional native frames.
  for(let i=1;i<=refresh*120;i++){
   const target=i*1000/refresh;
   while(!paused&&now+clock.delay(now)<target){now+=clock.delay(now);if(clock.take(now)){steps.push(now);clock.complete(now);}}
   now=target;
   if(i===refresh*20){clock.pause();paused=true;}
   if(i===refresh*21){clock.resume(now);paused=false;assert.equal(clock.take(now),false);}
   if(i===refresh*40){clock.pause();clock.resume(now);assert.equal(clock.take(now),false);}
   if(clock.take(now)){steps.push(now);clock.complete(now);}
  }
  assertRollingLimit(steps);
  assert(steps.length>=7100&&steps.length<=7140,`${refresh}Hz actual execution count ${steps.length}`);
 }
});

test('worker request stalls and native overruns discard missed execution debt',async()=>{
 let now=0,cost=3;const steps=[];
 const runner={info:()=>({fps:60.0988}),input(){},step(){steps.push(now);now+=cost;return {frame:steps.length};},reset(){},load(){}};
 const executor=createSnesFrameExecutor(runner,{now:()=>now,wait:async ms=>{now+=ms;}});
 for(let i=0;i<90;i++)await executor.frame([0,0]);
 now+=400;await executor.frame([0,0]);const afterDispatchStall=steps.at(-1);
 await executor.frame([0,0]);assert(steps.at(-1)-afterDispatchStall>=1000/60);
 cost=400;await executor.frame([0,0]);const finished=now;cost=3;
 // The same executor survives cartridge reset and checkpoint load in worker.mjs.
 runner.reset();runner.load();await executor.frame([0,0]);assert(steps.at(-1)-finished>=1000/60,'Native stall was followed by a catch-up step');
 for(let i=0;i<120;i++)await executor.frame([0,0]);
 assertRollingLimit(steps);
});

test('pause history survives rapid restart and a lower native frequency remains lower',()=>{
 const clock=createSimulationClock();clock.resume(0);let now=0,steps=[];
 for(let i=0;i<60;i++){now+=clock.delay(now);assert(clock.take(now));steps.push(now);}
 for(let i=0;i<5;i++){clock.pause();clock.resume(now);assert.equal(clock.take(now),false);}
 now+=clock.delay(now);assert(clock.take(now));steps.push(now);assertRollingLimit(steps);
 const pal=createSimulationClock({hz:50});pal.resume(0);assert.equal(pal.take(20),false);assert(pal.take(20.001));assert.equal(pal.take(33.334),false);
});

test('native frames slightly above one period do not pay a second full-frame delay',async()=>{
 for(const cost of [16.8,18,20,25]){
  let now=0;const steps=[],runner={info:()=>({fps:60}),input(){},step(){steps.push(now);now+=cost;return {frame:steps.length};}};
  const executor=createSnesFrameExecutor(runner,{now:()=>now,wait:async ms=>{now+=ms;}});
  while(now<5000)await executor.frame([0,0]);
  assert(steps.length>=Math.floor((5000-1000/60)/cost),'An overrun incurred an unnecessary extra frame interval');
  for(let i=1;i<steps.length;i++)assert(steps[i]-steps[i-1]>=1000/60);assertRollingLimit(steps);
 }
});
