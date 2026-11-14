<?php
declare(strict_types=1);
require __DIR__.'/../api/bootstrap.php';
use Wowie\Api\NetplayPolicy;use Wowie\Api\ApiException;
$catalog=json_decode(file_get_contents(__DIR__.'/../includes/api/classes/netplay-catalog.json'),true,24,JSON_THROW_ON_ERROR);
foreach($catalog['packages'] as $id=>$b){if(NetplayPolicy::package($id,$b['artifactDigest'])!==$b)throw new RuntimeException('Catalog mismatch');if($b['capabilities']['nativePlayers']!==1||$b['players']['local']!==$b['players']['remote'])throw new RuntimeException('Current games must share P1');try{NetplayPolicy::package($id,str_repeat('0',64));throw new RuntimeException('Forged artifact accepted');}catch(ApiException $e){if($e->status!==409)throw $e;}}
echo json_encode(['run'=>true,'pass'=>true,'scope'=>'PHP package authority units; no database or media'])."\n";
