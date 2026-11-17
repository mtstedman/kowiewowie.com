import fs from 'node:fs';import {spawnSync} from 'node:child_process';import path from 'node:path';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('MMC5 anchor '+a);return s.replace(a,b);};
export function stageMMC5(root,compiler='clang'){
 const file=path.join(root,'runtime.mjs');let s=fs.readFileSync(file,'utf8');
 s=once(s,'const api={','let mapperStageValid=false;\n const api={');
 s=once(s,'synchronizations++;refreshMapping();','if(mapperStageValid)return true;\n     synchronizations++;refreshMapping();');
 s=once(s,'function after(){\n     ppuDot=od[0];',`function after(){
     const ticks=Math.floor(od[0]/3)-Math.floor(ppuDot/3);if(ticks<0||ticks>1)throw Error('Owned audio clock invariant');for(let i=0;i<ticks;i++)audioTick();ownedAudioTicks+=ticks;
     mapperStageValid=true;ppuDot=od[0];`);
 s=once(s,'let mappingRefreshes=0,synchronizations=0,skippedSource=0,skippedAudio=0;', 'let mappingRefreshes=0,synchronizations=0,skippedSource=0,skippedAudio=0,ownedAudioTicks=0;');
 s=once(s,'skippedPreparations:skippedSource+skippedAudio,','ownedAudioTicks,skippedPreparations:skippedSource+skippedAudio,');
 s=once(s,':(Math.floor((clock+1)/3)!=Math.floor(clock/3)?2:0);',':0;');
 s=once(s,'return Object.freeze(api);',`for(const key of ['read','write','ppuRead','ppuWrite','ppuFetch','setPPUAddress','advancePPUClock','loadRAM','loadCHR','loadMapperState']){const fn=api[key];if(fn)api[key]=function(...args){mapperStageValid=false;return fn.apply(this,args);};}\n return Object.freeze(api);`);
 fs.writeFileSync(file,s);
 const cfile=path.join(root,'shared-pixel.c');let c=fs.readFileSync(cfile,'utf8');
 c=once(c,':(__builtin_floor((clock+1)/3)!=__builtin_floor(clock/3)?2:0);',':0;');
 c=once(c,'}else if(om[8]==5)od[0]=t;',`}else if(om[8]==5){
  uint32_t ticks=(uint32_t)(__builtin_floor(t/3)-__builtin_floor(od[0]/3));
  for(uint32_t i=0;i<ticks;i++){
   if(om[20])om[27]=0;
   else if(++om[27]>=3){om[27]=3;om[21]=0;om[18]=0;om[19]=0;}
   om[20]=0;
  }
  od[0]=t;
 }`);fs.writeFileSync(cfile,c);
 const wasm=fs.readFileSync(path.join(root,'shared-pixel.wasm'));
 const names=WebAssembly.Module.exports(new WebAssembly.Module(wasm)).filter(x=>x.kind==='function').map(x=>'-Wl,--export='+x.name);
 const args=['--target=wasm32','-O2','-std=c11','-ffreestanding','-fno-builtin','-nostdlib','-Wl,--no-entry','-Wl,--export-memory','-Wl,--initial-memory=1572864','-Wl,--max-memory=1572864',...names,cfile,'-o',path.join(root,'shared-pixel.wasm')];const run=spawnSync(compiler,args,{encoding:'utf8'});if(run.status)throw Error(run.stderr);const version=spawnSync(compiler,['--version'],{encoding:'utf8'});if(version.status)throw Error(version.stderr);
 const test=path.join(root,'shared-ppu-owned-tests.mjs');let t=fs.readFileSync(test,'utf8');
 const start=t.indexOf("if(five){\n const x=device(false,setup5),y=device(true,setup5);\n compare(x,y,2,'audio prelude');"),end=t.indexOf('// Fresh differential pairs',start);if(start<0||end<start)throw Error('Audio gate anchor');
 t=t.slice(0,start)+`if(five){
 const x=device(false,setup5),y=device(true,setup5);
 compare(x,y,2,'audio prelude');const before=y.p.getSharedPPUStats();
 compare(x,y,1,'ordered audio edge');const after=y.p.getSharedPPUStats();
 assert.equal(after.ownedAudioTicks,before.ownedAudioTicks+1);
 assert.equal(after.ownedDots,before.ownedDots+1);
 compare(x,y,7,'ordered audio continuation');
}
`+t.slice(end);
 t=once(t,'assert.ok(stats.yieldMapperAudioEdge>0);','assert.ok(stats.ownedAudioTicks>0);');fs.writeFileSync(test,t);return {version:version.stdout.trim(),arguments:args.map(x=>x.replaceAll(root,'$OUTPUT'))};
}
