import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(){this.nodes=new Map();this.listeners=new Map();this.textContent='';this.dataset={};}
 querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
 querySelectorAll(){return [];}
 addEventListener(event,callback){this.listeners.set(event,callback);}
 click(){this.listeners.get('click')?.({});}
 append(){} setAttribute(){} focus(){} remove(){} contains(){return false;}
}
async function harness(platform){
 let root,control=true,write=async()=>{},exportState=async()=>({machine:'checkpoint'});
 const writes=[],runtime={snapshot:()=>({ready:true,running:false}),pause(){},load(){},reset(){},dispose(){},releaseAll(){},exportCheckpoint:()=>exportState(),importCheckpoint(){},input(){},held(){return false;},audio(){return [];}};
 const context=vm.createContext({AbortController,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,document:{createElement(){root=new Element();return root;},hidden:false,hasFocus:()=>true},window:new Element()});
 const file=new URL(`../htdocs/games/arcade/${platform}-adapter.mjs`,import.meta.url);
 const module=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file.href});
 class Pads{clear(){} poll(){} render(){}}
 const store=async(...args)=>{writes.push(args);return write(...args);};
 const dependencies={
  './checkpoint-store.mjs':{saveCheckpoint:store,loadCheckpoint:async()=>({})},
  './snes-runtime.mjs':{createSnesRuntime:()=>runtime},
  './snes-input.mjs':{SNES_BUTTONS:['b','y','select','start','up','down','left','right','a','x','l','r'],SNES_KEYS:{},SnesGamepads:Pads},
  './snes-storage.mjs':{snesSlot:store},
 };
 await module.link(async name=>{const exports=dependencies[name];assert(exports,`Unexpected dependency ${name}`);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});});await module.evaluate();
 const ctx={package:{id:'save-fixture',title:'Save fixture',artifactDigest:'1'.repeat(64),capabilities:{nativePlayers:1}},scope:{defer(){}},signal:new AbortController().signal,view:new Element(),input(){return true;},canControl:()=>control,changed(){}};
 const adapter=platform==='nes'?module.namespace.createNESAdapter(ctx,()=>runtime,Pads,Pads):module.namespace.createSNESAdapter(ctx,{});
 await adapter.load();
 return {adapter,writes,setWrite(fn){write=fn;},setExport(fn){exportState=fn;},deny(){control=false;},status:()=>root.querySelector(platform==='nes'?'#nes-save-status':'.snes-save-message').textContent,saveButton:()=>root.querySelector(platform==='nes'?'#nes-save':'[data-snes-save="save"]')};
}

for(const platform of ['nes','snes']){
 test(`${platform} adapter save waits for durable storage and exposes failures while button errors are handled`,async()=>{
  const h=await harness(platform),gate=deferred();h.setWrite(()=>gate.promise);
  let complete=false;const save=h.adapter.save().then(value=>{complete=true;return value;});await tick();assert.equal(h.writes.length,1);assert.equal(complete,false);assert.match(h.status(),/Saving game/);
  gate.resolve();assert.equal(await save,true);assert.match(h.status(),/Saved on/);
  const failure=Error('Storage write rejected');h.setWrite(async()=>{throw failure;});
  await assert.rejects(h.adapter.save(),e=>e===failure);assert.equal(h.status(),failure.message);
  h.saveButton().click();await tick();assert.equal(h.status(),failure.message);await h.adapter.dispose();
 });
 test(`${platform} adapter refuses to persist a checkpoint after authority is lost`,async()=>{
  const h=await harness(platform),gate=deferred();h.setExport(()=>gate.promise);const saving=h.adapter.save();await tick();h.deny();h.adapter.setSessionState({role:'spectator'});gate.resolve({machine:'old'});
  await assert.rejects(saving,/cancelled/);assert.equal(h.writes.length,0);await h.adapter.dispose();
 });
}
