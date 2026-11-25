import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharing} from '../htdocs/games/arcade/sharing.mjs';
const state=(role='solo',phase='inactive')=>({role,phase,epoch:1,reconnect:'none',watch:'available',play:'available',message:'Ready'});
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.hidden=false;this.dataset={};this.attrs={};this.value='';this.textContent='';}
 append(...nodes){for(const n of nodes){n.remove();this.children.push(n);n.parentNode=this;}}
 after(n){const p=this.parentNode;assert(p);n.remove();p.children.splice(p.children.indexOf(this)+1,0,n);n.parentNode=p;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
 replaceChildren(...nodes){for(const c of [...this.children])c.remove();this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}
 focus(){this.focused=true;}select(){this.selected=true;}
 click(){this.dispatchEvent(new Event('click'));this.onclick?.();}
}
function environment(t){
 const body=new Element('body'),player=new Element('section'),status=new Element('p');player.id='player';status.id='session-state';body.append(player);player.append(status);
 const find=(n,id)=>n.id===id?n:n.children.map(c=>find(c,id)).find(Boolean);
 const replacements={document:{body,createElement:t=>new Element(t),getElementById:id=>find(body,id)},location:{href:'https://127.0.0.1:9443/games/arcade/',origin:'https://127.0.0.1:9443'},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{clipboard:{writeText:async()=>{throw Error('Permission denied');}}}};
 for(const [key,value] of Object.entries(replacements)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
 return replacements.document;
}
const packageValue={id:'fixture',artifactDigest:'a'.repeat(64),capabilities:{play:'shared-hero',watch:true}};
const owner={getPackage:()=>packageValue};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('sharing UI hides solo controls, copies accessibly and cleans on abort without stale resurrection',async t=>{
 const doc=environment(t),abort=new AbortController();let notify,disposed=0,attached=0,current=state();
 const bridge={provider:{getState:()=>current},async attach(){attached++;},async dispose(){disposed++;},async end(){current=state();notify({state:current,participants:[]});},revoke(){},retry(){}};
 const sharing=createSharing({loadBinding:async()=>({}),createBridge:(_p,_b,_r,o)=>{notify=o.onUI;return bridge;}});
 await sharing.load(packageValue,abort.signal,{solo:true},async()=>({version:1}));
 await Promise.all([sharing.attach(owner),sharing.attach(owner)]);assert.equal(attached,1);
 assert.equal(doc.getElementById('sharing-controls').hidden,true);
 current=state('host','active');notify({state:current,participants:[{participant:'one',participant_role:'watch',joined:false}]});
 notify({invite:'https://127.0.0.1:9443/games/arcade/#test-only',assignment:{participant:'one'}});
 const copy=doc.getElementById('sharing-copy'),link=doc.getElementById('sharing-link');
 assert.equal(copy.textContent,'Copy invitation');assert.equal(copy.hidden,false);assert.equal(link.attrs['aria-label'],'Invitation link');
 copy.click();await flush();assert.equal(link.selected,true);assert.equal(doc.getElementById('sharing-copy-status').attrs.role,'status');
 assert.match(doc.getElementById('sharing-copy-status').textContent,/Select and copy/);
 abort.abort('library');assert.equal(doc.getElementById('sharing-controls'),undefined);assert.equal(link.value,'');
 await flush();assert.equal(disposed,1);
 notify({state:state('host','active'),invite:'late'});assert.equal(doc.getElementById('sharing-controls'),undefined);
 await sharing.dispose();assert.equal(disposed,1);
});
test('an aborted delayed binding cannot attach or overwrite a newer selection',async t=>{
 const doc=environment(t),first=new AbortController(),second=new AbortController();let resolve,created=0;
 const gate=new Promise(r=>resolve=r);let calls=0;
 const sharing=createSharing({loadBinding:()=>++calls===1?gate:Promise.resolve({}),createBridge:()=>{created++;return {provider:{getState:()=>state()},attach:async()=>{},dispose:async()=>{}};}});
 await sharing.load(packageValue,first.signal,{solo:true},async()=>({version:1}));const pending=sharing.attach(owner);
 first.abort('package-change');await sharing.load(packageValue,second.signal,{solo:true},async()=>({version:1}));await sharing.attach(owner);
 resolve({});await pending;assert.equal(created,1);assert.equal(doc.getElementById('sharing-controls').hidden,true);
 second.abort('library');await flush();assert.equal(doc.getElementById('sharing-controls'),undefined);
});
