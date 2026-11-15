
export function restoreArray(target,source){
 if(target.length!==source.length||Array.isArray(target)!==Array.isArray(source)||target.constructor!==source.constructor)throw Error('State storage shape changed');
 for(let i=0;i<target.length;i++){if(Object.hasOwn(source,i))target[i]=source[i];else delete target[i];}
}
export function replaceRows(target,source){if(target!==source)target.splice(0,target.length,...source);}
