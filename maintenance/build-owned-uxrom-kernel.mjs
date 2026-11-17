import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {source,compilerArgs} from './engines/owned-uxrom/kernel-source.mjs';

// Produce a candidate in a fresh directory. The release assembler owns promotion.
export function buildOwnedUxromKernel(directory,clang='clang-18'){
 const out=path.resolve(directory);
 if(fs.existsSync(out))throw Error('Fresh output directory required');
 fs.mkdirSync(out);
 const input=path.join(out,'owned-ppu.c'),output=path.join(out,'owned-ppu.wasm');
 fs.writeFileSync(input,source);
 const result=spawnSync(clang,[...compilerArgs,input,'-o',output],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||'Compiler failed');
 const bytes=fs.readFileSync(output);
 new WebAssembly.Module(bytes);
 const template=fs.readFileSync(new URL('./engines/owned-uxrom/binary-factory.mjs',import.meta.url),'utf8');
 const literal=/Uint8Array\.from\(\[[\d,]+\]\)/g;
 if([...template.matchAll(literal)].length!==1)throw Error('Expected one embedded Wasm binary');
 fs.writeFileSync(path.join(out,'binary-factory.mjs'),template.replace(literal,()=>`Uint8Array.from([${bytes.join(',')}])`));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const receipt={source_sha256:hash(source),wasm_sha256:hash(bytes),compiler:spawnSync(clang,['--version'],{encoding:'utf8'}).stdout,compilerArgs};
 fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(receipt,null,2)+'\n');
 return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: node maintenance/build-owned-uxrom-kernel.mjs <fresh-external-directory>');
 console.log(JSON.stringify(buildOwnedUxromKernel(process.argv[2])));
}
