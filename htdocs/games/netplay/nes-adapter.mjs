// The only new module that knows NES numeric buttons or physical controller ports.
import {validateBinding,assignment,full,insist} from './policy.mjs';
const names=['a','b','select','start','up','down','left','right'],zero=()=>Array(8).fill(false);
export function nesState(values){insist(Array.isArray(values)&&values.length===8&&values.every(v=>typeof v==='boolean'),'NES controller array');return Object.fromEntries(names.map((n,i)=>[n,values[i]]));}
export class NESRemoteInputs {
 constructor(value){this.binding=validateBinding(value);insist(this.binding.adapter==='nes-network/1'&&this.binding.inputs.map(i=>i.id).join(',')===names.join(','),'NES adapter/profile mismatch');this.players=new Map();}
 admit(value){const a=assignment(this.binding,value);if(a.participant_role==='watch')return;insist(a.session,'Joined assignment required');const old=this.players.get(a.participant);if(old&&old.session===a.session)return;insist(!this.players.size||old,'One remote player limit');const port=this.binding.compatibility==='native-two/1'?2:1;this.players.set(a.participant,{session:a.session,player:a.player,port,held:zero(),values:zero(),queues:names.map(()=>[])});}
 set(id,session,player,controls){const p=this.players.get(id);insist(p&&p.session===session&&p.player===player&&full(this.binding,controls),'Input authority mismatch');try{for(let i=0;i<names.length;i++){const next=controls[names[i]];if(next!==p.held[i]){insist(p.queues[i].length<32,'Remote input overflow');p.queues[i].push(next);p.held[i]=next;}}}catch(e){this.clear(id);throw e;}}
 clear(id){for(const [key,p] of this.players)if(id===undefined||id===key){p.held.fill(false);p.values.fill(false);for(const q of p.queues)q.length=0;}}
 remove(id){this.clear(id);this.players.delete(id);}
 sample(local){nesState(local);const ports=[local.slice(),zero()];for(const p of this.players.values())for(let i=0;i<names.length;i++){if(p.queues[i].length)p.values[i]=p.queues[i].shift();ports[p.port-1][i]||=p.values[i];}return {buttons:ports[0],buttons2:ports[1]};}
}
export function captureNESOutput(canvas,audio){
 insist(canvas&&typeof canvas.captureStream==='function'&&typeof audio==='function','NES output surface unavailable');const stream=canvas.captureStream(),video=stream.getVideoTracks()[0];let tap=null,closed=false;
 const detach=()=>{const old=tap;tap=null;if(old){try{old.master.disconnect(old.node);}catch{}for(const track of old.node.stream.getTracks())try{track.stop();}catch{}}};
 const dispose=()=>{if(closed)return;closed=true;detach();for(const track of stream.getTracks())try{track.stop();}catch{}};
 if(!video){dispose();throw Error('NES video unavailable');}video.contentHint='detail';
 return {video,getAudio(){if(closed)return null;const pair=audio();if(!pair?.context||!pair?.master){detach();return null;}if(tap?.context===pair.context&&tap?.master===pair.master)return tap.node.stream.getAudioTracks()[0]||null;detach();const node=pair.context.createMediaStreamDestination();try{pair.master.connect(node);}catch(e){for(const t of node.stream.getTracks())t.stop();throw e;}tap={...pair,node};return node.stream.getAudioTracks()[0]||null;},dispose};
}
export function createNESNetworkAdapter(binding,{canvas,audio,enabled}){const inputs=new NESRemoteInputs(binding);return {version:1,packageId:binding.packageId,artifactDigest:binding.artifactDigest,capture:()=>captureNESOutput(canvas,audio),enabled,admit:a=>inputs.admit(a),remote:(...args)=>inputs.set(...args),release:id=>inputs.clear(id),remove:id=>inputs.remove(id),sample:local=>inputs.sample(local)};}
