import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTransport} from '../htdocs/games/netplay/transport.mjs';
import {receiverModule} from '../htdocs/games/arcade/session-bridge.mjs';
const binding=JSON.parse(readFileSync(new URL('../htdocs/games/netplay/catalog.json',import.meta.url))).packages.megaman;
test('receiver exposes a visible stream mount before any decoded picture and keeps its declared surface',async t=>{
 const prior=globalThis.document,nodes=[],view={append(node){node.parentNode=this;}};
 globalThis.document={createElement(tag){const node={tagName:tag.toUpperCase(),dataset:{},children:[],hidden:false,setAttribute(){},append(child){this.children.push(child);child.parentNode=this;},remove(){this.parentNode=null;}};nodes.push(node);return node;}};
 t.after(()=>{globalThis.document=prior;});
 const adapter=receiverModule().createAdapter({package:{id:'test',artifactDigest:'a'.repeat(64),surfaces:{video:{kind:'canvas'},audio:{kind:'none'}}},scope:{defer(){}},view});
 await adapter.load();const mount=nodes.find(n=>Object.hasOwn(n.dataset,'sharedReceiverVideo'));
 assert(mount,'Early media mounting must have a concrete owned DOM target');assert.equal(mount.hidden,false);assert.equal(mount.parentNode.parentNode,view);
 assert.equal(adapter.surfaces().video.tagName,'CANVAS');assert.equal(adapter.surfaces().video.hidden,true,'The declared placeholder must not compete with the actual video');
});
test('receiver binds populated owned streams for both track arrival orders and keeps cleanup authority',t=>{
 const priorPC=globalThis.RTCPeerConnection,priorStream=globalThis.MediaStream;
 globalThis.MediaStream=class{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}};
 globalThis.RTCPeerConnection=class{close(){this.connectionState='closed';}};
 t.after(()=>{globalThis.RTCPeerConnection=priorPC;globalThis.MediaStream=priorStream;});
 for(const order of [['video','audio'],['audio','video']]){
  const assignment={protocol:3,catalog:binding.catalog,binding:binding.version,packageId:binding.packageId,artifactDigest:binding.artifactDigest,inputProfile:binding.inputProfile,inputsDigest:binding.inputsDigest,compatibility:binding.compatibility,participant:'1'.repeat(32),participant_role:'watch',player:null,session:'2'.repeat(32),capabilities:{video:true,audio:true,input:false}};
  const bound=[],video={srcObject:null,play(){bound.push(this.srcObject);return Promise.resolve();},pause(){}};
  const {Peer}=createTransport(binding),peer=new Peer('guest',{...assignment,room:'3'.repeat(32),credential:'4'.repeat(64)},{video,clear(){},enabled(){}});
  peer.connect({});assert.equal(video.srcObject,null,'Never bind an empty receiving stream');
  const tracks=order.map(kind=>({kind,readyState:'live',stop(){this.readyState='ended';}}));
  peer.pc.ontrack({track:tracks[0]});const first=video.srcObject;
  assert.deepEqual(first.getTracks(),[tracks[0]]);assert(peer.media.includes(first));
  peer.pc.ontrack({track:tracks[1]});const second=video.srcObject;
  assert.notEqual(second,first,'WebKit must receive a populated stream assignment after each new track');
  assert.deepEqual(second.getTracks(),tracks);assert.deepEqual(peer.media,[second]);
  peer.pc.ontrack({track:tracks[1]});assert.equal(bound.length,2,'Duplicate events must not restart playback');
  peer.stop('Test complete');assert.equal(video.srcObject,null);assert(tracks.every(track=>track.readyState==='ended'));
 }
});
