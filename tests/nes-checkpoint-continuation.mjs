import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),catalog=JSON.parse(readFileSync(new URL('htdocs/games/arcade/catalog.json',root)));
const hash=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const signature=m=>({state:hash(stable(m.getState())),rgba:hash(m.getRGBA()),audio:hash(m.takeAudio())});
const input=(m,i)=>{for(let p=1;p<=2;p++)for(let b=0;b<8;b++)m.setButton(p,b,b===3?i>=10&&i<16:b===0?i%13<5:b===7?i%150<80:false);};
for(const {id} of catalog){
 const {createMachine}=await import(new URL('htdocs/games/'+id+'/composition-entry.mjs',root)),m=createMachine();
 for(let i=0;i<240;i++){input(m,i);m.frame({maxMs:60000});m.takeAudio();}
 // Include a non-frame-aligned CPU/PPU boundary and pending audio in the save.
 for(let i=0;i<17;i++)m.step();
 const save=JSON.parse(JSON.stringify(m.exportCheckpoint())),state=m.getState(),frames=[];
 for(let i=240;i<360;i++){input(m,i);m.frame({maxMs:60000});frames.push(signature(m));}
 m.importCheckpoint(save);assert.deepEqual(m.getState(),state);
 for(let i=240;i<360;i++){input(m,i);m.frame({maxMs:60000});assert.deepEqual(signature(m),frames[i-240],id+' continuation '+i);}
 m.reset();const resetSave=JSON.parse(JSON.stringify(m.exportCheckpoint())),reset=[];
 for(let i=0;i<10;i++){input(m,i);m.frame({maxMs:60000});reset.push(signature(m));}
 m.importCheckpoint(resetSave);
 for(let i=0;i<10;i++){input(m,i);m.frame({maxMs:60000});assert.deepEqual(signature(m),reset[i],id+' reset continuation '+i);}
 console.log(JSON.stringify({id,pass:true,warmup_frames:240,continuation_frames:120,reset_continuation_frames:10,checkpoint_bytes:JSON.stringify(save).length}));
}
