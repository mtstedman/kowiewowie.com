import {readSave,writeSave,validateRecord} from './battery-codec.mjs';
// This facade adds save messages only. Frame/input/audio envelopes remain base-owned.
export function createPersistentRuntime(args,createBase,{NativeWorker=globalThis.Worker,storage=globalThis.localStorage,timeoutMs=4000}={}){
 let current=null,closed=false,disposal=null,queue=Promise.resolve(),saveError=null;
 const warning=args.root.ownerDocument?.createElement('p');if(warning){warning.setAttribute('role','status');warning.hidden=true;args.root.append(warning);}
 function report(e){saveError=e instanceof Error?e:Error('Save failed');if(warning){warning.hidden=false;warning.textContent='Save data could not be stored on this device. Keep this game open and free storage before trying again.';}}
 // Read/validate before creating a worker. Corrupt or wrong-ROM saves are never overwritten.
 let saved=readSave(storage);
 class SavingWorker {
  constructor(url,options){
   if(closed)throw Error('Cartridge closed');this.dead=false;this.serial=0;this.waiting=new Map();this.worker=new NativeWorker(url,options);current=this;
   this.worker.onmessage=e=>{
    if(this.dead)return;const d=e.data;
    try{
     if(d?.type==='battery-await-init'){this.worker.postMessage({type:'battery-init',record:saved});return;}
     if(d?.type==='battery-data'){
      const v=validateRecord(d.record);saved=writeSave(storage,v);saveError=null;if(warning)warning.hidden=true;
      const pending=this.waiting.get(d.request);if(pending){this.waiting.delete(d.request);clearTimeout(pending.timer);pending.resolve();}return;
     }
     if(d?.type==='battery-error'){throw Error(String(d.message||'Battery operation failed').slice(0,240));}
     this.onmessage?.(e);
    }catch(error){report(error);for(const p of this.waiting.values()){clearTimeout(p.timer);p.reject(error);}this.waiting.clear();this.onerror?.({message:'Cartridge save operation failed'});}
   };
   this.worker.onerror=e=>{for(const p of this.waiting.values()){clearTimeout(p.timer);p.reject(Error('Save worker failed'));}this.waiting.clear();this.onerror?.(e);};
   this.worker.onmessageerror=e=>this.onmessageerror?.(e);
  }
  postMessage(...a){if(this.dead)throw Error('Worker closed');this.worker.postMessage(...a);}
  flush(){
   if(this.dead)return Promise.reject(Error('Save worker closed'));if(this.waiting.size)return Promise.reject(Error('Save already pending'));
   const request=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiting.delete(request);reject(Error('Battery flush timed out'));},timeoutMs);this.waiting.set(request,{resolve,reject,timer});try{this.worker.postMessage({type:'battery-flush',request});}catch(e){clearTimeout(timer);this.waiting.delete(request);reject(e);}});
  }
  terminate(){if(this.dead)return;this.dead=true;for(const p of this.waiting.values()){clearTimeout(p.timer);p.reject(Error('Save worker terminated'));}this.waiting.clear();this.worker.onmessage=this.worker.onerror=this.worker.onmessageerror=null;this.worker.terminate();if(current===this)current=null;}
 }
 let base;
 try{base=createBase({...args,WorkerClass:SavingWorker});}catch(e){current?.terminate();warning?.remove();throw e;}
 async function flush(){if(current)await current.flush();if(saveError)throw saveError;}
 function reset(){if(closed)return;const work=queue.then(async()=>{if(closed)return;base.pause();await flush();if(!closed)base.reset();});queue=work.catch(e=>{report(e);});return work;}
 function dispose(){if(disposal)return disposal;closed=true;base.pause();disposal=(async()=>{let error;try{await queue;await flush();}catch(e){report(e);error=e;}finally{try{await base.dispose();}finally{current?.terminate();warning?.remove();}}if(error)throw error;})();return disposal;}
 const forward=k=>(...a)=>{if(closed)return false;return base[k](...a);};
 return Object.freeze({...base,reset,dispose,start:forward('start'),input:forward('input'),pause:forward('pause'),snapshot:()=>({...base.snapshot(),closed:closed||base.snapshot().closed})});
}
