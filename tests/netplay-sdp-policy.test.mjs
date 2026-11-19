import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {validateSDP} from '../htdocs/games/netplay/policy.mjs';

// RFC 8866 section 6.7: a media direction overrides the session default.
// Firefox answers include session sendrecv even when both media are recvonly.
test('JavaScript and PHP agree on Firefox SDP defaults without widening media authority',()=>{
 const cases=[];
 for(const type of ['offer','answer'])for(const watch of [false,true]){
  const direction=type==='offer'?'sendonly':'recvonly';
  const build=(session='',audio=direction,video=direction,application='sendrecv')=>({type,sdp:'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 '+Array(32).fill('AB').join(':')+'\r\n'+session+['audio','video'].map((kind,i)=>`m=${kind} 9 UDP/TLS/RTP/SAVPF 96\r\n${[audio,video][i]?`a=${[audio,video][i]}\r\n`:''}`).join('')+(watch?'':`m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\na=${application}\r\n`)});
  const add=(name,description,accepted)=>cases.push({name:`${type}/${watch?'watch':'play'}/${name}`,description,watch,accepted});
  add('explicit',build(),true);
  add('Firefox default overridden',build('a=sendrecv\r\n'),true);
  add('safe inherited direction',build(`a=${direction}\r\n`,'',''),true);
  add('unsafe inherited default',build('a=sendrecv\r\n',''),false);
  add('missing direction',build('',''),false);
  add('unsafe explicit override',build(`a=${direction}\r\n`,'sendrecv'),false);
  add('duplicate session direction',build('a=sendrecv\r\na=sendrecv\r\n'),false);
  add('conflicting session direction',build(`a=sendrecv\r\na=${direction}\r\n`),false);
  add('duplicate media direction',build('',`${direction}\r\na=${direction}`),false);
  add('conflicting media direction',build('',`${direction}\r\na=sendrecv`),false);
  if(watch){const d=build('a=sendrecv\r\n');d.sdp+='m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n';add('watcher data forbidden',d,false);}
  else add('duplicate application direction',build('',direction,direction,'sendrecv\r\na=sendrecv'),false);
 }
 for(const c of cases){let accepted=true;try{validateSDP(c.description,c.watch);}catch{accepted=false;}assert.equal(accepted,c.accepted,c.name);}
 const php=spawnSync('php',['-r',String.raw`
 require getcwd().'/api/bootstrap.php';
 $cases=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);$results=[];
 foreach($cases as $c){try{\Wowie\Api\NetplayPolicy::sdp($c['description'],$c['description']['type'],$c['watch']);$results[]=true;}catch(\Wowie\Api\ApiException $e){$results[]=false;}}
 echo json_encode($results,JSON_THROW_ON_ERROR);
 `],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});
 assert.equal(php.status,0,php.stderr);
 const results=JSON.parse(php.stdout);
 assert.equal(results.length,cases.length);
 cases.forEach((c,i)=>assert.equal(results[i],c.accepted,`PHP ${c.name}`));
});

test('pure application synchronization SDP is distinct from audiovisual watcher authority in JS and PHP',()=>{
 const cases=[];for(const type of['offer','answer'])for(const watch of[false,true]){
  const sdp='v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 '+Array(32).fill('AB').join(':')+'\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n';
  for(const [name,s,accepted]of[['pure',sdp,true],['missing SCTP port',sdp.replace('a=sctp-port:5000\r\n',''),false],['bad port',sdp.replace('sctp-port:5000','sctp-port:65536'),false],['duplicate port',sdp+'a=sctp-port:5000\r\n',false],['two application sections',sdp+'m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5001\r\n',false],['mixed audio',sdp+'m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na='+(type==='offer'?'sendonly':'recvonly')+'\r\n',false]])cases.push({name,type,watch,description:{type,sdp:s},accepted});
 }
 for(const c of cases){let accepted=true;try{validateSDP(c.description,c.watch);}catch{accepted=false;}assert.equal(accepted,c.accepted,c.name);}
 const php=spawnSync('php',['-r',String.raw`require getcwd().'/api/bootstrap.php';$cases=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);$results=[];foreach($cases as $c){try{\Wowie\Api\NetplayPolicy::sdp($c['description'],$c['type'],$c['watch']);$results[]=true;}catch(\Wowie\Api\ApiException $e){$results[]=false;}}echo json_encode($results);`],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});assert.equal(php.status,0,php.stderr);assert.deepEqual(JSON.parse(php.stdout),cases.map(c=>c.accepted));
});
