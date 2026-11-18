import test from 'node:test';
import assert from 'node:assert/strict';
import {createProducer,createTaskScheduler,RGBA_BYTES} from '../htdocs/games/arcade/worker-stream-producer.mjs';

function lab(){
 let now=0,serial=0,seq=0,epoch=0,frames=0,cost=0,buttonCost=0;
 const tasks=new Map(),executions=[],messages=[];
 const machine={setButton(){now+=buttonCost;},frame(){executions.push(now);now+=cost;return {state:{frames:++frames,cycles:frames*29781}};},
  getRGBA(buffer){return new Uint8ClampedArray(buffer||new ArrayBuffer(RGBA_BYTES));},
  audioLength(){return 1598;},takeAudio(buffer){return new Float32Array(buffer||new ArrayBuffer(1598*4));}};
 const producer=createProducer({machine,now:()=>now,post:m=>messages.push(m),
  schedule(fn,delay){tasks.set(++serial,{fn,due:now+delay});return serial;},cancel:id=>tasks.delete(id)});
 const send=(type,extra={})=>producer.receive({type,epoch,seq:++seq,...extra});
 const sync=()=>{epoch++;send('sync');messages.length=0;};
 function run(at){assert(tasks.size);const [id,task]=tasks.entries().next().value;tasks.delete(id);now=at??Math.max(now,task.due);task.fn();assert(!producer.snapshot().failed,messages.at(-1)?.message);}
 function replenish(){const returns=messages.splice(0).filter(m=>m.type==='frame').map(m=>({id:m.id,rgba:m.rgba.buffer,audio:m.audio.buffer}));if(returns.length)send('grant',{count:returns.length,returns});}
 sync();return {producer,executions,messages,tasks,send,sync,run,replenish,get now(){return now;},jump(ms){now+=ms;},cost(ms){cost=ms;},buttonCost(ms){buttonCost=ms;}};
}
function assertBounded(times){
 for(let i=1;i<times.length;i++)assert(times[i]-times[i-1]>=1000/60,`Frame ${i} executed too soon`);
 for(let i=60;i<times.length;i++)assert(times[i]-times[i-60]>1000,'More than 60 executions in a rolling second');
}
test('actual NES frame executions stay bounded for two minutes despite full credit capacity and early callbacks',()=>{
 const l=lab();for(let n=0;n<4;n++)l.send('grant',{count:4});
 for(let n=0;n<100;n++)l.run(0);
 assert.equal(l.executions.length,0,'Startup credits cannot execute a frame');
 while(l.now<120000){l.run();l.replenish();}
 assert(l.executions.length>=7190&&l.executions.length<=7200);
 assertBounded(l.executions);
 for(const at of l.executions)assert(at>=1000/60);
 l.producer.dispose();assert.equal(l.tasks.size,0);
});
test('execution timestamps and the rolling cap include variable controller sampling cost',()=>{
 const l=lab();l.send('grant',{count:4});
 for(let n=0;n<360;n++){
  l.buttonCost([0,.02,.1][n%3]);l.run();
  assert.equal(l.messages.at(-1).executedAtMs,l.executions.at(-1),'Timestamp must describe machine.frame after input sampling');
  l.replenish();
 }
 for(let i=60;i<l.executions.length;i++)assert(l.executions[i]-l.executions[i-60]>1000);
 l.producer.dispose();
});
test('worker starvation and slow machine.frame discard missed deadlines instead of catching up',()=>{
 const l=lab();l.send('grant',{count:4});l.run();l.replenish();
 l.jump(120000);const stalled=l.now;l.run();l.replenish();
 assert.equal(l.executions.at(-1),stalled);
 for(let n=0;n<20;n++)l.run(l.now);
 assert.equal(l.executions.length,2,'Overdue credits cannot execute together');
 l.cost(400);l.run();const completion=l.now;l.replenish();l.cost(0);
 for(let n=0;n<20;n++)l.run(completion);
 assert.equal(l.executions.length,3,'Long native execution cannot cause an immediate next frame');
 l.run();assert(l.executions.at(-1)>=completion+1000/60);assertBounded(l.executions);l.producer.dispose();
});
test('rapid sync, stop, resume and idle grants cannot reset the execution budget',()=>{
 const l=lab();l.send('grant',{count:1});l.run();
 for(let n=0;n<180;n++){
  l.send('stop');l.sync();l.send('grant',{count:1});l.run(l.now);
  const before=l.executions.length;l.run();assert.equal(l.executions.length,before+1);
  assert.equal(l.tasks.size,0,'Exhausted credits leave no background work');
 }
 assertBounded(l.executions);
 l.jump(120000);l.send('grant',{count:1});l.run();
 assertBounded(l.executions);l.producer.dispose();
});
test('delayed task scheduler cancels deadline timers and still yields through MessageChannel',()=>{
 const timers=new Map(),deliveries=[];let serial=0,closes=0;
 class Channel{constructor(){this.port1={onmessage:null,close(){closes++;}};this.port2={postMessage:id=>deliveries.push(()=>this.port1.onmessage?.({data:id})),close(){closes++;}};}}
 const scheduler=createTaskScheduler(Channel,{setTimer(fn,delay){timers.set(++serial,{fn,delay});return serial;},clearTimer:id=>timers.delete(id)}),seen=[];
 const cancelled=scheduler.schedule(()=>seen.push('cancelled'),17);scheduler.cancel(cancelled);
 assert.equal(timers.size,0);assert.equal(deliveries.length,0);
 scheduler.schedule(()=>seen.push('frame'),17);const [id,timer]=timers.entries().next().value;timers.delete(id);
 assert.equal(timer.delay,17);timer.fn();assert.deepEqual(seen,[]);deliveries.shift()();assert.deepEqual(seen,['frame']);
 scheduler.schedule(()=>seen.push('disposed'),17);scheduler.dispose();assert.equal(timers.size,0);assert.equal(closes,2);
});
