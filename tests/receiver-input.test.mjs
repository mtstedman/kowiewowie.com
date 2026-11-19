import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReceiverInputs} from '../htdocs/games/arcade/receiver-input.mjs';
import {ResourceScope} from '../htdocs/games/arcade/host.mjs';

class ReceiverNode extends EventTarget{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.hidden=false;this.disabled=false;this.captures=new Set();}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
 contains(n){return this===n||this.children.some(c=>c.contains(n));}
 get isConnected(){return this.ownerDocument.body.contains(this);}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
 closest(){if(['BUTTON','INPUT','SELECT','TEXTAREA','A','SUMMARY'].includes(this.tagName)||this.attrs.has('contenteditable'))return this;return this.parentNode?.closest()||null;}
 focus(){this.ownerDocument.activeElement=this;this.ownerDocument.dispatchEvent(new Event('focusout'));}
 setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
}
function receiverFixture(t,ids=['a','b','select','start','up','down','left','right']){
 const doc=new EventTarget(),win=new EventTarget(),rafs=new Map(),scope=new ResourceScope(),abort=new AbortController(),calls=[];
 let serial=0,pads=[],s={role:'guest',phase:'active',epoch:1},permission=true;
 doc.defaultView=win;doc.hidden=false;doc.focused=true;doc.hasFocus=()=>doc.focused;doc.createElement=tag=>new ReceiverNode(doc,tag);doc.body=doc.createElement('body');doc.activeElement=doc.body;
 win.navigator={getGamepads:()=>pads};win.requestAnimationFrame=fn=>{const id=++serial;rafs.set(id,fn);return id;};win.cancelAnimationFrame=id=>rafs.delete(id);
 const mount=doc.createElement('div'),screen=doc.createElement('div'),outside=doc.createElement('input');doc.body.append(screen,mount,outside);
 const ctx={package:{inputs:ids.map(id=>({id,label:id.toUpperCase(),kind:'button',hint:'untrusted hint ArrowRight',activation:'input'}))},controls:mount,signal:abort.signal,scope,canControl:()=>permission,input:e=>{calls.push({...e});return true;}};
 const controller=mountReceiverInputs(ctx,{getState:()=>s,stream:()=>screen});
 const flatten=n=>[n,...n.children.flatMap(flatten)];
 const root=()=>flatten(mount).find(n=>n.id==='receiver-controls');
 const button=id=>flatten(mount).find(n=>n.dataset.receiverControl===id);
 function fire(target,type,props={}){const e=new Event(type,{cancelable:true});for(const [k,v] of Object.entries(props))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);return e;}
 const key=(type,code,props={})=>fire(win,type,{code,target:doc.activeElement,repeat:false,...props});
 const step=()=>{for(const [id,fn] of [...rafs]){rafs.delete(id);fn();}};
 const pad={index:0,id:'Synthetic standard controller',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 t.after(async()=>{controller.dispose();await scope.close();assert.equal(rafs.size,0);});
 return {doc,win,mount,screen,outside,calls,controller,abort,root,button,key,fire,step,pad,rafs,setPads:v=>{pads=v;},setState:v=>{s={...s,...v};},setPermission:v=>{permission=v;}};
}

test('receiver keyboard stays scoped and requires release after focus loss or a host barrier',async t=>{
 const f=receiverFixture(t);f.outside.focus();f.key('keydown','ArrowRight');assert.equal(f.calls.length,0);
 f.screen.focus();f.key('keydown','ArrowRight',{ctrlKey:true});f.key('keydown','ArrowRight',{isComposing:true});assert.equal(f.calls.length,0);
 f.key('keydown','ArrowRight');assert.deepEqual(f.calls.at(-1),{control:'right',source:'receiver:k:ArrowRight',pressed:true});
 assert.equal(f.key('keydown','ArrowRight',{repeat:true}).defaultPrevented,true,'Held arrows must not scroll the page');assert.equal(f.calls.length,1);
 f.outside.focus();await Promise.resolve();assert.equal(f.calls.at(-1).pressed,false);
 f.screen.focus();const n=f.calls.length;f.key('keydown','ArrowRight',{repeat:true});assert.equal(f.calls.length,n);
 f.key('keyup','ArrowRight');f.key('keydown','ArrowRight');assert.equal(f.calls.at(-1).pressed,true);
 f.controller.cancel();f.setState({epoch:2});f.step();const barrier=f.calls.length;
 f.key('keydown','ArrowRight',{repeat:true});f.step();assert.equal(f.calls.length,barrier,'No replay across a host-owned barrier');
 f.key('keyup','ArrowRight');assert.equal(f.calls.at(-1).pressed,false);f.key('keydown','ArrowRight');assert.equal(f.calls.at(-1).pressed,true);
 f.key('keyup','ArrowRight');f.controller.dispose();assert.equal(f.root(),undefined);assert.equal(f.screen.getAttribute('tabindex'),null);assert.equal(f.rafs.size,0);
 const disposed=f.calls.length;f.key('keydown','ArrowRight');f.step();assert.equal(f.calls.length,disposed);
});

