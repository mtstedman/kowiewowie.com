// Non-console fixture. These players are logical sinks, not controller ports.
export class DiagnosticAdapter {
 constructor(binding){this.version=1;this.packageId=binding.packageId;this.artifactDigest=binding.artifactDigest;this.binding=binding;this.members=new Map();this.local=new Set();this.remoteHeld=new Map();}
 enabled(){return true;}
 admit(a){if(!a.capabilities.input||a.participant_role!=='play'||a.player!==this.binding.players.remote)throw Error('Diagnostic authority');this.members.set(a.participant,a);}
 remote(id,session,player,controls){const a=this.members.get(id);if(!a||a.session!==session||a.player!==player)throw Error('Diagnostic stale input');this.remoteHeld.set(id,new Set(Object.entries(controls).filter(([,v])=>v).map(([k])=>k)));}
 release(id){if(id===undefined)this.remoteHeld.clear();else this.remoteHeld.delete(id);}
 remove(id){this.release(id);this.members.delete(id);}
 capture(){throw Error('Diagnostic has no media hardware');}
}
