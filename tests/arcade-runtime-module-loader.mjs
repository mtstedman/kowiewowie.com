// Exact-source test ESM loader. VM isolation is not a security boundary.
import vm from 'node:vm';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export function exactModuleSource(sourceRoot,filename,pins){
 const root=resolve(sourceRoot),file=resolve(filename),key=relative(root,file).split(sep).join('/');
 assert.equal(realpathSync(root),root,'Canonical source root required');
 assert(key&&!key.startsWith('../')&&!isAbsolute(key),'Module escapes source root');
 assert(/^[A-Za-z0-9_./-]+\.mjs$/.test(key),'Only plain .mjs paths are supported');
 assert(!key.split('/').some(x=>x==='.'||x==='..'||!x),'Noncanonical module path');
 assert(Object.hasOwn(pins,key),'Unpinned module: '+key);
 let current=root;
 for(const part of key.split('/')){current=resolve(current,part);assert(!lstatSync(current).isSymbolicLink(),'Symlink module path: '+key);}
 assert(lstatSync(file).isFile(),'Module must be a regular file');
 const pin=pins[key];assert(Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&pin.bytes<=524288,'Module size limit');
 assert(/^[a-f0-9]{64}$/.test(pin.sha256),'Invalid module digest');
 assert.equal(lstatSync(file).size,pin.bytes,'Module byte count: '+key);
 const bytes=readFileSync(file);assert.equal(bytes.length,pin.bytes,'Module byte count: '+key);
 const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,pin.sha256,'Module SHA256 mismatch: '+key);
 return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),record:{path:key,bytes:bytes.length,sha256}};
}
export async function loadExactModule(entry,{context,sourceRoot,pins}){
 assert.equal(typeof vm.SourceTextModule,'function','Run Node >=24.9 with --experimental-vm-modules');
 assert(vm.isContext(context),'A distinct test VM context is required');
 const modules=new Map(),records=[],root=resolve(sourceRoot);let total=0;
 function get(file){
  file=resolve(file);if(modules.has(file))return modules.get(file);
  assert(modules.size<64,'Module graph limit');
  const {text,record}=exactModuleSource(root,file,pins);total+=record.bytes;assert(total<=4194304,'Module graph byte limit');
  const mod=new vm.SourceTextModule(text,{context,identifier:pathToFileURL(file).href,
   initializeImportMeta(meta,m){meta.url=m.identifier;},
   importModuleDynamically(){throw Error('Dynamic imports are disabled in lifecycle tests');}
  });
  modules.set(file,mod);records.push(record);return mod;
 }
 const main=get(entry);
 await main.link((specifier,parent,extra)=>{
  assert(!Object.keys(extra?.attributes||extra?.assert||{}).length,'Import attributes are unsupported');
  assert(/^(?:\.\/|\.\.\/)[A-Za-z0-9_./-]+\.mjs$/.test(specifier),'Only pinned relative module imports are allowed');
  return get(resolve(dirname(fileURLToPath(parent.identifier)),specifier));
 });
 for(const mod of modules.values()){
  assert.equal(typeof mod.hasTopLevelAwait,'function','Node >=24.9 required');
  assert(!mod.hasTopLevelAwait(),'Top-level await is unsupported; exported lifecycle methods may be async');
 }
 await main.evaluate({timeout:2000});
 return {namespace:main.namespace,namespaces:[...modules.values()].map(m=>m.namespace),records};
}
