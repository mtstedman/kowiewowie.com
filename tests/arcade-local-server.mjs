// Local verification server using the checked-in production CSP/isolation maps.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {snesBrowserCSP} from './snes-browser-policy.mjs';
const root=fileURLToPath(new URL('../htdocs/',import.meta.url)),nginx=fs.readFileSync(new URL('../deploy/nginx/wowiekowie.com.conf',import.meta.url),'utf8');
export function isolationHeaders(url){const headers={};for(const [variable,header]of [['arcade_coop','Cross-Origin-Opener-Policy'],['arcade_coep','Cross-Origin-Embedder-Policy']]){
 const body=new RegExp('map \\$uri \\$'+variable+' \\{([\\s\\S]*?)\\n\\}').exec(nginx)?.[1];if(!body)throw Error('Missing production isolation policy');
 if(!nginx.includes('add_header '+header+' $'+variable+' always;'))throw Error('Isolation map not applied');
 const scoped=/~([^\s]+) "([^"]+)";/.exec(body);if(!scoped)throw Error('Missing scoped isolation policy');if(new RegExp(scoped[1]).test(url))headers[header]=scoped[2];
 }return headers;}
export async function startArcadeServer(port=0){const server=http.createServer((req,res)=>{try{
 let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(url.endsWith('/'))url+='index.html';const file=path.resolve(root,'.'+url);if(!file.startsWith(root)||!['GET','HEAD'].includes(req.method))throw Error('Unavailable');
 res.setHeader('Content-Security-Policy',snesBrowserCSP(url));for(const[k,v]of Object.entries(isolationHeaders(url)))res.setHeader(k,v);
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.md':'text/plain','.txt':'text/plain'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return {server,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {origin}=await startArcadeServer(Number(process.argv[2]||8643));console.log(origin+'/games/arcade/');}