test('standard gamepad and concurrent pointers share descriptor inputs, neutral rearming and cleanup',async t=>{
 const f=receiverFixture(t);f.screen.focus();f.setPads([f.pad]);f.step();f.pad.buttons[15].pressed=true;f.step();
 assert.equal(f.calls.at(-1).control,'right');assert.equal(f.calls.at(-1).pressed,true);const n=f.calls.length;f.step();assert.equal(f.calls.length,n);
 const right=f.button('right'),a=f.button('a');f.fire(right,'pointerdown',{button:0,pointerId:7,pointerType:'touch'});f.fire(a,'pointerdown',{button:0,pointerId:8,pointerType:'touch'});
 assert.equal(f.doc.activeElement,f.root(),'Touch controls keep keyboard focus on the panel');
 assert(f.calls.some(e=>e.source==='receiver:p:7'&&e.control==='right'&&e.pressed));assert(f.calls.some(e=>e.source==='receiver:p:8'&&e.control==='a'&&e.pressed));
 f.fire(right,'pointerup',{pointerId:7});assert.equal(f.calls.at(-1).source,'receiver:p:7');assert.equal(f.calls.at(-1).pressed,false);
 f.fire(a,'pointercancel',{pointerId:8});assert.equal(f.calls.at(-1).source,'receiver:p:8');assert.equal(f.calls.at(-1).pressed,false);
 assert(!f.calls.some(e=>e.source==='receiver:g:0:right'&&!e.pressed),'Pointer release cannot release a different source');
 f.outside.focus();await Promise.resolve();assert.equal(f.calls.at(-1).source,'receiver:g:0:right');assert.equal(f.calls.at(-1).pressed,false);
 f.screen.focus();const downCount=()=>f.calls.filter(e=>e.source==='receiver:g:0:right'&&e.pressed).length;const before=downCount();f.step();f.step();assert.equal(downCount(),before);
 f.pad.buttons[15].pressed=false;f.step();f.pad.axes[0]=.6;f.step();assert.equal(downCount(),before+1);f.pad.axes[0]=.35;f.step();assert.equal(f.calls.at(-1).pressed,true);f.pad.axes[0]=.2;f.step();assert.equal(f.calls.at(-1).pressed,false);
 f.pad.buttons[15].pressed=true;f.step();f.fire(f.win,'gamepaddisconnected',{gamepad:f.pad});assert.equal(f.calls.at(-1).pressed,false);
 f.setPads([]);f.step();f.abort.abort();assert.equal(f.rafs.size,0);assert.equal(f.root(),undefined);
});

test('watchers and unavailable receivers never submit input, even with enabled forged buttons',t=>{
 const f=receiverFixture(t);f.setState({role:'spectator'});f.setPads([f.pad]);f.pad.buttons[15].pressed=true;f.screen.focus();f.step();
 f.key('keydown','ArrowRight');const b=f.button('right');b.disabled=false;f.fire(b,'pointerdown',{button:0,pointerId:9,pointerType:'touch'});f.fire(b,'click',{detail:0});f.key('keyup','ArrowRight');f.step();assert.equal(f.calls.length,0);assert.equal(f.root().hidden,true);
 for(const phase of ['connecting','reconnecting','ended','incompatible']){f.setState({role:'guest',phase});f.screen.focus();f.step();f.key('keydown','ArrowRight');f.fire(b,'pointerdown',{button:0,pointerId:10});f.step();assert.equal(f.calls.length,0);}
 f.setState({phase:'active'});f.setPermission(false);f.step();f.key('keydown','ArrowRight');assert.equal(f.calls.length,0);
});

test('receiver mappings use declared IDs, never human hints, and unknown buttons remain usable by touch',t=>{
 const f=receiverFixture(t,['fire']);f.screen.focus();f.key('keydown','ArrowRight');f.setPads([f.pad]);f.step();f.pad.buttons[15].pressed=true;f.step();assert.equal(f.calls.length,0);
 const b=f.button('fire');f.fire(b,'pointerdown',{button:0,pointerId:1,pointerType:'touch'});assert.deepEqual(f.calls.at(-1),{source:'receiver:p:1',control:'fire',pressed:true});f.fire(b,'lostpointercapture',{pointerId:1});assert.equal(f.calls.at(-1).pressed,false);
});


test('extended descriptor controller keeps all four face buttons and shoulders independent',t=>{
 const f=receiverFixture(t,['a','b','x','y','l','r','select','start','up','down','left','right']);
 f.screen.focus();
 for(const [code,control] of [['KeyZ','b'],['KeyX','a'],['KeyA','y'],['KeyS','x'],['KeyQ','l'],['KeyW','r']]){
  f.key('keydown',code);assert.equal(f.calls.at(-1).control,control);assert.equal(f.calls.at(-1).pressed,true);f.key('keyup',code);assert.equal(f.calls.at(-1).pressed,false);
 }
 f.setPads([f.pad]);f.step();
 for(const [index,control]of [[0,'b'],[1,'a'],[2,'y'],[3,'x'],[4,'l'],[5,'r']]){
  const before=f.calls.length;f.pad.buttons[index].pressed=true;f.step();
  assert.deepEqual(f.calls.slice(before).filter(e=>e.pressed).map(e=>e.control),[control]);
  f.pad.buttons[index].pressed=false;f.step();assert.equal(f.calls.at(-1).control,control);assert.equal(f.calls.at(-1).pressed,false);
 }
});
