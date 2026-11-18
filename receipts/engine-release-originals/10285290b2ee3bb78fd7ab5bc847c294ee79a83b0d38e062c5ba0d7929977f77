<?php
declare(strict_types=1);
namespace Wowie\Api;
final class NetplayPolicy {
 public const VERSION='romjs-cartridge-roles/1';
 public const BINDING='game-network-binding/1';
 private const DIGEST='fe85ad62282ce2c32a849afd23239f5a1f07d6012fcce96ec2cd7d4f5681060f';
 public static function deny(string $code='invalid_contract',int $status=422): never {throw new ApiException($status,$code,'Netplay request rejected.');}
 public static function package(mixed $id,mixed $artifact): array {
  if(!is_string($id)||!is_string($artifact)||!preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/',$id)||strlen($id)>64||!preg_match('/\A[a-f0-9]{64}\z/',$artifact))self::deny();
  $raw=file_get_contents(__DIR__.'/netplay-catalog.json');if(!is_string($raw)||strlen($raw)>524288||!hash_equals(self::DIGEST,hash('sha256',$raw)))self::deny('catalog_unavailable',503);
  $all=json_decode($raw,true,24,JSON_THROW_ON_ERROR);$b=$all['packages'][$id]??null;
  if(($all['format']??null)!==self::VERSION||!is_array($b)||($b['version']??null)!==self::BINDING||($b['packageId']??null)!==$id||!hash_equals($b['artifactDigest'],$artifact))self::deny('binding_changed',409);
  self::classification($b);return $b;
 }
 public static function classification(array $b): void {
  $c=$b['capabilities']??[];$p=$b['players']??[];
  if(($c['watch']??null)!==true||($c['video']??null)!==true||($c['audio']??null)!==true||!is_string($p['local']??null)||!is_string($p['remote']??null))self::deny('catalog_unavailable',503);
  $solo=($c['nativePlayers']??null)===1&&($c['play']??null)==='shared-hero'&&($b['compatibility']??null)==='solo-shared/1'&&$p['local']===$p['remote'];
  $two=($c['nativePlayers']??null)===2&&($c['play']??null)==='independent'&&($b['compatibility']??null)==='native-two/1'&&$p['local']!==$p['remote'];
  if(!$solo&&!$two)self::deny('catalog_unavailable',503);
 }
 public static function sdp(mixed $d,string $type,bool $watch): string {
  if(!is_array($d)||count($d)!==2||($d['type']??null)!==$type||!is_string($d['sdp']??null))self::deny('invalid_sdp');
  $s=$d['sdp'];if(strlen($s)>32768||!str_starts_with($s,"v=0\r\n")||preg_match('/[^\x09\x0a\x0d\x20-\x7e]/',$s)||preg_match('/\r(?!\n)/',$s))self::deny('invalid_sdp');
  $lines=preg_split('/\r?\n/',$s);if(count($lines)>1024)self::deny('invalid_sdp');$sections=[];$current=-1;$candidates=0;
  foreach($lines as $line){
   if(strlen($line)>1024)self::deny('invalid_sdp');if(str_starts_with($line,'a=candidate:')&&++$candidates>64)self::deny('invalid_sdp');
   if($watch&&preg_match('/^(m=application\b|a=(sctp-port|sctpmap|max-message-size):)/',$line))self::deny('watch_data_forbidden',403);
   if(str_starts_with($line,'m=')){
    if(!preg_match('/\Am=(audio|video|application) ([1-9][0-9]{0,4}) ([A-Za-z0-9\/]+) .+\z/',$line,$m)||(int)$m[2]>65535||$m[3]!==($m[1]==='application'?'UDP/DTLS/SCTP':'UDP/TLS/RTP/SAVPF'))self::deny('invalid_sdp');
    $sections[]=['kind'=>$m[1],'directions'=>[]];$current=count($sections)-1;
   }
   if(preg_match('/\Aa=(sendonly|recvonly|sendrecv|inactive)\z/',$line,$m)){if($current<0)self::deny('invalid_sdp');$sections[$current]['directions'][]=$m[1];}
  }
  $kinds=array_column($sections,'kind');sort($kinds);if($kinds!==($watch?['audio','video']:['application','audio','video']))self::deny('invalid_sdp');
  foreach($sections as $m)if($m['kind']!=='application'&&$m['directions']!==[$type==='offer'?'sendonly':'recvonly'])self::deny('invalid_media_direction');
  if(!preg_match('/^a=fingerprint:sha-256 (?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}\r?$/m',$s))self::deny('invalid_sdp');return $s;
 }
}
