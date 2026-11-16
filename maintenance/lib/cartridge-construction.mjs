import {parse} from 'acorn';
export {canonical,compiledDescriptor,verifyInertBank,declaredJSON};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function insist(ok,message){if(!ok)throw Error(message);}
function ast(text){return parse(text,{ecmaVersion:'latest',sourceType:'module'});}
function declaredJSON(text,name){
 for(const top of ast(text).body){const n=top.type==='ExportNamedDeclaration'?top.declaration:top;if(n?.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.type==='Identifier'&&d.id.name===name){insist(d.init,'Missing data initializer');return JSON.parse(text.slice(d.init.start,d.init.end));}}
 throw Error('Missing cartridge metadata declaration: '+name);
}
function compiledDescriptor(text){
 const tree=ast(text),info=declaredJSON(text,'info');let bankArray=null,bankExpression=null;const bankImports=[];
 for(const n of tree.body){
  if(n.type==='ImportDeclaration'&&/^\.\/bank-[A-Za-z0-9_-]+\.mjs$/.test(n.source.value)){
   insist(n.specifiers.length===1&&n.specifiers[0].type==='ImportDefaultSpecifier','Unexpected translated bank import');bankImports.push({name:n.specifiers[0].local.name,source:n.source.value});
  }
  if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.name==='B'){
   const q=d.init;insist(q?.type==='CallExpression'&&q.callee.type==='MemberExpression'&&q.callee.object.name==='Object'&&q.callee.property.name==='freeze'&&q.arguments.length===1&&q.arguments[0].type==='ArrayExpression','Unexpected translated program table');
   bankArray=[];
   function table(e){
    insist(e,'Missing bank table member');
    if(e.type==='Identifier'){bankArray.push(e.name);return;}
    insist(e.type==='CallExpression'&&!e.optional&&e.callee.type==='MemberExpression'&&!e.callee.computed&&e.callee.object.name==='Object'&&e.callee.property.name==='freeze'&&e.arguments.length===1,'Unexpected bank table construction');
    const value=e.arguments[0];
    if(value.type==='ArrayExpression'){for(const member of value.elements)table(member);return;}
    insist(value.type==='ObjectExpression','Unexpected bank window mapping');
    const keys=new Set();
    for(const p of value.properties){
     insist(p.type==='Property'&&p.kind==='init'&&!p.method&&!p.computed&&!p.shorthand&&p.key.type==='Literal'&&Number.isInteger(p.key.value)&&p.key.value>=0&&!keys.has(p.key.value),'Unexpected bank window key');
     keys.add(p.key.value);insist(p.value.type==='Identifier','Unexpected bank window value');table(p.value);
    }
   }
   table(q);bankExpression=text.slice(q.start,q.end);
  }
 }
 insist(bankArray&&bankArray.length===bankImports.length&&bankArray.every((n,i)=>bankImports[i]?.name===n),'Incomplete translated program table');
 insist(info.apiVersion===3&&info.runtimeRevision==='fetch-epoch-2'&&info.scan_complete===true&&info.region==='ntsc','Unsupported compiler cartridge ABI');
 return {info,bankImports,bankArray,bankExpression};
}
function verifyInertBank(text,label){
 const body=ast(text).body,fail=()=>insist(false,'Unsupported translated bank construction: '+label);
 const shape=n=>JSON.stringify(n,(k,v)=>['start','end','raw'].includes(k)?undefined:v);
 const same=(a,s)=>shape(a)===shape(ast(s).body[0]);
 insist(body.length>=5,'Incomplete translated bank: '+label);
 insist(same(body[0],'const B=Object.create(null);'),'Unsupported bank declaration: '+label);
 const suffixes=[
  'function f(e){if(e.cross){for(const x of Object.values(e.cross))f(x);Object.freeze(e.cross);}else Object.freeze(e[0]);Object.freeze(e);}',
  'function f(e){if(e.cross){for(const x of e.cross)f(x);Object.freeze(e.cross);}else Object.freeze(e[0]);Object.freeze(e);}'
 ];
 insist(suffixes.some(s=>same(body.at(-3),s))&&same(body.at(-2),'for(const e of Object.values(B))f(e);')&&same(body.at(-1),'export default Object.freeze(B);'),'Unsupported bank freeze construction: '+label);
 const integer=(n,max)=>n?.type==='Literal'&&Number.isInteger(n.value)&&n.value>=0&&n.value<=max;
 function properties(n,keyCheck,valueCheck){
  if(n?.type!=='ObjectExpression'||!n.properties.length)return fail();
  const seen=new Set();for(const p of n.properties){
   if(p.type!=='Property'||p.kind!=='init'||p.method||p.computed||p.shorthand||!keyCheck(p.key)||seen.has(String(p.key.value??p.key.name)))return fail();
   seen.add(String(p.key.value??p.key.name));valueCheck(p.value);
  }
 }
 function entry(n){
  if(n?.type==='ArrayExpression'){
   const [bytes,fn,flag,prefetchedByteCount]=n.elements;
   // Optional field is a count of initial byte fetches, never a bit mask.
   if(![3,4].includes(n.elements.length)||bytes?.type!=='ArrayExpression'||!bytes.elements.length||!bytes.elements.every(x=>integer(x,255))||fn?.type!=='ArrowFunctionExpression'||fn.async||fn.generator||fn.params.length!==1||fn.params[0].type!=='Identifier'||fn.params[0].name!=='c'||fn.body.type!=='BlockStatement'||!integer(flag,2))return fail();
   if(n.elements.length===4&&(!integer(prefetchedByteCount,bytes.elements.length)||prefetchedByteCount.value<1))return fail();
   return;
  }
  properties(n,k=>k.type==='Identifier'&&k.name==='cross',cross=>{
   if(cross.type==='ArrayExpression'){if(!cross.elements.length)return fail();for(const e of cross.elements)entry(e);}
   else properties(cross,k=>integer(k,255),entry);
  });
 }
 const addresses=new Set();
 for(const statement of body.slice(1,-3)){
  const e=statement.type==='ExpressionStatement'&&statement.expression,l=e?.left;
  if(e?.type!=='AssignmentExpression'||e.operator!=='='||l?.type!=='MemberExpression'||!l.computed||l.object.type!=='Identifier'||l.object.name!=='B'||!integer(l.property,65535)||addresses.has(l.property.value))return fail();
  addresses.add(l.property.value);entry(e.right);
 }
 insist(addresses.size>0,'Empty translated bank: '+label);
}
