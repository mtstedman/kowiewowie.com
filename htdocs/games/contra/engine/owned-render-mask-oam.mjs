import {restoreArray,replaceRows} from './state-transfer-runtime.mjs';
export const referenceOamModel=true;
const REFERENCE=referenceOamModel;
export function createOamEvaluator(p, secondary, capture) {
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 if(!(secondary instanceof Uint8Array)||secondary.length!==32||!p.spriteMem||p.spriteMem.length!==256)fail('DEVICE_CONTRACT','OAM storage shape');
 let h=0,l=0,used=0,secondaryAddress=0,buffer=255,inRange=false,done=false,overflowRemaining=0;
 let zeroAdded=false,zeroVisible=false,count=0,pendingIncrement=false,busRow=0;
 let reads=0,copies=0,disableIncrements=0,refreshCopies=0;
 const pendingRows=new Uint8Array(32),corruptionTrace=[];
 let pendingTransition=null,rowMarks=0,rowCopies=0,droppedCorruptionTrace=0;
 const primary=a=>p.spriteMem[a&255]&(((a&3)===2)?0xe3:255);
 function record(kind,d,line,rows=[]){
  if(corruptionTrace.length===16){corruptionTrace.shift();droppedCorruptionTrace++;}
  corruptionTrace.push({kind,dot:d,scanline:line,rows,primary_address:p.sramAddress&255,h,l,used,buffer,first_row:Array.from(p.spriteMem.slice(0,8))});
 }
 function flushRows(d,line,reason){
  const rows=[];
  for(let i=0;i<32;i++)if(pendingRows[i]){
   if(i!==0){for(let j=0;j<8;j++)p.spriteMem[i*8+j]=p.spriteMem[j];rowCopies++;}
   pendingRows[i]=0;rows.push(i);
  }
  if(rows.length)record(reason,d,line,rows);
 }
 function copyRow(from,to){
  if(from===to)return;
  const row=p.spriteMem.slice(from*8,from*8+8),extra=secondary[from];
  p.spriteMem.set(row,to*8);secondary[to]=extra;refreshCopies++;
 }
 function selectedRow(d,line){
  if(line>=21&&line<=260&&d>=1&&d<=64)return ((d-1)>>>1)&31;
  if(line>=21&&line<=260&&d>=65&&d<=256)return (d&1)?((p.sramAddress&255)>>>3):(used&31);
  if(line>=20&&line<=260&&d>=257&&d<=320)return (((d-257)>>>3)*4+Math.min((d-257)&7,3))&31;
  if(line>=20&&line<=260&&d>=321)return 0;
  return (p.sramAddress&255)>>>3;
 }
 function tick(d,line,enabled){
  if(REFERENCE){
   // Mesen ProcessScanlineFirstCycle clears count even in forced blank.
   if(line===20&&d===0){count=0;zeroVisible=false;p.spritesFound=0;p.sprite0InSecondary=false;if(enabled)flushRows(d,line,'prerender');}
   // No fake primary read replaces the retained evaluation latch in blanking.
   if(!enabled)return;
   // Mesen's OAMADDR bug is an eight-dot primary-only copy, with live source.
   if(line===20&&d>=1&&d<=8&&(p.sramAddress&255)>=8){
    p.spriteMem[d-1]=p.spriteMem[((p.sramAddress&255)&0xf8)+d-1];refreshCopies++;
   }
  }else{
   if(!enabled){busRow=(p.sramAddress&255)>>>3;const primaryAddress=p.sramAddress;buffer=p.spriteMem[primaryAddress&255]&(((primaryAddress&3)===2)?0xe3:255);return;}
   if(line===20&&d===0){copyRow((p.sramAddress&255)>>>3,secondaryAddress&31);count=0;zeroVisible=false;}
  }
  const renderLine=line>=20&&line<=260;
  if(renderLine&&d>=257&&d<=320){
   p.sramAddress=0;secondaryAddress=(((d-257)>>>3)*4+Math.min((d-257)&7,3))&31;
   busRow=secondaryAddress;buffer=secondary[secondaryAddress];return;
  }
  if(renderLine&&(d>=321||d===0)){
   secondaryAddress=0;busRow=0;buffer=secondary[0];return;
  }
  if(line<21||line>260||d<1||d>256){busRow=(p.sramAddress&255)>>>3;return;}
  if(d<=64){
   secondaryAddress=((d-1)>>>1)&31;busRow=secondaryAddress;buffer=255;
   if(!(d&1))secondary[secondaryAddress]=255;
   return;
  }
  if(d&1){
   if(d===65){h=(p.sramAddress>>>2)&63;l=p.sramAddress&3;used=0;secondaryAddress=0;inRange=false;done=false;overflowRemaining=0;zeroAdded=false;}
   busRow=(p.sramAddress&255)>>>3;const primaryAddress=p.sramAddress;buffer=p.spriteMem[primaryAddress&255]&(((primaryAddress&3)===2)?0xe3:255);reads++;return;
  }
  if(d===256){count=Math.min(8,(used+3)>>>2);zeroVisible=zeroAdded;p.spritesFound=count;p.sprite0InSecondary=zeroVisible;}
  secondaryAddress=used&31;busRow=secondaryAddress;
  if(done){h=(h+1)&63;if(used>=32)buffer=secondary[secondaryAddress];p.sramAddress=((h<<2)|l)&255;return;}
  if(!inRange){const value=buffer;if(p.scanline-21>=value&&p.scanline-21<value+(p.f_spriteSize?16:8))inRange=true;}
  if(used<32){
   secondary[used]=buffer;copies++;
   if(inRange){
    if(d===66)zeroAdded=true;
    l++;used++;
    if(l===4){l=0;h=(h+1)&63;if(h===0)done=true;}
    if((used&3)===0){inRange=false;if(l!==0){const value=buffer;if(!(p.scanline-21>=value&&p.scanline-21<value+(p.f_spriteSize?16:8)))l=0;}}
   }else{h=(h+1)&63;l=0;if(h===0)done=true;}
  }else{
   buffer=secondary[used&31];
   if(inRange){
    p.setStatusFlag(p.STATUS_SLSPRITECOUNT,true);
    l++;if(l===4){l=0;h=(h+1)&63;}
    if(overflowRemaining===0)overflowRemaining=3;
    else if(--overflowRemaining===0){done=true;l=0;}
   }else{h=(h+1)&63;l=(l+1)&3;if(h===0)done=true;}
  }
  p.sramAddress=((h<<2)|l)&255;
 }
 function transition(on,d,line){
  if(REFERENCE){pendingTransition={on};return;}
  if(line<20||line>260)return;
  const primaryRow=(p.sramAddress&255)>>>3;
  const from=on?primaryRow:busRow,to=on?selectedRow(d,line):primaryRow;
  if(from!==to)fail('UNSUPPORTED_MASK_OAM_ROW_PHASE','PPUMASK switches physical OAM row '+from+' to '+to+' at line '+line+' dot '+d+'; analog CPU/PPU alignment is not qualified');
  if(!on&&d>=65&&d<=256)pendingIncrement=true;
 }
 function finish(d,line){
  if(REFERENCE){
   if(!pendingTransition)return false;
   const on=pendingTransition.on;pendingTransition=null;
   // This is the delayed previous-render edge, using the CURRENT dot/line.
   // A transition that crosses into post-render/vblank has no active effects.
   if(line<20||line>260)return false;
   if(on){flushRows(d,line,'reenable');record('enabled',d,line);return false;}
   let row=-1;
   if(d>=0&&d<64)row=d>>>1;
   else if(d>=256&&d<320)row=(((d-256)>>>3)*4)+Math.min(3,(d-256)&7);
   if(row>=0){pendingRows[row]=1;rowMarks++;}
   if(d>=65&&d<=256){p.sramAddress=(p.sramAddress+1)&255;h=p.sramAddress>>>2;l=p.sramAddress&3;disableIncrements++;}
   record('disabled',d,line,row<0?[]:[row]);return true;
  }
  if(pendingIncrement){pendingIncrement=false;p.sramAddress=(p.sramAddress+1)&255;h=p.sramAddress>>>2;l=p.sramAddress&3;disableIncrements++;}
  return false;
 }
 
 const borrowed={pendingRows,corruptionTrace};
 const restoreBorrowed=s=>{({h,l,used,secondaryAddress,buffer,inRange,done,overflowRemaining,zeroAdded,zeroVisible,count,pendingIncrement,busRow,reads,copies,disableIncrements,refreshCopies,pendingTransition,rowMarks,rowCopies,droppedCorruptionTrace}=s);if(pendingRows!==s.pendingRows)restoreArray(pendingRows,s.pendingRows);replaceRows(corruptionTrace,s.corruptionTrace);};
 if(capture)capture(Object.freeze({
 borrowState:()=>{borrowed.h=h;borrowed.l=l;borrowed.used=used;borrowed.secondaryAddress=secondaryAddress;borrowed.buffer=buffer;borrowed.inRange=inRange;borrowed.done=done;borrowed.overflowRemaining=overflowRemaining;borrowed.zeroAdded=zeroAdded;borrowed.zeroVisible=zeroVisible;borrowed.count=count;borrowed.pendingIncrement=pendingIncrement;borrowed.busRow=busRow;borrowed.reads=reads;borrowed.copies=copies;borrowed.disableIncrements=disableIncrements;borrowed.refreshCopies=refreshCopies;borrowed.pendingTransition=pendingTransition;borrowed.rowMarks=rowMarks;borrowed.rowCopies=rowCopies;borrowed.droppedCorruptionTrace=droppedCorruptionTrace;return borrowed;},
 restoreBorrowed,
 pending:()=>Boolean(pendingTransition),
 exportState:()=>structuredClone({h,l,used,secondaryAddress,buffer,inRange,done,overflowRemaining,zeroAdded,zeroVisible,count,pendingIncrement,busRow,reads,copies,disableIncrements,refreshCopies,pendingTransition,rowMarks,rowCopies,droppedCorruptionTrace,pendingRows,corruptionTrace}),
 importState:state=>{const s=structuredClone(state);({h,l,used,secondaryAddress,buffer,inRange,done,overflowRemaining,zeroAdded,zeroVisible,count,pendingIncrement,busRow,reads,copies,disableIncrements,refreshCopies,pendingTransition,rowMarks,rowCopies,droppedCorruptionTrace}=s);restoreArray(pendingRows,s.pendingRows);replaceRows(corruptionTrace,s.corruptionTrace);}
 }));
return Object.freeze({tick,transition,finish,primary,read:()=>buffer,get count(){return count;},get zero(){return zeroVisible;},traceState:()=>[p.sramAddress&255,h,l,used,buffer,secondaryAddress,count,Number(inRange),Number(done),Number(zeroAdded),Number(zeroVisible)],snapshot:()=>({primary_address:p.sramAddress&255,h,l,secondary_address:secondaryAddress,used,buffer,in_range:inRange,done,count,zero_added:zeroAdded,zero_visible:zeroVisible,overflow_remaining:overflowRemaining,pending_increment:pendingIncrement,pending_transition:pendingTransition?{...pendingTransition}:null,bus_row:busRow,reads,copies,disable_increments:disableIncrements,refresh_copies:refreshCopies,reference_model:REFERENCE,pending_rows:Array.from(pendingRows.entries()).filter(x=>x[1]).map(x=>x[0]),row_marks:rowMarks,row_copies:rowCopies,corruption_trace:corruptionTrace.map(x=>({...x,rows:x.rows.slice(),first_row:x.first_row.slice()})),dropped_corruption_trace:droppedCorruptionTrace,primary:REFERENCE?Array.from(p.spriteMem):[],secondary:Array.from(secondary)})});
}
