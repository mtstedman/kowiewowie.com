import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GameHost,ResourceScope} from '../htdocs/games/arcade/host.mjs';
import {receiverModule,receiverStatus} from '../htdocs/games/arcade/session-bridge.mjs';
import {canonical,verifyPackage,Catalog} from '../htdocs/games/arcade/package.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url)),json=p=>JSON.parse(read(p));
const hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:hash(b)});
const migration=json('tests/shared-connection-migration.json');
const rows=json('htdocs/games/arcade/catalog.json'),network=json('htdocs/games/netplay/catalog.json');
test('complete hotfix dependency closure, retained originals and unchanged inventory membership',async()=>{
 assert.equal(rows.length,migration.packages.length);assert.equal(rows.length,5);
 for(const [p,c] of Object.entries(migration.files)){
  assert.deepEqual(pin(read(p)),c.after,p);
  assert.deepEqual(pin(read(c.original)),c.before,p);
 }
 for(const x of migration.packages){
  const row=rows.find(r=>r.id===x.id);assert(row);
  const p=await verifyPackage(json('htdocs'+row.manifest),row.artifactDigest);
  const prior=json(x.original_package);assert.equal(prior.artifactDigest,x.before);
  assert.equal(hash(canonical(prior.manifest)),x.before);assert.equal(p.artifactDigest,x.after);
  const m=structuredClone(prior.manifest);
  assert(x.members.length>0);
  for(const c of x.members){assert.deepEqual(m.files[c.path],c.before);m.files[c.path]=c.after;}
  const {artifactDigest,...actual}=p;assert.deepEqual(actual,m);
  for(const [u,r] of Object.entries(actual.files))assert.deepEqual(pin(read('htdocs'+u)),r,u);
  assert.deepEqual(Object.keys(actual.files),Object.keys(prior.manifest.files));
  const binding=network.packages[x.id];assert.equal(binding.artifactDigest,x.after);
  const originalBinding=json(migration.original_network).packages[x.id];assert.deepEqual(binding,{...originalBinding,artifactDigest:x.after});
  for(const inv of x.inventories){
   const old=json(inv.original),current=json(inv.path),a=inv.field?old[inv.field]:old,b=inv.field?current[inv.field]:current;
   assert.deepEqual(Object.keys(b),Object.keys(a));
   for(const [name,r] of Object.entries(b))assert.deepEqual(pin(read(x.prefix+name)),r,name);
  }
  if(x.network_reference){const n=json(x.network_reference);assert.equal(n.artifactDigest,x.after);assert.deepEqual(n.binding,binding);}
 }
 const oldPlan=json(migration.original_plan),plan=json('tests/cartridge-library-plan.json');
 assert.deepEqual(plan.newIds,oldPlan.newIds);assert.deepEqual(plan.games,oldPlan.games);
 assert.deepEqual(Object.keys(plan.preserved),Object.keys(oldPlan.preserved));
 assert.deepEqual(Object.keys(plan.browserAssets),Object.keys(oldPlan.browserAssets));
 for(const map of ['preserved','browserAssets'])for(const [p,r] of Object.entries(plan[map]))assert.deepEqual(pin(read(p)),r,p);
 for(const x of [...oldPlan.identityMigrations,...(oldPlan.published||[])]){
  assert.equal(hash(canonical(x.original_manifest)),x.before);
  const m=structuredClone(x.original_manifest);assert.deepEqual(m.files[x.shared_member],x.shared_before);m.files[x.shared_member]=x.shared_after;
  assert.equal(hash(canonical(m)),x.after);
  const current=migration.packages.find(p=>p.id===x.id);assert(current);
  assert.deepEqual(m,json(current.original_package).manifest,'Historical transition still reaches the authenticated e84 package');
 }
 assert.deepEqual(read('htdocs/games/netplay/catalog.json'),read('includes/api/classes/netplay-catalog.json'));
 assert(read('includes/api/classes/NetplayPolicy.php').toString().includes("DIGEST='"+hash(read('htdocs/games/netplay/catalog.json'))+"'"));
});
test('receiver static status follows reconnect, ended and error without losing declared surfaces',async t=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
 const nodes=[];globalThis.document={createElement:tag=>{const n={nodeType:1,tagName:tag.toUpperCase(),children:[],dataset:{},setAttribute(){},append(...xs){this.children.push(...xs);},remove(){this.removed=true;}};nodes.push(n);return n;}};
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'document',prior);else delete globalThis.document;});
 const scope=new ResourceScope(),p=json('htdocs'+rows[0].manifest).manifest;
 const a=receiverModule().createAdapter({package:{...p,artifactDigest:rows[0].artifactDigest},view:{append(){}},scope});a.load();
 const label=nodes.find(n=>n.dataset.sharedReceiverStatus!==undefined);assert(label);assert.match(label.textContent,/Connecting/);
 for(const [phase,message] of [['reconnecting','Reconnecting · controls released.'],['ended','Sharing ended.'],['incompatible','Sharing unavailable. Return to the library.']]){
  a.setSessionState({phase,message});assert.equal(label.textContent,receiverStatus({phase,message}));assert.doesNotMatch(label.textContent,/Connecting/);
 }
 a.setSessionState({phase:'reconnecting',message:'Connected—host paused/away · No picture received yet. Ask the host to Resume · controls released.'});
 assert.match(label.textContent,/No picture received yet/);assert.match(label.textContent,/Ask the host to Resume/);
 assert.equal(a.input({pressed:true}),false);await scope.close();assert(nodes[0].removed);
});
test('watcher remains inputless; only a bound guest may expose reconnect media',async()=>{
 const row=rows[0],p=await verifyPackage(json('htdocs'+row.manifest),row.artifactDigest),catalog=new Catalog();catalog.register(p);
 let running=false,listener,s={role:'spectator',phase:'active',epoch:1,reconnect:'none',watch:'unavailable',play:'unavailable',message:'Watching live · no controls.'},audio=0;
 const video={nodeType:1,tagName:'VIDEO',pause(){},remove(){}};
 const h=new GameHost(catalog,{loader:async()=>({version:1,createAdapter:()=>({version:1,packageId:p.id,artifactDigest:p.artifactDigest,load(){},start(){running=true;},resume(){running=true;},pause(){running=false;},reset(){},dispose(){},input(){throw Error('Watcher reached engine');},releaseAll(){},snapshot:()=>({ready:true,running,loading:false,closed:false}),surfaces:()=>({view:{nodeType:1},video:{nodeType:1,tagName:p.surfaces.video.kind==='canvas'?'CANVAS':'VIDEO'},audio:{kind:p.surfaces.audio.kind,getNodes:()=>({context:null,node:null})}})})})});
 await h.load(p.id);h.bindSession({version:1,packageId:p.id,artifactDigest:p.artifactDigest,getState:()=>s,subscribe:f=>{listener=f;return()=>{};},inviteWatch(){},invitePlay(){},sendInput(){throw Error('Watcher sent input');},releaseInputs(){},enableAudio(){audio++;},getMedia:()=>({video,audio:video}),dispose(){}});
 assert.equal(h.snapshot().canControl,false);assert.equal(h.input({control:p.inputs[0].id,source:'watch',pressed:true}),false);assert.equal(h.media().video,video);await h.control('start');assert.equal(audio,1);
 s={...s,phase:'reconnecting',reconnect:'pending',epoch:2};listener(s);assert.equal(h.media(),null);await assert.rejects(async()=>h.control('start'));
 s={...s,phase:'ended',epoch:3,message:'Sharing ended.'};listener(s);assert.equal(h.media(),null);assert.equal(h.snapshot().canControl,false);await h.dispose();
});
