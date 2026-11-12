const deny=message=>{const e=new Error(message);e.code='GRAPH_PATH';throw e;};
export function canonicalName(raw,base=[]){
 if(typeof raw!=='string'||!raw.length||raw.length>4096||!/^[A-Za-z0-9._/-]+$/.test(raw)||raw.startsWith('/')||raw.endsWith('/'))deny('Invalid relative graph path');
 const parts=base.slice();for(const part of raw.split('/')){if(part==='')deny('Empty graph path component');if(part==='.')continue;if(part==='..'){if(!parts.length)deny('Graph path escapes root');parts.pop();}else parts.push(part);}if(!parts.length)deny('Graph path names root');return parts.join('/');
}
const excluded=name=>/(^|\/)(cpu|nes)\.js$/.test(name);
function member(name,contents){if(!contents.has(name)||excluded(name))deny('Forbidden graph member '+name);}
export function resolveGraph(a,contents){
 if(!a||!['entry-point','import-statement'].includes(a.kind))deny('Unsupported import kind');let base=[];
 if(a.kind==='entry-point'){if(a.importer||!['','file',undefined].includes(a.namespace))deny('Invalid entry context');}
 else{if(a.namespace!=='verified'||typeof a.importer!=='string'||canonicalName(a.importer)!==a.importer)deny('Invalid importer');member(a.importer,contents);if(typeof a.path!=='string'||!(a.path.startsWith('./')||a.path.startsWith('../')))deny('Nonrelative import');base=a.importer.split('/').slice(0,-1);}
 const name=canonicalName(a.path,base);member(name,contents);return {path:name,namespace:'verified'};
}
export function graphPlugin(input){
 if(!(input instanceof Map))deny('Expected authenticated contents');const contents=new Map(input);
 for(const [name,b] of contents){if(canonicalName(name)!==name)deny('Noncanonical graph key');if(typeof b!=='string'&&!(b instanceof Uint8Array))deny('Invalid graph contents');}
 return {name:'authenticated-graph',setup(build){build.onResolve({filter:/.*/},a=>resolveGraph(a,contents));build.onLoad({filter:/.*/,namespace:'verified'},a=>{if(a.namespace!=='verified'||canonicalName(a.path)!==a.path)deny('Invalid load context');member(a.path,contents);return {contents:contents.get(a.path),loader:a.path.endsWith('.css')?'css':'js'};});}};
}
