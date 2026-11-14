import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export function runtimeHarness(path){
 let sequence=0,frame=0,audioCloses=0;const timers=new Map(),rafs=new Map(),workers=[],contexts=[],nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'2',dataset:{},textContent:'',disabled:false,setAttribute(){},getContext(){return {imageSmoothingEnabled:false,clearRect(){},putImageData(){}};}});return nodes.get(id);};
 class Worker{constructor(){assert.equal(workers.filter(w=>!w.dead).length,0);this.dead=false;this.sent=[];workers.push(this);}postMessage(m){assert(!this.dead);this.sent.push(m);}terminate(){this.dead=true;}receive(d){this.onmessage?.({data:d});}}
 class Audio{constructor(){this.state='running';this.currentTime=0;this.destination={};contexts.push(this);}createGain(){return {gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}resume(){return Promise.resolve();}close(){audioCloses++;this.state='closed';return Promise.resolve();}}
 const context=vm.createContext({document:{hidden:false,hasFocus:()=>true},window:{AudioContext:Audio},Worker,URL,console,performance:{now:()=>1000},localStorage:{getItem:()=>null,setItem(){}},Uint8ClampedArray,Float32Array,ImageData:class{},setTimeout:f=>{const id=++sequence;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:f=>{const id=++frame;rafs.set(id,f);return id;},cancelAnimationFrame:id=>rafs.delete(id),root:{querySelector:s=>{assert.match(s,/^#nes-[a-z-]+$/);return node(s.slice(5));}}});
 let code=readFileSync(path,'utf8').replace('export function createRuntime','function createRuntime').replaceAll('import.meta.url',JSON.stringify('https://wowiekowie.com/games/test/host-runtime.mjs'));
 vm.runInContext(code,context,{timeout:2000});const runtime=vm.runInContext('createRuntime({root})',context,{timeout:2000});return {runtime,workers,contexts,timers,rafs,audioCloses:()=>audioCloses};
}
