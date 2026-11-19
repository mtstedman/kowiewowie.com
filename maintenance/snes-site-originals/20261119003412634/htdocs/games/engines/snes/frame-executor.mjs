import {createSimulationClock} from '../../arcade/simulation-clock.mjs';
// The worker's actual native step owns the final speed limit. A page request
// or an overdue timer cannot authorize a burst of native execution.
export function createSnesFrameExecutor(runner,{hz=Math.min(60,runner.info().fps),now=()=>performance.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(.1,ms)))}={}){
 const clock=createSimulationClock({hz});
 return Object.freeze({
  async frame(pads){
   if(!Array.isArray(pads)||pads.length!==2)throw Error('Invalid controller frame');
   if(!clock.snapshot().active)clock.resume(now());
   for(let p=0;p<2;p++)runner.input(p+1,pads[p]);
   let executedAtMs;
   while(!clock.take(executedAtMs=now()))await wait(clock.delay(now()));
   try{return {...runner.step(),simulation:{...clock.snapshot(),executedAtMs}};}
   finally{clock.complete(now());}
  },
  snapshot:()=>clock.snapshot(),
 });
}
