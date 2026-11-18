<?php
declare(strict_types=1);
if(getenv('ROMJS_NETPLAY_TEST_ALLOW')!=='disposable-local-database')throw new RuntimeException('Disposable database opt-in required.');
$dsn=getenv('ROMJS_NETPLAY_TEST_DSN');if(!is_string($dsn)||!preg_match('/\Apgsql:host=\/[A-Za-z0-9_\/.\-]+;dbname=romjs_netplay_test\z/',$dsn))throw new RuntimeException('Use local Unix socket database romjs_netplay_test.');
require __DIR__.'/../api/bootstrap.php';
use Wowie\Api\Config;use Wowie\Api\NetplayService;use Wowie\Api\NetplayPolicy;use Wowie\Api\ApiException;use Wowie\Api\Http\Request;
$db=new PDO($dsn,getenv('ROMJS_NETPLAY_TEST_USER')?:null,getenv('ROMJS_NETPLAY_TEST_PASSWORD')?:null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
$db->exec("SET statement_timeout='3000ms'; SET lock_timeout='500ms'");$schema='np3_test_'.bin2hex(random_bytes(8));$db->exec('CREATE SCHEMA '.$schema);$db->exec('SET search_path TO '.$schema);
function ok(bool $v,string $m):void{if(!$v)throw new RuntimeException($m);}
function denied(callable $f):void{try{$f();}catch(ApiException $e){ok($e->status>=400,'Expected rejection');return;}throw new RuntimeException('Request unexpectedly accepted');}
try{
 $db->exec(file_get_contents(__DIR__.'/../docs/postgres/updates/028_romjs_netplay.sql'));$db->exec(file_get_contents(__DIR__.'/../docs/postgres/updates/029_romjs_netplay_roles.sql'));
 putenv('WOWIE_NETPLAY_ENABLED=true');putenv('WOWIE_NETPLAY_TURN_URLS=turn:relay.example.invalid:3478');putenv('WOWIE_NETPLAY_TURN_SECRET='.bin2hex(random_bytes(32)));putenv('WOWIE_NETPLAY_ORIGINS=https://wowiekowie.com');putenv('WOWIE_NETPLAY_STUN_URLS=');putenv('WOWIE_NETPLAY_ICE_POLICY=all');$_SERVER['QUERY_STRING']='';
 // Deliberately bypass environment-file loading; never read protected production configuration.
 $config=(new ReflectionClass(Config::class))->newInstanceWithoutConstructor();$service=new NetplayService($config,$db);
 $catalog=json_decode(file_get_contents(__DIR__.'/../includes/api/classes/netplay-catalog.json'),true,24,JSON_THROW_ON_ERROR);$b=$catalog['packages']['megaman'];$base=['package'=>$b['packageId'],'artifact'=>$b['artifactDigest'],'binding'=>$b['version']];
 $call=function(string $action,array $body=[],array $headers=[])use($service,$base){$h=['host'=>'wowiekowie.com','origin'=>'https://wowiekowie.com','sec-fetch-site'=>'same-origin','x-netplay-protocol'=>'3','content-type'=>'application/json'];return $service->handle(new Request('POST','/v1/netplay/'.$action,array_replace($h,$headers),[],json_encode($base+$body,JSON_THROW_ON_ERROR),'192.0.2.10'))->payload;};
 $host=$call('create');$root=['room'=>$host['room'],'credential'=>$host['credential']];
 denied(fn()=>$call('create',['nativePlayers'=>2]));denied(fn()=>$call('create',[],['x-netplay-protocol'=>'2']));denied(fn()=>$call('create',[],['cookie'=>'test=1']));denied(fn()=>$call('create',[],['origin'=>'https://other.example.invalid']));
 $watch=[];for($i=0;$i<4;$i++)$watch[]=$call('invite',$root+['participant_role'=>'watch']);denied(fn()=>$call('invite',$root+['participant_role'=>'watch']));$play=$call('invite',$root+['participant_role'=>'play']);ok($play['player']===$b['players']['local'],'Solo shared hero');denied(fn()=>$call('invite',$root+['participant_role'=>'play']));
 $joined=[];foreach([...$watch,$play] as $invite){$cred=bin2hex(random_bytes(32));$join=['room'=>$root['room'],'credential'=>$cred,'participant'=>$invite['participant'],'invite'=>$invite['invite'],'join_id'=>bin2hex(random_bytes(16))];$a=$call('join',$join);ok($call('join',$join)===$a,'Idempotent join');$joined[]=['room'=>$root['room'],'credential'=>$cred,'role'=>'guest','participant'=>$a['participant'],'participant_role'=>$a['participant_role'],'player'=>$a['player'],'session'=>$a['session']];}
 $w=$joined[0];$p=$joined[4];foreach([['credential'=>bin2hex(random_bytes(32))],['participant_role'=>'play'],['player'=>$b['players']['remote']],['session'=>bin2hex(random_bytes(16))],['role'=>'host'],['participant'=>$p['participant']]] as $bad)denied(fn()=>$call('ice',array_replace($w,$bad)));
 denied(fn()=>$call('input',$w+['controls'=>['a'=>true]]));denied(fn()=>$call('upgrade',$w));$ice=$call('ice',$w);ok($ice['expires_at']-$ice['server_time']>=599&&$ice['expires_at']-$ice['server_time']<=600,'Temporary TURN credential');
 // Routing comes from the authenticated participant role on both peers.
 foreach([$w,$p] as $participant){
  $expected=$participant['participant_role']==='watch'?'relay':'all';
  ok($call('ice',$participant)['iceTransportPolicy']===$expected,'Guest role routing policy');
  $authority=array_replace($participant,['role'=>'host','credential'=>$root['credential']]);
  ok($call('ice',$authority)['iceTransportPolicy']===$expected,'Host role routing policy');
 }
 putenv('WOWIE_NETPLAY_ICE_POLICY=relay');ok($call('ice',$p)['iceTransportPolicy']==='relay','Explicit relay fallback diagnostic preserved');putenv('WOWIE_NETPLAY_ICE_POLICY=all');
 $fingerprint=implode(':',str_split(bin2hex(random_bytes(32)),2));$sdp=fn(string $type,bool $data=false)=>['type'=>$type,'sdp'=>"v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 ".$fingerprint."\r\n".implode('',array_map(fn($k)=>'m='.$k." 9 UDP/TLS/RTP/SAVPF 96\r\na=".($type==='offer'?'sendonly':'recvonly')."\r\n",['audio','video'])).($data?"m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n":'')];
 $wa=array_replace($w,['role'=>'host','credential'=>$root['credential']]);$round=bin2hex(random_bytes(16));$call('begin',$wa+['previous'=>'','round'=>$round,'mode'=>'rebuild']);denied(fn()=>$call('signal',$wa+['round'=>$round,'description'=>$sdp('offer',true)]));$call('signal',$wa+['round'=>$round,'description'=>$sdp('offer')]);denied(fn()=>$call('signal',$w+['round'=>$round,'description'=>$sdp('answer',true)]));$call('signal',$w+['round'=>$round,'description'=>$sdp('answer')]);
 $call('revoke',$root+['participant'=>$w['participant'],'session'=>$w['session']]);denied(fn()=>$call('ice',$w));ok($call('ice',$joined[1])['available']===true,'Independent watcher survives revoke');
 $edit=function(callable $fn)use($db,$root){$q=$db->prepare('SELECT state FROM romjs_netplay3_rooms WHERE id=?');$q->execute([$root['room']]);$s=json_decode($q->fetchColumn(),true,24,JSON_THROW_ON_ERROR);$fn($s);$q=$db->prepare('UPDATE romjs_netplay3_rooms SET state=CAST(? AS jsonb) WHERE id=?');$q->execute([json_encode($s,JSON_THROW_ON_ERROR),$root['room']]);};
 $edit(function(&$s)use($p){$s['participants'][$p['participant']]['seen']=time()-20;});$rejoin=['room'=>$root['room'],'credential'=>$p['credential'],'participant'=>$p['participant'],'session'=>$p['session'],'join_id'=>bin2hex(random_bytes(16))];$next=$call('rejoin',$rejoin);ok($next['session']!==$p['session'],'Rejoin fencing');ok($call('rejoin',$rejoin)===$next,'Idempotent rejoin');denied(fn()=>$call('ice',$p));
 $db->exec("UPDATE romjs_netplay3_rooms SET created_at=clock_timestamp()-interval '30 days',host_lease_until=clock_timestamp()+interval '10 seconds'");$call('roster',$root);ok((float)$db->query('SELECT extract(epoch FROM host_lease_until-clock_timestamp()) FROM romjs_netplay3_rooms')->fetchColumn()>55,'No fixed active session age');
 $edit(function(&$s)use($joined){$s['participants'][$joined[1]['participant']]['guest_turn_until']=time()-1;});ok($call('ice',$joined[1])['expires_at']>=time()+599,'Renewed temporary credentials');
 $edit(function(&$s)use($joined){$s['participants'][$joined[2]['participant']]['seen']=time()-301;$s['host_poll']=0;});$roster=$call('roster',$root);ok(!in_array($joined[2]['participant'],array_column($roster['participants'],'participant'),true),'Stale viewer cleanup');ok($call('ice',$joined[1])['available']===true,'Cleanup is participant-local');
 // Exhausting room-creation admission must not strand existing participants.
 $slot=hexdec(substr(hash('sha256','192.0.2.10'),0,4))%1024;
 foreach(['bucket','global'] as $limit){
  $db->exec('UPDATE romjs_netplay_gate SET creates='.($limit==='global'?31:0).',create_window=now(),requests=0,window_at=now()');
  $db->exec('UPDATE romjs_netplay_buckets SET creates='.($limit==='bucket'?7:0).',create_window=now(),requests=0,window_at=now() WHERE slot='.$slot);
  try{$call('create');throw new RuntimeException('Exhausted create quota accepted');}catch(ApiException $e){ok($e->status===429,'Create admission remains limited');}
  ok($call('capabilities')['available']===true,'Create quota does not block capabilities');
  $edit(function(&$s)use($joined){$s['host_poll']=0;$s['participants'][$joined[1]['participant']]['guest_poll']=0;});
  $call('roster',$root);
  $call('poll',$joined[1]+['recover'=>'none','round'=>'']);
  ok($call('ice',$joined[1])['available']===true,'Create quota does not block existing participant');
 }
 // General request limits still apply to non-create traffic.
 $db->exec('UPDATE romjs_netplay_buckets SET requests=1200,window_at=now() WHERE slot='.$slot);
 try{$call('capabilities');throw new RuntimeException('Request quota accepted');}catch(ApiException $e){ok($e->status===429,'Request limit preserved');}
 $db->exec('UPDATE romjs_netplay_buckets SET requests=0,window_at=now() WHERE slot='.$slot);
 $call('end',$root);denied(fn()=>$call('ice',$joined[1]));ok((int)$db->query('SELECT count(*) FROM romjs_netplay3_rooms')->fetchColumn()===0,'All state revoked');
 $fixture=$b;$fixture['capabilities']['nativePlayers']=2;$fixture['capabilities']['play']='independent';$fixture['compatibility']='native-two/1';$fixture['players']['remote']='diagnostic-second-player';NetplayPolicy::classification($fixture);$fixture['players']['remote']=$fixture['players']['local'];denied(fn()=>NetplayPolicy::classification($fixture));
 echo json_encode(['status'=>'passed','scope'=>'disposable PostgreSQL authority regressions; no browser, gameplay or TURN execution'])."\n";
}finally{if($db->inTransaction())$db->rollBack();$db->exec('SET search_path TO public');$db->exec('DROP SCHEMA '.$schema.' CASCADE');putenv('WOWIE_NETPLAY_TURN_SECRET');}
