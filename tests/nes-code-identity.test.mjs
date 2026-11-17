import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url),web=new URL('htdocs/',root),registry=JSON.parse(fs.readFileSync(new URL('games/engines/nes/registry.json',web)));
for(const id of ['bionic-commando','zelda'])test(id+' cached code identity preserves live mapping, RAM epochs and restore',async()=>{
 const data=await import(new URL('games/'+id+'/cartridge/entry.mjs',web)),selection=Object.entries(registry.selections).find(([key])=>{const r=JSON.parse(key);return Object.entries(data.requirements).every(([k,v])=>r[k]===v);})?.[1];assert(selection);
 const manifest=JSON.parse(fs.readFileSync(new URL(selection.manifest.path.slice(1),web))),runtime=manifest.graph.nodes.find(n=>n.key==='runtime.mjs');
 const {instantiate}=await import(new URL('games/engines/nes/'+registry.release+'/common/'+runtime.factory+'.mjs',web));
 const {makeBus,fromHex}=instantiate([{makeTimedCPU(){throw Error('CPU not needed for bus boundary test');}}]);
 const bus=makeBus(fromHex(data.prgHex),fromHex(data.trainerHex),{},data.metadata,fromHex(data.chrHex)),events=[];bus.watchCode(page=>events.push(page));
 const write=(a,v)=>bus.write(a,v,bus.getCPUClock()+2);
 assert.equal(bus.codeLocation(0).key,bus.codeLocation(0x800).key);
 const first=bus.codeLocation(0x8000),copy={...first};first.key='poison';first.physical=-1;assert.deepEqual(bus.codeLocation(0x8000),copy);
 const ram=bus.codeLocation(0x40),old=bus.peek(0x40);write(0x40,old^1);assert.notEqual(bus.codeLocation(0x40).key,ram.key);assert.equal(events.at(-1),'ram:0');
 const changed=bus.codeLocation(0x40).key,n=events.length;write(0x40,old^1);assert.equal(bus.codeLocation(0x40).key,changed);assert.equal(events.length,n);
 // Cache-slot collisions and distinct mirrored logical addresses must not poison identities.
 for(let a=0x8000;a<0x10000;a+=0x2000){const q=bus.codeLocation(a);assert.equal(q.physical,bus.mapPRG(a));assert.equal(bus.codeLocation(a).key,q.key);}
 const before=bus.codeLocation(0x8000),fixed=bus.codeLocation(0xc000);for(let bit=0;bit<5;bit++)write(0xe000,(1>>>bit)&1);
 assert.notEqual(bus.codeLocation(0x8000).physical,before.physical);assert.equal(bus.codeLocation(0xc000).physical,fixed.physical);
 const save=structuredClone(bus.checkpointCapture()),saved=[0x40,0x8000,0xc000].map(a=>bus.codeLocation(a));
 write(0x40,old);for(let bit=0;bit<5;bit++)write(0xe000,0);bus.loadRAM(save.ram,save.sram);assert.notEqual(bus.codeLocation(0x40).key,saved[0].key);
 bus.checkpointRestore(save);assert.deepEqual([0x40,0x8000,0xc000].map(a=>bus.codeLocation(a)),saved);
 assert.equal(bus.codeLocation(0x2000).kind,'unmapped');assert.throws(()=>bus.codeLocation(65536));
});
