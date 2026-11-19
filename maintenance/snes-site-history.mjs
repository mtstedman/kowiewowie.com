// Record an additive site release without rewriting any prior maintenance receipt.
// Run after the complete reviewed working tree is ready, before the release gate.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const wrapper='tests/shared-engine-history.mjs';
const previousWrapper=git('show','HEAD:'+wrapper).toString();
const match=/export const maintenanceHead=(\{[^\n]+\});/.exec(previousWrapper);
if(!match)throw Error('Current committed history wrapper is not recognized');
const previous=JSON.parse(match[1]);
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const originals='maintenance/snes-site-originals/'+stamp;
const receiptPath='receipts/snes-site-history-'+stamp+'.json';
const changed=git('diff','HEAD','--name-only','-z').toString().split('\0').filter(Boolean);
const added=git('ls-files','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean);
// Markup, styling, artwork and prose change freely and are never recorded or re-verified.
const skip=p=>p===wrapper||p.startsWith('maintenance/snes-site-originals/')||/^receipts\/snes-site-history-/.test(p)||/^htdocs\/.*(?:\.(?:css|html|png|md|txt)|\.d\.mts)$/.test(p);
const changes={},newFiles={};
for(const name of changed.filter(p=>!skip(p))){
 const file=path.join(root,name);if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Deletion/non-file requires separate reviewed history handling: '+name);
 const before=git('show','HEAD:'+name),after=fs.readFileSync(file);if(before.equals(after))continue;
 const original=originals+'/'+name,dest=path.join(root,original);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,before,{flag:'wx'});
 changes[name]={before:pin(before),after:pin(after),original};
}
for(const name of added.filter(p=>!skip(p))){const f=path.join(root,name);if(fs.lstatSync(f).isSymbolicLink()||!fs.statSync(f).isFile())throw Error('Added file must be regular: '+name);newFiles[name]=pin(fs.readFileSync(f));}
if(!Object.keys(changes).length&&!Object.keys(newFiles).length)throw Error('Expected reviewed changes or additions');
const receipt={format:'nes-engine-maintenance-history/1',reason:process.argv[2]||'Add Posse SNES packages and shared twelve-button input while preserving immutable prior release records.',previous,changes,added:newFiles};
const raw=Buffer.from(JSON.stringify(receipt,null,2)+'\n');fs.writeFileSync(path.join(root,receiptPath),raw,{flag:'wx'});
const head={path:receiptPath,...pin(raw)};fs.writeFileSync(path.join(root,wrapper),fs.readFileSync(path.join(root,wrapper),'utf8').replace(/export const maintenanceHead=\{[^\n]+\};/,()=>'export const maintenanceHead='+JSON.stringify(head)+';'));
console.log(JSON.stringify({head,changed:Object.keys(changes).length,added:Object.keys(newFiles).length,previous}));
