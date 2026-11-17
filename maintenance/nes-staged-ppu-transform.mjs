import {parse} from 'acorn';
const walk=(node,fn)=>{if(!node||typeof node!=='object')return;fn(node);for(const v of Object.values(node)){if(Array.isArray(v)){for(const x of v)walk(x,fn);}else if(v&&typeof v==='object')walk(v,fn);}};
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected one anchor: '+a);return s.replace(a,b);};
export function stageRenderer(source){
 let fn;walk(parse(source,{ecmaVersion:'latest',sourceType:'module'}),n=>{if(n.type==='FunctionDeclaration'&&n.id?.name==='installOwnedDotPPU'){if(fn)throw Error('Duplicate owned renderer');fn=n;}});if(!fn)throw Error('No owned renderer');
 let body=source.slice(fn.start,fn.end);const ordered=body.includes('function sourceBoundary('),five=body.includes('mapperScope:[5]');
 const names=['v','t','fineX','first','odd','lo','hi','al','ah','nt','at','pl','ph','addr','fetchKind','skippedDummy'];
 const changes=[];walk(parse(body,{ecmaVersion:'latest'}),n=>{if(n.type==='MemberExpression'&&n.computed&&n.object.type==='Identifier'&&n.property.type==='Literal'){
 const name=n.object.name==='state'?names[n.property.value]:n.object.name==='clocks'?['dot','lastClear'][n.property.value]:null;if(name)changes.push({start:n.start,end:n.end,text:name});
 }});
 for(const c of changes.sort((a,b)=>b.start-a.start))body=body.slice(0,c.start)+c.text+body.slice(c.end);
 body=once(body,'first=1;',`let v=0,t=0,fineX=0,first=true,dot=0,odd=false,lastClear=-1,lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0${five?',skippedDummy=false':''};\n first=true;`);
 body=once(body,'function syncOutput(){p.curX=q[0];p.scanline=q[1];counters();}',`function syncOutput(){p.curX=q[0];p.scanline=q[1];}`);
 let advance;walk(parse(body,{ecmaVersion:'latest'}),n=>{if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.left.object.name==='p'&&n.left.property.name==='advanceDots')advance=n;});if(!advance)throw Error('No advance');
 const toState=names.slice(0,five?16:15).map((x,i)=>`state[${i}]=${x};`).join('');
 const fromState=names.slice(0,five?16:15).map((x,i)=>`${x}=${['first','odd','skippedDummy'].includes(x)?'Boolean(state['+i+'])':'state['+i+']'};`).join('');
 const boundary=ordered?'sourceBoundary(x,line,p.f_bgVisibility||p.f_spVisibility,stageActive?state[4]:odd,stageActive?clocks[0]:dot)':"((line===0&&x===1)||(line===20&&x===1)||x===340||(line===20&&x===339&&(stageActive?state[4]:odd)&&(p.f_bgVisibility||p.f_spVisibility))||((p.f_bgVisibility||p.f_spVisibility)&&line>=20&&line<=260&&x>=257&&x<=320)?1:0)";
 const replacement=`let stageActive=false,entries=0,exits=0;
 function leave(){if(!stageActive)return;${fromState}dot=clocks[0];lastClear=clocks[1];syncOutput();stageActive=false;exits++;counters();}
 function enter(){${toState}clocks[0]=dot;clocks[1]=lastClear;syncInput();stageActive=true;entries++;}
 p.advanceDots=n=>{
  if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');if(inAdvance)throw Error('Private owned PPU reentry');
  inAdvance=true;advanceCalls++;
  try{let left=n;
   while(left){const x=stageActive?q[0]:p.curX,line=stageActive?q[1]:p.scanline,reason=${boundary};
    if(reason){${ordered?'binding.skipPreparation(reason);':''}leave();fallbackDots++;tick(left);left--;continue;}
    if(!stageActive)enter();
    if(spriteRowDirty&&q[1]>=21&&q[1]<=260&&q[0]>=1&&q[0]<=256&&q[3]&&(q[0]>=9||q[5])){leave();prepareSpriteRow();enter();}
    q[15]=spriteRowDirty?1:0;
    let done=0;if(binding.before()){ownedCalls++;done=e.owned_advance(Math.min(3,left));binding.after();}
    if(done){left-=done;}else{leave();fallbackDots++;tick(left);left--;}
   }
   if(stageActive)syncOutput();
   if((p.scanline===0||p.scanline===20)&&p.curX===1)leave();boundary(0);
  }finally{inAdvance=false;}
 }`;
 body=body.slice(0,advance.start)+replacement+body.slice(advance.end);
 // Only the private, factory-owned renderer stages observations. The checked
 // public renderer remains unchanged; public machine state flushes this boundary.
 const tail=`
 const methods=new Set();for(let proto=p;proto&&proto!==Object.prototype;proto=Object.getPrototypeOf(proto))for(const key of Object.getOwnPropertyNames(proto))methods.add(key);
 for(const key of methods){if(key==='constructor'||key==='advanceDots'||typeof p[key]!=='function')continue;const fn=p[key];Object.defineProperty(p,key,{configurable:true,writable:true,value:function(...args){if(!inAdvance)leave();return fn.apply(this,args);}});}
 p.sharedPPUBoundary=leave;
 p.sharedPPUTransferStats=()=>({stageActive,entries,exits});
 `;
 body=body.slice(0,-1)+tail+'}';
 let result=source.slice(0,fn.start)+body+source.slice(fn.end);
 result=once(result,'function state(){return {','function state(){nes.ppu.sharedPPUBoundary?.();return {');
 if(body.includes('mapperScope:[4]')){
  result=once(result,'const api={','let mapperStageValid=false;\n const api={');
  result=once(result,'synchronizations++;\n     if(version>', 'if(mapperStageValid&&version<Number.MAX_SAFE_INTEGER-8208)return true;\n     synchronizations++;\n     if(version>');
  result=once(result,'version+=delta;state.ppuDot=od[0];','od[1]=0;mapperStageValid=true;version+=delta;state.ppuDot=od[0];');
  result=once(result,'return Object.freeze(api);', `for(const key of ['write','ppuRead','ppuWrite','setPPUAddress','advancePPUClock','loadRAM','loadCHR','loadMapperState']){const fn=api[key];if(fn)api[key]=function(...args){mapperStageValid=false;return fn.apply(this,args);};}\n return Object.freeze(api);`);
 }
 parse(result,{ecmaVersion:'latest',sourceType:'module'});return result;
}
