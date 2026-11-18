// Posse SNES browser boundary. Every instance owns its complete machine memory.
export const BUTTONS = Object.freeze(['b','y','select','start','up','down','left','right','a','x','l','r']);
export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const need=(v,m)=>{if(!v)throw Error(m);};
export async function fetchPinned(pin, {fetcher=fetch,signal}={}) {
 need(pin&&/^\/games\/[a-zA-Z0-9._/-]+$/.test(pin.path)&&!pin.path.split('/').includes('..')&&Number.isInteger(pin.bytes)&&pin.bytes>0&&pin.bytes<=16*1024*1024&&/^[a-f0-9]{64}$/.test(pin.sha256),'Invalid cartridge/core resource');
 const response=await fetcher(new URL(pin.path,import.meta.url).href,{credentials:'same-origin',cache:'no-cache',redirect:'error',signal});
 need(response.ok&&response.body,'SNES resource unavailable');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;need(length<=pin.bytes,'SNES resource exceeds declared size');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 need(length===pin.bytes&&await sha256(bytes)===pin.sha256,'SNES resource integrity mismatch');return bytes;
}
function withBytes(c,bytes,fn){const p=c._malloc(bytes.length||1);need(p,'SNES allocation failed');try{c.HEAPU8.set(bytes,p);return fn(p,bytes.length);}finally{c._free(p);}}
export async function instantiateCore(config,options={}) {
 const [loader,wasm]=await Promise.all([fetchPinned(config.loader,options),fetchPinned(config.wasm,options)]);
 const url=URL.createObjectURL(new Blob([loader,'\nexport default createPosseSnesModule;\n'],{type:'text/javascript'}));
 try{
  const factory=(await import(url)).default,code=await WebAssembly.compile(wasm);
  return await factory({print(){},printErr(){},instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(code,imports);receive(instance,code);return instance.exports;}});
 }finally{URL.revokeObjectURL(url);}
}
export class BrowserSnesRunner {
 constructor(core,config,sampleRate){this.core=core;this.config=config;this.sampleRate=sampleRate;this.frame=0;this.audioFrames=0;this.pads=[0,0];}
 static async create(config,{sampleRate=48000,core=null,rom=null}={}) {
  need(Number.isInteger(sampleRate)&&sampleRate>=8000&&sampleRate<=96000,'Invalid SNES audio rate');
  const c=core??await instantiateCore(config.core),bytes=rom??await fetchPinned(config.rom);
  need(await sha256(bytes)===config.rom.sha256&&bytes.length===config.rom.bytes,'SNES cartridge identity mismatch');
  c._s9xwasm_set_loglevel(0);
  need(c._s9xwasm_setup(sampleRate,0,2)===1,'SNES initialization failed');
  need(withBytes(c,bytes,(p,n)=>c._s9xwasm_load_rom(p,n))===1,'SNES cartridge rejected');
  const m=config.metadata;
  need(m.romSha256===config.rom.sha256&&c._s9xwasm_rom_size()===m.romBytes&&c._s9xwasm_sram_size()===m.ramBytes&&!!c._s9xwasm_is_pal()===(m.region==='pal'),'SNES hardware metadata mismatch');
  return new BrowserSnesRunner(c,config,sampleRate);
 }
 live(){need(this.core,'SNES runner disposed');return this.core;}
 input(player,mask){need((player===1||player===2)&&Number.isInteger(mask)&&mask>=0&&mask<=4095,'Invalid SNES controller input');this.pads[player-1]=mask;}
 step(){const c=this.live();for(let p=0;p<2;p++)c._s9xwasm_input(p,this.pads[p]);c._s9xwasm_skip_render(0);const count=c._s9xwasm_exec(),width=c._s9xwasm_frame_width(),height=c._s9xwasm_frame_height();need(count>=0&&count%2===0&&count<=this.sampleRate/5&&width>0&&width<=512&&height>0&&height<=478,'Invalid SNES output');const vp=c._s9xwasm_frame_rgba(),ap=c._s9xwasm_audio_ptr();const rgba=c.HEAPU8.slice(vp,vp+width*height*4),audio=c.HEAP16.slice(ap/2,ap/2+count);const result={frame:this.frame++,audioStart:this.audioFrames,width,height,rgba,audio,sampleRate:this.sampleRate};this.audioFrames+=count/2;return result;}
 reset(){this.live()._s9xwasm_reset();this.frame=0;this.audioFrames=0;this.pads=[0,0];}
 info(){return {fps:this.live()._s9xwasm_framerate_micro()/1e6,sampleRate:this.sampleRate,frame:this.frame,audioFrames:this.audioFrames};}
 identity(){return {romSha256:this.config.rom.sha256,coreSha256:this.config.core.wasm.sha256,sampleRate:this.sampleRate};}
 capture(){const c=this.live(),size=c._posse_checkpoint_save(),p=c._posse_checkpoint_ptr();need(p&&size>=16&&size<=8*1024*1024,'SNES checkpoint capture failed');return c.HEAPU8.slice(p,p+size);}
 async save(){const data=this.capture();return {format:'posse-snes-browser-state/1',...this.identity(),frame:this.frame,audioFrames:this.audioFrames,pads:[...this.pads],data,sha256:await sha256(data)};}
 async load(record){
  need(record?.format==='posse-snes-browser-state/1','Invalid SNES checkpoint');for(const [k,v]of Object.entries(this.identity()))need(record[k]===v,'SNES checkpoint identity mismatch');
  need(record.data instanceof Uint8Array&&record.data.length>=16&&record.data.length<=8*1024*1024&&await sha256(record.data)===record.sha256,'SNES checkpoint integrity mismatch');
  need(Number.isSafeInteger(record.frame)&&record.frame>=0&&Number.isSafeInteger(record.audioFrames)&&record.audioFrames>=0&&Array.isArray(record.pads)&&record.pads.length===2&&record.pads.every(p=>Number.isInteger(p)&&p>=0&&p<=4095),'Invalid SNES checkpoint timeline');
  const c=this.live(),backup=this.capture();if(!withBytes(c,record.data,(p,n)=>c._posse_checkpoint_load(p,n))){if(!withBytes(c,backup,(p,n)=>c._posse_checkpoint_load(p,n)))this.dispose();throw Error('SNES checkpoint rejected');}
  this.frame=record.frame;this.audioFrames=record.audioFrames;this.pads=[...record.pads];
 }
 async battery(){const c=this.live(),n=this.config.metadata.nvramBytes,p=c._s9xwasm_sram_ptr(),data=c.HEAPU8.slice(p,p+n);return {format:'posse-snes-battery/1',romSha256:this.config.rom.sha256,nvramBytes:n,data,sha256:await sha256(data)};}
 async importBattery(record){const n=this.config.metadata.nvramBytes;need(record?.format==='posse-snes-battery/1'&&record.romSha256===this.config.rom.sha256&&record.nvramBytes===n&&record.data instanceof Uint8Array&&record.data.length===n&&await sha256(record.data)===record.sha256,'SNES battery identity/integrity mismatch');const c=this.live();c.HEAPU8.set(record.data,c._s9xwasm_sram_ptr());}
 dispose(){this.core=null;this.pads=[0,0];}
}
