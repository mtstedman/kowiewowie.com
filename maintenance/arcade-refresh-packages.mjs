// Explicit release refresh. Dry-run by default; --write is for a frozen reviewed tree.
// Example: node maintenance/arcade-refresh-packages.mjs --write htdocs/games/arcade/ui.mjs ...
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {canonical,validateManifest} from '../htdocs/games/arcade/package-contract.mjs';
import {validateBinding} from '../htdocs/games/netplay/policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),write=args.includes('--write'),names=args.filter(a=>a!=='--write');
if(!names.length||names.some(a=>a.startsWith('--')))throw Error('Pass explicit reviewed relative source paths; optionally --write');
const reviewedNames=new Set(names);
const reviewed=new Set(names.map(name=>{
 if(path.isAbsolute(name)||name.split('/').includes('..')||!name.startsWith('htdocs/')&&!name.startsWith('tests/')||!fs.statSync(path.join(root,name)).isFile())throw Error('Expected an existing htdocs/tests source file: '+name);
 return name.startsWith('htdocs/')?'/'+name.slice('htdocs/'.length):null;
}).filter(Boolean));
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=new Map(),pins=new Map();
const read=url=>{if(!bytes.has(url))bytes.set(url,fs.readFileSync(path.join(root,'htdocs',url)));return bytes.get(url);};
const pin=url=>{if(!pins.has(url)){const b=read(url);pins.set(url,{bytes:b.length,sha256:hash(b)});}return pins.get(url);};
const same=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
const json=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const resolve=(specifier,from)=>{
 if(typeof specifier!=='string'||!specifier.startsWith('.')&&!specifier.startsWith('/'))return null;
 const u=new URL(specifier,'https://arcade.invalid'+from);
 if(u.origin!=='https://arcade.invalid'||!u.pathname.startsWith('/games/'))throw Error('Unexpected local dependency: '+specifier);
 return u.pathname;
};
// Only traverse actual import declarations, literal imports and literal URL/fetch assets.
// Dynamic cartridge/core paths remain covered by their existing explicit inventories.
const dependencyCache=new Map();
function dependencies(url){
 if(dependencyCache.has(url))return dependencyCache.get(url);
 const found=new Set(),add=value=>{const target=resolve(value,url);if(target)found.add(target);};
 if(url.endsWith('.mjs')){
  const ast=parse(read(url).toString(),{ecmaVersion:'latest',sourceType:'module'});
  const visit=node=>{
   if(!node||typeof node!=='object')return;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&node.source?.type==='Literal')add(node.source.value);
   if(node.type==='NewExpression'&&node.callee?.name==='URL'&&node.arguments[0]?.type==='Literal'&&node.arguments[1]?.type==='MemberExpression'&&node.arguments[1].object?.type==='MetaProperty')add(node.arguments[0].value);
   if(node.type==='CallExpression'&&node.callee?.name==='fetch'&&node.arguments[0]?.type==='Literal')add(node.arguments[0].value);
   for(const [key,value]of Object.entries(node))if(!['start','end'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
  };visit(ast);
 }else if(url.endsWith('.html')){
  for(const match of read(url).toString().matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g))if(/\.(?:mjs|js|css)(?:\?|$)/.test(match[1]))add(match[1]);
 }
 dependencyCache.set(url,found);return found;
}
function graph(seeds){const found=new Set(),queue=[...seeds];while(queue.length){const url=queue.pop();if(found.has(url))continue;pin(url);found.add(url);for(const dep of dependencies(url))queue.push(dep);}return found;}
// Match the maintained assembler's authenticated import-span rules; preserve all
// untouched engine/cartridge edges and binding receipts byte-for-byte in value.
function executableEdges(url){
 const text=read(url).toString(),tree=parse(text,{ecmaVersion:'latest',sourceType:'module'}),result=[];
 const add=node=>{const value=node?.value;if(typeof value!=='string'||!value.startsWith('.')||/[\\?#%]/.test(value))throw Error('Unsupported composed dependency: '+url);const target=resolve(value,url);if(!/\.(mjs|js)$/.test(target))throw Error('Non-JS composed dependency: '+url);result.push({start:node.start,end:node.end,original:text.slice(node.start,node.end),target});};
 for(const node of tree.body)if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source){if(node.attributes?.length||node.assertions?.length)throw Error('Import attributes unsupported');add(node.source);}
 const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='ImportExpression')throw Error('Dynamic composed imports unsupported: '+url);if(node.type==='NewExpression'&&node.callee?.name==='URL'){const [value,base]=node.arguments;if(base?.type==='MemberExpression'&&base.object?.type==='MetaProperty'&&base.property?.name==='url'){if(value?.type!=='Literal')throw Error('Nonliteral composed URL: '+url);add(value);}}for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}};visit(tree);
 return result.sort((a,b)=>a.start-b.start);
}
const catalog=json('htdocs/games/arcade/catalog.json'),network=json('htdocs/games/netplay/catalog.json');
const pending=new Map(),reports=[],allGraph=new Set();
const schedule=(name,value)=>pending.set(name,typeof value==='string'?value:canonical(value)+'\n');
for(const row of catalog){
 const name='htdocs'+row.manifest,envelope=json(name),manifest=envelope.manifest;
 if(hash(canonical(manifest))!==envelope.artifactDigest||row.artifactDigest!==envelope.artifactDigest||network.packages[row.id]?.artifactDigest!==envelope.artifactDigest)throw Error('Existing identity mismatch: '+row.id);
 const seeds=['/games/arcade/index.html','/games/arcade/ui.mjs','/games/arcade/host.mjs',...Object.keys(manifest.files).filter(p=>p.startsWith('/games/arcade/')&&p.endsWith('.mjs'))];
 const discovered=graph(seeds);for(const p of discovered)allGraph.add(p);
 const updated=[],added=[],derived=new Set();
 if(manifest.platform==='NES'){
  const sideURL=manifest.route+'composition.json',side=JSON.parse(read(sideURL)),before=canonical(side),binding=canonical(side.binding),queue=Object.keys(side.moduleGraph).filter(url=>reviewed.has(url)),seen=new Set();
  while(queue.length){const url=queue.pop();if(seen.has(url))continue;seen.add(url);side.moduleGraph[url]=executableEdges(url);discovered.add(url);allGraph.add(url);for(const edge of side.moduleGraph[url])if(!Object.hasOwn(side.moduleGraph,edge.target)||reviewed.has(edge.target))queue.push(edge.target);}
  if(canonical(side.binding)!==binding)throw Error('Composition bindings must remain unchanged');
  if(canonical(side)!==before){const raw=canonical(side)+'\n';schedule('htdocs'+sideURL,raw);bytes.set(sideURL,Buffer.from(raw));pins.delete(sideURL);derived.add(sideURL);}
 }

 for(const [url,record]of Object.entries(manifest.files)){
  const actual=pin(url);if(same(record,actual))continue;
  if(!reviewed.has(url)&&!derived.has(url))throw Error('Stale inventory member not explicitly reviewed: '+row.id+' '+url);
  manifest.files[url]=actual;updated.push(url);
 }
 for(const url of discovered)if(!Object.hasOwn(manifest.files,url)){manifest.files[url]=pin(url);added.push(url);}
 if(!updated.length&&!added.length)continue;
 validateManifest(manifest);const artifactDigest=hash(canonical(manifest));envelope.artifactDigest=artifactDigest;row.artifactDigest=artifactDigest;
 network.packages[row.id]=validateBinding({...network.packages[row.id],artifactDigest});schedule(name,envelope);
 const legacy='htdocs'+manifest.route+'network-package.json';
 if(fs.existsSync(path.join(root,legacy))){const old=json(legacy);old.artifactDigest=artifactDigest;old.binding=network.packages[row.id];schedule(legacy,old);}
 reports.push({id:row.id,artifactDigest,updated,added});
}
const sourcePinsName='tests/arcade-runtime-source-pins.json',sourcePins=json(sourcePinsName),changedPins=[];
for(const [name,record]of Object.entries(sourcePins.files)){
 if(!name.startsWith('htdocs/')&&!name.startsWith('tests/'))continue;const url=name.slice('htdocs'.length);
 if(reviewed.has(url)&&!same(record,pin(url))){sourcePins.files[name]=pin(url);changedPins.push(name);}
}
for(const url of allGraph)if(url.endsWith('.mjs')&&!Object.hasOwn(sourcePins.files,'htdocs'+url)){sourcePins.files['htdocs'+url]=pin(url);changedPins.push('htdocs'+url);}
if(changedPins.length)schedule(sourcePinsName,sourcePins);
if(reports.length){
 schedule('htdocs/games/arcade/catalog.json',catalog);
 const raw=canonical(network)+'\n';schedule('htdocs/games/netplay/catalog.json',raw);schedule('includes/api/classes/netplay-catalog.json',raw);
 const policy='includes/api/classes/NetplayPolicy.php',source=fs.readFileSync(path.join(root,policy),'utf8');
 if(!/private const DIGEST='[a-f0-9]{64}'/.test(source))throw Error('Network policy digest marker missing');
 schedule(policy,source.replace(/private const DIGEST='[a-f0-9]{64}'/,"private const DIGEST='"+hash(raw)+"'"));
}
if(write)for(const [name,value]of pending)fs.writeFileSync(path.join(root,name),value);
console.log(JSON.stringify({write,reviewed:[...reviewedNames],packages:reports,sourcePins:changedPins,outputs:[...pending.keys()]},null,2));
