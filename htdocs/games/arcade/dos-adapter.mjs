// GPL-2.0-or-later. Host integration for the source-built Posse DOSBox core.
// The machine owns execution/timing; this adapter owns input, audio and presentation.
export async function verifiedBytes(pin, signal) {
 const response=await fetch(pin.path,{signal,cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error('DOS resource unavailable');
 const bytes=new Uint8Array(await response.arrayBuffer());
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==pin.bytes||sha!==pin.sha256)throw Error('DOS resource integrity mismatch: '+pin.path);
 return bytes;
}
export function createDOSAdapter(ctx,config){
 let root,canvas,assets,audio,gain,session=null,closed=false,ready=false,loading=true,running=false,message='Loading',raf=0,pending=null,nextAudio=0,frames=0,ms=0;
 const events=new AbortController(),sources=new Map(),sounds=new Set();
 const notify=()=>ctx.changed();
 const listen=(target,type,fn)=>target.addEventListener(type,fn,{signal:events.signal});
 const signal=(s,state)=>{Atomics.store(s.ctl,2,state);Atomics.add(s.ctl,4,1);Atomics.notify(s.ctl,4);};
 function clearAudio(){for(const node of sounds){try{node.stop();}catch{}node.disconnect();}sounds.clear();nextAudio=0;}
 function stop(){if(session){signal(session,2);session.worker.terminate();URL.revokeObjectURL(session.url);session=null;}sources.clear();pending=null;running=false;loading=false;clearAudio();}
 function fault(error){stop();message=String(error.message||error);ready=false;notify();}
 function enqueue(control,pressed){
  if(!session)return false;const key=assets.keys[config.controls[control]?.key];if(key===undefined)return false;
  const c=session.ctl,head=Atomics.load(c,0),tail=Atomics.load(c,1);
  if(((head-tail)|0)>=256){fault(Error('Keyboard queue overflow; reset the game to continue.'));return false;}
  Atomics.store(c,16+(head&255),key*2+(pressed?1:0));Atomics.store(c,0,(head+1)|0);return true;
 }
 function releaseAll(){const controls=new Set(sources.values());sources.clear();for(const control of controls)enqueue(control,false);}
 function input(e){
  if(closed||e.seat!==1||!config.controls[e.control])return false;
  if(!e.pressed){const old=sources.get(e.source);if(!old)return false;sources.delete(e.source);if(![...sources.values()].includes(old))enqueue(old,false);return true;}
  if(!running||!session||sources.has(e.source))return false;
  if(![...sources.values()].includes(e.control)&&!enqueue(e.control,true))return false;sources.set(e.source,e.control);return true;
 }
 function paint(){if(closed)return;raf=requestAnimationFrame(paint);if(!pending)return;
  const m=pending;pending=null;if(canvas.width!==m.w||canvas.height!==m.h){canvas.width=m.w;canvas.height=m.h;}
  const src=new Uint32Array(m.data),img=new ImageData(m.w,m.h),out=new Uint32Array(img.data.buffer);
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){const v=src[y*m.pitch/4+x];out[y*m.w+x]=0xff000000|((v>>>16)&255)|(v&0xff00)|((v&255)<<16);}
  canvas.getContext('2d').putImageData(img,0,0);frames++;
 }
 function playAudio(m){if(!audio||!running)return;const pcm=new Int16Array(m.data),n=pcm.length/2,b=audio.createBuffer(2,n,m.rate);
  for(let c=0;c<2;c++){const a=b.getChannelData(c);for(let i=0;i<n;i++)a[i]=pcm[i*2+c]/32768;}
  const now=audio.currentTime;if(nextAudio<now+.03||nextAudio>now+.4)nextAudio=now+.06;
  const node=audio.createBufferSource();node.buffer=b;node.connect(gain);sounds.add(node);node.onended=()=>{sounds.delete(node);node.disconnect();};node.start(nextAudio);nextAudio+=b.duration;
 }
 async function start(){
  if(closed||!assets)throw Error('DOS package is not ready');
  audio??=new AudioContext();if(!gain){gain=audio.createGain();gain.connect(audio.destination);}await audio.resume();if(closed)return;
  if(session){signal(session,0);running=true;message='Running';canvas.focus();notify();return;}
  ready=true;loading=true;running=false;message='Starting';frames=0;ms=0;
  const url=URL.createObjectURL(new Blob([assets.worker],{type:'text/javascript'})),worker=new Worker(url),s={worker,url,ctl:new Int32Array(new SharedArrayBuffer(272*4))};
  session=s;Atomics.store(s.ctl,3,100);
  worker.onmessage=({data:m})=>{if(session!==s||closed)return;
   if(m.type==='started'){loading=false;running=Atomics.load(s.ctl,2)===0;message=running?'Running':'Paused';if(running)canvas.focus();notify();}
   else if(m.type==='frame')pending=m;
   else if(m.type==='audio')playAudio(m);
   else if(m.type==='clock'){ms=m.ms;}
   else if(m.type==='error')fault(Error(m.message));
   else if(m.type==='exit'||m.type==='returned'){stop();message=m.error||'Stopped';ready=true;notify();}
  };
  worker.onerror=e=>{if(session===s)fault(Error(e.message||'DOS worker failed'));};
  worker.postMessage({ctl:s.ctl.buffer,js:assets.js,wasm:assets.wasm,drive:assets.drive,conf:assets.conf,mtimeMs:assets.mtimeMs});notify();
 }
 function pause(){releaseAll();if(session)signal(session,1);running=false;clearAudio();message='Paused';notify();}
 async function dispose(){if(closed)return;closed=true;events.abort();cancelAnimationFrame(raf);stop();await audio?.close();root?.remove();}
 ctx.scope.defer(dispose);
 return {version:1,packageId:ctx.package.id,artifactDigest:ctx.package.artifactDigest,
  async load(){
   if(!globalThis.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')throw Error('DOS requires cross-origin isolation');
   root=document.createElement('div');root.className='nes-view dos-view';root.tabIndex=0;root.setAttribute('aria-label',ctx.package.title+' controls');
   const frame=document.createElement('div');frame.className='video-frame';canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;canvas.tabIndex=0;canvas.setAttribute('aria-label','Game video');frame.append(canvas);root.append(frame);
   const help=document.createElement('p');help.className='quiet';help.textContent='Arrow keys move · Ctrl jumps · Alt uses pogo · Ctrl + Alt fires · Enter confirms · Esc opens the menu';root.append(help);ctx.view.append(root);
   const [data,worker,js,wasm]=await Promise.all([config.data,config.worker,config.js,config.wasm].map(p=>verifiedBytes(p,ctx.signal)));
   if(closed||ctx.signal.aborted)throw Error('Load cancelled');const drive=JSON.parse(new TextDecoder().decode(data));assets={...drive,worker,js,wasm};
   listen(canvas,'pointerdown',()=>canvas.focus());
   const keyControl=code=>Object.entries(config.controls).find(([,c])=>c.codes.includes(code))?.[0];
   listen(window,'keydown',e=>{const control=keyControl(e.code);if(!control||!root.contains(document.activeElement)||e.isComposing||e.metaKey)return;e.preventDefault();if(!e.repeat&&ctx.canControl())ctx.input({control,source:'keyboard:'+e.code,pressed:true});});
   listen(window,'keyup',e=>{const control=keyControl(e.code);if(control)ctx.input({control,source:'keyboard:'+e.code,pressed:false});});
   listen(root,'focusout',e=>{if(!root.contains(e.relatedTarget))releaseAll();});
   ready=true;loading=false;message='Ready';raf=requestAnimationFrame(paint);notify();
  },start,resume:start,pause,reset(){stop();ready=Boolean(assets);message='Ready';frames=0;ms=0;canvas?.getContext('2d').clearRect(0,0,canvas.width,canvas.height);notify();},dispose,input,releaseAll,
  snapshot:()=>({ready,running,loading,closed,message,presentedFrames:frames,emulatedMs:ms}),
  surfaces:()=>({view:root,video:canvas,audio:{kind:'web-audio',getNodes:()=>({context:audio??null,node:gain??null})}})
 };
}
