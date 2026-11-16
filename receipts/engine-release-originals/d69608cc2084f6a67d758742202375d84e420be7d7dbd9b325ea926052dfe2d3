const insist=(ok,message)=>{if(!ok)throw new TypeError(message);};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
async function readBytes(url,limit,signal){
 const abort=new AbortController(),cancel=()=>abort.abort(),timer=setTimeout(cancel,15000);
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:abort.signal});
  insist(response.ok&&response.body,'Static package resource unavailable');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;insist(size<=limit,'Static package resource exceeds limit');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function authenticatedGraph(p,signal){
 const sources=new Map(),urls=new Map(),pending=new Set(),owned=[];
 try{
  for(const [path,pin] of Object.entries(p.files)){
   const bytes=await readBytes(path,pin.bytes,signal);
   insist(bytes.length===pin.bytes&&await digest(bytes)===pin.sha256,'Package member integrity mismatch: '+path);
   if(path.endsWith('.mjs')||path.endsWith('.js'))sources.set(path,new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  const sidecar=p.route+'composition.json',pin=p.files[sidecar];
  insist(pin,'Inventoried composition required');
  const raw=await readBytes(sidecar,pin.bytes,signal);
  insist(raw.length===pin.bytes&&await digest(raw)===pin.sha256,'Composition integrity mismatch');
  const composition=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  insist(composition.format==='nes-composition/1','Unsupported composition');
  const graph=composition.moduleGraph;insist(graph&&typeof graph==='object'&&!Array.isArray(graph),'Authenticated module graph required');
  for(const receipt of Object.values(composition.binding)){
   insist(receipt&&p.files[receipt.path]?.sha256===receipt.sha256&&p.files[receipt.path]?.bytes===receipt.bytes,'Selected engine binding mismatch');
  }
  for(const [path,edges]of Object.entries(graph)){
   insist(sources.has(path)&&Array.isArray(edges),'Uninventoried executable');
   for(const edge of edges)insist(Object.hasOwn(graph,edge.target)&&sources.has(edge.target),'Incomplete executable closure');
  }
  function build(path){
   if(urls.has(path))return urls.get(path);
   insist(!pending.has(path),'Unsupported authenticated import cycle');pending.add(path);
   const source=sources.get(path),edges=graph[path];insist(typeof source==='string'&&Array.isArray(edges),'Incomplete authenticated executable closure');
   const patches=[];
   for(const edge of edges){
    insist(Number.isSafeInteger(edge.start)&&Number.isSafeInteger(edge.end)&&edge.start>=0&&edge.end>edge.start&&edge.end<=source.length,'Malformed authenticated import span');
    insist(source.slice(edge.start,edge.end)===edge.original,'Authenticated import span mismatch');
    patches.push({...edge,replacement:JSON.stringify(build(edge.target))});
   }
   patches.sort((a,b)=>b.start-a.start);let code=source,boundary=source.length;
   for(const edge of patches){insist(edge.end<=boundary,'Overlapping authenticated imports');code=code.slice(0,edge.start)+edge.replacement+code.slice(edge.end);boundary=edge.start;}
   const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));owned.push(url);urls.set(path,url);pending.delete(path);return url;
  }
  const entry=build(p.entry);return {entry,moduleURL(path){insist(Object.hasOwn(graph,path),'Uninventoried executable entry');return build(path);},dispose(){for(const u of owned)URL.revokeObjectURL(u);}};
 }catch(e){for(const u of owned)URL.revokeObjectURL(u);throw e;}
}
