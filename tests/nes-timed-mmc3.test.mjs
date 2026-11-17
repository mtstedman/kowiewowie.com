import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {instantiate as runtimeFactory} from '../maintenance/engines/timed-mmc3/runtime-factory.mjs';
const web=new URL('../htdocs/',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
test('timed MMC3 preserves mapped RAM code identities and checkpoint invalidation',async()=>{
 const data=await import(new URL('games/double-dragon-ii/cartridge/entry.mjs',web)),runtime=runtimeFactory([{makeTimedCPU(){throw Error('Bus-only test');}}]),bus=runtime.makeBus(runtime.fromHex(data.prgHex),runtime.fromHex(data.trainerHex),{},data.metadata,runtime.fromHex(data.chrHex)),events=[];bus.watchCode(p=>events.push(p));
 const write=(a,v)=>bus.write(a,v,bus.getCPUClock()+2),before=bus.codeLocation(0x7f0);assert.equal(before.key,bus.codeLocation(0xff0).key);write(0x7f0,0xa9);assert.notEqual(bus.codeLocation(0x7f0).key,before.key);assert.equal(events.at(-1),'ram:7');
 const saved=structuredClone(bus.checkpointCapture()),identity=bus.codeLocation(0x7f0),rom=bus.codeLocation(0x8000);write(0x7f0,0xea);bus.checkpointRestore(saved);assert.deepEqual(bus.codeLocation(0x7f0),identity);assert.deepEqual(bus.codeLocation(0x8000),rom);assert.equal(bus.peek(0x7f0),0xa9);
});
test('RAM-executing MMC3 runs through the shared Wasm PPU and round-trips complete machine state',async()=>{
 const {createMachine}=await import(new URL('games/double-dragon-ii/composition-entry.mjs',web)),m=createMachine();const step=n=>{for(let f=0;f<n;f++){m.frame({maxMs:60000});m.takeAudio();}};
 step(120);const s=m.getState();assert(s.hardware.translation.mutableInstructions>0);assert(s.hardware.translation.sourceSpecialized);assert.equal(s.metrics.interpreterCalls,0);assert.equal(s.metrics.bankInstructions.length,64);assert(!s.fault);
 const checkpoint=m.exportCheckpoint();m.setButton(1,2,true);step(4);const state=m.getState(),frame=hash(m.getRGBA());m.importCheckpoint(checkpoint);m.setButton(1,2,true);step(4);assert.deepEqual(m.getState(),state);assert.equal(hash(m.getRGBA()),frame);
 assert.equal(m.getSharedPPUStats().backend,'wasm-owned-three-dot/1');m.reset();step(3);assert(!m.getState().fault);
});
test('MMC3 ROM identity cache preserves bank switches, fresh results and restore generations',async()=>{
 const data=await import(new URL('games/double-dragon-ii/cartridge/entry.mjs',web)),runtime=runtimeFactory([{}]),bus=runtime.makeBus(runtime.fromHex(data.prgHex),runtime.fromHex(data.trainerHex),{},data.metadata,runtime.fromHex(data.chrHex));
 const locations=()=>[0x8000,0xa000,0xc000,0xe000].map(a=>bus.codeLocation(a)),write=(a,v)=>bus.write(a,v,bus.getCPUClock()+2),initial=locations(),saved=structuredClone(bus.checkpointCapture());
 const poisoned=bus.codeLocation(0x8000);poisoned.key='poison';poisoned.physical=-1;assert.deepEqual(locations(),initial);
 for(let i=0;i<32;i++){write(0x8000,(i&1?64:0)|6);write(0x8001,i);for(const a of [0x8000,0xa000,0xc000,0xe000]){const q=bus.codeLocation(a);assert.equal(q.physical,bus.mapPRG(a));assert.equal(q.key,'rom:'+q.physical+':'+saved.codeGeneration+':0');}}
 const mapped=locations();bus.loadRAM(saved.ram,saved.sram);assert.notDeepEqual(locations().map(q=>q.key),mapped.map(q=>q.key));bus.checkpointRestore(saved);assert.deepEqual(locations(),initial);
});
