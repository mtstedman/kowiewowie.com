// Cache-bust stylesheets in a release tree: every same-origin stylesheet reference in an
// .html page gets ?v=<content hash>, so a changed file is a new URL and an unchanged one
// keeps its cache. Runs on the release copy only; the repository keeps whatever ?v= it has.
// Usage: node deploy/stamp-assets.mjs <release htdocs dir>
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const htdocs=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.statSync(htdocs).isDirectory())throw Error('Usage: stamp-assets.mjs <htdocs dir>');
const hashes=new Map();
function version(url){
 if(!hashes.has(url)){
  const file=path.resolve(htdocs,'.'+url);
  if(!file.startsWith(htdocs+path.sep)||!fs.existsSync(file)){hashes.set(url,null);}
  else hashes.set(url,createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12));
 }
 return hashes.get(url);
}
function* pages(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())yield* pages(full);else if(entry.isFile()&&entry.name.endsWith('.html'))yield full;
 }
}
let pagesChanged=0,missing=new Set();
for(const page of pages(htdocs)){
 const before=fs.readFileSync(page,'utf8');
 const after=before.replace(/(<link\b[^>]*\bhref=")(\/[^"?#]+\.css)(?:\?[^"#]*)?(")/g,(match,open,url,close)=>{
  const v=version(url);if(!v){missing.add(url);return match;}
  return open+url+'?v='+v+close;
 });
 if(after!==before){fs.writeFileSync(page,after);pagesChanged++;}
}
if(missing.size)throw Error('Stylesheet referenced but missing from release: '+[...missing].join(', '));
console.log(`Stamped stylesheet versions in ${pagesChanged} page(s): `+[...hashes].map(([u,v])=>u+'?v='+v).join(', '));
