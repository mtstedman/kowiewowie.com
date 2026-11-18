import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.env.NES_FIX_ROOT||new URL('../',import.meta.url).pathname;
const source=p=>readFileSync(root+'/'+p,'utf8');
const pin=b=>({bytes:Buffer.byteLength(b),sha256:createHash('sha256').update(b).digest('hex')});
let serial=0;
async function loader(){return import('data:text/javascript;base64,'+Buffer.from(source('htdocs/games/arcade/authenticated-loader.mjs')+'\n// fixture '+serial++).toString('base64'));}
function fixture(){
 const entry='/games/fixture/entry.mjs',sidecar='/games/fixture/composition.json';
 const files=new Map([[entry,'export const value=1;'],[sidecar,JSON.stringify({format:'nes-composition/1',binding:{},moduleGraph:{[entry]:[]}})]]);
 for(let i=0;i<10;i++)files.set('/games/fixture/member-'+i+'.mjs','export const value='+i+';');
 return {files,p:{route:'/games/fixture/',entry,files:Object.fromEntries([...files].map(([k,v])=>[k,pin(v)]))}};
}
function network(files,{delay=2,corrupt=null}={}){
 const original=globalThis.fetch,stats={requests:[],active:0,peak:0};
 globalThis.fetch=async (url,{signal}={})=>{
  stats.requests.push(url);stats.active++;stats.peak=Math.max(stats.peak,stats.active);
  try{await new Promise((resolve,reject)=>{const fail=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',fail);resolve();},delay);if(signal?.aborted)fail();else signal?.addEventListener('abort',fail,{once:true});});return new Response(corrupt===url?'corrupt':files.get(url));}
  finally{stats.active--;}
 };
 return {stats,restore(){globalThis.fetch=original;}};
}
test('loader bounds concurrent reads, reads composition once, reuses only verified bytes and owns separate Blob graphs',async()=>{
 const {authenticatedGraph}=await loader(),{files,p}=fixture(),net=network(files);
 try{
  const a=await authenticatedGraph(p);assert(net.stats.peak>1);assert(net.stats.peak<=4);assert.equal(net.stats.requests.filter(x=>x.endsWith('composition.json')).length,1);
  const count=net.stats.requests.length,b=await authenticatedGraph(p);assert.equal(net.stats.requests.length,count);assert.notEqual(a.entry,b.entry);
  a.dispose();assert.equal(await (await fetchBlob(b.entry)).text(),'export const value=1;');b.dispose();
 }finally{net.restore();}
});
const fetchBlob=globalThis.fetch;
test('cancelled loads drain in-flight fetches and never return a graph; cached loads still honor cancellation',async()=>{
 const {authenticatedGraph}=await loader(),{files,p}=fixture(),net=network(files,{delay:30});
 try{const abort=new AbortController(),pending=authenticatedGraph(p,abort.signal);abort.abort(new Error('cancelled test'));await assert.rejects(pending,/cancelled test/);assert.equal(net.stats.active,0);const graph=await authenticatedGraph(p);graph.dispose();await assert.rejects(authenticatedGraph(p,abort.signal),/cancelled test/);}
 finally{net.restore();}
});
test('cache cannot authorize changed pins or malformed import graphs',async()=>{
 const {authenticatedGraph}=await loader(),{files,p}=fixture(),net=network(files);
 try{const a=await authenticatedGraph(p);a.dispose();const changed=structuredClone(p);changed.files[p.entry]=pin('export const value=99;');await assert.rejects(authenticatedGraph(changed),/integrity mismatch/);
 const side=p.route+'composition.json',bad=JSON.stringify({format:'nes-composition/1',binding:{},moduleGraph:{[p.entry]:[{target:p.entry,start:0,end:6,original:'wrong'}]}});files.set(side,bad);const malformed=structuredClone(p);malformed.files[side]=pin(bad);await assert.rejects(authenticatedGraph(malformed),/span mismatch/);
 }finally{net.restore();}
});
test('audio producer reuses returned exact-length PCM buffers, bounded across changes and reset',async()=>{
 const {createProducer,RGBA_BYTES,CAPACITY}=await import(pathToFileURL(root+'/htdocs/games/arcade/worker-stream-producer.mjs'));
 let frames=0,seq=0,task,received;const offered=[],buffers=[];
 const machine={setButton(){},frame(){return {state:{frames:++frames,cycles:frames*29781}};},getRGBA(buffer){return new Uint8ClampedArray(buffer||new ArrayBuffer(RGBA_BYTES));},audioLength(){return frames%2?1600:1602;},takeAudio(buffer){offered.push(buffer);const a=buffer?new Float32Array(buffer):new Float32Array(this.audioLength());a.fill(frames);return a;}};
 const producer=createProducer({machine,post:m=>{received=m;},schedule:f=>{task=f;return 1;},cancel:()=>{task=null;}});
 const send=(type,extra={})=>producer.receive({type,epoch:1,seq:++seq,...extra});send('sync');let returns=[];
 for(let i=0;i<CAPACITY*3;i++){
  send('grant',{count:1,returns});const f=task;task=null;f();assert.equal(received.type,'frame');assert.equal(received.audio[0],i+1);buffers.push(received.audio.buffer);
  returns=[{id:received.id,rgba:received.rgba.buffer,audio:received.audio.buffer}];
 }
 assert.equal(new Set(buffers).size,2);assert.equal(offered.filter(Boolean).length,CAPACITY*3-2);
 send('sync');send('grant',{count:1,returns:[]});task();assert.equal(offered.at(-1),undefined);producer.dispose();
});
test('touch controller preserves live held state without rewriting unchanged attributes',async()=>{
 let writes=0,queries=0;const buttons=[4,5,6,7].map(n=>({dataset:{direction:String(n)},_disabled:true,attrs:{},addEventListener(){},get disabled(){return this._disabled;},set disabled(v){writes++;this._disabled=v;},getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){writes++;this.attrs[k]=v;}}));
 const dataset=new Proxy({enabled:'false'},{set(o,k,v){writes++;o[k]=v;return true;}});
 const element={dataset,addEventListener(){},querySelectorAll(){queries++;return buttons;}};
 const {TouchDPad}=await import(pathToFileURL(root+'/htdocs/games/contra/touch-dpad.mjs'));
 const pad=new TouchDPad(element,{press(){return true;},release(){}});pad.render(true,()=>false);const first=writes,lookups=queries;
 for(let i=0;i<120;i++)pad.render(true,()=>false);assert.equal(writes,first);assert.equal(queries,lookups);
 pad.render(true,n=>n===4);assert.equal(buttons[0].attrs['aria-pressed'],'true');assert.equal(writes,first+1);
 pad.render(false,()=>false);assert(buttons.every(b=>b.disabled));assert.equal(dataset.enabled,'false');
});
test('all selected engines bound deadline polling by 32 instructions and reuse exact PCM buffers',async()=>{
 const catalog=JSON.parse(source('htdocs/games/arcade/catalog.json'));
 for(const row of catalog){
  const {createMachine}=await import(pathToFileURL(root+'/htdocs/games/'+row.id+'/composition-entry.mjs'));
  const machine=createMachine(),original=globalThis.performance;let calls=0;
  try{
   globalThis.performance={now:()=>++calls<3?0:1000};const result=machine.advance({maxSteps:1000,maxCycles:100000,maxMs:1});assert.equal(result.steps,32,row.id);assert.equal(result.reason,'time');assert.equal(calls,3);
  }finally{globalThis.performance=original;}
  machine.reset();machine.frame({maxMs:60000});const buffer=new ArrayBuffer(machine.audioLength()*4),audio=machine.takeAudio(buffer);assert.equal(audio.buffer,buffer,row.id);assert.equal(machine.audioLength(),0);machine.dispose?.();
 }
});
