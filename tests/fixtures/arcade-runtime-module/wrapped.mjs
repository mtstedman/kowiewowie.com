import {createRuntime as make} from './standalone.mjs';
export {marker} from './shared.mjs';
import {marker} from './shared.mjs';
export function createRuntime(args){
 const base=make(args);let queue=Promise.resolve();
 return {...base,marker,reset(){const result=queue.then(()=>base.reset());queue=result;return result;},async dispose(){await queue;await base.dispose();}};
}
