// Non-NES contract fixture: surfaces/input/lifecycle only, no game authenticity claim.
export const version=1;
export const trace=[];
export const resources={workers:0,audio:0,listeners:0,active:0,maximum:0};
export function createAdapter(ctx){
 let ready=false,running=false,closed=false,disposal=null;const held=new Map();const element=tag=>typeof document==='undefined'?{nodeType:1,tagName:tag,remove(){}}:document.createElement(tag.toLowerCase());const view=element('DIV'),video=element('CANVAS');
 if(view.append)view.append(video);ctx.scope.defer(()=>view.remove());
 const dispose=()=>{if(disposal)return disposal;closed=true;held.clear();running=false;ready=false;trace.push(ctx.package.id+':dispose');disposal=Promise.resolve();return disposal;};ctx.scope.defer(dispose);
 return {version:1,packageId:ctx.package.id,artifactDigest:ctx.package.artifactDigest,
 load(){trace.push(ctx.package.id+':load');resources.active++;resources.maximum=Math.max(resources.maximum,resources.active);resources.workers++;resources.audio++;resources.listeners++;let released=false;ctx.scope.defer(()=>{if(released)return;released=true;resources.active--;resources.workers--;resources.audio--;resources.listeners--;});ready=true;ctx.view?.append?.(view);},
 start(){trace.push(ctx.package.id+':start');running=true;},pause(){trace.push(ctx.package.id+':pause');running=false;held.clear();},resume(){trace.push(ctx.package.id+':resume');running=true;},reset(){trace.push(ctx.package.id+':reset');held.clear();running=false;},dispose,
 input(e){trace.push([ctx.package.id,'input',e.control,e.source,e.pressed,e.seat]);if(e.pressed)held.set(e.source,e.control);else held.delete(e.source);return true;},releaseAll(){held.clear();trace.push(ctx.package.id+':release');},snapshot(){return {ready,running,loading:false,closed};},surfaces(){return {view,video,audio:{kind:'web-audio',getNodes:()=>({context:null,node:null})}};}
 };
}
