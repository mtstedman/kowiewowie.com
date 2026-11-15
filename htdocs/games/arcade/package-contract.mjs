export function insist(ok,message){if(!ok)throw new TypeError(message);}
export function exact(o,keys){insist(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k)),'Unexpected contract fields');}
export function freeze(o){if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
export function canonical(o){if(o===null||typeof o!=='object')return JSON.stringify(o);if(Array.isArray(o))return '['+o.map(canonical).join(',')+']';return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';}
export async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
export const isDigest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)&&v!=='0'.repeat(64);
const id=v=>typeof v==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)&&v.length<=64;
const text=(v,max=240)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const url=v=>typeof v==='string'&&/^\/games\/[a-z0-9-]+\/(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\/)*[A-Za-z0-9_.-]*$/.test(v)&&!v.split('/').some(x=>x==='.'||x==='..')&&v.length<=512;
export function validateManifest(m){
 exact(m,['format','hostApi','id','title','platform','publisher','year','route','entry','image','notes','capabilities','surfaces','inputs','timing','files']);
 insist(m.format==='game-package/1'&&m.hostApi===1,'Unsupported package or host API version');
 insist(id(m.id)&&text(m.title,100)&&text(m.platform,40)&&text(m.publisher,80)&&/^\d{4}$/.test(m.year),'Invalid package identity/label');
 insist(url(m.route)&&m.route.endsWith('/')&&m.route!=='/games/arcade/'&&url(m.entry)&&m.entry.endsWith('.mjs'),'Invalid route/entry');
 insist(m.image===null||url(m.image),'Invalid image URL');exact(m.notes,['usage','attribution']);insist(url(m.notes.usage)&&url(m.notes.attribution),'Invalid note URLs');
 const c=m.capabilities;exact(c,['verified','evidence','nativePlayers','mode','play','watch']);
 insist(c.verified===true&&text(c.evidence)&&typeof c.watch==='boolean','Verified capability evidence required');
 insist((c.nativePlayers===1&&c.mode==='solo'&&['none','shared-hero'].includes(c.play))||(c.nativePlayers===2&&['simultaneous','alternating'].includes(c.mode)&&['none','host-p1-guest-p2'].includes(c.play)),'Contradictory player/control capabilities');
 const s=m.surfaces;exact(s,['view','video','audio']);insist(s.view==='dom','Unsupported view surface');exact(s.video,['kind','width','height']);exact(s.audio,['kind','channels','sampleRate']);
 insist(['canvas','video','none'].includes(s.video.kind)&&Number.isInteger(s.video.width)&&s.video.width>=1&&s.video.width<=8192&&Number.isInteger(s.video.height)&&s.video.height>=1&&s.video.height<=8192,'Invalid video surface');
 insist(['web-audio','media-element','none'].includes(s.audio.kind)&&Number.isInteger(s.audio.channels)&&s.audio.channels>=0&&s.audio.channels<=8&&Number.isInteger(s.audio.sampleRate)&&s.audio.sampleRate>=0&&s.audio.sampleRate<=192000,'Invalid audio surface');
 insist(s.audio.kind==='none'?(s.audio.channels===0&&s.audio.sampleRate===0):(s.audio.channels>0&&s.audio.sampleRate>0),'Contradictory audio declaration');
 insist(!c.watch||(s.video.kind!=='none'&&s.audio.kind!=='none'),'Watching requires declared game video and audio');
 insist(Array.isArray(m.inputs)&&m.inputs.length<=64,'Invalid input descriptors');const seen=new Set();
 for(const i of m.inputs){exact(i,['id','label','hint','kind','activation']);insist(id(i.id)&&!seen.has(i.id)&&text(i.label,40)&&text(i.hint,160)&&i.kind==='button'&&['input','start'].includes(i.activation),'Invalid input descriptor');seen.add(i.id);}
 exact(m.timing,['nominalHz','clockOwner']);insist(Number.isFinite(m.timing.nominalHz)&&m.timing.nominalHz>0&&m.timing.nominalHz<=1000&&m.timing.clockOwner==='adapter','Invalid nominal timing');
 insist(m.files&&typeof m.files==='object'&&!Array.isArray(m.files)&&Object.keys(m.files).length>0&&Object.keys(m.files).length<=1024,'Invalid package inventory');let size=0;
 for(const [p,r] of Object.entries(m.files)){exact(r,['bytes','sha256']);insist(url(p)&&Number.isSafeInteger(r.bytes)&&r.bytes>=0&&r.bytes<=67108864&&isDigest(r.sha256),'Invalid artifact member');size+=r.bytes;}
 insist(size<=268435456&&Object.hasOwn(m.files,m.entry),'Package ceiling or entry inventory mismatch');return m;
}
export async function verifyPackage(envelope,expected){
 exact(envelope,['manifest','artifactDigest']);validateManifest(envelope.manifest);insist(isDigest(expected)&&envelope.artifactDigest===expected,'Catalog artifact digest mismatch');
 insist(await digest(new TextEncoder().encode(canonical(envelope.manifest)))===expected,'Package content digest mismatch');
 return freeze({...structuredClone(envelope.manifest),artifactDigest:expected});
}
export class Catalog {
 #items=new Map();
 register(p){insist(Object.isFrozen(p)&&isDigest(p.artifactDigest),'Register a verified immutable package');const {artifactDigest,...manifest}=p;validateManifest(manifest);insist(!this.#items.has(p.id)&&!this.list().some(x=>x.route===p.route),'Duplicate package ID or route');this.#items.set(p.id,p);return p;}
 get(id){const p=this.#items.get(id);insist(p,'Unknown game package');return p;}
 list(){return Object.freeze([...this.#items.values()]);}
 route(href){
  const u=new URL(href,'https://wowiekowie.com'),original=u.pathname+u.search+u.hash;
  const alias=this.list().find(p=>u.pathname.replace(/index\.html$/,'').replace(/\/$/,'')===p.route.slice(0,-1));
  insist(alias||['/games/arcade/','/games/arcade','/games/arcade/index.html'].includes(u.pathname),'Unknown game-host route');
  insist(u.searchParams.getAll('package').length<=1&&u.searchParams.getAll('cartridge').length<=1,'Duplicate package selection');
  const a=u.searchParams.get('package'),b=u.searchParams.get('cartridge');
  insist((a===null||a.length>0)&&(b===null||b.length>0)&&(!a||!b||a===b),'Conflicting package selection');
  const chosen=a||b||alias?.id||null;if(chosen)this.get(chosen);insist(!alias||!chosen||chosen===alias.id,'Alias and package selection disagree');
  u.pathname='/games/arcade/';u.searchParams.delete('cartridge');if(chosen)u.searchParams.set('package',chosen);else u.searchParams.delete('package');
  const canonical=u.pathname+u.search+u.hash;return {id:chosen,canonical:canonical===original?null:canonical};
 }
}
export async function readBytes(url,limit,signal){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();
 try{const r=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:abort.signal});insist(r.ok&&r.body,'Static package resource unavailable');const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;insist(size<=limit,'Static package resource exceeds limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}const out=new Uint8Array(size);let at=0;for(const b of chunks){out.set(b,at);at+=b.length;}return out;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function loadCatalog(signal){
 const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes('/games/arcade/catalog.json',65536,signal)));insist(Array.isArray(rows)&&rows.length>0&&rows.length<=128,'Invalid catalog');const catalog=new Catalog();
 for(const row of rows){exact(row,['id','manifest','artifactDigest']);insist(id(row.id)&&url(row.manifest)&&row.manifest.endsWith('.json')&&isDigest(row.artifactDigest),'Invalid catalog registration');const e=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(row.manifest,524288,signal)));const p=await verifyPackage(e,row.artifactDigest);insist(p.id===row.id,'Catalog identity mismatch');catalog.register(p);}return catalog;
}

export function playDescription(p){return p.capabilities.play==='shared-hero'?'Share one hero · both people control the same character.':p.capabilities.play==='host-p1-guest-p2'?'Host: Player 1 · guest: Player 2 · '+(p.capabilities.mode==='alternating'?'take turns.':'play together.'):'Play invitations are unavailable for this package.';}
