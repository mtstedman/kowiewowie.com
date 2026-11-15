import assert from 'node:assert/strict';
import {canonical,compiledDescriptor,verifyInertBank} from './shared-engine-construction.mjs';
assert.equal(canonical({z:1,a:[2]}),'{"a":[2],"z":1}');
const prefix='const B=Object.create(null);';
const freeze='function f(e){if(e.cross){for(const x of Object.values(e.cross))f(x);Object.freeze(e.cross);}else Object.freeze(e[0]);Object.freeze(e);}for(const e of Object.values(B))f(e);export default Object.freeze(B);';
const instruction='[[169,1],c=>{const s=c.s;s.a=c.nz(1);return 2;},0]';
const supported=prefix+'B[32768]='+instruction+';'+freeze;
verifyInertBank(supported,'ordinary');
const jsr='[[32,157,237],c=>{c.q(32802,237);return 6;},0,2]';
verifyInertBank(prefix+'B[32800]='+jsr+';'+freeze,'Contra deferred operand byte count');
for(const count of ['0','-1','4','1.5','null','undefined','arbitraryCall()','...[]'])assert.throws(()=>verifyInertBank(prefix+'B[32800]='+jsr.replace(',0,2]',',0,'+count+']')+';'+freeze,'invalid prefetch count'));
verifyInertBank(prefix+'B[32800]='+jsr.replace(',0,2]',',0,3]')+';'+freeze,'full byte count');
verifyInertBank(supported.replace('},0]','},2]'),'supported interrupt flag');
verifyInertBank(prefix+'B[40959]={cross:{0:'+instruction+',15:'+instruction+'}};'+freeze,'MMC3 crossing');
verifyInertBank(prefix+'B[49151]={cross:['+instruction+']};'+freeze.replace('Object.values(e.cross)','e.cross'),'MMC1 crossing');
for(const source of [
 'Object.freeze({}); arbitraryCall();',
 supported+'arbitraryCall();',
 supported.replace('B[32768]=','globalThis.stolen='),
 supported.replace(instruction,'arbitraryCall()'),
 supported.replace(instruction,'[[1],(c=arbitraryCall())=>{},0]'),
 supported.replace(instruction,'{get cross(){return arbitraryCall();}}'),
 supported.replace('Object.freeze(e);','arbitraryCall();Object.freeze(e);'),
 supported.replace(instruction,'[[1],c=>{},0,...arbitraryCall()]'),
 supported.replace('B[32768]=','B[arbitraryCall()]=')
])assert.throws(()=>verifyInertBank(source,'negative'));
const info={apiVersion:3,runtimeRevision:'fetch-epoch-2',scan_complete:true,region:'ntsc'};
const imports='import T0 from "./bank-0-w0.mjs";import T1 from "./bank-1-w0.mjs";';
const expression='Object.freeze([Object.freeze({0:T0}),Object.freeze({15:T1})])';
const source=imports+'const info='+JSON.stringify(info)+';const B='+expression+';';
const d=compiledDescriptor(source);assert.equal(d.bankExpression,expression);assert.deepEqual(d.bankArray,['T0','T1']);
assert.equal(compiledDescriptor(source.replace(expression,'Object.freeze([T0,T1])')).bankExpression,'Object.freeze([T0,T1])');
assert.throws(()=>compiledDescriptor(source.replace('15:T1','15:arbitraryCall()')));
assert.throws(()=>compiledDescriptor(source.replace('15:T1','15:T0')));
console.log('Supported bank construction and nested window mapping fixtures passed');
