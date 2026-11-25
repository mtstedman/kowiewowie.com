import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyPackage} from '../htdocs/games/arcade/package-contract.mjs';
import {verifiedBytes} from '../htdocs/games/arcade/dos-adapter.mjs';
import {createSharing} from '../htdocs/games/arcade/sharing.mjs';
import {isolationHeaders} from './arcade-local-server.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url)),json=p=>JSON.parse(read(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const rows=json('htdocs/games/arcade/catalog.json');
test('previous games retain their content and capabilities across the reviewed sharing-shell update',async()=>{
 for(const old of json('tests/fixtures/arcade-additions-baseline.json')){
  const row=rows.find(r=>r.id===old.id);assert.equal(row.manifest,old.manifest);
  const p=await verifyPackage(json('htdocs'+row.manifest),row.artifactDigest);
  assert.deepEqual(p.capabilities,old.capabilities);
  for(const[url,pin]of Object.entries(old.files)){if(url==='/games/arcade/sharing.mjs')continue;assert.deepEqual(p.files[url],pin,url);}
  for(const[url,pin]of Object.entries(p.files)){const b=read('htdocs'+url);assert.equal(b.length,pin.bytes,url);assert.equal(sha(b),pin.sha256,url);}
 }
});
test('both additions authenticate all assets and declare only supported local capabilities',async()=>{
 for(const id of ['commander-keen','donkey-kong-country']){
  const row=rows.find(r=>r.id===id);assert(row);const p=await verifyPackage(json('htdocs'+row.manifest),row.artifactDigest);
  assert.equal(p.capabilities.play,'none');assert.equal(p.capabilities.watch,false);
  for(const[url,pin]of Object.entries(p.files)){const b=read('htdocs'+url);assert.equal(b.length,pin.bytes,url);assert.equal(sha(b),pin.sha256,url);}
 }
 const drive=json('htdocs/games/commander-keen/drive.json');assert.equal(drive.identity.executable,'KEEN1.EXE');
 assert.equal(sha(Buffer.from(drive.drive.find(([p])=>p==='KEEN1.EXE')[1],'base64')),'8b3f829f7eeab18a7fbf9d539967e9ae9c856258aa78efc0531fa922df71c4a2');
 assert.equal(sha(read('htdocs/games/donkey-kong-country/source.sfc')),'628147468c3539283197f58f03b94df49758a332831857481ea9cc31645f0527');
});
test('DOS resource verification rejects altered content and incorrect lengths',async t=>{
 const bytes=new TextEncoder().encode('reviewed artifact'),pin={path:'/fixture',bytes:bytes.length,sha256:sha(bytes)};
 t.mock.method(globalThis,'fetch',async()=>new Response(bytes));assert.deepEqual(await verifiedBytes(pin),bytes);
 await assert.rejects(verifiedBytes({...pin,bytes:bytes.length+1}),/integrity/);
 await assert.rejects(verifiedBytes({...pin,sha256:'0'.repeat(64)}),/integrity/);
});
test('local-only packages skip network setup and reject received invitations',async()=>{
 let imports=0,bindings=0;const sharing=createSharing({loadBinding(){bindings++;throw Error('Network must not be contacted');}}),p={capabilities:{play:'none',watch:false}},signal=new AbortController().signal;
 const source={version:1};assert.equal(await sharing.load(p,signal,{solo:true,href:'https://example.test/games/arcade/'},async()=>{imports++;return source;}),source);
 await sharing.attach({getPackage:()=>p});assert.equal(imports,1);assert.equal(bindings,0);
 // location is only a base for absolute route URLs in the browser implementation.
 const previous=globalThis.location;globalThis.location={origin:'https://example.test'};
 try{await assert.rejects(sharing.load(p,signal,{href:'https://example.test/games/arcade/#netplay=opaque'},async()=>source),/unavailable/);}finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
test('production isolation headers are scoped to the arcade document and worker',()=>{
 for(const p of ['/games/arcade/','/games/arcade/index.html','/games/arcade/dos-worker.js'])assert.deepEqual(isolationHeaders(p),{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
 for(const p of ['/','/games/','/games/engines/snes/worker.mjs'])assert.deepEqual(isolationHeaders(p),{});
});
