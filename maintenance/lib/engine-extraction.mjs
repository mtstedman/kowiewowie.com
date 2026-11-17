import {parse} from 'acorn';
const insist=(v,m)=>{if(!v)throw Error(m);};
function ast(text){return parse(text,{ecmaVersion:'latest',sourceType:'module'});}
function walk(node,visit){if(!node||typeof node!=='object')return;if(typeof node.type==='string')visit(node);for(const [k,v]of Object.entries(node)){if(k==='start'||k==='end')continue;if(Array.isArray(v)){for(const x of v)walk(x,visit);}else if(v&&typeof v==='object')walk(v,visit);}}
function patchText(text,edits){
 edits.sort((a,b)=>b.start-a.start);let boundary=text.length;
 for(const e of edits){insist(e.start>=0&&e.end>=e.start&&e.end<=boundary,'Overlapping source transformation');text=text.slice(0,e.start)+e.text+text.slice(e.end);boundary=e.start;}return text;
}
function boundNames(pattern){
 if(pattern.type==='Identifier')return [pattern.name];
 if(pattern.type==='ObjectPattern')return pattern.properties.flatMap(p=>boundNames(p.type==='RestElement'?p.argument:p.value));
 if(pattern.type==='ArrayPattern')return pattern.elements.filter(Boolean).flatMap(boundNames);
 if(pattern.type==='AssignmentPattern')return boundNames(pattern.left);
 if(pattern.type==='RestElement')return boundNames(pattern.argument);
 throw Error('Unsupported exported binding pattern: '+pattern.type);
}
function declarationNames(n){return n.type==='VariableDeclaration'?n.declarations.flatMap(d=>boundNames(d.id)):n.id?[n.id.name]:[];}
function extractFactory(text,label){
 const tree=ast(text),edits=[],dependencies=[],exports=[],bindings=[];
 function dependency(n){const slot=dependencies.length;dependencies.push(n.source.value);return slot;}
 function expose(name,expression){exports.push([name,expression]);}
 for(const n of tree.body){
  if(n.type==='ImportDeclaration'){
   insist(!n.attributes?.length,'Import attributes unsupported: '+label);const slot=dependency(n);
   for(const s of n.specifiers){
    const access=s.type==='ImportNamespaceSpecifier'?'imports['+slot+']':'imports['+slot+']['+JSON.stringify(s.type==='ImportDefaultSpecifier'?'default':s.imported.name??s.imported.value)+']';
    bindings.push('const '+s.local.name+'='+access+';');
   }
   edits.push({start:n.start,end:n.end,text:''});
  }else if(n.type==='ExportNamedDeclaration'){
   if(n.declaration){for(const name of declarationNames(n.declaration))expose(name,name);edits.push({start:n.start,end:n.declaration.start,text:''});}
   else if(n.source){const slot=dependency(n);for(const s of n.specifiers)expose(s.exported.name??s.exported.value,'imports['+slot+']['+JSON.stringify(s.local.name??s.local.value)+']');edits.push({start:n.start,end:n.end,text:''});}
   else{for(const s of n.specifiers)expose(s.exported.name??s.exported.value,s.local.name);edits.push({start:n.start,end:n.end,text:''});}
  }else if(n.type==='ExportDefaultDeclaration'){
   const d=n.declaration;if((d.type==='FunctionDeclaration'||d.type==='ClassDeclaration')&&d.id){expose('default',d.id.name);edits.push({start:n.start,end:d.start,text:''});}
   else{expose('default','__default');edits.push({start:n.start,end:d.start,text:'const __default='});}
  }else if(n.type==='ExportAllDeclaration')throw Error('Explicit re-exports required: '+label);
 }
 walk(tree,n=>{insist(n.type!=='ImportExpression','Dynamic engine import unsupported: '+label);insist(!(n.type==='MetaProperty'&&n.meta.name==='import'),'Engine import.meta requires an explicit extraction rule: '+label);});
 insist(new Set(exports.map(x=>x[0])).size===exports.length,'Duplicate engine export: '+label);
 const body=patchText(text,edits),getters=exports.map(([k,v])=>JSON.stringify(k)+':{enumerable:true,get:()=>'+v+'}').join(',');
 let factoryBody=body,prelude='';
 // The embedded binary module is immutable. Keep compilation outside machine factories.
 if((label==='owned-ppu-binary.mjs'||label.endsWith('/owned-ppu-binary.mjs'))){
  const declarations=ast(body).body;
  const cached=declarations.filter(n=>n.type==='VariableDeclaration');
  insist(cached.length===2&&cached.some(n=>body.slice(n.start,n.end).includes('new WebAssembly.Module')),'Unexpected embedded Wasm contract');
  prelude=cached.map(n=>body.slice(n.start,n.end)).join('\n')+'\n';
  factoryBody=patchText(body,cached.map(n=>({start:n.start,end:n.end,text:''})));
 }
 const code='// Posse extracted reusable engine factory; original body retained.\n'+prelude+'export function instantiate(imports){\n"use strict";\n'+bindings.join('\n')+'\n'+factoryBody+'\nreturn Object.freeze(Object.defineProperties(Object.create(null),{'+getters+'}));\n}\n';
 ast(code);return {code,dependencies,exports:exports.map(x=>x[0])};
}
const COMPILED_BRIDGE=`export function instantiate(imports){
 const [runtime,data]=imports;
 const {makeBus,makeCPU,fromHex}=runtime;
 const {metadata,blocks,prgHex,chrHex,trainerHex}=data;
 const getPRG=()=>fromHex(prgHex),getCHR=()=>fromHex(chrHex),getTrainer=()=>fromHex(trainerHex);
 const createBus=(io={})=>makeBus(getPRG(),getTrainer(),io,metadata,getCHR());
 const createCPU=(bus=createBus())=>makeCPU(bus,blocks,metadata);
 return Object.freeze({metadata,CPUError:runtime.CPUError,getPRG,getCHR,getTrainer,createBus,createCPU});
}
`;
export {extractFactory,COMPILED_BRIDGE};
