import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hashReplicationState,encodeReplicationState,decodeReplicationState} from '../htdocs/games/arcade/replication-state.mjs';
const site=new URL('../htdocs/',import.meta.url),catalog=JSON.parse(fs.readFileSync(new URL('games/arcade/catalog.json',site)));
const cartridges=catalog.map(row=>JSON.parse(fs.readFileSync(new URL('.'+row.manifest,site))).manifest).filter(p=>p.platform==='NES');
assert(cartridges.length>0);
for(const cartridge of cartridges)test(cartridge.id+': exact checkpoint continuation for both controller ports, video, PCM and full state',async()=>{
 const {createMachine}=await import(new URL('games/'+cartridge.id+'/composition-entry.mjs',site));const host=createMachine(),follower=createMachine();
 const pads=(frame)=>[(frame%17<8?128:0)|(frame%11<3?1:0)|(frame%31===0?8:0),(frame%13<6?64:0)|(frame%19<5?2:0)|(frame%29===0?8:0)];
 const step=(machine,frame)=>{const masks=pads(frame);for(let p=1;p<=2;p++)for(let b=0;b<8;b++)machine.setButton(p,b,Boolean(masks[p-1]&(1<<b)));const result=machine.frame({maxSteps:20000,maxCycles:40000,maxMs:60000});return {frame:result.state.frames,rgba:machine.getRGBA(),audio:machine.takeAudio()};};
 for(let frame=0;frame<16;frame++)step(host,frame);
 const checkpoint=host.exportCheckpoint();follower.importCheckpoint(decodeReplicationState(encodeReplicationState(checkpoint)));
 assert.equal(await hashReplicationState(follower.exportCheckpoint()),await hashReplicationState(checkpoint),'Wire checkpoint changed the complete native state');
 for(let frame=16;frame<64;frame++){const expected=step(host,frame),actual=step(follower,frame);assert.equal(actual.frame,expected.frame);assert.deepEqual(actual.rgba,expected.rgba,`Video diverged at frame ${frame}`);assert.deepEqual(actual.audio,expected.audio,`PCM diverged at frame ${frame}`);}
 assert.equal(await hashReplicationState(follower.exportCheckpoint()),await hashReplicationState(host.exportCheckpoint()),'Native state diverged after continuation');
});

// Old saves may enumerate object fields in any insertion order; import remains compatible.
test('checkpoint graph canonicalizes object insertion order and imports legacy ordering',async()=>{
 const {captureGraph,restoreGraph}=await import('../htdocs/games/engines/nes/1.4.14/composer.mjs');
 const a={z:3,a:1,empty:undefined,zero:-0},b={zero:-0,empty:undefined,a:1,z:3};
 a.child={x:4};a.alias=a.child;a.self=a;b.self=b;b.alias={x:4};b.child=b.alias;
 assert.deepEqual(encodeReplicationState(captureGraph(a)),encodeReplicationState(captureGraph(b)));
 const legacy=captureGraph(a);for(const node of legacy.nodes)if(node.kind==='object')node.values.reverse();
 const restored=restoreGraph(b,legacy);assert.equal(restored.alias,restored.child);assert.equal(restored.self,restored);
 assert.equal(restored.empty,undefined);assert(Object.is(restored.zero,-0));assert.deepEqual(encodeReplicationState(captureGraph(restored)),encodeReplicationState(captureGraph(a)));
});
