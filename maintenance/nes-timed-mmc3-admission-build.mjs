// Create a pinned, inactive admission bundle from authenticated translated output.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,compiledDescriptor,verifyInertBank,declaredJSON} from './lib/cartridge-construction.mjs';
import {extractFactory,COMPILED_BRIDGE} from './lib/engine-extraction.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:Buffer.byteLength(b),sha256:hash(b)}),ok=(v,m)=>{if(!v)throw Error(m);};
export function build(input){
 const {source_root:source,source_manifest:manifestName,source_manifest_sha256:manifestSHA,site_root:site,output_directory:out,release,id,title,publisher,year,image,evidence}=input;
 ok(!existsSync(out),'Fresh output required');ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),'Cartridge id');ok(/^\d+\.\d+\.\d+$/.test(release),'Release');
 const read=p=>readFileSync(resolve(site,p)),raw=readFileSync(resolve(source,manifestName));ok(hash(raw)===manifestSHA,'Compiler manifest authentication');const manifest=JSON.parse(raw);
 function member(p){ok(/^[A-Za-z0-9_.-]+$/.test(p),'Source member');const b=readFileSync(resolve(source,p));ok(canonical(pin(b))===canonical(manifest.files[p]),'Compiler member authentication: '+p);return b;}
 const descriptor=compiledDescriptor(member('compiled.mjs').toString()),metadata=descriptor.info;
 ok(evidence?.nativePlayers===2&&evidence?.mode==='simultaneous','Explicit independent controller evidence required');
 ok(metadata.mapper===4&&metadata.board==='standard-txrom'&&!metadata.battery&&metadata.mmc3.prg_ram==='none','Only qualified timed MMC3 non-battery profile');
 const abi='timed-mmc3/1',requirements={abi,battery:false,board:metadata.board,compiler:metadata.runtimeRevision,mapper:4,region:'ntsc'},base='/games/'+id+'/',engineBase='/games/engines/nes/'+release+'/',files=new Map();
 function put(p,b){ok(!files.has(p),'Duplicate admission member');files.set(p,Buffer.from(b));return pin(files.get(p));}const json=(p,v)=>put(p,canonical(v)+'\n');
 const cart=base+'cartridge/';
 for(const bank of descriptor.bankImports){const name=bank.source.slice(2),b=member(name);verifyInertBank(b.toString(),name);put(cart+name,b);}
 const data=member('cartridge.mjs').toString(),parts={};for(const [name,field]of [['prgHex','prgSha256'],['chrHex','chrSha256'],['trainerHex','trainerSha256']]){parts[name]=declaredJSON(data,name);ok(hash(Buffer.from(parts[name],'hex'))===metadata[field],'ROM component hash');}
 put(cart+'cartridge.mjs',Object.entries(parts).map(([k,v])=>'export const '+k+'='+JSON.stringify(v)+';').join('\n')+'\n');
 put(cart+'data.mjs',descriptor.bankImports.map(b=>'import '+b.name+' from '+JSON.stringify(b.source)+';').join('\n')+'\nimport {prgHex,chrHex,trainerHex} from "./cartridge.mjs";\nfunction freeze(v){if(v&&typeof v==="object"){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}\nexport const metadata=freeze('+canonical(metadata)+');\nexport const blocks='+descriptor.bankExpression+';\nexport {prgHex,chrHex,trainerHex};\n');
 put(cart+'entry.mjs','export * from "./data.mjs";\nexport const requirements=Object.freeze('+canonical(requirements)+');\n');
 const board={mapper:4,trainerBytes:parts.trainerHex.length/2,prgBytes:parts.prgHex.length/2,chrBytes:parts.chrHex.length/2,battery:false,romSha256:metadata.romSha256,provenance:'authenticated-compiler-output'};
 const cartridge={format:'nes-cartridge/1',id,requirements,metadata,board};json(cart+'cartridge-manifest.json',cartridge);
 const nodes=[],visited=new Set(),factoryPins={};
 function factory(code){const digest=hash(code),url=engineBase+'common/'+digest+'.mjs';if(!files.has(url))factoryPins[url]=put(url,code);return digest;}
 const registry=JSON.parse(read('htdocs/games/engines/nes/registry.json'));
 const engines=['mmc3-dot/1','timed-mmc1/1'].map(abi=>{const choice=Object.entries(registry.selections).find(([k])=>JSON.parse(k).abi===abi)?.[1];ok(choice,'Qualified source engine required');const raw=read('htdocs'+choice.manifest.path);ok(canonical(pin(raw))===canonical({bytes:choice.manifest.bytes,sha256:choice.manifest.sha256}),'Source engine authentication');return JSON.parse(raw);});
 function visit(name){if(visited.has(name))return;visited.add(name);let code,deps;
  if(name==='compiled.mjs'){code=COMPILED_BRIDGE;deps=['runtime.mjs','$data'];}
  else if(name==='machine.mjs'){code=readFileSync(new URL('./engines/timed-mmc3/machine-factory.mjs',import.meta.url),'utf8');deps=['runtime.mjs','ppu-mmc3.mjs','compiled.mjs','devices.mjs'];}
  else if(name==='runtime.mjs'){code=readFileSync(new URL('./engines/timed-mmc3/runtime-factory.mjs',import.meta.url),'utf8');deps=['hardware-cpu.mjs'];}
  else if(name==='hardware-cpu.mjs'){code=readFileSync(new URL('./engines/timed-mmc3/hardware-cpu-factory.mjs',import.meta.url),'utf8');deps=['hardware-factories.mjs','hardware-config.mjs'];}
  else {const em=engines.find(e=>e.graph.nodes.some(n=>n.key===name));ok(em,'Shared engine component: '+name);const node=em.graph.nodes.find(n=>n.key===name),url=Object.keys(em.files).find(p=>p.endsWith('/'+node.factory+'.mjs'));const raw=read('htdocs'+url);ok(canonical(pin(raw))===canonical(em.files[url]),'Shared factory authentication');code=raw.toString();deps=node.dependencies;}
  nodes.push({key:name,factory:factory(code),dependencies:deps});for(const dep of deps)if(dep!=='$data')visit(dep);
 }
 visit('machine.mjs');const graph={entry:'machine.mjs',nodes:nodes.sort((a,b)=>a.key.localeCompare(b.key))};
 const em={format:'nes-engine/1',abi,capabilities:{mapper:4,region:'ntsc',execution:abi,compiler:metadata.runtimeRevision},graph,files:factoryPins},digest=hash(canonical(em)),engineDir=engineBase+abi.replace('/','-')+'/'+digest+'/',engineManifest=engineDir+'engine-manifest.json',engineEntry=engineDir+'entry.mjs';
 const unique=[...new Set(nodes.map(n=>n.factory))].sort();
 put(engineEntry,unique.map((d,i)=>'import {instantiate as F'+i+'} from "../../common/'+d+'.mjs";').join('\n')+'\nimport {admit,createMachine as instantiateMachine} from "../../composer.mjs";\nconst graph='+canonical(graph)+';\nconst factories=Object.freeze({'+unique.map((d,i)=>JSON.stringify(d)+':F'+i).join(',')+'});\nconst abi='+JSON.stringify(abi)+';\nexport function createMachine(cartridge,options={}){if(JSON.stringify(cartridge.requirements)!==JSON.stringify('+canonical(requirements)+')||cartridge.metadata?.mapper!==4||cartridge.metadata?.board!=="standard-txrom"||JSON.stringify(cartridge.metadata?.mmc3)!==JSON.stringify('+canonical(metadata.mmc3)+'))throw Error("UNSUPPORTED_ENGINE_ABI");return instantiateMachine(admit(cartridge,graph,abi),options,factories,abi);}\n');
 em.files[engineEntry]=pin(files.get(engineEntry));json(engineManifest,em);
 put(base+'composition-entry.mjs','import * as cartridge from "./cartridge/entry.mjs";\nimport {createMachine as compose} from '+JSON.stringify(posix.relative(base,engineEntry))+';\nexport const metadata=cartridge.metadata;\nexport const createMachine=(options={})=>compose(cartridge,options);\n');
 // Shell stubs are identical for every NES cartridge and contain no game logic.
 for(const name of ['host-entry.mjs','host-runtime.mjs','worker.mjs','gamepad.mjs','touch-dpad.mjs','netplay-binding.mjs','netplay-nes-adapter.mjs','LICENSE-JSNES.txt','NOTICE.txt'])put(base+name,read('htdocs/games/contra/'+name));
 put(base+'index.html',read('htdocs/games/arcade/index.html'));
 put(base+'gameplay.png',readFileSync(image));json(base+'capability-evidence.json',evidence);
 put(base+'USAGE.md',title+'\n\nLoad this cartridge in the NES arcade. Enter starts; arrows move; Z and X send A and B. Saves capture the full machine on this browser. Select two-player mode in the game menu; invite a friend as Player 2 or to watch.\n');
 const template=JSON.parse(read('htdocs/games/contra/game-package.json')).manifest;
 const capabilities={nativePlayers:2,mode:'simultaneous',verified:true,play:'host-p1-guest-p2',watch:true,evidence:'ROM-bound play verification; evidence SHA-256 '+hash(files.get(base+'capability-evidence.json'))};
 const packageManifest={...template,id,title,publisher,year,route:base,entry:base+'host-entry.mjs',image:base+'gameplay.png',notes:{usage:base+'USAGE.md',attribution:base+'NOTICE.txt'},capabilities,files:{}};
 const network=JSON.parse(read('htdocs/games/netplay/catalog.json')).packages.contra;
 const binding={...network,packageId:id,route:base,entryAdapter:base+'netplay-nes-adapter.mjs'};delete binding.artifactDigest;
 const admission={format:'nes-engine-admission/1',release,requirements,engineManifest,engineEntry,packageManifest,binding,cartridge,source:{manifest:manifestName,...pin(raw)},files:Object.fromEntries([...files].map(([p,b])=>[p,pin(b)]))};
 for(const [p,b]of files){const target=resolve(out,'htdocs'+p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b,{flag:'wx'});}writeFileSync(resolve(out,'admission.json'),canonical(admission)+'\n',{flag:'wx'});
 return {output_directory:out,admission:pin(readFileSync(resolve(out,'admission.json')))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){let raw='';for await(const b of process.stdin)raw+=b;console.log(JSON.stringify(build(JSON.parse(raw))));}
