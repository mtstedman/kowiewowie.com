// Wall-time authority for native frame execution. There are no stored credits:
// the first frame waits one period. Ordinary timer jitter retains phase; a
// whole missed period discards debt. The rolling window is the final hard cap.
export function createSimulationClock({hz=60}={}){
 if(!Number.isFinite(hz)||hz<=0||hz>60)throw Error('Invalid simulation frequency');
 const period=1000/hz+1e-6,recent=[];let active=false,due=Infinity,executed=0,lastTime=-Infinity;
 function time(now){if(!Number.isFinite(now)||now<0||now<lastTime)throw Error('Invalid simulation timestamp');lastTime=now;while(recent.length&&recent[0]<now-1000)recent.shift();}
 function next(){return Math.max(due,recent.length>=60?recent[0]+1000+1e-6:-Infinity);}
 return Object.freeze({
  resume(now){time(now);if(active)return;active=true;due=now+period;},
  pause(){active=false;due=Infinity;},
  take(now){time(now);if(!active||now<next())return false;recent.push(now);executed++;due=now-due<period?due+period:now+period;return true;},
  // A small overrun has already consumed its frame interval. Preserve the
  // minimum start spacing; only a whole missed period discards the schedule.
  complete(now){time(now);if(active&&now>=due)due=now-due<period?Math.max(now,recent.at(-1)+period):now+period;},
  delay(now){time(now);return active?Math.max(0,next()-now):Infinity;},
  snapshot(){return {active,hz,executed};},
 });
}
