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
 private function ice(string $room='',string $role='',int $until=0): array {
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
  return ['available'=>true,'iceServers'=>$servers,'iceTransportPolicy'=>$policy,'server_time'=>$now,'expires_at'=>$until,'refresh_after_seconds'=>max(1,min(420,$until-$now-180))];
 }
 private function rate(Request $r,bool $create): void {
  $slot=hexdec(substr(hash('sha256',(string)$r->remoteAddress),0,4))%1024;$this->pdo->beginTransaction();
  try {
   $this->pdo->exec("SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='250ms'");
   $this->query('SELECT singleton FROM romjs_netplay_gate WHERE singleton=true FOR UPDATE')->fetch();
   $g=$this->query("UPDATE romjs_netplay_gate SET requests=CASE WHEN window_at<now()-interval '1 second' THEN 1 ELSE LEAST(requests+1,1000000) END,window_at=CASE WHEN window_at<now()-interval '1 second' THEN now() ELSE window_at END,creates=CASE WHEN create_window<now()-interval '1 minute' THEN :inc ELSE LEAST(creates+:inc2,1000000) END,create_window=CASE WHEN create_window<now()-interval '1 minute' THEN now() ELSE create_window END WHERE singleton=true RETURNING requests,creates",['inc'=>(int)$create,'inc2'=>(int)$create])->fetch();
   $b=$this->query("UPDATE romjs_netplay_buckets SET requests=CASE WHEN window_at<now()-interval '1 minute' THEN 1 ELSE LEAST(requests+1,1000000) END,window_at=CASE WHEN window_at<now()-interval '1 minute' THEN now() ELSE window_at END,creates=CASE WHEN create_window<now()-interval '10 minutes' THEN :inc ELSE LEAST(creates+:inc2,1000000) END,create_window=CASE WHEN create_window<now()-interval '10 minutes' THEN now() ELSE create_window END WHERE slot=:slot RETURNING requests,creates",['inc'=>(int)$create,'inc2'=>(int)$create,'slot'=>$slot])->fetch();
   $this->pdo->commit();if(!$g||!$b||$g['requests']>300||$g['creates']>30||$b['requests']>600||$b['creates']>6)$this->fail(429,'Request limit reached. Retry later.');
  }catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw $e;}
 }
 private function handle(Request $r): Response {
  if($r->method!=='POST'||$r->header('x-netplay-protocol')!=='2'||strtolower(trim(explode(';',$r->header('content-type')??'')[0]))!=='application/json')$this->fail(405,'Use the current same-origin JSON client.');
  if(($_SERVER['QUERY_STRING']??'')!=='')$this->fail(400,'Signaling parameters must not appear in URLs.');
  $origin=$r->header('origin')??'';$host=$r->header('host')??'';$origins=$this->config->csv('WOWIE_NETPLAY_ORIGINS',['https://wowiekowie.com','https://www.wowiekowie.com']);
  if(!in_array($origin,$origins,true)||$origin!=='https://'.$host||$r->header('sec-fetch-site')!=='same-origin')$this->fail(403,'Same-origin HTTPS is required.');
  $action=substr($r->path,strlen('/v1/netplay/'));
  if(!in_array($action,['capabilities','create','join','rejoin','ice','poll','begin','signal','end'],true))$this->fail(404,'Unknown action.');
  $d=$r->json();$allowed=['game','artifact','room','credential','role','session','invite','join_id','recover','round','previous','mode','description'];
  if(array_diff(array_keys($d),$allowed)!==[])$this->fail(422,'Unknown signaling field.');
  $games=json_decode((string)file_get_contents(__DIR__.'/netplay-games.json'),true,16,JSON_THROW_ON_ERROR);$game=$d['game']??null;$artifact=$d['artifact']??null;
  if(!is_string($game)||!is_string($artifact)||!isset($games[$game])||!hash_equals($games[$game],$artifact))$this->fail(409,'Reload the matched game release.','binding_changed');
  $this->rate($r,$action==='create');
  if($action==='capabilities')return Response::json($this->ice());
  if(in_array($action,['create','ice'],true)&&!$this->ice()['available'])$this->fail(503,'TURN is not configured. Offline play still works.');
  $this->pdo->beginTransaction();
  try {
   $this->pdo->exec("SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='250ms'");
   if($action==='create'){
    $this->query('SELECT singleton FROM romjs_netplay_gate WHERE singleton=true FOR UPDATE')->fetch();
    $this->pdo->exec("DELETE FROM romjs_netplay_rooms WHERE host_lease_until<=clock_timestamp() OR (guest_hash IS NULL AND invite_expires_at<=clock_timestamp())");
    if((int)$this->query('SELECT count(*) FROM romjs_netplay_rooms')->fetchColumn()>=128)$this->fail(503,'Rooms are at capacity.');
    $id=bin2hex(random_bytes(16));$credential=bin2hex(random_bytes(32));$invite=bin2hex(random_bytes(32));
    $this->query("INSERT INTO romjs_netplay_rooms(id,game,artifact,origin,host_hash,invite_hash,invite_expires_at) VALUES(:id,:game,:artifact,:origin,:host,:invite,clock_timestamp()+interval '5 minutes')",['id'=>$id,'game'=>$game,'artifact'=>$artifact,'origin'=>$origin,'host'=>hash('sha256',$credential),'invite'=>hash('sha256',$invite)]);
    $result=['room'=>$id,'credential'=>$credential,'invite'=>$invite,'session'=>'','invite_ttl_seconds'=>300,'host_lease_seconds'=>60];
   }else{
    $id=$this->identity($d['room']??null,32);$credential=$this->identity($d['credential']??null,64);$hash=hash('sha256',$credential);
    $room=$this->query('SELECT *,extract(epoch FROM host_lease_until) AS lease_time,extract(epoch FROM invite_expires_at) AS invite_time,extract(epoch FROM host_seen) AS host_time,extract(epoch FROM guest_seen) AS guest_time,extract(epoch FROM round_at) AS round_time,extract(epoch FROM host_poll) AS host_poll_time,extract(epoch FROM guest_poll) AS guest_poll_time FROM romjs_netplay_rooms WHERE id=:id FOR UPDATE',['id'=>$id])->fetch();
    if(!$room){if($action==='end'){$this->pdo->commit();return Response::json(['ended'=>true]);}$this->fail(410,'Room is unavailable.');}
    $dbNow=(float)$this->query('SELECT extract(epoch FROM clock_timestamp())')->fetchColumn();
    if($room['game']!==$game||$room['artifact']!==$artifact||$room['origin']!==$origin)$this->fail(403,'Room binding mismatch.');
    if($action==='join'||$action==='rejoin'){
     $join=$this->identity($d['join_id']??null,32);$same=is_string($room['guest_hash'])&&hash_equals($room['guest_hash'],$hash);
     if(!$same){
      $invite=$this->identity($d['invite']??null,64);
      if($action!=='join'||$room['guest_hash']!==null||!is_string($room['invite_hash'])||!hash_equals($room['invite_hash'],hash('sha256',$invite)))$this->fail(403,'Invite is invalid or consumed.');
     }
     if((float)$room['lease_time']<=$dbNow)$this->fail(410,'Host authorization expired.');
     if($same&&hash_equals($room['join_id'],$join))$result=['session'=>$room['session']];
     else{
      if(!$same&&(float)$room['invite_time']<=$dbNow)$this->fail(410,'Unused invite expired.');
      if($same&&$action!=='rejoin')$this->fail(409,'Use authenticated rejoin.');
      if($same&&(float)$room['guest_time']>$dbNow-15)$this->fail(409,'Previous guest is still active. Retry after 15 seconds.');
      $session=bin2hex(random_bytes(16));
      $this->query("UPDATE romjs_netplay_rooms SET guest_hash=:hash,invite_hash=NULL,join_id=:join,session=:session,guest_seen=clock_timestamp(),host_sdp=NULL,guest_sdp=NULL,round='',round_at=NULL,round_mode='rebuild',recovery='none',host_turn_until=0,guest_turn_until=0,guest_poll=NULL WHERE id=:id",['hash'=>$hash,'join'=>$join,'session'=>$session,'id'=>$id]);
      $result=['session'=>$session];
     }
    }else{
     $role=$d['role']??'';if(!in_array($role,['host','guest'],true))$this->fail(403,'Role required.');
     if(!is_string($room[$role.'_hash'])||!hash_equals($room[$role.'_hash'],$hash))$this->fail(403,'Invalid role credential.');
     if($role==='guest'&&($d['session']??null)!==$room['session'])$this->fail(409,'Guest session replaced.','stale_session');
     if($action==='end'){
      if($role!=='host')$this->fail(403,'Only the host can revoke.');
      $this->query('DELETE FROM romjs_netplay_rooms WHERE id=:id',['id'=>$id]);$result=['ended'=>true];
     }else{
      if((float)$room['lease_time']<=$dbNow||($room['guest_hash']===null&&(float)$room['invite_time']<=$dbNow))$this->fail(410,'Host authorization or unused invite expired.');
      $count=(int)$this->query("UPDATE romjs_netplay_rooms SET {$role}_requests=CASE WHEN {$role}_window<now()-interval '1 minute' THEN 1 ELSE LEAST({$role}_requests+1,1000000) END,{$role}_window=CASE WHEN {$role}_window<now()-interval '1 minute' THEN now() ELSE {$role}_window END WHERE id=:id RETURNING {$role}_requests",['id'=>$id])->fetchColumn();
      if($count>100)$this->fail(429,'Role request limit reached.');
      if($action==='poll'){
       $recover=$d['recover']??'none';$observed=$d['round']??'';
       if(!in_array($recover,['none','restart','rebuild'],true)||!is_string($observed)||($observed!==''&&!preg_match('/\A[a-f0-9]{32}\z/',$observed)))$this->fail(422,'Invalid recovery request.');
       if($room[$role.'_poll_time']!==null&&$dbNow-(float)$room[$role.'_poll_time']<0.3)$this->fail(429,'Poll too quickly.');
       // Guest traffic cannot renew host authorization. No age-based condition exists.
       $renew=$role==='host'?",host_lease_until=clock_timestamp()+interval '60 seconds'":'';
       $this->query("UPDATE romjs_netplay_rooms SET {$role}_poll=clock_timestamp(),{$role}_seen=clock_timestamp(){$renew} WHERE id=:id",['id'=>$id]);
       // Fence an old recovery request against a just-started replacement round.
       if($role==='guest'&&$recover!=='none'&&$observed===$room['round']){
        $requested=$room['recovery']==='rebuild'?'rebuild':$recover;
        $this->query('UPDATE romjs_netplay_rooms SET recovery=:mode WHERE id=:id',['mode'=>$requested,'id'=>$id]);$room['recovery']=$requested;
       }
       $other=$role==='host'?'guest':'host';
       $result=['session'=>$room['session'],'round'=>$room['round'],'mode'=>$room['round_mode'],'recover'=>$room['recovery'],'peer_live'=>$room[$other.'_time']!==null&&(float)$room[$other.'_time']>$dbNow-15,'message'=>null,'host_lease_seconds'=>60];
       if($room[$other.'_sdp']!==null)$result['message']=['round'=>$room['round'],'description'=>['type'=>$role==='host'?'answer':'offer','sdp'=>$room[$other.'_sdp']]];
      }elseif($action==='ice'){
       if(($d['session']??null)!==$room['session'])$this->fail(409,'Session changed.');
       $until=(int)$room[$role.'_turn_until'];if($until<=time()+180){$until=time()+600;$this->query("UPDATE romjs_netplay_rooms SET {$role}_turn_until=:until WHERE id=:id",['until'=>$until,'id'=>$id]);}
       $result=$this->ice($id,$role,$until);
      }elseif($action==='begin'){
       if($role!=='host')$this->fail(403,'Only the host starts negotiation.');
       if(($d['session']??null)!==$room['session']||$room['session']==='')$this->fail(409,'Session changed.');
       $round=$this->identity($d['round']??null,32);$prev=$d['previous']??null;$mode=$d['mode']??null;
       if(!is_string($prev)||($prev!==''&&!preg_match('/\A[a-f0-9]{32}\z/',$prev))||!in_array($mode,['restart','rebuild'],true))$this->fail(422,'Invalid negotiation identity.');
       if($round===$room['round']){if($mode!==$room['round_mode'])$this->fail(409,'Round mode differs.');}
       else{
        if($prev!==$room['round'])$this->fail(409,'Negotiation has advanced.');
        if($room['round_at']!==null&&(float)$room['round_time']>$dbNow-8)$this->fail(429,'Negotiation retry too soon.');
        if((float)$room['guest_time']<=$dbNow-15)$this->fail(409,'Wait for the guest heartbeat.');
        $this->query("UPDATE romjs_netplay_rooms SET round=:round,round_mode=:mode,round_at=clock_timestamp(),host_sdp=NULL,guest_sdp=NULL,recovery='none' WHERE id=:id",['round'=>$round,'mode'=>$mode,'id'=>$id]);
       }
       $result=['round'=>$round,'accepted'=>true];
      }elseif($action==='signal'){
       if(($d['session']??null)!==$room['session']||$room['session']===''||($d['round']??null)!==$room['round']||$room['round']==='')$this->fail(409,'Stale negotiation.');
       $desc=$d['description']??null;$type=$role==='host'?'offer':'answer';
       if(!is_array($desc)||count($desc)!==2||!array_key_exists('type',$desc)||!array_key_exists('sdp',$desc)||$desc['type']!==$type||!is_string($desc['sdp']))$this->fail(422,'Invalid description.');
       $text=$desc['sdp'];
       if(strlen($text)>32768||!str_starts_with($text,'v=0')||substr_count($text,'a=candidate:')>64||!str_contains($text,'m=video ')||!str_contains($text,'m=audio ')||!str_contains($text,'m=application '))$this->fail(422,'Description exceeds bounds.');
       if($role==='guest'&&$room['host_sdp']===null)$this->fail(409,'Offer not ready.');
       if($room[$role.'_sdp']!==null){if(!hash_equals($room[$role.'_sdp'],$text))$this->fail(409,'Description already set.');}
       else $this->query("UPDATE romjs_netplay_rooms SET {$role}_sdp=:sdp WHERE id=:id",['sdp'=>$text,'id'=>$id]);
       $result=['accepted'=>true,'round'=>$room['round']];
      }else $this->fail(404,'Unsupported action.');
     }
    }
   }
   $this->pdo->commit();return Response::json($result);
  }catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw $e;}
 }
}
