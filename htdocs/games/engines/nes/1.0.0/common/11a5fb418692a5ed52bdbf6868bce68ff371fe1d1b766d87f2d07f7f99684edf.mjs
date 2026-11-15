// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";


function restoreArray(target,source){
 if(target.length!==source.length||Array.isArray(target)!==Array.isArray(source)||target.constructor!==source.constructor)throw Error('State storage shape changed');
 for(let i=0;i<target.length;i++){if(Object.hasOwn(source,i))target[i]=source[i];else delete target[i];}
}
function replaceRows(target,source){if(target!==source)target.splice(0,target.length,...source);}

return Object.freeze(Object.defineProperties(Object.create(null),{"restoreArray":{enumerable:true,get:()=>restoreArray},"replaceRows":{enumerable:true,get:()=>replaceRows}}));
}
