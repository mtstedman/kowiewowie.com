// Upgrade authenticated private-owned engines without changing cartridge data.
// This emits an inactive candidate. Hardware/browser/performance qualification
// and publication remain separate gates; it never selects an engine for a game.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {stageRenderer} from './nes-staged-ppu-transform.mjs';
import {stageMMC5} from './nes-staged-mmc5-transform.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),ensure=(v,m)=>{if(!v)throw Error(m);};
function inventory(root,prefix=''){
 const out=[];for(const d of fs.readdirSync(path.join(root,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+d.name:d.name;ensure(!d.isSymbolicLink()&&!name.includes('\\'),'Unsafe member');
  if(d.isDirectory())out.push(...inventory(root,name));else{ensure(d.isFile(),'Nonregular member');out.push(name);}
 }return out.sort();
}
export function buildStagedEngine(input){
 ensure(input&&Object.keys(input).every(k=>['input_root','manifest_sha256','output_root','clang'].includes(k)),'Input fields');
 ensure(typeof input.input_root==='string'&&typeof input.output_root==='string'&&/^[a-f0-9]{64}$/.test(input.manifest_sha256),'Input contract');
 const root=fs.realpathSync(input.input_root),out=path.resolve(input.output_root);
 ensure(!fs.existsSync(out),'Fresh output required');
 const parent=fs.realpathSync(path.dirname(out));ensure(parent!==root&&!parent.startsWith(root+path.sep),'Output inside source');
 const raw=fs.readFileSync(path.join(root,'manifest.json'));ensure(sha(raw)===input.manifest_sha256,'Manifest authentication');
 const manifest=JSON.parse(raw),names=inventory(root);
 ensure(manifest.files&&JSON.stringify(names)===JSON.stringify([...Object.keys(manifest.files),'manifest.json'].sort()),'Exact input inventory required');
 let total=0;for(const [name,pin]of Object.entries(manifest.files)){
  ensure(!path.isAbsolute(name)&&!name.split('/').some(x=>!x||x==='.'||x==='..'),'Unsafe manifest member');
  const bytes=fs.readFileSync(path.join(root,name));total+=bytes.length;ensure(total<=1024**3&&bytes.length<=64*1024**2,'Input size');
  ensure(bytes.length===pin.bytes&&sha(bytes)===pin.sha256,'Member authentication: '+name);
 }
 ensure([0,1,2,4,5].includes(manifest.mapper),'Unsupported mapper');
 const runtime=fs.readFileSync(path.join(root,'runtime.mjs'),'utf8'),candidate=stageRenderer(runtime);
 // The transform checks the admitted private-owned construction. Public/custom
 // renderer implementations keep their original checked boundary contract.
 fs.cpSync(root,out,{recursive:true});fs.writeFileSync(path.join(out,'runtime.mjs'),candidate);
 const test=path.join(out,'shared-ppu-owned-tests.mjs');let source=fs.readFileSync(test,'utf8');
 source=source.replace('function snapshot(){const fields={};','function snapshot(){p.sharedPPUBoundary?.();const fields={};').replace('assert.deepEqual([b.p.scanline','b.p.sharedPPUBoundary?.();assert.deepEqual([b.p.scanline');fs.writeFileSync(test,source);
 const compilation=manifest.mapper===5?stageMMC5(out,input.clang??'clang'):null;
 const compilerFile=path.join(out,'compiler-manifest.json'),compiler=JSON.parse(fs.readFileSync(compilerFile));
 compiler.shared_ppu={...compiler.shared_ppu,bridge:'staged-private-state/1',mapper_bridge:[4,5].includes(manifest.mapper)?'invalidate-on-mutation/1':'cached-mapping/1',validation:'not-executed',source_manifest_sha256:input.manifest_sha256};
 if(compilation)compiler.shared_ppu_compiler={...compilation,kernel_sha256:sha(fs.readFileSync(path.join(out,'shared-pixel.c'))),runtime_sha256:sha(fs.readFileSync(path.join(out,'shared-pixel-runtime.mjs')))};
 compiler.staged_runtime_sha256=sha(fs.readFileSync(path.join(out,'runtime.mjs')));manifest.shared_ppu=compiler.shared_ppu;manifest.active=false;manifest.status='inactive-staged-engine-candidate';
 if(compiler.files)for(const name of Object.keys(compiler.files)){if(name==='compiler-manifest.json')continue;const b=fs.readFileSync(path.join(out,name));compiler.files[name]={bytes:b.length,sha256:sha(b)};}
 fs.writeFileSync(compilerFile,JSON.stringify(compiler,null,2)+'\n');if(manifest.compiler_manifest_sha256)manifest.compiler_manifest_sha256=sha(fs.readFileSync(compilerFile));
 for(const [name,pin]of Object.entries(manifest.files)){const bytes=fs.readFileSync(path.join(out,name));pin.bytes=bytes.length;pin.sha256=sha(bytes);}
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {status:'built-unqualified',output_root:out,mapper:manifest.mapper,manifest_sha256:sha(fs.readFileSync(path.join(out,'manifest.json'))),source_manifest_sha256:input.manifest_sha256,bridge:'staged-private-state/1',activated:false,deployed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(buildStagedEngine(JSON.parse(fs.readFileSync(0,'utf8')))));}catch(error){console.error(error.message);process.exitCode=1;}
}
