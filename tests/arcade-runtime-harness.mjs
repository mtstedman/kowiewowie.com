import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadExactModule} from './arcade-runtime-module-loader.mjs';
import {batteryContract,workerTransport} from './arcade-runtime-protocol.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const sourcePins=JSON.parse(readFileSync(new URL('./arcade-runtime-source-pins.json',import.meta.url),'utf8')).files;
export async function runtimeHarness(path,{storage:providedStorage,flushMode='auto',now=()=>1000}={}){
 let sequence=0,frame=0,audioCloses=0,battery=null;
 const timers=new Map(),timerDelays=new Map(),rafs=new Map(),contexts=[],nodes=new Map(),saved=new Map();
 const storage=providedStorage||{getItem:k=>saved.get(k)??null,setItem:(k,v)=>{saved.set(k,String(v));},removeItem:k=>saved.delete(k)};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'2',dataset:{},textContent:'',disabled:false,setAttribute(){},getContext(){return {imageSmoothingEnabled:false,clearRect(){},putImageData(){}};}});return nodes.get(id);};
 const {Worker,workers,trace}=workerTransport(()=>battery,{flushMode});
 class Audio{
  constructor(){this.state='running';this.currentTime=0;this.destination={};contexts.push(this);}
  createGain(){return {gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  resume(){return Promise.resolve();}
  close(){audioCloses++;this.state='closed';return Promise.resolve();}
 }
 const context=vm.createContext({document:{hidden:false,hasFocus:()=>true},window:{AudioContext:Audio},Worker,URL,console,
  performance:{now},localStorage:storage,Uint8Array,Uint8ClampedArray,Float32Array,ImageData:class{},
  setTimeout:(f,ms)=>{const id=++sequence;timers.set(id,f);timerDelays.set(id,ms);return id;},
  clearTimeout:id=>{timerDelays.delete(id);return timers.delete(id);},
  requestAnimationFrame:f=>{const id=++frame;rafs.set(id,f);return id;},cancelAnimationFrame:id=>rafs.delete(id),
  root:{querySelector:s=>{assert.match(s,/^#nes-[a-z-]+$/);return node(s.slice(5));}}
 },{codeGeneration:{strings:false,wasm:false}});
 const loaded=await loadExactModule(path,{context,sourceRoot,pins:sourcePins});battery=batteryContract(loaded.namespaces);
 assert.equal(typeof loaded.namespace.createRuntime,'function','Runtime factory export required');
 context.runtimeFactory=loaded.namespace.createRuntime;
 let runtime;
 try{runtime=vm.runInContext('runtimeFactory({root})',context,{timeout:2000});}
 catch(error){for(const w of workers)if(!w.dead)w.terminate();timers.clear();timerDelays.clear();rafs.clear();for(const a of contexts)await a.close();throw error;}
 finally{delete context.runtimeFactory;}
 return {runtime,workers,contexts,timers,timerDelays,rafs,storage,saved,trace,battery,sourceRecords:loaded.records,audioCloses:()=>audioCloses,
  fireTimer(id){assert(timers.has(id),'Unknown timer');const f=timers.get(id);timers.delete(id);timerDelays.delete(id);f();}
 };
}
