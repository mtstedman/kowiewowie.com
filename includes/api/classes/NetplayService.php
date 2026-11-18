<?php
declare(strict_types=1);
namespace Wowie\Api;
use PDO;
use Throwable;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;
final class NetplayService
{
 public function __construct(private readonly Config $config,private readonly PDO $pdo) {}
 public static function matches(): bool {
  $p=parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH);
  return is_string($p)&&(str_starts_with($p,'/api/v1/netplay/')||str_starts_with($p,'/v1/netplay/'));
 }
 public static function serve(string $root): never {
  try {
   $headers=[];foreach($_SERVER as $k=>$v)if(is_string($v)&&str_starts_with($k,'HTTP_'))$headers[strtolower(str_replace('_','-',substr($k,5)))]=$v;
   $headers['content-type']=(string)($_SERVER['CONTENT_TYPE']??'');
   $raw=file_get_contents('php://input',false,null,0,70001);
   if($raw===false||strlen($raw)>70000)throw new ApiException(413,'body_limit','Signaling request is too large.');
   $path=preg_replace('#^/api(?=/|$)#','',(string)parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH));
   $r=new Request(strtoupper($_SERVER['REQUEST_METHOD']??''),$path,$headers,[],$raw,$_SERVER['REMOTE_ADDR']??null);
   $config=Config::load($root);$response=(new self($config,Database::connect($config)))->handle($r);
  }catch(ApiException $e){$response=Response::json(['error'=>$e->errorCode,'message'=>$e->getMessage()],$e->status);}
  catch(Throwable $e){error_log('romjs netplay service unavailable');$response=Response::json(['error'=>'service_unavailable','message'=>'Netplay signaling is unavailable. Offline play still works.'],503);}
  $response->withHeaders(['Cache-Control'=>'no-store','X-Content-Type-Options'=>'nosniff','Referrer-Policy'=>'no-referrer'])->send();
 }
 private function fail(int $status,string $message,string $code='netplay_error'): never {throw new ApiException($status,$code,$message);}
 private function query(string $sql,array $args=[]): \PDOStatement {$q=$this->pdo->prepare($sql);$q->execute($args);return $q;}
 private function identity(mixed $v,int $length): string {if(!is_string($v)||!preg_match('/\A[a-f0-9]{'.$length.'}\z/',$v))$this->fail(422,'Invalid session identity.');return $v;}
 private function ice(string $room='',string $role='',int $until=0,bool $watch=false): array {
  $turn=$this->config->csv('WOWIE_NETPLAY_TURN_URLS');$stun=$this->config->csv('WOWIE_NETPLAY_STUN_URLS');
  $turnKey=$this->config->get('WOWIE_NETPLAY_TURN_SECRET','');$policy=$this->config->get('WOWIE_NETPLAY_ICE_POLICY','all');
  $available=$this->config->boolean('WOWIE_NETPLAY_ENABLED',false)&&count($turn)>0&&count($turn)<=6&&count($stun)<=2&&strlen($turnKey)>=32&&strlen($turnKey)<=256&&in_array($policy,['all','relay'],true);
  foreach($turn as $url)if(strlen($url)>250||!preg_match('/\Aturns?:[A-Za-z0-9.-]+:([0-9]{1,5})(?:\?transport=(?:udp|tcp))?\z/',$url,$m)||(int)$m[1]<1||(int)$m[1]>65535)$available=false;
  foreach($stun as $url)if(strlen($url)>250||!preg_match('/\Astuns?:[A-Za-z0-9.-]+:([0-9]{1,5})\z/',$url,$m)||(int)$m[1]<1||(int)$m[1]>65535)$available=false;
  if(!$available)return ['available'=>false,'iceServers'=>[],'reason'=>'Provision and verify an authenticated TURN relay.'];
  if($room==='')return ['available'=>true,'iceServers'=>[['urls'=>$turn]],'iceTransportPolicy'=>$policy,'reason'=>'Configured; live relay reachability is not measured.'];
  $now=time();$username=$until.':'.$room.':'.$role;
  $servers=[];if($stun!==[])$servers[]=['urls'=>$stun];
  $servers[]=['urls'=>$turn,'username'=>$username,'credential'=>base64_encode(hash_hmac('sha1',$username,$turnKey,true))];
  // Players prefer direct ICE paths by default; authenticated watchers always relay.
  return ['available'=>true,'iceServers'=>$servers,'iceTransportPolicy'=>$watch?'relay':$policy,'server_time'=>$now,'expires_at'=>$until,'refresh_after_seconds'=>max(1,min(420,$until-$now-180))];
 }
 private function rate(Request $r,bool $create): void {
  $slot=hexdec(substr(hash('sha256',(string)$r->remoteAddress),0,4))%1024;$this->pdo->beginTransaction();
  try {
   $this->pdo->exec("SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='250ms'");
   $this->query('SELECT singleton FROM romjs_netplay_gate WHERE singleton=true FOR UPDATE')->fetch();
   $g=$this->query("UPDATE romjs_netplay_gate SET requests=CASE WHEN window_at<now()-interval '1 second' THEN 1 ELSE LEAST(requests+1,1000000) END,window_at=CASE WHEN window_at<now()-interval '1 second' THEN now() ELSE window_at END,creates=CASE WHEN create_window<now()-interval '1 minute' THEN :inc ELSE LEAST(creates+:inc2,1000000) END,create_window=CASE WHEN create_window<now()-interval '1 minute' THEN now() ELSE create_window END WHERE singleton=true RETURNING requests,creates",['inc'=>(int)$create,'inc2'=>(int)$create])->fetch();
   $b=$this->query("UPDATE romjs_netplay_buckets SET requests=CASE WHEN window_at<now()-interval '1 minute' THEN 1 ELSE LEAST(requests+1,1000000) END,window_at=CASE WHEN window_at<now()-interval '1 minute' THEN now() ELSE window_at END,creates=CASE WHEN create_window<now()-interval '10 minutes' THEN :inc ELSE LEAST(creates+:inc2,1000000) END,create_window=CASE WHEN create_window<now()-interval '10 minutes' THEN now() ELSE create_window END WHERE slot=:slot RETURNING requests,creates",['inc'=>(int)$create,'inc2'=>(int)$create,'slot'=>$slot])->fetch();
   $this->pdo->commit();if(!$g||!$b||$g['requests']>300||$b['requests']>1200||($create&&($g['creates']>30||$b['creates']>6)))$this->fail(429,'Request limit reached. Retry later.');
  }catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw $e;}
 }
 private function tokenHash(string $room,string $participant,string $role,?string $player,string $kind,string $token): string {return hash('sha256','np3|'.$room.'|'.$participant.'|'.$role.'|'.($player??'none').'|'.$kind.'|'.$token);}
 private function assignment(array $b,string $pid,array $p): array {return ['protocol'=>3,'catalog'=>NetplayPolicy::VERSION,'binding'=>NetplayPolicy::BINDING,'packageId'=>$b['packageId'],'artifactDigest'=>$b['artifactDigest'],'inputProfile'=>$b['inputProfile'],'inputsDigest'=>$b['inputsDigest'],'compatibility'=>$b['compatibility'],'participant'=>$pid,'participant_role'=>$p['role'],'player'=>$p['player'],'session'=>$p['session'],'capabilities'=>['video'=>true,'audio'=>true,'input'=>$p['role']==='play']];}
 public function handle(Request $r): Response {
  if($r->method!=='POST')$this->fail(405,'POST required.');
  if($r->header('x-netplay-protocol')!=='3')$this->fail(426,'Reload protocol 3 and create a new invitation.','protocol_upgrade_required');
  if(strtolower(trim(explode(';',$r->header('content-type')??'')[0]))!=='application/json')$this->fail(415,'JSON required.');
  if(($_SERVER['QUERY_STRING']??'')!==''||$r->query!==[]||$r->header('cookie')!==null||$r->header('authorization')!==null)$this->fail(403,'Cookie-free JSON signaling required.');
  $origin=$r->header('origin')??'';$host=$r->header('host')??'';
  if(!in_array($origin,$this->config->csv('WOWIE_NETPLAY_ORIGINS',['https://wowiekowie.com','https://www.wowiekowie.com']),true)||$origin!=='https://'.$host||$r->header('sec-fetch-site')!=='same-origin')$this->fail(403,'Same-origin HTTPS required.');
  if(!str_starts_with($r->path,'/v1/netplay/'))$this->fail(404,'Unknown route.');$action=substr($r->path,strlen('/v1/netplay/'));
  $root=['room','credential'];$auth=[...$root,'role','participant','participant_role','player','session'];
  $fields=['capabilities'=>[],'create'=>[],'invite'=>[...$root,'participant_role'],'roster'=>$root,'end'=>$root,'revoke'=>[...$root,'participant','session'],'join'=>[...$root,'participant','invite','join_id'],'rejoin'=>[...$root,'participant','join_id','session'],'poll'=>[...$auth,'recover','round'],'ice'=>$auth,'begin'=>[...$auth,'previous','round','mode'],'signal'=>[...$auth,'round','description'],'leave'=>$auth];
  if(!isset($fields[$action]))$this->fail(404,'Unknown action.');$d=$r->json();$keys=array_keys($d);sort($keys);$want=['package','artifact','binding',...$fields[$action]];sort($want);
  if($keys!==$want||$d['binding']!==NetplayPolicy::BINDING)$this->fail(422,'Missing, unknown or incompatible field.');
  $b=NetplayPolicy::package($d['package'],$d['artifact']);$game=$b['packageId'];$artifact=$b['artifactDigest'];$this->rate($r,$action==='create');
  if($action==='capabilities')return Response::json([...$this->ice(),'protocol'=>3,'binding'=>$b,'watch_cap'=>4,'play_cap'=>1]);
  if(in_array($action,['create','ice'],true)&&!$this->ice()['available'])$this->fail(503,'TURN unavailable.');
  $this->pdo->beginTransaction();
  try {
   $this->pdo->exec("SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='250ms'");
   if($action==='create'){
    $this->query('SELECT singleton FROM romjs_netplay_gate WHERE singleton=true FOR UPDATE')->fetch();$this->pdo->exec('DELETE FROM romjs_netplay3_rooms WHERE host_lease_until<=clock_timestamp()');
    if((int)$this->query('SELECT count(*) FROM romjs_netplay3_rooms')->fetchColumn()>=32)$this->fail(503,'Room capacity.','capacity');
    $now=(float)$this->query('SELECT extract(epoch FROM clock_timestamp())')->fetchColumn();$id=bin2hex(random_bytes(16));$credential=bin2hex(random_bytes(32));
    $s=['host_seen'=>$now,'host_poll'=>0,'window'=>$now,'requests'=>0,'participants'=>new \stdClass()];
    $this->query('INSERT INTO romjs_netplay3_rooms(id,package,artifact,origin,host_hash,state) VALUES(:id,:game,:artifact,:origin,:hash,CAST(:state AS jsonb))',['id'=>$id,'game'=>$game,'artifact'=>$artifact,'origin'=>$origin,'hash'=>$this->tokenHash($id,'','host',null,'credential',$credential),'state'=>json_encode($s,JSON_THROW_ON_ERROR)]);
    $this->pdo->commit();return Response::json(['protocol'=>3,'binding'=>NetplayPolicy::BINDING,'packageId'=>$game,'artifactDigest'=>$artifact,'room'=>$id,'credential'=>$credential,'host_lease_seconds'=>60]);
   }
   $id=$this->identity($d['room'],32);$credential=$this->identity($d['credential'],64);
   $room=$this->query('SELECT *,extract(epoch FROM host_lease_until) AS lease_time FROM romjs_netplay3_rooms WHERE id=:id FOR UPDATE',['id'=>$id])->fetch();$now=(float)$this->query('SELECT extract(epoch FROM clock_timestamp())')->fetchColumn();
   if(!$room)$this->fail(410,'Room ended.','room_ended');
   if($room['package']!==$game||$room['artifact']!==$artifact||$room['origin']!==$origin)$this->fail(403,'Room binding mismatch.');
   if((float)$room['lease_time']<=$now)$this->fail(410,'Host lease expired.','room_ended');
   $s=json_decode($room['state'],true,24,JSON_THROW_ON_ERROR);$ps=$s['participants'];if(!is_array($ps)||count($ps)>5)$this->fail(503,'Invalid stored room.');
   $rootAction=in_array($action,['invite','roster','end','revoke'],true);$isHost=$rootAction||(($d['role']??'')==='host');$renew=false;
   if($isHost){
    if(!hash_equals($room['host_hash'],$this->tokenHash($id,'','host',null,'credential',$credential)))$this->fail(403,'Invalid host credential.');
    if($now-$s['window']>=60){$s['window']=$now;$s['requests']=0;}if(++$s['requests']>400)$this->fail(429,'Host rate limit.');
   }
   if($action==='end'){$this->query('DELETE FROM romjs_netplay3_rooms WHERE id=:id',['id'=>$id]);$this->pdo->commit();return Response::json(['ended'=>true]);}
   if(in_array($action,['roster','invite'],true))foreach($ps as $pid=>$p)if(($p['credential_hash']===null&&$p['invite_until']<=$now)||($p['credential_hash']!==null&&$p['seen']<$now-300))unset($ps[$pid]);
   if($action==='invite'){
    $role=$d['participant_role'];if(!in_array($role,['watch','play'],true))$this->fail(422,'Invalid invitation role.');
    if(count(array_filter($ps,static fn($p)=>$p['role']===$role))>=($role==='watch'?4:1))$this->fail(409,'Participant capacity.','capacity');
    $pid=bin2hex(random_bytes(16));$invite=bin2hex(random_bytes(32));$player=$role==='watch'?null:$b['players']['remote'];
    $p=['role'=>$role,'player'=>$player,'session'=>'','join_id'=>'','credential_hash'=>null,'invite_hash'=>$this->tokenHash($id,$pid,$role,$player,'invite',$invite),'invite_until'=>$now+300,'seen'=>0,'host_poll'=>0,'guest_poll'=>0,'window'=>$now,'requests'=>0,'round'=>'','mode'=>'rebuild','round_at'=>0,'recovery'=>'none','host_sdp'=>null,'guest_sdp'=>null,'host_turn_until'=>0,'guest_turn_until'=>0];
    $ps[$pid]=$p;$result=[...$this->assignment($b,$pid,$p),'room'=>$id,'invite'=>$invite,'invite_ttl_seconds'=>300];
   }elseif($action==='roster'){
    if($now-$s['host_poll']<.3)$this->fail(429,'Roster poll too fast.');$s['host_poll']=$now;$s['host_seen']=$now;$renew=true;
    $list=[];foreach($ps as $pid=>$p)$list[]=[...$this->assignment($b,$pid,$p),'joined'=>$p['credential_hash']!==null,'peer_live'=>$p['seen']>$now-15];
    $result=['protocol'=>3,'participants'=>$list,'host_lease_seconds'=>60];
   }else{
    $pid=$this->identity($d['participant'],32);if(!isset($ps[$pid]))$this->fail(410,'Participant ended.','participant_ended');$p=$ps[$pid];
    if($action==='revoke'){
     if($d['session']!==$p['session'])$this->fail(409,'Session changed.','stale_session');unset($ps[$pid]);$result=['revoked'=>true];
    }elseif(in_array($action,['join','rejoin'],true)){
     $join=$this->identity($d['join_id'],32);$hash=$this->tokenHash($id,$pid,$p['role'],$p['player'],'credential',$credential);$same=is_string($p['credential_hash'])&&hash_equals($p['credential_hash'],$hash);
     if($same&&hash_equals($p['join_id'],$join))$result=$this->assignment($b,$pid,$p);
     else{
      if($action==='join'){
       $invite=$this->identity($d['invite'],64);if($p['credential_hash']!==null||$p['invite_until']<=$now||!is_string($p['invite_hash'])||!hash_equals($p['invite_hash'],$this->tokenHash($id,$pid,$p['role'],$p['player'],'invite',$invite)))$this->fail(403,'Invalid or consumed invitation.');
      }else{
       if(!$same)$this->fail(403,'Invalid participant credential.');if($d['session']!==$p['session'])$this->fail(409,'Session replaced.','stale_session');if($p['seen']>$now-15)$this->fail(409,'Previous participant active.','still_active');
      }
      $p['credential_hash']=$hash;$p['invite_hash']=null;$p['session']=bin2hex(random_bytes(16));$p['join_id']=$join;$p['seen']=$now;$p['round']='';$p['round_at']=0;$p['mode']='rebuild';$p['recovery']='none';$p['host_sdp']=null;$p['guest_sdp']=null;$p['host_turn_until']=0;$p['guest_turn_until']=0;$p['host_poll']=0;$p['guest_poll']=0;
      $ps[$pid]=$p;$result=$this->assignment($b,$pid,$p);
     }
    }else{
     $side=$d['role'];if(!in_array($side,['host','guest'],true)||$d['participant_role']!==$p['role']||$d['player']!==$p['player'])$this->fail(403,'Role or player mismatch.');
     if($p['credential_hash']===null)$this->fail(409,'Participant has not joined.');
     if($side==='guest'&&!hash_equals($p['credential_hash'],$this->tokenHash($id,$pid,$p['role'],$p['player'],'credential',$credential)))$this->fail(403,'Invalid participant credential.');
     if($d['session']!==$p['session'])$this->fail(409,'Session replaced.','stale_session');
     if($side==='guest'){if($now-$p['window']>=60){$p['window']=$now;$p['requests']=0;}if(++$p['requests']>100)$this->fail(429,'Participant rate limit.');}
     $result=$this->assignment($b,$pid,$p);
     if($action==='leave'){
      if($side!=='guest')$this->fail(403,'Use host revocation.');unset($ps[$pid]);$result['left']=true;
     }else{
      if($action==='poll'){
       if(!in_array($d['recover'],['none','restart','rebuild'],true)||!is_string($d['round'])||($d['round']!==''&&!preg_match('/\A[a-f0-9]{32}\z/',$d['round'])))$this->fail(422,'Invalid recovery.');
       if($now-$p[$side.'_poll']<.3)$this->fail(429,'Poll too fast.');$p[$side.'_poll']=$now;
       if($side==='host'){$s['host_seen']=$now;$renew=true;}else{$p['seen']=$now;if($d['round']===$p['round']&&$d['recover']!=='none')$p['recovery']=$p['recovery']==='rebuild'?'rebuild':$d['recover'];}
       $result+=['round'=>$p['round'],'mode'=>$p['mode'],'recover'=>$p['recovery'],'peer_live'=>($side==='host'?$p['seen']:$s['host_seen'])>$now-15,'message'=>null,'host_lease_seconds'=>60];
       $other=$side==='host'?'guest':'host';if($p[$other.'_sdp']!==null)$result['message']=['round'=>$p['round'],'description'=>['type'=>$side==='host'?'answer':'offer','sdp'=>$p[$other.'_sdp']]];
      }elseif($action==='ice'){
       $until=$p[$side.'_turn_until'];if($until<=time()+180)$until=time()+600;$p[$side.'_turn_until']=$until;$result+=$this->ice($id,$pid.':'.$p['session'].':'.$side,$until,$p['role']==='watch');
      }elseif($action==='begin'){
       if($side!=='host')$this->fail(403,'Only host negotiates.');$round=$this->identity($d['round'],32);
       if(!is_string($d['previous'])||($d['previous']!==''&&!preg_match('/\A[a-f0-9]{32}\z/',$d['previous']))||!in_array($d['mode'],['restart','rebuild'],true))$this->fail(422,'Invalid round.');
       if($round===$p['round']){if($d['mode']!==$p['mode'])$this->fail(409,'Round mode mismatch.');}
       else{if($d['previous']!==$p['round'])$this->fail(409,'Round advanced.');if($p['round_at']>$now-8)$this->fail(429,'Retry too soon.');if($p['seen']<=$now-15)$this->fail(409,'Wait for participant heartbeat.');$p['round']=$round;$p['mode']=$d['mode'];$p['round_at']=$now;$p['host_sdp']=null;$p['guest_sdp']=null;$p['recovery']='none';}
       $result+=['accepted'=>true,'round'=>$round];
      }elseif($action==='signal'){
       if($d['round']!==$p['round']||$p['round']==='')$this->fail(409,'Stale round.');$text=NetplayPolicy::sdp($d['description'],$side==='host'?'offer':'answer',$p['role']==='watch');
       if($side==='guest'&&$p['host_sdp']===null)$this->fail(409,'Offer missing.');if($p[$side.'_sdp']!==null&&!hash_equals($p[$side.'_sdp'],$text))$this->fail(409,'Description already set.');$p[$side.'_sdp']=$text;$result+=['accepted'=>true,'round'=>$p['round']];
      }else $this->fail(404,'Unsupported action.');$ps[$pid]=$p;
     }
    }
   }
   $s['participants']=$ps?:new \stdClass();$json=json_encode($s,JSON_THROW_ON_ERROR);if(strlen($json)>450000)$this->fail(413,'Room storage limit.');
   $renewSQL=$renew?",host_lease_until=clock_timestamp()+interval '60 seconds'":'';$this->query('UPDATE romjs_netplay3_rooms SET state=CAST(:state AS jsonb)'.$renewSQL.' WHERE id=:id',['state'=>$json,'id'=>$id]);$this->pdo->commit();return Response::json($result);
  }catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw $e;}
 }
}
