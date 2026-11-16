import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildCartridge} from '../maintenance/romjs-cartridge-build.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:hash(b)});
const site=resolve(process.env.NES_FIX_ROOT||new URL('../',import.meta.url).pathname),temp=mkdtempSync(join(tmpdir(),'nes-cartridge-build-'));
const {sharedEngineHistoricalRead}=await import(pathToFileURL(join(site,'tests/shared-engine-history.mjs')));
const historical=sharedEngineHistoricalRead(),id='castlevania',base='htdocs/games/'+id+'/engine/';
const source=join(temp,'compiler');mkdirSync(source);
const files={};for(const name of ['compiled.mjs','cartridge.mjs',...Array.from({length:8},(_,i)=>'bank-'+i+'.mjs'),'bank-fixed.mjs']){
 const bytes=historical(base+name);writeFileSync(join(source,name),bytes);files[name]=pin(bytes);
}
const manifest=Buffer.from(JSON.stringify({files}));writeFileSync(join(source,'manifest.json'),manifest);
const registry=readFileSync(join(site,'htdocs/games/engines/nes/registry.json'));
const req=JSON.parse(readFileSync(join(site,'htdocs/games/'+id+'/cartridge/cartridge-manifest.json'))).requirements;
const input={source_root:source,source_manifest:'manifest.json',source_manifest_sha256:hash(manifest),site_root:site,registry_sha256:hash(registry),requirements:req,id:'imported-cartridge',output_directory:join(temp,'cartridge')};
test('fresh compiler output becomes an engine-independent cartridge using exact registered ABI',async()=>{
 const report=buildCartridge(input);assert.equal(report.qualification.browser,false);const data=await import(pathToFileURL(join(input.output_directory,'entry.mjs')));
 const engine=await import(pathToFileURL(join(site,'htdocs'+report.selected_engine.entry.path)));
 const original=await import(pathToFileURL(join(site,'htdocs/games/castlevania/composition-entry.mjs')));
 const a=original.createMachine(),b=engine.createMachine(data);
 for(let i=0;i<120;i++){for(const m of [a,b]){m.setButton(1,3,i>=10&&i<16);m.frame({maxMs:60000});}assert.deepEqual(b.getState(),a.getState());assert.deepEqual(b.takeAudio(),a.takeAudio());assert.deepEqual(b.getRGBA(),a.getRGBA());}
 for(const name of Object.keys(files).filter(x=>x.startsWith('bank-')))assert.deepEqual(readFileSync(join(input.output_directory,name)),readFileSync(join(source,name)));
 assert(!readdirSync(input.output_directory).some(x=>['runtime.mjs','machine.mjs','devices.mjs'].includes(x)));
 assert(!readFileSync(join(input.output_directory,'entry.mjs'),'utf8').includes('engines/'));
});
test('cartridge builder rejects changed source and registry pins, conflicting requirements and unregistered mapper/ABI',()=>{
 for(const [label,patch] of [
  ['source',{source_manifest_sha256:'0'.repeat(64)}],['registry',{registry_sha256:'0'.repeat(64)}],
  ['mapper',{requirements:{...req,mapper:5}}],['abi',{requirements:{...req,abi:'unqualified/1'}}]
 ]){const output_directory=join(temp,label);assert.throws(()=>buildCartridge({...input,...patch,output_directory}));assert(!existsSync(output_directory));}
 assert.throws(()=>buildCartridge({...input,output_directory:join(source,'nested')}),/disjoint/);
});
