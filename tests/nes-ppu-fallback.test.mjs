import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const web=new URL('../htdocs/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,web)));
for(const id of ['adventure-island-2','double-dragon-ii','castlevania-3'])test(id+' retains JS PPU fallback across machine reset',async()=>{
 const composition=read('games/'+id+'/composition.json'),manifest=read(composition.binding.engineManifest.path.slice(1));
 const composerPath=Object.keys(manifest.files).find(p=>p.endsWith('/composer.mjs'));
 const composer=await import(new URL(composerPath.slice(1),web)),data=await import(new URL('games/'+id+'/cartridge/entry.mjs',web)),factories={};let disabled=0;
 for(const node of manifest.graph.nodes){const url=Object.keys(manifest.files).find(p=>p.endsWith('/'+node.factory+'.mjs')),factory=await import(new URL(url.slice(1),web));factories[node.factory]=imports=>{
  const exports=factory.instantiate(imports);if(!exports.createOwnedInstance)return exports;disabled++;return Object.freeze({...exports,createOwnedInstance:()=>null});
 };}
 const m=composer.createMachine(composer.admit(data,manifest.graph,manifest.abi),{},factories,manifest.abi);assert(disabled>0);
 for(let reset=0;reset<2;reset++){if(reset)m.reset();m.frame({maxMs:60000});assert.equal(m.getState().fault,null);assert(m.getState().frames>0);m.takeAudio();}
});
