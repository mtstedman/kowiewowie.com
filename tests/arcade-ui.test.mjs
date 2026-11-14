import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyPackage,validateManifest,Catalog,canonical,digest,playDescription} from '../htdocs/games/arcade/package.mjs';
import {GameHost,ResourceScope,validateState,validateSurfaces,bounded} from '../htdocs/games/arcade/host.mjs';
import * as fixture from './fixtures/arcade-synthetic.mjs';
import {runtimeHarness} from './arcade-runtime-harness.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8'),clone=x=>structuredClone(x);
const rows=JSON.parse(read('htdocs/games/arcade/catalog.json'));
const envelopes=rows.map(row=>JSON.parse(read('htdocs'+row.manifest)));
const packages=await Promise.all(envelopes.map((e,i)=>verifyPackage(e,rows[i].artifactDigest)));
async function synthetic(id='synthetic-puzzle',caps=null){const m=clone(envelopes[0].manifest);m.id=id;m.title='Synthetic puzzle';m.platform='Test fixture';m.route='/games/'+id+'/';m.entry=m.route+'adapter.mjs';m.files={[m.entry]:{bytes:1,sha256:'1'.repeat(64)}};m.inputs=[{id:'mark',label:'Mark',hint:'Fixture input only',kind:'button',activation:'input'}];if(caps)m.capabilities=caps;const h=await digest(new TextEncoder().encode(canonical(m)));return verifyPackage({manifest:m,artifactDigest:h},h);}
const state=(changes={})=>({role:'host',phase:'active',epoch:1,reconnect:'none',watch:'available',play:'available',message:'Ready',...changes});
function provider(p,initial=state()){let listener=null,current=initial;const log=[];return {log,update(s){current=s;listener?.(s);},definition:{version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>current,subscribe:f=>{listener=f;return()=>{listener=null;log.push('unsubscribe');};},inviteWatch(){log.push('watch');},invitePlay(){log.push('play');},sendInput:e=>{log.push(e);},releaseInputs:()=>log.push('release'),enableAudio:()=>log.push('audio'),getMedia:()=>({video:{nodeType:1,tagName:'VIDEO',pause(){},remove(){}},audio:{nodeType:1,tagName:'AUDIO',pause(){},remove(){}}}),dispose:()=>log.push('dispose')}};}
function hostFor(items,loader=async()=>fixture,extra={}){const c=new Catalog();items.forEach(p=>c.register(p));return new GameHost(c,{loader,...extra});}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('package format, schema, digest, immutable capabilities and incompatible versions',async()=>{
 const preserved=packages.filter(p=>["megaman","adventure-island-2"].includes(p.id));assert.equal(preserved.length,2);for(const p of preserved){assert(Object.isFrozen(p));assert(Object.isFrozen(p.capabilities));assert.equal(p.capabilities.nativePlayers,1);assert.equal(p.capabilities.play,'shared-hero');assert.match(playDescription(p),/same character/);}
 for(const mutate of [m=>m.hostApi=2,m=>m.format='game-package/9',m=>m.entry='/outside.mjs',m=>m.capabilities.nativePlayers=2,m=>m.capabilities.verified=false,m=>m.surfaces.audio.kind='none',m=>m.timing.nominalHz=0,m=>m.inputs.push(clone(m.inputs[0])),m=>m.surprise=true]){const m=clone(envelopes[0].manifest);mutate(m);assert.throws(()=>validateManifest(m));}
 const bad=clone(envelopes[0]);bad.manifest.title='changed';await assert.rejects(verifyPackage(bad,rows[0].artifactDigest),/digest/);await assert.rejects(verifyPackage(envelopes[0],'0'.repeat(64)));
 const c=new Catalog();c.register(packages[0]);assert.throws(()=>c.register(packages[0]));
});
test('old routes and selection aliases canonicalize into one host, preserving opaque data',()=>{
 const c=new Catalog();packages.forEach(p=>c.register(p));for(const p of packages)for(const suffix of ['', 'index.html']){const result=c.route(p.route+suffix+'?old=keep#netplay=opaque');assert.equal(result.id,p.id);const u=new URL(result.canonical,'https://wowiekowie.com');assert.equal(u.pathname,'/games/arcade/');assert.equal(u.searchParams.get('package'),p.id);assert.equal(u.searchParams.get('old'),'keep');assert.equal(u.hash,'#netplay=opaque');}
 const alias=c.route('/games/arcade/?cartridge=megaman&old=keep#netplay=opaque');assert.equal(alias.id,'megaman');assert.equal(c.route(alias.canonical).canonical,null);assert.deepEqual(c.route('/games/arcade/'),{id:null,canonical:null});
 for(const href of ['/games/arcade/?package=missing','/games/arcade/?package=megaman&cartridge=adventure-island-2','/games/arcade/?package=megaman&package=megaman','/games/megaman/?package=adventure-island-2'])assert.throws(()=>c.route(href));
});
test('catalog-only non-NES registration reuses identical host code, surfaces and lifecycle',async()=>{
 const before=read('htdocs/games/arcade/host.mjs'),one=await synthetic(),two=await synthetic('second-fixture');const h=hostFor([one,two]);fixture.trace.length=0;fixture.resources.maximum=0;
 await h.load(one.id);await h.control('start');assert(h.input({control:'mark',source:'keyboard',pressed:true}));assert.equal(h.input({control:'mark',source:'keyboard',pressed:true}),false);await h.control('pause');await h.control('resume');await h.control('reset');await h.load(two.id);await h.unload();assert.equal(h.active,null);assert.equal(h.closed,false);await h.dispose();await h.dispose();
 assert.equal(read('htdocs/games/arcade/host.mjs'),before);assert.equal(fixture.resources.maximum,1);assert.deepEqual({...fixture.resources},{workers:0,audio:0,listeners:0,active:0,maximum:1});
 const log=fixture.trace;assert(log.indexOf(one.id+':dispose')<log.indexOf(two.id+':load'));assert.equal(log.filter(x=>x===one.id+':dispose').length,1);assert(log.some(x=>Array.isArray(x)&&x[2]==='mark'&&x[4]===false));
});
test('cancelled import never creates an adapter and late failure cannot replace newer state',{timeout:4000},async()=>{
 const a=await synthetic('slow-import'),b=await synthetic('fast-import'),gate=deferred(),entered=deferred();let created=0;
 const late={...fixture,createAdapter(ctx){created++;return fixture.createAdapter(ctx);}};
 const h=hostFor([a,b],p=>{if(p.id===a.id){entered.resolve();return gate.promise;}return fixture;});
 const old=h.load(a.id);await bounded(entered.promise,1000);await bounded(h.load(b.id),1000);assert.equal(h.snapshot().package.id,b.id);gate.resolve(late);await old;await Promise.resolve();assert.equal(created,0);assert.equal(h.snapshot().package.id,b.id);await h.unload();assert.equal(fixture.resources.active,0);
});
test('late asynchronous load writes only to a detached obsolete mount; unload cancels it',{timeout:4000},async()=>{
 class Node {constructor(doc){this.ownerDocument=doc;this.children=[];this.parent=null;this.dataset={};}append(n){n.remove();n.parent=this;this.children.push(n);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
 const doc={createElement(){return new Node(doc);}},view=new Node(doc),controls=new Node(doc),gate=deferred(),entered=deferred(),p=await synthetic();let ctx;
 const h=hostFor([p],async()=>({...fixture,createAdapter(c){ctx=c;const a=fixture.createAdapter(c);return {...a,async load(){a.load();entered.resolve();await gate.promise;c.view.append(new Node(doc));}};}}),{view,controls});
 const old=h.load(p.id);await bounded(entered.promise,1000);await bounded(h.unload(),1000);gate.resolve();await old;await Promise.resolve();assert.equal(view.children.length,0);assert.equal(controls.children.length,0);assert.equal(ctx.view.parent,null);assert.equal(h.active,null);assert.equal(fixture.resources.active,0);await h.dispose();
});
test('failed disposal blocks subsequent loads while still releasing the scope',async()=>{
 const p=await synthetic(),failing={...fixture,createAdapter:ctx=>{const a=fixture.createAdapter(ctx);return {...a,dispose(){a.dispose();throw Error('cleanup failure');}};}};
 const h=hostFor([p],async()=>failing);await h.load(p.id);await assert.rejects(h.unload(),/cleanup failure/);await assert.rejects(h.load(p.id));assert.equal(fixture.resources.active,0);
});
test('scope attempts every cleanup exactly once and rejects late registrations',async()=>{const s=new ResourceScope(),calls=[];s.defer(()=>calls.push('first'));s.defer(()=>{calls.push('second');throw Error('failed');});await assert.rejects(s.close());await assert.rejects(s.close());assert.throws(()=>s.defer(()=>calls.push('late')));assert.deepEqual(calls,['second','first','late']);});
test('adapter identity/version and surface incompatibility stop loading',async()=>{
 const p=await synthetic();for(const change of [a=>({...a,version:2}),a=>({...a,artifactDigest:'2'.repeat(64)}),a=>({...a,surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:'VIDEO'},audio:null})})]){const h=hostFor([p],async()=>({...fixture,createAdapter:ctx=>change(fixture.createAdapter(ctx))}));await assert.rejects(h.load(p.id));await h.dispose();}assert.equal(fixture.resources.active,0);assert.throws(()=>validateSurfaces({view:null,video:null,audio:null},p));
});
test('spectator has zero host-boundary input and no engine lifecycle control',async()=>{
 const p=await synthetic(),h=hostFor([p]);await h.load(p.id);await h.control('start');h.input({control:'mark',source:'held',pressed:true});const b=provider(p,state({role:'spectator'})),lease=h.bindSession(b.definition);const before=fixture.trace.filter(Array.isArray).length;
 assert.equal(h.input({control:'mark',source:'watcher',pressed:true}),false);assert.equal(lease.input({control:'mark',source:'watcher',pressed:true,seat:1,epoch:1,role:'spectator'}),false);await assert.rejects(async()=>h.control('reset'));assert.equal(fixture.trace.filter(Array.isArray).length,before);assert.equal(b.log.filter(x=>typeof x==='object').length,0);await h.control('start');assert(b.log.includes('audio'));await h.dispose();assert(b.log.includes('dispose'));assert(b.log.includes('unsubscribe'));
});
test('guest forwarding, host remote input, P2 capabilities and epoch/reconnect barriers',async()=>{
 const caps={verified:true,evidence:'synthetic contract only',nativePlayers:2,mode:'alternating',play:'host-p1-guest-p2',watch:true},p=await synthetic('two-seat-fixture',caps),h=hostFor([p]);await h.load(p.id);await h.control('start');const b=provider(p),lease=h.bindSession(b.definition);const edge={control:'mark',source:'remote',pressed:true,seat:2,epoch:1,role:'guest'};
 assert.equal(lease.input({...edge,seat:1}),false);assert.equal(lease.input(edge),true);b.update(state({phase:'reconnecting',reconnect:'pending',epoch:2}));assert.equal(lease.input(edge),false);b.update(state({epoch:3,reconnect:'recovered'}));await h.control('resume');assert.equal(lease.input({...edge,epoch:3}),true);
 b.update(state({role:'guest',epoch:4}));assert.equal(h.input({control:'mark',source:'local',pressed:true}),true);assert(b.log.some(x=>typeof x==='object'&&x.seat===2&&x.epoch===4));b.update(state({role:'guest',epoch:3}));assert.equal(h.snapshot().session.phase,'incompatible');assert.equal(h.input({control:'mark',source:'other',pressed:true}),false);await h.dispose();assert.equal(lease.input({...edge,epoch:4}),false);
});
test('single-player remote controls cannot claim independent P2; invitations abort on unload',async()=>{
 const p=packages[0],h=hostFor([p]);await h.load(p.id);await h.control('start');const b=provider(p);assert.throws(()=>h.bindSession({...b.definition,artifactDigest:'f'.repeat(64)}));let finish,signal;b.definition.inviteWatch=context=>{signal=context.signal;return new Promise(r=>finish=r);};const lease=h.bindSession(b.definition);
 assert.equal(lease.input({control:'a',source:'remote',pressed:true,seat:2,epoch:1,role:'guest'}),false);const pending=h.invite('watch');assert.equal(await h.invite('watch'),false);await h.unload();assert.equal(signal.aborted,true);assert.equal(await pending,false);finish();assert.equal(h.active,null);assert.equal(b.log.filter(x=>x==='dispose').length,1);await h.dispose();
 assert.throws(()=>validateState(state({epoch:-1})));assert.throws(()=>validateState(state({role:'spectator',epoch:1}),state()));assert.throws(()=>validateState(state({message:'bad\nmessage'})));
});
test('switch releases held inputs and provider before starting the next adapter',async()=>{
 const a=await synthetic('first-session'),b=await synthetic('second-session'),h=hostFor([a,b]);await h.load(a.id);await h.control('start');const p=provider(a);h.bindSession(p.definition);assert(h.input({control:'mark',source:'key',pressed:true}));const at=fixture.trace.length;await h.load(b.id);assert(p.log.includes('unsubscribe')&&p.log.includes('dispose'));assert(fixture.trace.slice(at).some(x=>Array.isArray(x)&&x[0]===a.id&&x[4]===false));await h.dispose();
});
for(const p of packages)test(p.title+': actual derived NES runtime releases inputs, worker, animation, timers and audio',async()=>{
 const h=runtimeHarness(fileURLToPath(new URL('htdocs'+p.route+'host-runtime.mjs',root))),r=h.runtime;r.reset();assert.equal(h.workers.length,1);h.workers[0].receive({type:'ready'});r.start();r.input('key',0,true);r.input('touch',1,true);assert(r.held(0)&&r.held(1));r.pause();assert(!r.held(0)&&!r.held(1));r.reset();assert(h.workers[0].dead);assert(r.snapshot().loading);await r.dispose();await r.dispose();assert(h.workers.every(w=>w.dead));assert.equal(h.rafs.size,0);assert.equal(h.timers.size,0);assert.equal(h.audioCloses(),1);r.reset();r.start();assert.equal(h.workers.length,2);
});
test('screen-first shell, accessible shelf, same-document routing and transport-free host',()=>{
 const html=read('htdocs/games/arcade/index.html'),css=read('htdocs/games/arcade/arcade.css'),ui=read('htdocs/games/arcade/ui.mjs'),core=read('htdocs/games/arcade/host.mjs');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);assert(html.indexOf('id="player"')<html.indexOf('id="library"'));assert.match(html,/<fieldset>/);assert.match(html,/aria-live="polite"/);assert.match(css,/:focus-visible/);assert.match(css,/touch-action:none/);assert.match(css,/@media\(max-width:600px\)/);assert.match(ui,/catalog.list\(\)/);assert.doesNotMatch(core,/megaman|adventure-island|NES|KeyZ|RTCPeerConnection|WebSocket|\/api\/v1\/netplay/);assert.doesNotMatch(html,/<script\b(?![^>]*src=)[^>]*>|\son\w+=|<style\b|<iframe\b/i);
 for(const name of ['ui.mjs','host.mjs','nes-adapter.mjs'])assert.doesNotMatch(read('htdocs/games/arcade/'+name),/location\s*\.\s*(?:assign|replace|reload)\s*\(|window\s*\.\s*open\s*\(|location(?:\.href)?\s*=/);
 assert.match(ui,/host\.unload/);assert.match(ui,/history\.pushState/);assert.match(ui,/host\.invite\('play'\)/);assert.doesNotMatch(ui,/legacy-play|legacy-request|legacy-continue/);
 const prov=JSON.parse(read('docs/arcade-ui-provenance.json'));for(const link of prov.preserved_games_links)assert(read('htdocs/games/index.php').includes(link));for(const p of packages)assert.equal(read('htdocs'+p.route+'index.html'),html);
 assert(!prov.changed_paths.some(p=>/bank-|source\.nes$|\/api\/|postgres|netplay-client\.mjs$|netplay-binding\.mjs$|worker\.mjs$/.test(p)));
});
test('each retained legacy page has its own authenticated shared heading and one shelf link',()=>{
 for(const p of packages.filter(p=>['megaman','adventure-island-2'].includes(p.id))){const html=read('htdocs'+p.route+'legacy.html');assert.deepEqual([...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map(m=>m[1]),[p.title+' · shared game']);const link='<p><a href="/games/arcade/">Return to the game shelf</a></p>';assert.equal(html.split(link).length-1,1);assert.equal(html.split('href="/games/arcade/"').length-1,1);assert.equal(html.split('src="./legacy-entry.mjs"').length-1,1);assert(!html.includes('src="./netplay-entry.mjs"'));const bytes=readFileSync(new URL('htdocs'+p.route+'legacy.html',root));assert.deepEqual(p.files[p.route+'legacy.html'],{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
});
