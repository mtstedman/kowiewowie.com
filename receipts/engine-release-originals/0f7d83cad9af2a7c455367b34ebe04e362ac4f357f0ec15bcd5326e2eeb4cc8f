// Audit each catalog cartridge against the current registry and authenticated graph.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,validateManifest} from '../htdocs/games/arcade/package-contract.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const insist=(v,m)=>{if(!v)throw Error(m);};
export function auditCapabilities(root){
 const read=url=>{
  insist(/^\/games\/[A-Za-z0-9_./-]+$/.test(url)&&!url.split('/').some(x=>x==='..'||x==='.'),'Noncanonical artifact URL');
  return readFileSync(resolve(root,'htdocs'+url));
 };
 const checked=new Map();
 const authenticate=(url,pin)=>{
  const key=url+':'+pin.sha256+':'+pin.bytes;
  if(checked.has(key))return checked.get(key);
  const b=read(url);insist(b.length===pin.bytes&&hash(b)===pin.sha256,'Artifact mismatch: '+url);checked.set(key,b);return b;
 };
 const catalog=JSON.parse(read('/games/arcade/catalog.json')),registry=JSON.parse(read('/games/engines/nes/registry.json'));
 insist(registry.format==='nes-engine-registry/1'&&Array.isArray(catalog),'Registry/catalog format');
 const rows=[];
 for(const row of catalog){
  const envelope=JSON.parse(read(row.manifest)),p=validateManifest(envelope.manifest);
  insist(p.id===row.id&&envelope.artifactDigest===row.artifactDigest&&hash(canonical(p))===row.artifactDigest,'Package identity mismatch');
  for(const [url,pin]of Object.entries(p.files))authenticate(url,pin);
  const c=JSON.parse(read(p.route+'composition.json')),selected=registry.selections[canonical(c.requirements)];
  insist(selected,'Unsupported cartridge execution contract: '+p.id);
  insist(canonical(c.binding.engineManifest)===canonical(selected.manifest),'Stale engine selection: '+p.id);
  const cartridge=JSON.parse(read(c.binding.cartridgeManifest.path));
  insist(canonical(cartridge.requirements)===canonical(c.requirements),'Cartridge requirements mismatch');
  for(const pin of Object.values(c.binding))insist(canonical(p.files[pin.path])===canonical({bytes:pin.bytes,sha256:pin.sha256}),'Unbound composition member');
  const graph=c.moduleGraph,reachable=new Set();
  function visit(url){if(reachable.has(url))return;insist(Array.isArray(graph[url]),'Missing executable: '+url);reachable.add(url);for(const edge of graph[url])visit(edge.target);}
  visit(p.entry);
  insist(reachable.has(selected.entry.path),'Selected engine is not consumed: '+p.id);
  const shared=['nes-adapter.mjs','nes-gamepad.mjs','nes-touch-dpad.mjs','worker-stream-host.mjs','worker-stream-consumer.mjs','worker-stream-producer.mjs'];
  const missing=shared.filter(name=>!reachable.has('/games/arcade/'+name));
  insist(missing.length===0,'Missing shared upgrades: '+p.id+' '+missing.join(', '));
  const battery=c.requirements.battery;
  if(battery)for(const name of ['battery-client.mjs','battery-codec.mjs'])insist(reachable.has('/games/arcade/'+name),'Missing shared battery component: '+p.id);
  rows.push({id:p.id,requirements:c.requirements,engine:selected.manifest.path,sharedComponents:shared,batteryPersistence:battery,artifactDigest:row.artifactDigest});
 }
 return {format:'nes-capability-audit/1',pass:true,games:rows,registeredMappers:[...new Set(Object.keys(registry.selections).map(k=>JSON.parse(k).mapper))].sort(),scope:'Authenticates current packages and verifies each selected engine and shared upgrade is actually reachable. Does not establish hardware equivalence, gameplay completeness, save-state support or performance.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(auditCapabilities(resolve(process.argv[2]||'.')),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
