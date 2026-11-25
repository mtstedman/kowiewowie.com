// GPL-2.0-or-later. Bytes arrive only after the package host verifies their pins.
onmessage=async({data:m})=>{
 let loader;
 try{
  self.posseCtl=new Int32Array(m.ctl);
  loader=URL.createObjectURL(new Blob([m.js],{type:'text/javascript'}));importScripts(loader);URL.revokeObjectURL(loader);loader=null;
  const M=await PosseDosbox({wasmBinary:m.wasm,print:()=>{},printErr:()=>{}});
  const mkdir=p=>{try{M.FS.mkdir(p);}catch{}};mkdir('/C');
  for(const [name,base64]of m.drive){let dir='/C';const parts=name.split('\\');for(const part of parts.slice(0,-1)){dir+='/'+part;mkdir(dir);}const file=dir+'/'+parts.at(-1);M.FS.writeFile(file,Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));M.FS.utime(file,m.mtimeMs,m.mtimeMs);}
  M.FS.writeFile('/run.conf',m.conf);M.FS.chdir('/');postMessage({type:'started'});
  const code=M.ccall('posse_web_start','number',['string'],['/run.conf']);postMessage({type:'returned',code});
 }catch(error){postMessage({type:'error',message:String(error.message||error)});}
 finally{if(loader)URL.revokeObjectURL(loader);}
};
