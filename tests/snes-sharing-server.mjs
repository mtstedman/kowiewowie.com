import {snesBrowserCSP} from './snes-browser-policy.mjs';
import https from 'node:https';
import http from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
const [root,port,upstream,key,cert]=process.argv.slice(2);if(!root||![port,upstream].every(x=>/^\d+$/.test(x)))throw Error('Fixture arguments');
const base=resolve(root,'htdocs'),types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.png':'image/png'};
const server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
 res.setHeader('Content-Security-Policy',snesBrowserCSP(new URL(req.url,'https://127.0.0.1').pathname));
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url.startsWith('/api/v1/netplay/')){if(req.method!=='POST'){res.writeHead(405).end();return;}const proxy=http.request({host:'127.0.0.1',port:Number(upstream),path:req.url,method:'POST',headers:req.headers,timeout:10000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});proxy.on('timeout',()=>proxy.destroy());proxy.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});let bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>70000){proxy.destroy();req.destroy();}});req.pipe(proxy);return;}
 try{if(!['GET','HEAD'].includes(req.method))throw Error();const name=decodeURIComponent(new URL(req.url,'https://127.0.0.1').pathname);if(name.includes('\0')||name.includes('\\'))throw Error();let p=resolve(base,'.'+name);if(!p.startsWith(base+sep))throw Error();if(statSync(p).isDirectory())p=resolve(p,'index.html');if(!statSync(p).isFile())throw Error();const b=readFileSync(p);res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:b);}catch{res.writeHead(404).end();}
});server.requestTimeout=15000;server.headersTimeout=10000;server.listen(Number(port),'127.0.0.1');
