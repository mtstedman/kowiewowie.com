// Build engine-independent cartridges from authenticated compiler output.
// No compiled code is evaluated, no registry is changed, and no site is deployed.
import {readFileSync,lstatSync,readdirSync,mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,compiledDescriptor,verifyInertBank,declaredJSON} from './lib/cartridge-construction.mjs';
const insist=(ok,m)=>{if(!ok)throw Error(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function key(p){insist(typeof p==='string'&&p.length<1024&&!isAbsolute(p)&&/^[A-Za-z0-9_./-]+$/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'),'Canonical relative path required');return p;}
function file(root,p){key(p);let here=root;for(const s of p.split('/')){here=join(here,s);insist(!lstatSync(here).isSymbolicLink(),'Symlink input');}const stat=lstatSync(here);insist(stat.isFile()&&stat.size<=67108864,'Bounded regular file required');const b=readFileSync(here);insist(b.length===stat.size,'Changed input');return b;}
function root(p){const r=resolve(p);insist(realpathSync(r)===r&&lstatSync(r).isDirectory(),'Canonical directory required');return r;}
function inside(a,b){const p=relative(a,b);return p===''||!isAbsolute(p)&&p!=='..'&&!p.startsWith('../');}
export function buildCartridge(input){
 const allowed=['source_root','source_manifest','source_manifest_sha256','site_root','registry_sha256','requirements','id','output_directory'];
 insist(input&&Object.keys(input).length===allowed.length&&allowed.every(k=>Object.hasOwn(input,k)),'Exact cartridge build fields required');
 insist(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)&&input.id.length<=64,'Cartridge id');
 const source=root(input.source_root),site=root(input.site_root),out=resolve(input.output_directory);
 insist(!existsSync(out)&&!inside(source,out)&&!inside(site,out)&&!inside(out,source)&&!inside(out,site),'Fresh disjoint output required');root(dirname(out));
 const raw=file(source,input.source_manifest);insist(hex(input.source_manifest_sha256)&&hash(raw)===input.source_manifest_sha256,'Compiler manifest hash');
 const manifest=JSON.parse(raw);insist(manifest.files&&Object.keys(manifest.files).length<=1024,'Compiler inventory');let total=0;
 const read=p=>{const b=file(source,p),r=manifest.files[p];insist(r&&canonical(pin(b))===canonical(r),'Compiler member hash: '+p);return b;};
 for(const p of Object.keys(manifest.files)){total+=read(p).length;insist(total<=268435456,'Compiler package limit');}
 const d=compiledDescriptor(read('compiled.mjs').toString()),req=input.requirements;
 insist(req&&Object.keys(req).length===6&&['abi','mapper','board','battery','compiler','region'].every(k=>Object.hasOwn(req,k)),'Explicit execution requirements required');
 insist(req.mapper===d.info.mapper&&req.board===d.info.board&&req.battery===Boolean(d.info.battery)&&req.compiler===d.info.runtimeRevision&&req.region===d.info.region,'Compiler/engine requirements disagree');
 const registryRaw=file(site,'htdocs/games/engines/nes/registry.json');insist(hex(input.registry_sha256)&&hash(registryRaw)===input.registry_sha256,'Registry hash');
 const registry=JSON.parse(registryRaw);insist(registry.format==='nes-engine-registry/1','Registry format');
 const selected=registry.selections[canonical(req)];insist(selected,'UNSUPPORTED_ENGINE_ABI: no qualified exact execution/mapper/board selection');
 const engineRead=(path,expected)=>{insist(typeof path==='string'&&path.startsWith('/games/engines/nes/'),'Engine path');const b=file(site,'htdocs'+path);insist(canonical(pin(b))===canonical({bytes:expected.bytes,sha256:expected.sha256}),'Engine member hash');return b;};
 const em=JSON.parse(engineRead(selected.manifest.path,selected.manifest));
 insist(em.format==='nes-engine/1'&&em.abi===req.abi&&em.capabilities.execution===req.abi&&['mapper','compiler','region'].every(k=>em.capabilities[k]===req[k]),'Engine contract mismatch');
 engineRead(selected.entry.path,selected.entry);for(const [p,v] of Object.entries(em.files))engineRead(p,v);
 const files=new Map(),put=(name,b)=>{key(name);insist(!files.has(name),'Duplicate output');files.set(name,Buffer.from(b));};
 for(const bank of d.bankImports){const name=bank.source.slice(2),b=read(name);verifyInertBank(b.toString(),name);put(name,b);}
 const data=read('cartridge.mjs').toString();
 const parts={};for(const [name,field] of [['prgHex','prgSha256'],['chrHex','chrSha256'],['trainerHex','trainerSha256']]){
  const value=declaredJSON(data,name);insist(typeof value==='string'&&/^(?:[a-fA-F0-9]{2})*$/.test(value),'ROM bytes');insist(hash(Buffer.from(value,'hex'))===d.info[field],'ROM component identity');parts[name]=value;
 }
 // Emit only data declarations, never carry extra code from cartridge.mjs.
 put('cartridge.mjs',Object.entries(parts).map(([k,v])=>'export const '+k+'='+JSON.stringify(v)+';').join('\n')+'\n');
 put('data.mjs',d.bankImports.map(b=>'import '+b.name+' from '+JSON.stringify(b.source)+';').join('\n')+'\nimport {prgHex,chrHex,trainerHex} from "./cartridge.mjs";\nfunction freeze(v){if(v&&typeof v==="object"){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}\nexport const metadata=freeze('+canonical(d.info)+');\nexport const blocks='+d.bankExpression+';\nexport {prgHex,chrHex,trainerHex};\n');
 put('entry.mjs','export * from "./data.mjs";\nexport const requirements=Object.freeze('+canonical(req)+');\n');
 const board={mapper:req.mapper,trainerBytes:parts.trainerHex.length/2,prgBytes:parts.prgHex.length/2,chrBytes:parts.chrHex.length/2,battery:req.battery,romSha256:d.info.romSha256,provenance:'authenticated-compiler-output'};
 put('cartridge-manifest.json',canonical({format:'nes-cartridge/1',id:input.id,requirements:req,metadata:d.info,board})+'\n');
 // This receipt is an import handoff, not a browser/playability qualification.
 const receipt={format:'nes-cartridge-build/1',id:input.id,source:{manifest:input.source_manifest,...pin(raw)},registry:pin(registryRaw),requirements:req,selectedEngine:selected,files:Object.fromEntries([...files].map(([k,b])=>[k,pin(b)])),qualification:{sourceIntegrity:true,bankConstruction:true,browser:false,performance:false,gameplay:false},next:'Compose this cartridge with selectedEngine using the shared shell; require browser/capability evidence before catalog admission.'};
 for(const [p,b] of files){const target=join(out,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b,{flag:'wx'});}
 writeFileSync(join(out,'build-receipt.json'),canonical(receipt)+'\n',{flag:'wx'});
 return {output_directory:out,receipt:join(out,'build-receipt.json'),cartridge:pin(files.get('cartridge-manifest.json')),selected_engine:selected,qualification:receipt.qualification};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{let raw='';for await(const b of process.stdin){raw+=b;insist(Buffer.byteLength(raw)<=1048576,'Input limit');}console.log(JSON.stringify(buildCartridge(JSON.parse(raw))));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
