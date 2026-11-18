// Presentation follows wall-clock deadlines, independently of native machine
// and PCM clocks. A stalled display never earns a burst of catch-up draws.
export const PRESENTATION_LIMIT_HZ=60;
export function createFramePacer(){
 const period=1000/PRESENTATION_LIMIT_HZ,windowMs=1000,epsilon=1e-7;
 let deadline=null,lastTime=null,total=0;const recent=[];
 function trim(now){while(recent.length&&recent[0]<=now-windowMs+epsilon)recent.shift();}
 function sample(now){
  if(!Number.isFinite(now)||now<0)throw Error('Invalid presentation timestamp');
  if(lastTime!==null&&now<lastTime)throw Error('Presentation clock moved backwards');
  lastTime=now;trim(now);
 }
 return Object.freeze({
  take(now){
   sample(now);
   if(recent.length>=PRESENTATION_LIMIT_HZ||(deadline!==null&&now+epsilon<deadline))return false;
   // Keep a steady phase across normal vsync rounding. If a whole deadline
   // was missed, discard that timing debt rather than presenting it later.
   deadline=deadline===null||now-deadline>=period?now+period:deadline+period;
   recent.push(now);total++;return true;
  },
  resetClock(){deadline=null;},
  snapshot(now){if(!Number.isFinite(now)||now<0)throw Error('Invalid presentation timestamp');return {limitHz:PRESENTATION_LIMIT_HZ,fps:recent.filter(t=>t>now-windowMs+epsilon&&t<=now+epsilon).length,presented:total};},
 });
}
