import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveControls} from '../htdocs/games/arcade/save-controls.mjs';
import {createSaveStore} from '../htdocs/games/arcade/save-store.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function lab(t,{replica=false}={}){
 const interval=globalThis.setInterval,clear=globalThis.clearInterval;let scheduled=null;
 globalThis.setInterval=(fn,ms)=>{assert.equal(ms,60000);scheduled=fn;return 1;};globalThis.clearInterval=()=>{scheduled=null;};
 t.after(()=>{globalThis.setInterval=interval;globalThis.clearInterval=clear;});
 class Element{constructor(tag){this.tag=tag;this.children=[];this.listeners=new Map();this.ownerDocument=doc;this.dataset={};this.attributes={};}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}addEventListener(k,fn){this.listeners.set(k,fn);}change(value){this.value=value;this.listeners.get('change')();}getContext(){return {drawImage(){}};}toDataURL(){return 'data:image/webp;base64,AQID';}}
 const doc={createElement:tag=>new Element(tag)},root=new Element('div'),values=new Map(),writes=[],calls=[];let state={frame:100},allowed=true,running=true,writeHook=async()=>{},snapshot=async()=>structuredClone(state),exportState=async()=>structuredClone(state);
 const backend={get:async key=>structuredClone(values.get(key)||null),getMany:async keys=>keys.map(key=>structuredClone(values.get(key)||null)),async put(key,value,{signal,ifAbsent}={}){await writeHook(key,value);if(signal?.aborted)throw Error('Save operation was cancelled');writes.push(key);if(!ifAbsent||!values.has(key))values.set(key,structuredClone(value));return value;}};
 const store=createSaveStore({platform:'nes',id:'fixture',backend});
 const runtime={snapshot:()=>({ready:true,running}),async pause(){calls.push('pause');running=false;},async exportCheckpoint(){calls.push('export');return exportState();},async networkSnapshot(){calls.push('snapshot');return snapshot();},async importCheckpoint(record){calls.push('import');state=structuredClone(record);}};
 const controls=createSaveControls({root,platform:'nes',id:'fixture',runtime:()=>runtime,canvas:()=>({ownerDocument:doc,width:256,height:240}),allowed:()=>allowed,release:()=>calls.push('release'),replica,store});
 t.after(()=>controls.dispose());const select=root.children[0].children[0];
 return {controls,store,values,writes,calls,root,select,get state(){return state;},setState(v){state=v;},deny(){allowed=false;controls.invalidate();},allow(){allowed=true;},running(v){running=v;},setWrite(fn){writeHook=fn;},setExport(fn){exportState=fn;},setSnapshot(fn){snapshot=fn;},timer:()=>scheduled};
}
test('manual selection controls the no-argument save and retains screenshot/timestamp metadata',async t=>{
 const l=lab(t);l.controls.update(true);await l.controls.refresh();l.select.change('slot3');await l.controls.save();
 assert.deepEqual(await l.store.read('slot3'),{frame:100});await assert.rejects(l.store.read('slot1'),/No saved game/);
 const row=(await l.store.list()).find(r=>r.slot==='slot3');assert.equal(row.screenshot,'data:image/webp;base64,AQID');assert(Number.isFinite(Date.parse(row.savedAt)));assert.deepEqual(l.calls,['release','pause','export']);
 l.select.change('autosave');l.setState({frame:200});await l.controls.save();assert.deepEqual(await l.store.read('slot3'),{frame:200},'Selecting a reserved load source retains the selected manual destination');
});
test('load cannot change emulation until recovery is durably committed',async t=>{
 const l=lab(t);await l.store.write('slot2',{frame:20});l.select.change('slot2');const gate=deferred();l.setWrite(key=>key.endsWith(':recovery')?gate.promise:Promise.resolve());
 const loading=l.controls.load();while(!l.calls.includes('export'))await turn();assert(!l.calls.includes('import'));assert.deepEqual(l.state,{frame:100});
 gate.resolve();await loading;assert.deepEqual(await l.store.read('recovery'),{frame:100});assert.deepEqual(l.state,{frame:20});
});
test('failed recovery write blocks loading and keeps the existing recovery checkpoint',async t=>{
 const l=lab(t);await l.store.write('slot1',{frame:20});await l.store.write('recovery',{frame:80});l.setWrite(async key=>{if(key.endsWith(':recovery'))throw Error('Storage full');});
 await assert.rejects(l.controls.load(),/Storage full/);assert(!l.calls.includes('import'));assert.deepEqual(l.state,{frame:100});assert.deepEqual(await l.store.read('recovery'),{frame:80});
});
test('loading recovery keeps its target in memory before backing up the current state',async t=>{
 const l=lab(t);await l.store.write('recovery',{frame:50});l.select.change('recovery');await l.controls.load();
 assert.deepEqual(l.state,{frame:50});assert.deepEqual(await l.store.read('recovery'),{frame:100});
});
test('periodic autosave is nonpausing and preserves the last good snapshot on failure',async t=>{
 const l=lab(t);assert.equal(typeof l.timer(),'function');l.timer()();while(!l.writes.length||l.controls.isBusy())await turn();
 assert.deepEqual(l.calls,['snapshot']);assert.deepEqual(await l.store.read('autosave'),{frame:100});
 l.setSnapshot(async()=>{throw Error('Snapshot failed');});await assert.rejects(l.controls.autosave(),/Snapshot failed/);assert.deepEqual(await l.store.read('autosave'),{frame:100});
 l.running(false);assert.equal(await l.controls.autosave(),false);assert.equal(l.calls.filter(x=>x==='snapshot').length,2);
});
test('autosave does not disable gameplay and a manual save awaits its durable completion',async t=>{
 const l=lab(t),gate=deferred();l.setWrite(key=>key.endsWith(':autosave')?gate.promise:Promise.resolve());
 const automatic=l.controls.autosave();while(!l.calls.includes('snapshot'))await turn();
 assert.equal(l.controls.isBusy(),false,'A pending autosave must not disable emulation controls');
 const manual=l.controls.save();await turn();assert(!l.calls.includes('pause'));
 gate.resolve();await automatic;await manual;assert.deepEqual(l.calls,['snapshot','release','pause','export']);
 assert.deepEqual(await l.store.read('autosave'),{frame:100});assert.deepEqual(await l.store.read('slot1'),{frame:100});
});
test('replicas and lost host authority never write local checkpoints',async t=>{
 const l=lab(t,{replica:true});assert.equal(l.timer(),null);assert.equal(l.root.hidden,true);l.controls.update(true);await assert.rejects(l.controls.save(),/not ready/);await assert.rejects(l.controls.autosave(),/not ready/);assert.equal(l.values.size,0);
});
test('authority changes cancel an in-flight manual snapshot before persistence',async t=>{
 const l=lab(t),gate=deferred();l.setExport(()=>gate.promise);const saving=l.controls.save();while(!l.calls.includes('export'))await turn();l.deny();gate.resolve({frame:900});await assert.rejects(saving,/cancelled/);assert.equal(l.values.size,0);
});
