import {readFileSync,writeFileSync,mkdirSync,lstatSync,readdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,posix,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const fail=m=>{throw Error(m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const pin=b=>({bytes:b.length,sha256:hash(b)});
const equal=(a,b)=>canonical(a)===canonical(b);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function keys(v,names){ok(obj(v)&&Object.keys(v).every(k=>names.includes(k)),'Unexpected object fields');}
function key(p){ok(typeof p==='string'&&p.length>0&&p.length<2048&&!p.includes('\\')&&!p.includes('\0')&&!isAbsolute(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..')&&!/[?#%]/.test(p),'Noncanonical path: '+p);return p;}
function web(p){ok(typeof p==='string'&&p.startsWith('/games/'),'Invalid games URL');key(p.slice(1));return 'htdocs'+p;}
function inside(a,b){const r=relative(a,b);return r!==''&&!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);}
function absolute(p){ok(typeof p==='string'&&p.length>0,'Missing file path');const a=resolve(p);let q=dirname(a);const chain=[a];while(q!==dirname(q)){chain.push(q);q=dirname(q);}chain.push(q);for(const s of chain.reverse())ok(!lstatSync(s).isSymbolicLink(),'Symlink path: '+s);return a;}
function readFile(p,max=67108864){const a=absolute(p),s=lstatSync(a);ok(s.isFile()&&s.size<=max,'Expected bounded regular file: '+p);const b=readFileSync(a);ok(b.length===s.size,'File changed during read');return b;}
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
function enumerate(root){const result=[];function scan(d){for(const e of readdirSync(join(root,d),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=key(d?d+'/'+e.name:e.name);ok(!e.isSymbolicLink(),'Symlink source: '+p);if(e.isDirectory())scan(p);else {ok(e.isFile(),'Unsupported filesystem member: '+p);result.push(p);ok(result.length<=100000,'Too many source files');}}}scan('');return result;}
function semver(s){ok(typeof s==='string'&&/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(s),'Stable semver required');const v=s.split('.').map(Number);ok(v.every(Number.isSafeInteger),'Semver too large');return v;}
function walk(n,fn){if(!n||typeof n!=='object')return; if(typeof n.type==='string')fn(n);for(const [k,v] of Object.entries(n)){if(k==='start'||k==='end')continue;if(Array.isArray(v))v.forEach(x=>walk(x,fn));else if(v&&typeof v==='object')walk(v,fn);}}
let parse;
const ast=t=>parse(t,{ecmaVersion:'latest',sourceType:'module'});
const edgeCache=new Map();
function edges(text,path){const identity=path+':'+hash(text);if(edgeCache.has(identity))return edgeCache.get(identity);const tree=ast(text),result=[];function add(n){ok(typeof n.value==='string'&&n.value.startsWith('.')&&!/[\\?#%]/.test(n.value),'Unsupported executable dependency: '+path);const target=posix.normalize(posix.join(posix.dirname(path),n.value));web(target);ok(/\.(mjs|js)$/.test(target),'Unsupported non-JS dependency');result.push({start:n.start,end:n.end,original:text.slice(n.start,n.end),target});}
for(const n of tree.body)if(n.type==='ImportDeclaration'||n.type==='ExportAllDeclaration'||n.type==='ExportNamedDeclaration'&&n.source){ok(!n.attributes?.length&&!n.assertions?.length,'Import attributes unsupported');add(n.source);}
walk(tree,n=>{ok(n.type!=='ImportExpression','Dynamic imports unsupported in composed closure');if(n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.callee.name==='URL'){const [a,b]=n.arguments;if(b?.type==='MemberExpression'&&b.object.type==='MetaProperty'&&b.property.name==='url'){ok(a?.type==='Literal','Nonliteral import.meta URL');add(a);}}});const sorted=Object.freeze(result.sort((a,b)=>a.start-b.start).map(Object.freeze));edgeCache.set(identity,sorted);return sorted;}
function patch(text,edits){let end=text.length;for(const e of edits.sort((a,b)=>b.start-a.start)){ok(e.start>=0&&e.end<=end&&e.end>e.start,'Invalid patch span');text=text.slice(0,e.start)+e.text+text.slice(e.end);end=e.start;}return text;}
function factoryShape(text){const t=ast(text);ok(t.body.every(n=>n.type!=='ImportDeclaration'&&n.type!=='ExportAllDeclaration'&&!n.source),'Factory must be self contained');const exp=t.body.filter(n=>n.type==='ExportNamedDeclaration');ok(exp.length===1&&exp[0].declaration?.type==='FunctionDeclaration'&&exp[0].declaration.id.name==='instantiate'&&exp[0].declaration.params.length===1,'Unsupported engine factory ABI');return t;}
function compatible(m,r){ok(m.format==='nes-engine/1'&&m.abi===r.abi&&m.capabilities?.execution===r.abi&&['mapper','region','compiler'].every(k=>equal(m.capabilities[k],r[k])),'UNSUPPORTED_ENGINE_ABI');}
const MAINTENANCE_USAGE=`Engine maintenance CLI (Node ES modules)

The exact executing assembler ships as maintenance/romjs-shared-engine-release-assembler.mjs in each fresh output site. It requires authenticated Acorn 8.17.0 dist/acorn.mjs supplied separately. No network or secrets are used.

Run: node maintenance/romjs-shared-engine-release-assembler.mjs < /external/release-input.json

Input JSON fields: root (current emitted modular site), output_directory (fresh disjoint directory), source_inventory (external JSON file), source_inventory_sha256, acorn_module, acorn_sha256, release (increasing stable same-major semver), edits ([{path,before_sha256,file,sha256}]). Optional support_additions adds pinned new tests/maintenance .mjs files under the same path restrictions. Optional support_edits can also update package.json scripts while preserving dependencies and other fields. Optional support_edits uses pinned edits for existing tests/maintenance .mjs files (excluding history and this assembler, which is copied from the executing source). Optional shell_additions accepts [{path,file,sha256}] for new /games/arcade/*.mjs modules reachable from the final authenticated package graphs. Optional shell_edits uses the same edit schema for existing executable package members outside cartridge and engine trees, plus the authenticated loader. Shell changes are validated before mutation and included in package graphs, bindings and immutable history. All SHA256 values must be independently trusted lowercase hex. An edit path is the CURRENT /games/engines/nes/<release>/common/<hash>.mjs or composer.mjs URL; file is the external edited source file. Never use the pre-extraction baseline.

Inventory format: {"format":"nes-release-source/1","files":{"relative/path":{"bytes":123,"sha256":"<trusted SHA256>"}}}. Cover every regular source file exactly, including maintenance scripts and history. Regenerate and authenticate this inventory before EACH release; do not reuse an earlier inventory. Supply a fresh output path for every run.

Stdout is one JSON receipt containing output_directory, release, receipt path, changed/added/preserved counts and executed_tests. Errors go to stderr with nonzero exit. A failed output write may leave a partial fresh directory. Inputs are never written; output is never deployed or activated.

The output refreshes current audit/runtime source pins and authenticates immutable successor history before the original shared-engine migration verifier runs. Historical receipts are retained; maintenance head and history wrapper are current pointers. No cryptographic signature is minted: trust comes from caller inventory SHA256 and embedded receipt hashes.

Later explicit regression: node tests/engine-release-<release>.mjs maintenance/romjs-shared-engine-release-assembler.mjs /external/release-input.json
Use a neutral comment INSIDE instantiate(imports) for the initial edit. This regression imports and steps real machines, checks history and pins, creates a temporary second neutral edit/inventory and successor release, and runs the regression on that second release. Temporary fixtures remain available for inspection. Drafting does not execute these checks. Browser/PHP/deployment tests remain separate gates.
`;
const HISTORY_HEAD='receipts/engine-maintenance-history.json';
function verifyMigration(read,exists,base){
const tree=ast(decode(base)),values=[];for(const n of tree.body)if(n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration')for(const d of n.declaration.declarations)if(d.id.name==='receiptSHA'&&d.init?.type==='Literal')values.push(d.init.value);
ok(values.length===1&&hex(values[0]),'Missing migration receipt pin');const raw=read('receipts/shared-engine-migration.json');ok(raw&&hash(raw)===values[0],'Migration receipt authentication failed');const r=JSON.parse(decode(raw));ok(r.format==='shared-engine-migration/1'&&obj(r.changes)&&obj(r.added)&&obj(r.deleted),'Invalid migration receipt');
for(const [p,c]of Object.entries(r.changes)){key(p);key(c.original);ok(equal(pin(read(p)),c.after)&&equal(pin(read(c.original)),c.before),'Migration history mismatch: '+p);}
for(const [p,c]of Object.entries(r.added)){key(p);ok(equal(pin(read(p)),c),'Migration added mismatch: '+p);}
for(const [p,c]of Object.entries(r.deleted)){key(p);key(c.original);ok(!exists(p)&&equal(pin(read(c.original)),c.before),'Migration deleted mismatch: '+p);}
return p=>{key(p);if(Object.hasOwn(r.added,p))return undefined;const c=r.changes[p]||r.deleted[p];return read(c?c.original:p);};
}
function historyWrapper(base,head){return `import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as base from './${posix.basename(base.path)}';
const root=new URL('../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:hash(b)}),same=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
export const receiptSHA=base.receiptSHA;
export const maintenanceHead=${canonical(head)};
function prior(read,exists){let h=maintenanceHead;while(h){const raw=read(h.path);if(!same(pin(raw),h))throw Error('Maintenance history receipt mismatch');const r=JSON.parse(raw);if(r.format!=='nes-engine-maintenance-history/1')throw Error('Maintenance history format');const nextRead=read,nextExists=exists;for(const [p,c]of Object.entries(r.changes)){if(!same(pin(read(p)),c.after)||!same(pin(read(c.original)),c.before))throw Error('Maintenance changed mismatch: '+p);}for(const [p,c]of Object.entries(r.added))if(!same(pin(read(p)),c))throw Error('Maintenance added mismatch: '+p);read=p=>{if(Object.hasOwn(r.added,p)){const e=Error('No prior file: '+p);e.code='ENOENT';throw e;}const c=r.changes[p];return nextRead(c?c.original:p);};exists=p=>!Object.hasOwn(r.added,p)&&(Object.hasOwn(r.changes,p)||nextExists(p));h=r.previous;}return {read,exists};}
export function releasePriorView(read=p=>readFileSync(new URL(p,root)),exists=p=>existsSync(new URL(p,root))){return prior(read,exists);}
export function verifySharedEngineMigration(read,exists){const v=releasePriorView(read,exists);return base.verifySharedEngineMigration(v.read,v.exists);}
export function sharedEngineHistoricalRead(read,exists){const v=releasePriorView(read,exists);return base.sharedEngineHistoricalRead(v.read,v.exists);}
export async function historicalRead(){const {coreHistoricalRead}=await import('./core-refresh-history.mjs');return coreHistoricalRead(sharedEngineHistoricalRead());}
`;}
function authenticateHistory(source,files){
let read=p=>Object.hasOwn(files,key(p))?source(p):undefined,exists=p=>read(p)!==undefined;
const wrapper=source('tests/shared-engine-history.mjs');let base={path:'tests/engine-history-base-'+hash(wrapper)+'.mjs',...pin(wrapper)},previous=null;
if(Object.hasOwn(files,HISTORY_HEAD)){const headRaw=source(HISTORY_HEAD),head=JSON.parse(decode(headRaw));keys(head,['format','head','base']);ok(head.format==='nes-engine-maintenance-head/1','Invalid maintenance head');base=head.base;previous=head.head;key(base.path);ok(equal(pin(source(base.path)),{bytes:base.bytes,sha256:base.sha256}),'History base authentication failed');ok(wrapper.equals(Buffer.from(historyWrapper(base,previous))),'History wrapper mismatch');}
const baseBytes=previous?source(base.path):wrapper;let h=previous,count=0;const seen=new Set();while(h){ok(++count<=256,'History exceeds 256 releases');key(h.path);ok(!seen.has(h.path),'History cycle');seen.add(h.path);const raw=read(h.path);ok(raw&&equal(pin(raw),{bytes:h.bytes,sha256:h.sha256}),'History receipt authentication failed');const r=JSON.parse(decode(raw));keys(r,['format','release','previous','base','changes','added']);ok(r.format==='nes-engine-maintenance-history/1'&&equal(r.base,base)&&obj(r.changes)&&obj(r.added),'Invalid successor history');semver(r.release);
const nextRead=read;for(const [p,c]of Object.entries(r.changes)){key(p);key(c.original);ok(!Object.hasOwn(r.added,p)&&read(p)&&read(c.original)&&equal(pin(read(p)),c.after)&&equal(pin(read(c.original)),c.before),'History changed mismatch: '+p);}
for(const [p,c]of Object.entries(r.added)){key(p);ok(read(p)&&equal(pin(read(p)),c),'History added mismatch: '+p);}
read=p=>{key(p);if(Object.hasOwn(r.added,p))return undefined;const c=r.changes[p];return nextRead(c?c.original:p);};exists=p=>read(p)!==undefined;h=r.previous;}
return {base,baseBytes,previous,preMigration:verifyMigration(read,exists,baseBytes)};
}
async function main(input){
keys(input,['root','output_directory','source_inventory','source_inventory_sha256','acorn_module','acorn_sha256','release','edits','shell_edits','shell_additions','support_edits','support_additions']);
const root=absolute(input.root);ok(lstatSync(root).isDirectory(),'Root directory required');
const out=resolve(input.output_directory);ok(!existsSync(out)&&!inside(root,out)&&!inside(out,root)&&out!==root,'Output must be fresh and disjoint');absolute(dirname(out));
const inventoryPath=absolute(input.source_inventory);ok(!inside(root,inventoryPath)&&!inside(out,inventoryPath),'Inventory must be external');
const inventoryBytes=readFile(inventoryPath,33554432);ok(hex(input.source_inventory_sha256)&&hash(inventoryBytes)===input.source_inventory_sha256,'Source inventory authentication failed');const inventory=JSON.parse(decode(inventoryBytes));keys(inventory,['format','files']);ok(inventory.format==='nes-release-source/1'&&obj(inventory.files),'Invalid source inventory');
const paths=enumerate(root),present=new Set(paths);let total=0;
function source(p){key(p);const expected=inventory.files[p];ok(expected&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&hex(expected.sha256),'Missing source pin: '+p);const b=readFile(join(root,p));ok(equal(pin(b),expected),'Source hash mismatch: '+p);return b;}
for(const p of paths){const b=source(p);total+=b.length;ok(total<=1073741824,'Source exceeds 1 GiB');}
// Collect mandatory dependencies before history verification or output mutation.
// Optional legacy envelopes are deliberately not seeded; declared members remain mandatory.
const required=new Set(),discovery=new Set(),scanned=new Set();
const seeds=['htdocs/games/engines/nes/registry.json','htdocs/games/arcade/catalog.json','htdocs/games/netplay/catalog.json','includes/api/classes/netplay-catalog.json','includes/api/classes/NetplayPolicy.php','compatibility-audit.json','tests/arcade-runtime-source-pins.json','tests/shared-engine-history.mjs','receipts/shared-engine-migration.json'];
function need(p,traverse=true){key(p);required.add(p);if(traverse)discovery.add(p);}
function references(v){if(Array.isArray(v)){for(const x of v)references(x);return;}if(!obj(v))return;
if(typeof v.path==='string'&&v.bytes!==undefined&&v.sha256!==undefined)need(v.path.startsWith('/games/')?web(v.path):v.path);
// Only explicit history contracts own original-file dependencies. Import edges
// also use original, but contain quoted JavaScript source spans, not paths.
if(v.format==='nes-engine-maintenance-history/1'){for(const [p,c]of Object.entries(v.changes||{})){need(p,false);if(typeof c.original==='string')need(c.original,false);}for(const p of Object.keys(v.added||{}))need(p,false);}
if(obj(v.files))for(const p of Object.keys(v.files))need(p.startsWith('/games/')?web(p):p);
if(obj(v.moduleGraph))for(const [url,edges]of Object.entries(v.moduleGraph)){need(web(url));if(Array.isArray(edges))for(const e of edges)need(web(e.target));}
for(const x of Object.values(v))references(x);}
for(const p of seeds)need(p);
if(present.has(HISTORY_HEAD))need(HISTORY_HEAD);
// Discover current contracts only; inventory membership and historical snapshots do not seed traversal.
for(;;){const pending=[...discovery].filter(p=>present.has(p)&&p.endsWith('.json')&&!scanned.has(p)&&p!=='tests/arcade-runtime-source-pins.json');if(!pending.length)break;
for(const p of pending){scanned.add(p);const text=decode(source(p));let v;try{v=JSON.parse(text);}catch{continue;}
// Historical source inventories may intentionally name removed pre-migration files.
// Follow only current artifact contracts, not arbitrary JSON files or historical inventories.
if(['nes-engine-registry/1','nes-engine-release/1','nes-engine/1','nes-composition/1','nes-engine-maintenance-head/1','nes-engine-maintenance-history/1'].includes(v?.format)||v?.manifest?.format==='game-package/1')references(v);
if(p==='receipts/shared-engine-migration.json'){for(const c of Object.values(v.changes||{}))if(typeof c.original==='string')need(c.original,false);for(const c of Object.values(v.deleted||{}))if(typeof c.original==='string')need(c.original,false);}
if(p==='htdocs/games/arcade/catalog.json'){ok(Array.isArray(v),'Invalid current arcade catalog');for(const row of v){const packagePath=web(row.manifest),base=posix.dirname(packagePath)+'/';need(packagePath);need(base+'composition.json');need(base+'composition-entry.mjs');need(base+'netplay-binding.mjs');}}
}}
const missing=[...required].filter(p=>!present.has(p)).sort();ok(!missing.length,'Missing mandatory source dependencies: '+JSON.stringify(missing));
ok(equal(paths.slice().sort(),Object.keys(inventory.files).sort()),'Source inventory must cover exact current tree');
const parserBytes=readFile(input.acorn_module,2097152);ok(hex(input.acorn_sha256)&&hash(parserBytes)===input.acorn_sha256,'Acorn hash mismatch');const acorn=await import('data:text/javascript;base64,'+parserBytes.toString('base64'));ok(acorn.version==='8.17.0'&&typeof acorn.parse==='function','Acorn 8.17.0 required');parse=acorn.parse;
const history=authenticateHistory(source,inventory.files);
const changes=new Map(),generated=new Map();let generatedBytes=0;
const get=p=>changes.has(p)?changes.get(p):source(p);
const json=p=>JSON.parse(decode(get(p)));
function put(p,b){key(p);ok(!p.split('/').includes('cartridge')&&!/\.(nes|rom)$/i.test(p)&&!/(^|\/)bank-[^/]+$/.test(p),'Protected cartridge/ROM path');b=Buffer.isBuffer(b)?b:Buffer.from(b);generatedBytes+=b.length;ok(generatedBytes<=268435456,'Generated output exceeds 256 MiB');changes.set(p,b);generated.set(p,pin(b));return pin(b);}
const putJSON=(p,v)=>put(p,canonical(v)+'\n');
const receipt=p=>({path:'/'+p.slice(7),...pin(get(p))});
function authenticate(url,expected){const b=get(web(url));ok(equal(pin(b),expected),'Member integrity mismatch: '+url);return b;}
function authReceipt(r){ok(obj(r),'Missing binding receipt');return authenticate(r.path,{bytes:r.bytes,sha256:r.sha256});}
const registryPath='htdocs/games/engines/nes/registry.json',registry=json(registryPath);ok(registry.format==='nes-engine-registry/1'&&obj(registry.selections),'Emitted modular registry required');
const oldRelease=registry.release,oldBase='/games/engines/nes/'+oldRelease+'/',newBase='/games/engines/nes/'+input.release+'/';
const oldV=semver(oldRelease),newV=semver(input.release);ok(newV[0]===oldV[0]&&(newV[1]>oldV[1]||newV[1]===oldV[1]&&newV[2]>oldV[2]),'Fresh increasing compatible semver required');ok(!paths.some(p=>p.startsWith('htdocs'+newBase)),'Release URL already exists');
const releaseManifest=JSON.parse(decode(authReceipt(registry.releaseManifest)));ok(releaseManifest.format==='nes-engine-release/1'&&releaseManifest.release===oldRelease&&obj(releaseManifest.engines),'Invalid current release');
for(const [url,p]of Object.entries(releaseManifest.engines))authenticate(url,p);
const editMap=new Map(),editReceipts=[];ok(Array.isArray(input.edits)&&input.edits.length>0&&input.edits.length<=64,'1..64 edits required');
for(const e of input.edits){keys(e,['path','before_sha256','file','sha256']);web(e.path);ok(e.path.startsWith(oldBase)&&(e.path===oldBase+'composer.mjs'||/^common\/[a-f0-9]{64}\.mjs$/.test(e.path.slice(oldBase.length))),'Only current shared factory/composer edits supported');ok(!editMap.has(e.path),'Duplicate edit');const original=source(web(e.path));ok(hex(e.before_sha256)&&hash(original)===e.before_sha256,'Before hash mismatch: '+e.path);const f=absolute(e.file);ok(!inside(root,f)&&!inside(out,f),'Edited source must be external');const b=readFile(f);ok(hex(e.sha256)&&hash(b)===e.sha256,'Edited source hash mismatch');ok(!b.equals(original),'Edit must change bytes');ast(decode(b));if(e.path!==oldBase+'composer.mjs')factoryShape(decode(b));editMap.set(e.path,b);editReceipts.push({path:e.path,before:pin(original),file:f,after:pin(b)});}
// Validate current concrete compositions before changing the mutable registry.
const catalogPath='htdocs/games/arcade/catalog.json',clientPath='htdocs/games/netplay/catalog.json',serverPath='includes/api/classes/netplay-catalog.json',phpPath='includes/api/classes/NetplayPolicy.php';
const catalog=json(catalogPath),network=json(clientPath);ok(Array.isArray(catalog)&&obj(network.packages),'Invalid current catalogs');ok(get(clientPath).equals(get(serverPath)),'Client/server catalog bytes differ');
const php=decode(get(phpPath)),phpPins=[...php.matchAll(/private const DIGEST='([a-f0-9]{64})'/g)];ok(phpPins.length===1&&phpPins[0][1]===hash(get(serverPath)), 'Server catalog authentication failed');ok(php.includes("self::deny('binding_changed',409)"),'Superseded binding policy missing');
const games=[],seen=new Set();
for(const row of catalog){ok(typeof row.id==='string'&&!seen.has(row.id),'Duplicate catalog identity');seen.add(row.id);const packagePath=web(row.manifest),envelope=json(packagePath),m=envelope.manifest;ok(m?.format==='game-package/1'&&m.hostApi===1&&m.id===row.id&&envelope.artifactDigest===row.artifactDigest&&hash(canonical(m))===envelope.artifactDigest,'Current package identity mismatch');ok(obj(m.files)&&Object.keys(m.files).length<=1024,'Invalid package inventory');for(const [url,p]of Object.entries(m.files))authenticate(url,p);
const base=posix.dirname(packagePath)+'/',sidePath=base+'composition.json',side=json(sidePath);ok(side.format==='nes-composition/1'&&obj(side.binding)&&obj(side.moduleGraph),'Concrete emitted composition required');ok(m.files['/'+sidePath.slice(7)],'Composition not inventoried');for(const r of Object.values(side.binding)){authReceipt(r);ok(equal(m.files[r.path],{bytes:r.bytes,sha256:r.sha256}),'Uninventoried composition binding');}
const cart=JSON.parse(decode(authReceipt(side.binding.cartridgeManifest)));ok(cart.format==='nes-cartridge/1'&&equal(cart.requirements,side.requirements),'Cartridge requirement mismatch');const selector=canonical(side.requirements),selection=registry.selections[selector];ok(selection&&equal(selection.manifest,side.binding.engineManifest),'No exact ABI/capability/profile selection');authReceipt(selection.entry);const engine=JSON.parse(decode(authReceipt(selection.manifest)));compatible(engine,side.requirements);ok(selection.manifest.path.startsWith(oldBase)&&releaseManifest.engines[selection.manifest.path]&&equal(releaseManifest.engines[selection.manifest.path],{bytes:selection.manifest.bytes,sha256:selection.manifest.sha256}),'Unregistered engine');
for(const [url,p]of Object.entries(engine.files))authenticate(url,p);
for(const [url,declared]of Object.entries(side.moduleGraph)){ok(m.files[url],'Uninventoried executable');const actual=edges(decode(get(web(url))),url);ok(equal(actual,declared),'Current executable graph mismatch: '+url);for(const e of actual)ok(Object.hasOwn(side.moduleGraph,e.target),'Incomplete current executable closure');}ok(Object.hasOwn(side.moduleGraph,m.entry),'Missing executable entry');
const binding=network.packages[row.id];ok(binding?.artifactDigest===envelope.artifactDigest&&binding.packageId===row.id,'Current arcade/client/server identity mismatch');
const networkPath=base+'network-package.json',legacy=Object.hasOwn(inventory.files,networkPath)?json(networkPath):null;if(Object.hasOwn(inventory.files,networkPath)){ok(obj(legacy),'Invalid historical network reference');ok(legacy.format==='combined-network-reference/1'&&legacy.packageFormat==='game-package/1'&&obj(legacy.binding)&&hex(legacy.artifactDigest)&&legacy.artifactDigest===legacy.binding.artifactDigest,'Invalid historical network reference');const withoutDigest=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='artifactDigest'));ok(equal(withoutDigest(legacy.binding),withoutDigest(binding)),'Historical binding policy differs');}
// Every cartridge byte, including unreferenced assets, must be authenticated by this package.
for(const p of paths.filter(p=>p.startsWith(base+'cartridge/')))ok(equal(m.files['/'+p.slice(7)],inventory.files[p]),'Cartridge tree is not fully package authenticated');
games.push({row,packagePath,envelope,m,base,sidePath,side,cart,selector,selection,engine,networkPath,legacy});}
ok(equal([...seen].sort(),Object.keys(network.packages).sort()),'Catalog membership mismatch');
const auditPath='compatibility-audit.json',audit=json(auditPath),runtimePinsPath='tests/arcade-runtime-source-pins.json',runtimePins=json(runtimePinsPath);
ok(Array.isArray(audit)&&audit.length===games.length&&new Set(audit.map(g=>g.id)).size===games.length,'Invalid compatibility audit membership');
for(const g of games){const a=audit.find(a=>a.id===g.row.id);ok(a&&a.abi===g.engine.abi&&equal(a.requirements,g.cart.requirements)&&a.artifactDigest===g.envelope.artifactDigest&&equal(a.engineManifest,g.side.binding.engineManifest)&&a.nativePlayers===g.m.capabilities.nativePlayers&&a.play===g.m.capabilities.play&&obj(a.board),'Current compatibility audit mismatch');const cartFiles=Object.fromEntries(paths.filter(p=>p.startsWith(g.base+'cartridge/')).map(p=>[p,inventory.files[p]]));ok(equal(a.cartridgeFiles,cartFiles),'Compatibility cartridge inventory mismatch');}
ok(obj(runtimePins)&&obj(runtimePins.files),'Invalid runtime source pins');
for(const [p,expected]of Object.entries(runtimePins.files)){key(p);let matched=Object.hasOwn(inventory.files,p)&&equal(inventory.files[p],expected);if(!matched){const b=history.preMigration(p);matched=b!==undefined&&equal(pin(b),expected);}ok(matched,'Runtime source pin mismatch: '+p);}
// Shell changes are authenticated against the same source and recorded in history.
// They may update existing executable package members, never cartridge or engine bytes.
const shellReceipts=[],shellPaths=new Set(),shellEdits=input.shell_edits??[];
ok(Array.isArray(shellEdits)&&shellEdits.length<=64,'At most 64 shell edits');
const shellAllowed=new Set(['/games/arcade/authenticated-loader.mjs',...games.flatMap(g=>Object.keys(g.side.moduleGraph))]);
for(const e of shellEdits){
 keys(e,['path','before_sha256','file','sha256']);web(e.path);
 ok(shellAllowed.has(e.path)&&!e.path.startsWith('/games/engines/')&&!e.path.includes('/cartridge/')&&!e.path.endsWith('/composition-entry.mjs')&&!e.path.endsWith('/netplay-binding.mjs'),'Unsupported shell edit');
 ok(!shellPaths.has(e.path),'Duplicate shell edit');shellPaths.add(e.path);
 const before=source(web(e.path));ok(hex(e.before_sha256)&&hash(before)===e.before_sha256,'Before hash mismatch: '+e.path);
 const f=absolute(e.file);ok(!inside(root,f)&&!inside(out,f),'Edited source must be external');
 const b=readFile(f);ok(hex(e.sha256)&&hash(b)===e.sha256,'Edited source hash mismatch');ok(!b.equals(before),'Edit must change bytes');ast(decode(b));
 put(web(e.path),b);shellReceipts.push({path:e.path,before:pin(before),file:f,after:pin(b)});
}
const shellAdditions=input.shell_additions??[];ok(Array.isArray(shellAdditions)&&shellAdditions.length<=32,'At most 32 shared module additions');
const addedShellPaths=new Set();
for(const e of shellAdditions){
 keys(e,['path','file','sha256']);web(e.path);ok(/^\/games\/arcade\/[a-z0-9-]+\.mjs$/.test(e.path),'Only shared arcade module additions supported');
 ok(!present.has(web(e.path))&&!addedShellPaths.has(e.path),'Shared module already exists');addedShellPaths.add(e.path);
 const f=absolute(e.file);ok(!inside(root,f)&&!inside(out,f),'Added source must be external');const b=readFile(f);ok(hex(e.sha256)&&hash(b)===e.sha256,'Added source hash mismatch');ast(decode(b));put(web(e.path),b);
}
const supportEdits=input.support_edits??[];ok(Array.isArray(supportEdits)&&supportEdits.length<=32,'At most 32 support edits');
const supportPaths=new Set();
for(const e of supportEdits){
 keys(e,['path','before_sha256','file','sha256']);key(e.path);ok((e.path==='package.json'||/^(tests|maintenance)\/[a-zA-Z0-9_./-]+\.mjs$/.test(e.path))&&!e.path.includes('history')&&e.path!=='maintenance/romjs-shared-engine-release-assembler.mjs','Unsupported support edit');
 ok(!supportPaths.has(e.path),'Duplicate support edit');supportPaths.add(e.path);const before=source(e.path);ok(hex(e.before_sha256)&&hash(before)===e.before_sha256,'Before hash mismatch: '+e.path);
 const f=absolute(e.file);ok(!inside(root,f)&&!inside(out,f),'Edited source must be external');const bytes=readFile(f);ok(hex(e.sha256)&&hash(bytes)===e.sha256,'Edited source hash mismatch');if(e.path==='package.json'){const old=JSON.parse(decode(before)),next=JSON.parse(decode(bytes));ok(equal({...old,scripts:undefined},{...next,scripts:undefined}),'Package support edit may only change scripts');ok(obj(next.scripts)&&Object.values(next.scripts).every(v=>typeof v==='string'),'Package scripts');}else ast(decode(bytes));put(e.path,bytes);
}
const supportAdditions=input.support_additions??[];ok(Array.isArray(supportAdditions)&&supportAdditions.length<=32,'At most 32 support additions');
for(const e of supportAdditions){
 keys(e,['path','file','sha256']);key(e.path);ok(/^(tests|maintenance)\/[a-zA-Z0-9_./-]+\.mjs$/.test(e.path)&&!e.path.includes('history')&&e.path!=='maintenance/romjs-shared-engine-release-assembler.mjs','Unsupported support addition');
 ok(!present.has(e.path)&&!supportPaths.has(e.path),'Support module already exists');supportPaths.add(e.path);
 const f=absolute(e.file);ok(!inside(root,f)&&!inside(out,f),'Added source must be external');const bytes=readFile(f);ok(hex(e.sha256)&&hash(bytes)===e.sha256,'Added source hash mismatch');ast(decode(bytes));put(e.path,bytes);
}
const selected=new Map(),newEngines={},consumed=new Set();
for(const [selector,s]of Object.entries(registry.selections)){
const requirements=JSON.parse(selector);ok(canonical(requirements)===selector,'Noncanonical selector');const em=JSON.parse(decode(authReceipt(s.manifest)));authReceipt(s.entry);compatible(em,requirements);ok(s.manifest.path.startsWith(oldBase)&&s.entry.path===posix.dirname(s.manifest.path)+'/entry.mjs','Unsupported engine layout');ok(equal(releaseManifest.engines[s.manifest.path],{bytes:s.manifest.bytes,sha256:s.manifest.sha256}),'Release selection mismatch');
for(const [url,p]of Object.entries(em.files))authenticate(url,p);
const supportedFiles=new Set([s.entry.path,oldBase+'composer.mjs',...(em.graph?.nodes||[]).map(n=>oldBase+'common/'+n.factory+'.mjs')]);ok(equal(Object.keys(em.files).sort(),[...supportedFiles].sort()),'Unsupported engine closure members; refusing to discard dependencies');
const oldEntry=decode(get(web(s.entry.path))),oldGraph=em.graph;ok(obj(oldGraph)&&Array.isArray(oldGraph.nodes)&&typeof oldGraph.entry==='string','Invalid factory graph');const graph=structuredClone(oldGraph),factoryURLs=new Map();
for(const node of graph.nodes){key(node.key);ok(hex(node.factory)&&Array.isArray(node.dependencies),'Malformed engine graph');const oldURL=oldBase+'common/'+node.factory+'.mjs';ok(em.files[oldURL],'Factory outside authenticated closure');const before=authenticate(oldURL,em.files[oldURL]);ok(hash(before)===node.factory,'Factory name hash mismatch');const b=editMap.get(oldURL)||before;if(editMap.has(oldURL))consumed.add(oldURL);factoryShape(decode(b));ok(edges(decode(b),oldURL).length===0,'Factory dependency unsupported');node.factory=hash(b);const url=newBase+'common/'+node.factory+'.mjs';put(web(url),b);factoryURLs.set(url,pin(b));}
const nodeKeys=graph.nodes.map(n=>n.key);ok(new Set(nodeKeys).size===nodeKeys.length&&nodeKeys.includes(graph.entry),'Malformed graph entry');for(const n of graph.nodes)ok(n.dependencies.every(d=>d==='$data'||nodeKeys.includes(d)),'Unknown factory dependency');
const oldComposer=oldBase+'composer.mjs';ok(em.files[oldComposer],'Missing authenticated composer');const composer=editMap.get(oldComposer)||authenticate(oldComposer,em.files[oldComposer]);if(editMap.has(oldComposer))consumed.add(oldComposer);ok(edges(decode(composer),oldComposer).length===0,'Composer dependencies unsupported');const newComposer=newBase+'composer.mjs';put(web(newComposer),composer);
// Retain the existing wrapper and guard, replacing only concrete imports, graph and factory keys.
const entryTree=ast(oldEntry),patches=[],hashMap=new Map(oldGraph.nodes.map((n,i)=>[n.factory,graph.nodes[i].factory]));let graphDeclarations=0;
for(const n of entryTree.body){if(n.type==='ImportDeclaration'){const value=n.source.value;let replacement;if(value==='../../composer.mjs')replacement=value;else {const match=/^\.\.\/\.\.\/common\/([a-f0-9]{64})\.mjs$/.exec(value);ok(match&&hashMap.has(match[1]),'Unexpected engine entry import');replacement='../../common/'+hashMap.get(match[1])+'.mjs';}patches.push({start:n.source.start,end:n.source.end,text:JSON.stringify(replacement)});}
if(n.type==='VariableDeclaration')for(const d of n.declarations){if(d.id.name==='graph'){ok(equal(JSON.parse(oldEntry.slice(d.init.start,d.init.end)),oldGraph),'Entry graph mismatch');patches.push({start:d.init.start,end:d.init.end,text:canonical(graph)});graphDeclarations++;}if(d.id.name==='factories'){walk(d.init,x=>{if(x.type==='Property'&&x.key.type==='Literal'&&hashMap.has(x.key.value))patches.push({start:x.key.start,end:x.key.end,text:JSON.stringify(hashMap.get(x.key.value))});});}}}
ok(graphDeclarations===1,'Unsupported entry graph declaration');const newEntry=patch(oldEntry,patches);ast(newEntry);
const core={...em,graph,files:Object.fromEntries([...factoryURLs.entries()].sort(([a],[b])=>a.localeCompare(b)))};const graphDigest=hash(canonical(core)),variant=posix.basename(posix.dirname(posix.dirname(s.manifest.path)));key(variant);const manifestURL=newBase+variant+'/'+graphDigest+'/engine-manifest.json',entryURL=posix.dirname(manifestURL)+'/entry.mjs';put(web(entryURL),newEntry);core.files[entryURL]=pin(get(web(entryURL)));core.files[newComposer]=pin(composer);putJSON(web(manifestURL),core);const choice={manifest:receipt(web(manifestURL)),entry:receipt(web(entryURL))};if(selected.has(selector))ok(equal(selected.get(selector),choice),'Ambiguous compatible selection');selected.set(selector,choice);newEngines[manifestURL]=pin(get(web(manifestURL)));}
ok([...editMap.keys()].every(p=>consumed.has(p)),'Edit is outside the selected release closure');
const newReleasePath=web(newBase+'release.json');putJSON(newReleasePath,{format:'nes-engine-release/1',release:input.release,engines:newEngines});putJSON(registryPath,{...registry,release:input.release,releaseManifest:receipt(newReleasePath),selections:Object.fromEntries(selected)});
function collect(entry){const result={},active=new Set();function visit(url){ok(!active.has(url),'Unsupported executable cycle: '+url);if(Object.hasOwn(result,url))return;active.add(url);const e=edges(decode(get(web(url))),url);result[url]=e;for(const x of e)visit(x.target);active.delete(url);}visit(entry);return result;}
const gameReceipts=[];
for(const g of games){const choice=selected.get(g.selector);ok(choice,'UNSUPPORTED_ENGINE_ABI');const em=json(web(choice.manifest.path));compatible(em,g.cart.requirements);
const compositionEntry=g.base+'composition-entry.mjs',text=decode(get(compositionEntry)),tree=ast(text),imports=tree.body.filter(n=>n.type==='ImportDeclaration'&&n.source.value.startsWith('../engines/'));ok(imports.length===1,'Concrete composition engine import required');const imported=posix.normalize(posix.join('/'+g.base.slice(7),imports[0].source.value));ok(imported===g.selection.entry.path,'Composition selection mismatch');const updated=patch(text,[{start:imports[0].source.start,end:imports[0].source.end,text:JSON.stringify(posix.relative('/'+g.base.slice(7),choice.entry.path))}]);put(compositionEntry,updated);
const moduleGraph=collect(g.m.entry),binding={...g.side.binding,registry:receipt(registryPath),releaseManifest:receipt(newReleasePath),engineManifest:choice.manifest};putJSON(g.sidePath,{...g.side,binding,moduleGraph});
const files={};for(const url of Object.keys(g.m.files)){if(url.startsWith(oldBase))continue;files[url]=pin(get(web(url)));}for(const url of Object.keys(moduleGraph))files[url]=pin(get(web(url)));for(const r of Object.values(binding))files[r.path]={bytes:r.bytes,sha256:r.sha256};for(const [url,p]of Object.entries(em.files))files[url]=p;files['/'+g.sidePath.slice(7)]=pin(get(g.sidePath));files[choice.entry.path]=pin(get(web(choice.entry.path)));
const manifest={...g.m,files},artifactDigest=hash(canonical(manifest));ok(Object.keys(files).length<=1024&&Object.values(files).reduce((n,p)=>n+p.bytes,0)<=268435456,'Package ceiling exceeded');ok(artifactDigest!==g.envelope.artifactDigest,'Composed identity did not change');putJSON(g.packagePath,{...g.envelope,manifest,artifactDigest});g.row.artifactDigest=artifactDigest;
const currentBinding=network.packages[g.row.id];network.packages[g.row.id]={...currentBinding,artifactDigest};if(g.legacy!==null)putJSON(g.networkPath,{...g.legacy,artifactDigest,binding:network.packages[g.row.id]});
gameReceipts.push({id:g.row.id,requirements:g.cart.requirements,before:g.envelope.artifactDigest,after:artifactDigest,previousLegacyDigest:g.legacy===null?null:g.legacy.artifactDigest,engineBefore:g.selection.manifest,engineAfter:choice.manifest,compositionEntryBefore:inventory.files[compositionEntry],compositionEntryAfter:pin(get(compositionEntry))});}
for(const path of addedShellPaths)ok(games.some(g=>Object.hasOwn(json(g.sidePath).moduleGraph,path)),'Unused shared module addition: '+path);
putJSON(catalogPath,catalog);putJSON(clientPath,network);put(serverPath,get(clientPath));put(phpPath,php.replace(phpPins[0][0],"private const DIGEST='"+hash(get(serverPath))+"'"));
for(const g of games){const a=audit.find(a=>a.id===g.row.id);a.previousArtifactDigest=g.envelope.artifactDigest;a.artifactDigest=g.row.artifactDigest;a.engineManifest=selected.get(g.selector).manifest;}
putJSON(auditPath,audit);
const currentPins={};for(const p of Object.keys(runtimePins.files))if(Object.hasOwn(inventory.files,p))currentPins[p]=pin(get(p));
for(const g of games){const side=json(g.sidePath);for(const url of Object.keys(side.moduleGraph))currentPins[web(url)]=pin(get(web(url)));for(const url of Object.keys(json(web(side.binding.engineManifest.path)).files))if(/\.(mjs|js)$/.test(url))currentPins[web(url)]=pin(get(web(url)));}
putJSON(runtimePinsPath,{...runtimePins,files:currentPins});
const assemblerPath='maintenance/romjs-shared-engine-release-assembler.mjs';
const selfBytes=readFile(fileURLToPath(import.meta.url));ast(decode(selfBytes));put(assemblerPath,selfBytes);
put('maintenance/ENGINE-RELEASE.md',MAINTENANCE_USAGE);
// Prepare all output only after authentication and assembly succeed. Old releases remain byte-identical.
const changed={},added={},preserved={};for(const p of paths){const before=inventory.files[p],after=pin(get(p));if(equal(before,after))preserved[p]=after;else {ok(!p.startsWith('htdocs'+oldBase),'Immutable historical release changed');ok(!p.split('/').includes('cartridge'),'Cartridge byte changed');changed[p]={before,after};}}for(const [p,b]of changes)if(!Object.hasOwn(inventory.files,p))added[p]=pin(b);
const receiptPath='receipts/engine-release-'+input.release+'.json';ok(!Object.hasOwn(inventory.files,receiptPath),'Release receipt already exists');
const report={format:'nes-engine-assembly-receipt/1',mode:'STANDARD',release:input.release,sourceInventory:{path:inventoryPath,...pin(inventoryBytes)},parser:pin(parserBytes),edits:editReceipts,shellEdits:shellReceipts,shellAdditions:shellAdditions,supportEdits,games:gameReceipts,changed,preserved,added,executedTests:[],checks:['exact authenticated source tree','current package and engine closures','exact ABI/capability/profile selectors','current arcade/client/server identity equality','authenticated and refreshed optional legacy envelopes only when present','collective mandatory source dependency preflight','preserved cartridge trees and old releases'],remainingGates:['Execute neutral source edit and import the actual emitted new engine/composition','Execute rejection tests for before/source hash mismatch and incompatible ABI','Browser authenticated loader/bootstrap and worker loading','PHP current and superseded binding replay'],limits:{sourceBytes:1073741824,memberBytes:67108864,generatedBytes:268435456,packageBytes:268435456,packageFiles:1024}};
const regressionPath='tests/engine-release-'+input.release+'.mjs';ok(!Object.hasOwn(inventory.files,regressionPath),'Release regression already exists');
put(regressionPath,REGRESSION);added[regressionPath]=pin(get(regressionPath));
putJSON(receiptPath,report);
// Immutable successor receipts cover current mutations and preserve the exact prior view.
if(!Object.hasOwn(inventory.files,history.base.path))put(history.base.path,history.baseBytes);
const historyChanges={},historyAdded={};
for(const [p,b]of [...changes]){if(p===HISTORY_HEAD||p==='tests/shared-engine-history.mjs')continue;const before=inventory.files[p],after=pin(b);if(!before)historyAdded[p]=after;else if(!equal(before,after)){const original='receipts/engine-release-originals/'+before.sha256;if(Object.hasOwn(inventory.files,original))ok(equal(inventory.files[original],before),'History original collision');else put(original,source(p));historyChanges[p]={before,after,original};}}
for(const [p,b]of changes)if(!Object.hasOwn(inventory.files,p)&&!Object.hasOwn(historyAdded,p))historyAdded[p]=pin(b);
const successorPath='receipts/engine-release-history-'+input.release+'.json';ok(!Object.hasOwn(inventory.files,successorPath),'History release already exists');
putJSON(successorPath,{format:'nes-engine-maintenance-history/1',release:input.release,previous:history.previous,base:history.base,changes:historyChanges,added:historyAdded});
const head={path:successorPath,...pin(get(successorPath))};putJSON(HISTORY_HEAD,{format:'nes-engine-maintenance-head/1',head,base:history.base});put('tests/shared-engine-history.mjs',historyWrapper(history.base,head));
// Authenticate the completed virtual tree before creating output.
const finalFiles=Object.fromEntries([...new Set([...paths,...changes.keys()])].map(p=>[p,pin(get(p))]));authenticateHistory(get,finalFiles);
for(const p of Object.keys(changed))delete changed[p];for(const p of Object.keys(added))delete added[p];for(const p of Object.keys(preserved))delete preserved[p];
for(const [p,after]of Object.entries(finalFiles)){const before=inventory.files[p];if(!before)added[p]=after;else if(equal(before,after))preserved[p]=after;else changed[p]={before,after};}
// Re-read source bytes during copy; never copy from unauthenticated provenance receipts.
mkdirSync(out,{recursive:false});for(const p of [...new Set([...paths,...changes.keys()])].sort()){const b=get(p),target=join(out,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b,{flag:'wx'});ok(equal(pin(readFile(target)),pin(b)),'Output write verification failed');}
ok(equal(enumerate(root).sort(),paths.slice().sort()),'Source tree changed during assembly');for(const p of paths)source(p);
return {output_directory:out,release:input.release,receipt:join(out,receiptPath),changed:Object.keys(changed).length,added:Object.keys(added).length,preserved:Object.keys(preserved).length,executed_tests:[]};
}
const REGRESSION=String.raw`// Explicit later execution only. Usage: node <this-file> <runner.mjs> <original-input.json>
// For a neutral probe, put a unique comment INSIDE instantiate(imports), retaining behavior.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,existsSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const runner=resolve(process.argv[2]||''),input=JSON.parse(readFileSync(resolve(process.argv[3]||''),'utf8'));
const root=resolve(input.root),out=resolve(input.output_directory);
const read=(r,p)=>readFileSync(join(r,p));
const json=(r,p)=>JSON.parse(read(r,p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function files(r,d=''){const result=[];for(const e of readdirSync(join(r,d),{withFileTypes:true})){const p=d?d+'/'+e.name:e.name;assert.ok(!e.isSymbolicLink());if(e.isDirectory())result.push(...files(r,p));else {assert.ok(e.isFile());result.push(p);}}return result.sort();}
// Exercise the exact preflight walker without importing or executing the assembler.
const assemblerText=readFileSync(runner,'utf8'),walkerStart=assemblerText.indexOf('function references(v){'),walkerEnd=assemblerText.indexOf('\nfor(const p of seeds)need(p);',walkerStart);
assert.ok(walkerStart>=0&&walkerEnd>walkerStart);
const discovered=new Set(),discover=Function('need','web','obj',assemblerText.slice(walkerStart,walkerEnd)+';return references;')(p=>{assert.equal(typeof p,'string');assert.ok(!p.includes('"')&&!p.split('/').includes('..'));discovered.add(p);},p=>{assert.ok(p.startsWith('/games/'));return 'htdocs'+p;},v=>v!==null&&typeof v==='object'&&!Array.isArray(v));
const target='/games/engines/nes/probe/common/'+'a'.repeat(64)+'.mjs',entry='/games/probe/composition-entry.mjs',original='receipts/engine-release-originals/'+'b'.repeat(64),probePin={bytes:1,sha256:'b'.repeat(64)};
discover({format:'nes-composition/1',moduleGraph:{[entry]:[{start:10,end:100,original:'"../../common/'+'a'.repeat(64)+'.mjs"',target}]}});
assert.deepEqual([...discovered].sort(),['htdocs'+entry,'htdocs'+target].sort(),'Import original source text must not become a dependency');
discover({format:'nes-engine-maintenance-history/1',changes:{'current.json':{before:probePin,after:probePin,original}},added:{'added.json':probePin}});
assert.ok(discovered.has(original),'History originals remain mandatory');assert.ok(discovered.has('current.json'));assert.ok(discovered.has('added.json'));
// Exercise actual preflight with an authenticated retained package and a current dependency.
const preflightStart=assemblerText.indexOf('// Collect mandatory dependencies before history verification or output mutation.'),preflightEnd=assemblerText.indexOf("ok(equal(paths.slice().sort(),Object.keys(inventory.files).sort())",preflightStart);
assert.ok(preflightStart>=0&&preflightEnd>preflightStart);
const fixture=new Map(),fixtureSeeds=['htdocs/games/engines/nes/registry.json','htdocs/games/arcade/catalog.json','htdocs/games/netplay/catalog.json','includes/api/classes/netplay-catalog.json','includes/api/classes/NetplayPolicy.php','compatibility-audit.json','tests/arcade-runtime-source-pins.json','tests/shared-engine-history.mjs','receipts/shared-engine-migration.json'];
for(const p of fixtureSeeds)fixture.set(p,Buffer.from('{}'));
const fixturePackage='htdocs/games/probe/game-package.json',retained='tests/migration-originals/game-package.json',removed='/games/probe/removed-engine.mjs',current='/games/probe/current.mjs';
fixture.set('htdocs/games/arcade/catalog.json',Buffer.from('[]'));
fixture.set('htdocs/games/engines/nes/registry.json',Buffer.from(JSON.stringify({format:'nes-engine-registry/1',package:{path:fixturePackage,...probePin}})));
fixture.set(fixturePackage,Buffer.from(JSON.stringify({manifest:{format:'game-package/1',files:{[current]:probePin}}})));
fixture.set('htdocs'+current,Buffer.from('x'));
fixture.set(retained,Buffer.from(JSON.stringify({manifest:{format:'game-package/1',files:{[removed]:probePin}}})));
fixture.set('receipts/shared-engine-migration.json',Buffer.from(JSON.stringify({changes:{[fixturePackage]:{before:probePin,after:probePin,original:retained}},deleted:{}})));
const runPreflight=Function('present','source','decode','obj','web','key','ok','HISTORY_HEAD',assemblerText.slice(preflightStart,preflightEnd)+';return required;');
function fixturePreflight(){return runPreflight(new Set(fixture.keys()),p=>{assert.ok(fixture.has(p),p);return fixture.get(p);},b=>b.toString(),v=>v!==null&&typeof v==='object'&&!Array.isArray(v),p=>'htdocs'+p,p=>{assert.equal(typeof p,'string');return p;},(v,m)=>{if(!v)throw Error(m);},'receipts/engine-maintenance-history.json');}
const fixtureRequired=fixturePreflight();assert.ok(fixtureRequired.has(retained));assert.ok(!fixtureRequired.has('htdocs'+removed),'Retained historical package must not seed former executable dependencies');
fixture.delete('htdocs'+current);assert.throws(fixturePreflight,e=>e.message==='Missing mandatory source dependencies: '+JSON.stringify(['htdocs'+current]),'Current package dependencies remain mandatory');
const beforeFiles=files(root),afterFiles=files(out);
const protectedPaths=beforeFiles.filter(p=>p.split('/').includes('cartridge')||/\.(nes|rom)$/i.test(p)||/(^|\/)bank-[^/]+$/.test(p));
assert.deepEqual(afterFiles.filter(p=>p.split('/').includes('cartridge')||/\.(nes|rom)$/i.test(p)||/(^|\/)bank-[^/]+$/.test(p)),protectedPaths);
for(const p of protectedPaths)assert.deepEqual(read(root,p),read(out,p),p);
const old=json(root,'htdocs/games/engines/nes/registry.json'),next=json(out,'htdocs/games/engines/nes/registry.json');
assert.notEqual(next.release,old.release);
for(const p of beforeFiles.filter(p=>p.startsWith('htdocs/games/engines/nes/')&&p!=='htdocs/games/engines/nes/registry.json'))assert.deepEqual(read(root,p),read(out,p),p);
const catalog=json(out,'htdocs/games/arcade/catalog.json'),client=json(out,'htdocs/games/netplay/catalog.json');
assert.deepEqual(read(out,'htdocs/games/netplay/catalog.json'),read(out,'includes/api/classes/netplay-catalog.json'));
assert.ok(read(out,'includes/api/classes/NetplayPolicy.php').toString().includes("private const DIGEST='"+hash(read(out,'includes/api/classes/netplay-catalog.json'))+"'"));
let affected=0,loadedEdits=0,legacyPresent=0,legacyAbsent=0;
for(const e of input.edits){if(!e.path.includes('/common/'))continue;const oldFactory=await import(pathToFileURL(join(root,'htdocs'+e.path)).href);const newURL='/games/engines/nes/'+input.release+'/common/'+e.sha256+'.mjs';assert.equal(hash(read(out,'htdocs'+newURL)),e.sha256);const newFactory=await import(pathToFileURL(join(out,'htdocs'+newURL)).href);assert.notEqual(Function.prototype.toString.call(newFactory.instantiate),Function.prototype.toString.call(oldFactory.instantiate),'Neutral probe must change bytes INSIDE instantiate to prove loaded code changed');loadedEdits++;}
assert.ok(loadedEdits>0,'Supply a neutral shared factory edit, not only composer edits');
for(const row of catalog){const p='htdocs'+row.manifest,before=json(root,p),after=json(out,p),base=dirname(p),side=json(out,base+'/composition.json'),prior=json(root,base+'/composition.json');assert.notEqual(after.artifactDigest,before.artifactDigest);assert.equal(hash(canonical(after.manifest)),after.artifactDigest);assert.equal(row.artifactDigest,after.artifactDigest);assert.equal(client.packages[row.id].artifactDigest,after.artifactDigest);const legacyPath=base+'/network-package.json',hasLegacy=existsSync(join(root,legacyPath));assert.equal(existsSync(join(out,legacyPath)),hasLegacy,'Optional legacy envelope presence changed');
assert.deepEqual(read(root,base+'/netplay-binding.mjs'),read(out,base+'/netplay-binding.mjs'));
if(hasLegacy){legacyPresent++;const priorLegacy=json(root,legacyPath),legacy=json(out,legacyPath);assert.equal(legacy.artifactDigest,after.artifactDigest);assert.deepEqual(legacy.binding,client.packages[row.id]);const extras=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='binding'&&k!=='artifactDigest'));assert.deepEqual(extras(legacy),extras(priorLegacy));}else legacyAbsent++;
for(const [url,pin]of Object.entries(after.manifest.files)){const b=read(out,'htdocs'+url);assert.equal(b.length,pin.bytes);assert.equal(hash(b),pin.sha256);}
const em=json(out,'htdocs'+side.binding.engineManifest.path),oldEM=json(root,'htdocs'+prior.binding.engineManifest.path);const impacted=oldEM.graph.nodes.some(n=>input.edits.some(e=>e.path.endsWith('/common/'+n.factory+'.mjs')));
assert.notEqual(side.binding.engineManifest.sha256,prior.binding.engineManifest.sha256);
const entry=next.selections[canonical(side.requirements)].entry.path;
const engine=await import(pathToFileURL(join(out,'htdocs'+entry)).href),cartridge=await import(pathToFileURL(join(out,base,'cartridge/entry.mjs')).href);
assert.throws(()=>engine.createMachine({...cartridge,requirements:{...cartridge.requirements,abi:'unsupported/0'}}),/UNSUPPORTED_ENGINE_ABI/);
const composed=await import(pathToFileURL(join(out,base,'composition-entry.mjs')).href);
const a=composed.createMachine(),b=engine.createMachine(cartridge);assert.deepEqual(a.getState(),b.getState());assert.equal(a.checkInterpreterGuard(),true);assert.equal(b.checkInterpreterGuard(),true);a.step();b.step();assert.deepEqual(a.getState(),b.getState());a.dispose?.();b.dispose?.();if(impacted)affected++;
}
assert.ok(affected>0,'Edit must affect an actually composed engine');
assert.ok(legacyPresent>0&&legacyAbsent>0,'Integration fixture must cover both present and intentionally absent optional legacy envelopes');
const history=await import(pathToFileURL(join(out,'tests/shared-engine-history.mjs')).href);
history.verifySharedEngineMigration();history.sharedEngineHistoricalRead();
const headDocument=json(out,'receipts/engine-maintenance-history.json');
const priorHistory=await import(pathToFileURL(join(out,headDocument.base.path)).href);
const priorView=history.releasePriorView();priorHistory.verifySharedEngineMigration(priorView.read,priorView.exists);
assert.throws(()=>history.verifySharedEngineMigration(p=>p===history.maintenanceHead.path?Buffer.from('{}'):read(out,p),p=>existsSync(join(out,p))),/history receipt mismatch/);
for(const [p,expected]of Object.entries(json(out,'tests/arcade-runtime-source-pins.json').files)){const b=read(out,p);assert.equal(b.length,expected.bytes,p);assert.equal(hash(b),expected.sha256,p);}
const audit=json(out,'compatibility-audit.json');
for(const row of catalog){const a=audit.find(a=>a.id===row.id),base=dirname('htdocs'+row.manifest),side=json(out,base+'/composition.json');assert.equal(a.artifactDigest,row.artifactDigest);assert.deepEqual(a.engineManifest,side.binding.engineManifest);assert.deepEqual(a.requirements,side.requirements);for(const [p,expected]of Object.entries(a.cartridgeFiles)){assert.deepEqual(read(root,p),read(out,p));assert.equal(hash(read(out,p)),expected.sha256);}}
for(const p of beforeFiles.filter(p=>p.startsWith('receipts/')&&p!=='receipts/engine-maintenance-history.json'))assert.deepEqual(read(root,p),read(out,p),p);
assert.deepEqual(read(out,'maintenance/romjs-shared-engine-release-assembler.mjs'),readFileSync(runner));
// Rejection calls never run edited source and must fail before creating their output.
for(const [label,mutate,pattern]of [
['before',v=>{v.edits[0].before_sha256='0'.repeat(64);},/Before hash mismatch/],
['source',v=>{v.source_inventory_sha256='0'.repeat(64);},/Source inventory authentication failed/],
['edit-source',v=>{v.edits[0].sha256='0'.repeat(64);},/Edited source hash mismatch/],
['abi-major',v=>{v.release=(Number(old.release.split('.')[0])+1)+'.0.0';},/compatible semver/]
]){const v=structuredClone(input);v.output_directory=join(dirname(out),'rejection-'+next.release+'-'+label);assert.ok(!existsSync(v.output_directory));mutate(v);const r=spawnSync(process.execPath,[runner],{input:JSON.stringify(v),encoding:'utf8',timeout:120000,maxBuffer:1048576});assert.ifError(r.error);assert.notEqual(r.status,0,label);assert.match(r.stderr,pattern);assert.ok(!existsSync(v.output_directory),'Rejected input created output');}
// Omit several mandatory files from a virtual source tree and its authenticated inventory.
// Keep original inventory separately to cover stale inventories as well as regenerated ones.
const missingTemp=mkdtempSync(join(tmpdir(),'nes-engine-missing-'));
const migration=json(root,'receipts/shared-engine-migration.json'),historyOriginal=Object.values(migration.changes)[0]?.original;assert.equal(typeof historyOriginal,'string');
const missingPaths=['htdocs/games/netplay/catalog.json','includes/api/classes/netplay-catalog.json','includes/api/classes/NetplayPolicy.php',historyOriginal,...catalog.slice(0,2).map(row=>dirname('htdocs'+row.manifest)+'/netplay-binding.mjs')].sort();
const missingRoot=join(missingTemp,'source');mkdirSync(missingRoot);
for(const p of beforeFiles){if(missingPaths.includes(p))continue;const target=join(missingRoot,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,read(root,p),{flag:'wx'});}
for(const stale of [false,true]){const v=structuredClone(input);v.root=missingRoot;v.output_directory=join(missingTemp,stale?'stale-output':'current-output');
if(!stale){const inv={format:'nes-release-source/1',files:Object.fromEntries(files(missingRoot).map(p=>{const b=read(missingRoot,p);return [p,{bytes:b.length,sha256:hash(b)}];}))},bytes=Buffer.from(JSON.stringify(inv));v.source_inventory=join(missingTemp,'inventory.json');writeFileSync(v.source_inventory,bytes,{flag:'wx'});v.source_inventory_sha256=hash(bytes);}
const result=spawnSync(process.execPath,[runner],{input:JSON.stringify(v),encoding:'utf8',timeout:120000,maxBuffer:1048576});assert.ifError(result.error);assert.notEqual(result.status,0);assert.match(result.stderr,/Missing mandatory source dependencies:/);const reported=JSON.parse(result.stderr.trim().split('Missing mandatory source dependencies: ')[1]);for(const p of missingPaths)assert.ok(reported.includes(p),'Missing collective diagnostic: '+p);for(const row of catalog){const p=dirname('htdocs'+row.manifest)+'/network-package.json';if(!existsSync(join(root,p)))assert.ok(!reported.includes(p),'Optional absence reported as mandatory');}assert.ok(!existsSync(v.output_directory),'Preflight failure created output');}
if(process.argv[4]!=='--single'){
const temp=mkdtempSync(join(tmpdir(),'nes-engine-successor-')),e=input.edits.find(e=>e.path.includes('/common/'));assert.ok(e);
const currentURL='/games/engines/nes/'+input.release+'/common/'+e.sha256+'.mjs',bytes=read(out,'htdocs'+currentURL),text=bytes.toString();
const parserBytes=readFileSync(input.acorn_module);assert.equal(hash(parserBytes),input.acorn_sha256);const parser=await import('data:text/javascript;base64,'+parserBytes.toString('base64'));
const tree=parser.parse(text,{ecmaVersion:'latest',sourceType:'module'}),fn=tree.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='instantiate').declaration;
const edited=Buffer.from(text.slice(0,fn.body.start+1)+'/* successor neutral probe */'+text.slice(fn.body.start+1)),editFile=join(temp,'factory.mjs');writeFileSync(editFile,edited,{flag:'wx'});
const inventory={format:'nes-release-source/1',files:Object.fromEntries(files(out).map(p=>{const b=read(out,p);return [p,{bytes:b.length,sha256:hash(b)}];}))},inventoryBytes=Buffer.from(JSON.stringify(inventory)),inventoryFile=join(temp,'inventory.json');writeFileSync(inventoryFile,inventoryBytes,{flag:'wx'});
const version=input.release.split('.').map(Number);version[2]++;assert.ok(Number.isSafeInteger(version[2]));
const second={...input,root:out,output_directory:join(temp,'site'),source_inventory:inventoryFile,source_inventory_sha256:hash(inventoryBytes),release:version.join('.'),shell_edits:[],shell_additions:[],support_edits:[],support_additions:[],edits:[{path:currentURL,before_sha256:hash(bytes),file:editFile,sha256:hash(edited)}]},secondInput=join(temp,'input.json');writeFileSync(secondInput,JSON.stringify(second),{flag:'wx'});
const shipped=join(out,'maintenance/romjs-shared-engine-release-assembler.mjs');
const assembled=spawnSync(process.execPath,[shipped],{input:JSON.stringify(second),encoding:'utf8',maxBuffer:1048576});assert.ifError(assembled.error);assert.equal(assembled.status,0,assembled.stderr);
const checked=spawnSync(process.execPath,[join(second.output_directory,'tests/engine-release-'+second.release+'.mjs'),shipped,secondInput,'--single'],{encoding:'utf8',maxBuffer:1048576});assert.ifError(checked.error);assert.equal(checked.status,0,checked.stderr);
console.error('Successive release regression fixtures: '+temp);
}
console.log(JSON.stringify({passed:['successor and prior migration history','current audit and runtime source pins','neutral factory source identity and loaded function body','engine and composed artifact identity','actual engine/composition import and step','all cartridge bytes','historical release bytes','package closures and current catalog equality','optional legacy presence preservation and binding refresh','collective mandatory dependency rejection','before/source/edited-source hash rejection','incompatible release and cartridge ABI rejection'],affected,loadedEdits,legacyPresent,legacyAbsent}));
`;
try{let raw='',size=0;for await(const b of process.stdin){size+=b.length;ok(size<=1048576,'Input exceeds 1 MiB');raw+=b.toString('utf8');}const input=JSON.parse(raw);process.stdout.write(JSON.stringify(await main(input))+'\n');}catch(e){process.stderr.write((e?.message||String(e))+'\n');process.exitCode=1;}
