const insist=(ok,message)=>{if(!ok)throw new TypeError(message);};
// Verified immutable bytes only; each mount owns its Blob graph and mutable state.
const verified=new Map(),CACHE_BYTES=64*1024*1024;let cachedBytes=0;
const checkAbort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
async function readBytes(url,limit,signal){
 const abort=new AbortController(),cancel=()=>abort.abort(),timer=setTimeout(cancel,15000);
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{
  const response=await fetch(url,{cache:'no-cache',credentials:'same-origin',redirect:'error',signal:abort.signal});
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
  const sidecar=p.route+'composition.json';insist(p.files[sidecar],'Inventoried composition required');
  const abort=new AbortController(),cancel=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});
  const entries=Object.entries(p.files);let next=0,raw;
  async function member(path,pin){
   checkAbort(signal);checkAbort(abort.signal);
   const key=pin.sha256+':'+pin.bytes;let bytes=verified.get(key);
   if(bytes){verified.delete(key);verified.set(key,bytes);}
   else{
    bytes=await readBytes(path,pin.bytes,abort.signal);
    insist(bytes.length===pin.bytes&&await digest(bytes)===pin.sha256,'Package member integrity mismatch: '+path);
    checkAbort(signal);checkAbort(abort.signal);
    if(bytes.length<=CACHE_BYTES){
     // Concurrent mounts can finish the same member independently.
     if(!verified.has(key)){while(cachedBytes+bytes.length>CACHE_BYTES){const first=verified.keys().next().value;cachedBytes-=verified.get(first).length;verified.delete(first);}verified.set(key,bytes);cachedBytes+=bytes.length;}
    }
   }
   if(path===sidecar)raw=bytes;
   if(path.endsWith('.mjs')||path.endsWith('.js'))sources.set(path,new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  async function pump(){try{while(next<entries.length){const [path,pin]=entries[next++];await member(path,pin);}}catch(e){abort.abort(e);throw e;}}
  try{const results=await Promise.allSettled(Array.from({length:Math.min(4,entries.length)},pump));const failure=results.find(r=>r.status==='rejected');if(failure)throw abort.signal.reason||failure.reason;checkAbort(signal);}
  finally{signal?.removeEventListener('abort',cancel);}
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
