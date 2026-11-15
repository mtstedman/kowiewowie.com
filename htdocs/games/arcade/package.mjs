// Trusted host bootstrap: excluded from the executable package DAG.
export * from './package-contract.mjs';
import {insist,readBytes,digest} from './package-contract.mjs';
import {authenticatedGraph} from './authenticated-loader.mjs';
async function verifiedEntry(p,signal){const expected=p.files[p.entry],bytes=await readBytes(p.entry,expected.bytes,signal);insist(bytes.length===expected.bytes&&await digest(bytes)===expected.sha256,'Adapter entry integrity mismatch');insist(!signal.aborted,'Load cancelled');return import(p.entry+'?v='+expected.sha256);}
export async function importAdapter(p,signal){
 if(!Object.hasOwn(p.files,p.route+'composition.json'))return verifiedEntry(p,signal);
 const graph=await authenticatedGraph(p,signal);
 let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',dispose);graph.dispose();};
 signal?.addEventListener('abort',dispose,{once:true});
 try{
  if(signal?.aborted)dispose();
  insist(!disposed,'Load cancelled');
  const namespace=await import(graph.entry);
  if(signal?.aborted)dispose();
  insist(!disposed,'Load cancelled');
  return {...namespace,createAdapter(context){
   try{
    if(signal?.aborted)dispose();
    insist(!disposed,'Load cancelled');
    context.scope.defer(dispose);
    insist(!disposed,'Load cancelled');
    return namespace.createAdapter(context);
   }catch(e){dispose();throw e;}
  }};
 }catch(e){dispose();throw e;}
}
