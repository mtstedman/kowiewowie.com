import {restoreArray} from './state-transfer-runtime.mjs';
// Device data only. The five invocation slots are deliberately never serialized.
export const fields='dot,last_x,last_y,last_clear,last_read,fetch_reads,scanline,x,odd,v,t,fine_x,first,lo,hi,al,ah,nt,at,pl,ph,address,bus_low,fetch_kind,attribute_fill,attribute_shift,carry_dummy,render_previous,bg,sp,bg_clip,sp_clip,sprite_size,bg_table,sp_table,disp_type,sram_address,sprites_found,sprite0_in_secondary,status,hit_sprite0,addr_inc,mirror,vblank_pending,event,event_remaining,event_ack,advance_remaining,advance_active,address_commits,active_address_commits,address_pending,address_left,address_value,increment_pending,mask_count,mask_value,mask_due,sprites,oam,primary,secondary,chr,ciram,palette,rgb,frame'.split(',');
export const oamFields='h,l,used,secondary_address,buffer,in_range,done,overflow_remaining,zero_added,zero_visible,count,bus_row,pending_increment,pending_transition,pending_rows,reads,copies,disable_increments,refresh_copies,row_marks,row_copies,trace_count,dropped_trace,trace'.split(',');
const closureMap={dot:'dot',last_x:'lastX',last_y:'lastY',last_clear:'lastClear',last_read:'lastRead',fetch_reads:'fetchReads',odd:'odd',v:'v',t:'t',fine_x:'fineX',first:'first',lo:'lo',hi:'hi',al:'al',ah:'ah',nt:'nt',at:'at',pl:'pl',ph:'ph',address:'addr',bus_low:'busLow',fetch_kind:'fetchKind',attribute_fill:'attributeFill',attribute_shift:'attrShift',carry_dummy:'carryDummy',render_previous:'renderPrevious'};
const deviceMap={scanline:'scanline',x:'curX',bg:'f_bgVisibility',sp:'f_spVisibility',bg_clip:'f_bgClipping',sp_clip:'f_spClipping',sprite_size:'f_spriteSize',bg_table:'f_bgPatternTable',sp_table:'f_spPatternTable',disp_type:'f_dispType',sram_address:'sramAddress',sprites_found:'spritesFound',sprite0_in_secondary:'sprite0InSecondary',hit_sprite0:'hitSpr0',addr_inc:'f_addrInc',vblank_pending:'vblankPending'};
const oamMap={h:'h',l:'l',used:'used',secondary_address:'secondaryAddress',buffer:'buffer',in_range:'inRange',done:'done',overflow_remaining:'overflowRemaining',zero_added:'zeroAdded',zero_visible:'zeroVisible',count:'count',bus_row:'busRow',pending_increment:'pendingIncrement',reads:'reads',copies:'copies',disable_increments:'disableIncrements',refresh_copies:'refreshCopies',row_marks:'rowMarks',row_copies:'rowCopies',dropped_trace:'droppedCorruptionTrace'};
const spriteFields='lo,hi,counter,armed,attr,zero,valid,address,x'.split(',');
const recordFields='kind,dot,scanline,row_bits,primary_address,h,l,used,buffer,first_row'.split(',');
const kinds=[null,'prerender','reenable','enabled','disabled'];
const invocation=new Set(['event','event_remaining','event_ack','advance_remaining','advance_active']);
const cast=(v,old)=>typeof old==='boolean'?Boolean(v):v;
function numeric(v,width){
 if(typeof v==='boolean')v=Number(v);
 if(typeof v!=='number'||(width!==8&&(!Number.isInteger(v)||v<0||v>2**(width*8)-1||Object.is(v,-0))))throw Error('ABI2 unrepresentable numeric value');
 return v;
}
export function createCodec(e,{fixedMemory=false}={}){
 if(e.ppu_abi()!==2||!(e.memory instanceof WebAssembly.Memory))throw Error('Expected ABI2 Wasm exports');
 const base=e.ppu_state()>>>0,size=e.ppu_state_size()>>>0;
 if(base+size>e.memory.buffer.byteLength)throw Error('ABI2 state bounds');
 let cachedBuffer=e.memory.buffer,cachedView=new DataView(cachedBuffer);const typedViews=new Map();
 function validateMemory(){const buffer=e.memory.buffer;if(buffer!==cachedBuffer){if(fixedMemory)throw Error('Private owned Wasm memory changed');cachedBuffer=buffer;cachedView=new DataView(buffer);typedViews.clear();}if(base+size>cachedBuffer.byteLength)throw Error('ABI2 state bounds');}
 const view=fixedMemory?()=>cachedView:()=>{validateMemory();return cachedView;};
 function table(names,count,value,parent=0,limit=size){
  if(count()!==names.length)throw Error('ABI2 descriptor count');
  return Object.fromEntries(names.map((name,i)=>{const offset=value(i,0)>>>0,width=value(i,1)>>>0,n=value(i,2)>>>0;
   if(!n||!width||offset+width*n>limit)throw Error('ABI2 descriptor bounds: '+name);
   return [name,{offset:base+parent+offset,width,n}];}));
 }
 const layout=table(fields,e.ppu_layout_count,e.ppu_layout_value);
 const ol=table(oamFields,e.ppu_oam_layout_count,e.ppu_oam_layout_value,layout.oam.offset-base,layout.oam.width);
 const sl=table(spriteFields,e.ppu_sprite_layout_count,e.ppu_sprite_layout_value,0,layout.sprites.width);
 const rl=table(recordFields,e.ppu_record_layout_count,e.ppu_record_layout_value,0,ol.trace.width);
 const doubles=new Set(['dot','last_x','last_y','last_clear','last_read','fetch_reads','address_commits','active_address_commits']);
 const odoubles=new Set(['reads','copies','disable_increments','refresh_copies','row_marks','row_copies','dropped_trace']);
 for(const [name,key] of Object.entries(closureMap))if(layout[name].width!==(doubles.has(name)?8:4))throw Error('ABI2 scalar type');
 for(const name of Object.keys(deviceMap))if(layout[name].width!==4)throw Error('ABI2 device type');
 for(const name of Object.keys(oamMap))if(ol[name].width!==(odoubles.has(name)?8:4))throw Error('ABI2 OAM type');
 function get(d,i=0){if(i<0||i>=d.n)throw Error('ABI2 index');const v=view(),a=d.offset+d.width*i;return d.width===8?v.getFloat64(a,true):d.width===4?v.getUint32(a,true):d.width===1?v.getUint8(a):(()=>{throw Error('ABI2 width');})();}
 function put(d,v,i=0){if(i<0||i>=d.n)throw Error('ABI2 index');v=numeric(v,d.width);const w=view(),a=d.offset+d.width*i;if(d.width===8)w.setFloat64(a,v,true);else if(d.width===4)w.setUint32(a,v,true);else if(d.width===1)w.setUint8(a,v);else throw Error('ABI2 width');}
 const nested=(d,slot,field)=>({...field,offset:d.offset+d.width*slot+field.offset-base});
 function shared(d,a){return ArrayBuffer.isView(a)&&a.buffer===cachedBuffer&&a.byteOffset===d.offset&&a.BYTES_PER_ELEMENT===d.width&&a.length===d.n;}
 function arrayIn(d,a){if(!a||a.length!==d.n)throw Error('ABI2 array shape');if(shared(d,a))return;for(let i=0;i<d.n;i++)put(d,a[i],i);}
 function arrayOut(d,a){if(a.length!==d.n)throw Error('ABI2 array shape');if(shared(d,a))return;for(let i=0;i<d.n;i++)a[i]=get(d,i);}
 function write(s,host){
  validateMemory();
  if(s?.abi!=='owned-renderer-js/1')throw Error('JS state ABI');
  for(const [a,b] of Object.entries(closureMap))put(layout[a],s.closure[b]);
  for(const [a,b] of Object.entries(deviceMap))put(layout[a],s.device[b]);
  put(layout.status,s.status);put(layout.address_commits,s.access.addressCommits);put(layout.active_address_commits,s.access.activeAddressCommits);
  // Device constants are not the C mirror enums: never copy currentMirroring.
  if(!['horizontal','vertical'].includes(host.mirroring))throw Error('Unsupported owned mirroring');
  put(layout.mirror,host.mirroring==='horizontal'?0:1);
  const c=s.closure,ap=c.addressPending;
  put(layout.address_pending,Number(!!ap));put(layout.address_left,ap?.left??0);put(layout.address_value,ap?.value??0);put(layout.increment_pending,c.incrementPending);
  put(layout.mask_count,s.maskQueue.length);
  for(let i=0;i<8;i++){put(layout.mask_value,s.maskQueue[i]?.value??0,i);put(layout.mask_due,s.maskQueue[i]?.due??0,i);}
  if(s.current.length!==8)throw Error('ABI2 sprite count');
  for(let i=0;i<8;i++)for(const f of spriteFields)put(nested(layout.sprites,i,sl[f]),s.current[i][f]);
  for(const [a,b] of Object.entries(oamMap))put(ol[a],s.oam[b]);
  put(ol.pending_transition,s.oam.pendingTransition?(s.oam.pendingTransition.on?2:1):0);arrayIn(ol.pending_rows,s.oam.pendingRows);
  const trace=s.oam.corruptionTrace;if(trace.length>16)throw Error('ABI2 trace capacity');put(ol.trace_count,trace.length);
  for(let i=0;i<trace.length;i++){
   const r=trace[i];let bits=0;for(const row of r.rows){if(!Number.isInteger(row)||row<0||row>31)throw Error('ABI2 OAM row');bits=(bits|2**row)>>>0;}
   for(const f of recordFields){const d=nested(ol.trace,i,rl[f]);if(f==='first_row')arrayIn(d,r[f]);else put(d,f==='kind'?kinds.indexOf(r.kind):f==='row_bits'?bits:r[f]);}
  }
  for(const name of ['primary','secondary','frame'])arrayIn(layout[name],s.bulk[name]);
  for(const name of ['chr','ciram','palette','rgb'])arrayIn(layout[name],host[name]);
 }
 function read(s){
  validateMemory();
  const previousDot=s.closure.dot;
  // s is the private sidecar. Mutate mapped fields only; queues, aliases, host
  // CPU/NMI fields, histories and unsupported device fields retain their graph.
  for(const [a,b] of Object.entries(closureMap))s.closure[b]=cast(get(layout[a]),s.closure[b]);
  for(const [a,b] of Object.entries(deviceMap))s.device[b]=cast(get(layout[a]),s.device[b]);
  s.status=get(layout.status);s.access.addressCommits=get(layout.address_commits);s.access.activeAddressCommits=get(layout.active_address_commits);
  for(let i=0;i<8;i++)for(const f of spriteFields)s.current[i][f]=cast(get(nested(layout.sprites,i,sl[f])),s.current[i][f]);
  for(const [a,b] of Object.entries(oamMap))s.oam[b]=cast(get(ol[a]),s.oam[b]);
  const pending=get(ol.pending_transition);s.oam.pendingTransition=pending?{on:pending===2}:null;arrayOut(ol.pending_rows,s.oam.pendingRows);
  const count=get(ol.trace_count);if(count>16)throw Error('ABI2 corrupt trace count');
  const rows=[];for(let i=0;i<count;i++){
   const r={};for(const f of recordFields){const d=nested(ol.trace,i,rl[f]);if(f==='first_row'){r[f]=new Array(8);arrayOut(d,r[f]);}else if(f==='kind'){r.kind=kinds[get(d)];if(!r.kind)throw Error('ABI2 record kind');}else if(f==='row_bits'){const bits=get(d);r.rows=Array.from({length:32},(_,j)=>j).filter(j=>(bits>>>j)&1);}else r[f]=get(d);}rows.push(r);
  }
  s.oam.corruptionTrace.splice(0,s.oam.corruptionTrace.length,...rows);
  for(const name of ['primary','secondary','frame'])arrayOut(layout[name],s.bulk[name]);
  if(s.closure.dot!==previousDot){const d=s.device,c=s.closure,v=c.v,t=c.t;
   Object.assign(d,{vramAddress:v,vramTmpAddress:t,firstWrite:c.first,regFH:c.fineX,cntFV:(v>>>12)&7,cntV:(v>>>11)&1,cntH:(v>>>10)&1,cntVT:(v>>>5)&31,cntHT:v&31,regFV:(t>>>12)&7,regV:(t>>>11)&1,regH:(t>>>10)&1,regVT:(t>>>5)&31,regHT:t&31});
  }
  return s;
 }
 function typed(name,Type){validateMemory();const d=layout[name];if(!d||!((Type===Uint8Array&&d.width===1)||(Type===Uint32Array&&d.width===4)))throw Error('ABI2 typed view shape');let a=typedViews.get(name);if(!a){a=new Type(cachedBuffer,d.offset,d.n);typedViews.set(name,a);}return a;}
 return Object.freeze({write,read,get:name=>get(layout[name]),set:(name,value)=>put(layout[name],value),typed,isShared:(name,a)=>shared(layout[name],a),invocationFields:Object.freeze([...invocation]),layout,ol});
}
export function intervalFallback(s,n,dot=s.closure.dot){
 if(!Number.isInteger(n)||n<0||n>24576)return 'invalid-argument';
 if(s.closure.addressPending||s.closure.incrementPending||s.closure.maskPending||s.maskQueue.length)return 'queued-register-effect';
 if(s.closure.edgeRemaining>0)return 'edge-trace-window';
 if(s.oam.pendingTransition)return 'pending-oam-transition';
 if(dot+n>=Number.MAX_SAFE_INTEGER-1)return 'clock-limit-partial-progress';
 return null;
}
