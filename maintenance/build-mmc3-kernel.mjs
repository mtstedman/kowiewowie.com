import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {source,compilerArgs} from './engines/mmc3/kernel-source.mjs';

// Compile into a fresh external directory. Promotion still uses the authenticated
// shared-engine release assembler; this command never changes a live engine.
export function buildMMC3Kernel(directory,clang='clang'){
 const out=path.resolve(directory);
 if(fs.existsSync(out))throw Error('Fresh output directory required');
 fs.mkdirSync(out);
 const input=path.join(out,'kernel.c'),output=path.join(out,'kernel.wasm');
 fs.writeFileSync(input,source);
 const result=spawnSync(clang,[...compilerArgs,input,'-o',output],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||'Compiler failed');
 const bytes=fs.readFileSync(output);
 new WebAssembly.Module(bytes);
 const module=`const bytes=Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0));\nexport const compiledModule=typeof WebAssembly==='object'?new WebAssembly.Module(bytes):null;\n`;
 fs.writeFileSync(path.join(out,'owned-ppu-binary.mjs'),module);
 const receipt={source_sha256:createHash('sha256').update(source).digest('hex'),wasm_sha256:createHash('sha256').update(bytes).digest('hex'),compiler:spawnSync(clang,['--version'],{encoding:'utf8'}).stdout,compilerArgs};
 fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: node maintenance/build-mmc3-kernel.mjs <fresh-external-directory>');
 console.log(JSON.stringify(buildMMC3Kernel(process.argv[2])));
}
