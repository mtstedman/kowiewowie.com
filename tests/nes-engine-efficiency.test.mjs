import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {parse} from 'acorn';
const root=new URL('../',import.meta.url),read=url=>fs.readFileSync(new URL('htdocs'+url,root),'utf8');
const registry=JSON.parse(read('/games/engines/nes/registry.json')),machines=new Set();
for(const selection of Object.values(registry.selections)){
 const manifest=JSON.parse(read(selection.manifest.path));const node=manifest.graph.nodes.find(n=>n.key===manifest.graph.entry);
 machines.add('/games/engines/nes/'+registry.release+'/common/'+node.factory+'.mjs');
}
const walk=(n,f)=>{if(!n||typeof n!=='object')return;f(n);for(const v of Object.values(n)){if(Array.isArray(v)){for(const x of v)walk(x,f);}else walk(v,f);}};
for(const file of machines){const source=read(file),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 function method(name){let found;walk(tree,n=>{if(n.type==='Property'&&n.method&&n.key.name===name){assert(!found);found=source.slice(n.start,n.end);}});assert(found);return found;}
 test('packed frame bytes and reusable buffer: '+file.slice(-68,-56),()=>{
  const video=Uint32Array.from({length:61440},(_,i)=>(Math.imul(i,2654435761)^0x8f1384a2)>>>0),expected=new Uint8Array(video.length*4);
  for(let i=0;i<video.length;i++){expected.set([video[i]&255,(video[i]>>>8)&255,(video[i]>>>16)&255,255],i*4);}
  const bad=()=>{throw Error('BAD_ARGUMENT');};
  for(const endian of [true,false]){
   const get=Function('video','mediaLittleEndian','bad','return ({'+method('getRGBA')+'}).getRGBA;')(video,endian,bad);
   const buffer=new ArrayBuffer(expected.length);assert.equal(get(buffer).buffer,buffer);assert.deepEqual(new Uint8Array(buffer),expected);assert.deepEqual(new Uint8Array(get().buffer),expected);
   assert.throws(()=>get(new ArrayBuffer(8)),/BAD_ARGUMENT/);
  }
 });
 test('audio ring extraction, wrap, empty and reuse: '+file.slice(-68,-56),()=>{
  const capacity=17,audio=Float32Array.from({length:capacity*2},(_,i)=>(i-13)/32);
  for(const head of [0,1,8,16])for(const count of [0,1,8,17])for(const reuse of [true,false]){
   const buffer=new ArrayBuffer(reuse?count*8:3),expected=Float32Array.from({length:count*2},(_,i)=>audio[(head*2+i)%audio.length]);
   const take=Function('audio','head','count','capacity','return ({'+method('takeAudio')+'}).takeAudio;')(audio,head,count,capacity),result=take(buffer);
   assert.deepEqual(result,expected);if(reuse)assert.equal(result.buffer,buffer);assert.equal(take().length,0);
  }
 });
}
