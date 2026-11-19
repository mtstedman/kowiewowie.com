export const VERSION='game-network-binding/1';
export const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
export function insist(ok,message){if(!ok)throw new TypeError(message);}
export function freeze(o){if(o&&typeof o==='object'){for(const v of Object.values(o))freeze(v);Object.freeze(o);}return o;}
export function validateBinding(b){
 insist(b&&b.version===VERSION&&b.protocol===3&&b.catalog==='romjs-cartridge-roles/1','Binding version');
 insist(typeof b.packageId==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.packageId)&&b.packageId.length<=64&&hex(b.artifactDigest,64),'Package identity');
 insist(['game-network-package/1','game-package/1'].includes(b.packageFormat)&&b.route==='/games/'+b.packageId+'/','Package route');
 insist(typeof b.entryAdapter==='string'&&b.entryAdapter.startsWith(b.route)&&b.entryAdapter.endsWith('.mjs')&&typeof b.adapter==='string','Adapter identity');
 const c=b.capabilities,p=b.players;
 insist(c&&c.watch===true&&c.video===true&&c.audio===true&&p&&typeof p.local==='string'&&typeof p.remote==='string','Capabilities');
 for(const id of [p.local,p.remote])insist(/^[a-z][a-z0-9-]{0,31}$/.test(id),'Player identifier');
 insist(c.nativePlayers===1&&c.play==='shared-hero'&&b.compatibility==='solo-shared/1'&&p.local===p.remote||c.nativePlayers===2&&c.play==='independent'&&b.compatibility==='native-two/1'&&p.local!==p.remote,'Player classification');
 insist(b.inputProfile==='buttons/1'&&hex(b.inputsDigest,64)&&Array.isArray(b.inputs)&&b.inputs.length>0&&b.inputs.length<=64,'Input profile');
 const seen=new Set();for(const i of b.inputs){insist(i&&typeof i.id==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(i.id)&&!seen.has(i.id)&&i.kind==='button'&&typeof i.label==='string'&&i.label.length>0&&i.label.length<=40,'Input descriptor');seen.add(i.id);}
 return freeze(structuredClone(b));
}
export function zero(b){return Object.fromEntries(b.inputs.map(i=>[i.id,false]));}
export function full(b,v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===b.inputs.length&&b.inputs.every(i=>Object.hasOwn(v,i.id)&&typeof v[i.id]==='boolean');}
export function assignment(b,d){
 insist(d&&d.protocol===3&&d.catalog===b.catalog&&d.binding===b.version&&d.packageId===b.packageId&&d.artifactDigest===b.artifactDigest&&d.inputsDigest===b.inputsDigest,'Assignment binding');
 insist(hex(d.participant,32)&&['watch','play'].includes(d.participant_role)&&(d.session===''||hex(d.session,32)),'Assignment identity');
 const play=d.participant_role==='play';
 insist(d.player===(play?b.players.remote:null)&&d.compatibility===b.compatibility&&d.inputProfile===b.inputProfile,'Assignment player');
 insist(d.capabilities&&Object.keys(d.capabilities).length===3&&d.capabilities.video===true&&d.capabilities.audio===true&&d.capabilities.input===play,'Assignment capabilities');
 return freeze(Object.fromEntries(['protocol','catalog','binding','packageId','artifactDigest','inputsDigest','participant','participant_role','session','player','compatibility','inputProfile','capabilities'].map(k=>[k,structuredClone(d[k])])));
}
export function validateSDP(d,watch){
 insist(d&&Object.keys(d).length===2&&['offer','answer'].includes(d.type)&&typeof d.sdp==='string'&&new TextEncoder().encode(d.sdp).length<=32768&&d.sdp.startsWith('v=0\r\n')&&!/[^\x09\x0a\x0d\x20-\x7e]/.test(d.sdp)&&!/\r(?!\n)/.test(d.sdp),'SDP envelope');
 const lines=d.sdp.split(/\r?\n/),sections=[],sessionDirections=[];let current=null,candidates=0,hasData=false;insist(lines.length<=1024,'SDP lines');
 for(const line of lines){
  insist(line.length<=1024,'SDP line size');if(line.startsWith('a=candidate:'))insist(++candidates<=64,'SDP candidates');
  if(/^(m=application\b|a=(sctp-port|sctpmap|max-message-size):)/.test(line))hasData=true;
  if(line.startsWith('m=')){const m=/^m=(audio|video|application) ([1-9][0-9]{0,4}) ([A-Za-z0-9/]+) .+$/.exec(line);insist(m&&Number(m[2])<=65535&&m[3]===(m[1]==='application'?'UDP/DTLS/SCTP':'UDP/TLS/RTP/SAVPF'),'SDP media');current={kind:m[1],directions:[]};sections.push(current);}
  const m=/^a=(sendonly|recvonly|sendrecv|inactive)$/.exec(line);if(m)(current?current.directions:sessionDirections).push(m[1]);
 }
 const sync=sections.length===1&&sections[0].kind==='application';
 insist(!watch||sync||!hasData,'Watcher data forbidden');
 insist(sync||sections.map(s=>s.kind).sort().join(',')===(watch?'audio,video':'application,audio,video'),'SDP sections');
 if(sync)insist(/^m=application [1-9][0-9]{0,4} UDP\/DTLS\/SCTP webrtc-datachannel\r?$/m.test(d.sdp)&&(d.sdp.match(/^a=sctp-port:/gm)||[]).length===1&&/^a=sctp-port:([1-9][0-9]{0,4})\r?$/m.test(d.sdp)&&Number(/^a=sctp-port:([1-9][0-9]{0,4})\r?$/m.exec(d.sdp)[1])<=65535,'SDP sync channel');
 insist(sessionDirections.length<=1,'SDP session direction');
 for(const s of sections){
  insist(s.directions.length<=1,'SDP duplicate direction');
  if(s.kind!=='application')insist((s.directions[0]??sessionDirections[0])===(d.type==='offer'?'sendonly':'recvonly'),'SDP direction');
 }
 insist(/^a=fingerprint:sha-256 (?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}\r?$/m.test(d.sdp),'SDP fingerprint');return {type:d.type,sdp:d.sdp};
}
