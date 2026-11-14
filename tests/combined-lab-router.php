<?php
declare(strict_types=1);
if(getenv('ROMJS_NETPLAY_TEST_ALLOW')!=='disposable-local-database')throw new RuntimeException('Fixture only');
require __DIR__.'/../api/bootstrap.php';
use Wowie\Api\Config;use Wowie\Api\NetplayService;use Wowie\Api\ApiException;use Wowie\Api\Http\Request;use Wowie\Api\Http\Response;
try{
 $dsn=getenv('ROMJS_NETPLAY_TEST_DSN');if(!is_string($dsn)||!preg_match('/\Apgsql:host=\/[A-Za-z0-9_\/.\-]+;dbname=romjs_netplay_test\z/',$dsn))throw new RuntimeException('Fixture DSN');
 $db=new PDO($dsn,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);$db->exec("SET statement_timeout='3000ms';SET lock_timeout='500ms'");
 $config=(new ReflectionClass(Config::class))->newInstanceWithoutConstructor();$headers=[];foreach($_SERVER as $k=>$v)if(is_string($v)&&str_starts_with($k,'HTTP_'))$headers[strtolower(str_replace('_','-',substr($k,5)))]=$v;$headers['content-type']=$_SERVER['CONTENT_TYPE']??'';
 $raw=file_get_contents('php://input',false,null,0,70001);if($raw===false||strlen($raw)>70000)throw new RuntimeException('Body bound');$path=preg_replace('#^/api(?=/|$)#','',parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH));
 $r=new Request($_SERVER['REQUEST_METHOD'],$path,$headers,[],$raw,'127.0.0.1');$response=(new NetplayService($config,$db))->handle($r);
}catch(ApiException $e){$response=Response::json(['error'=>$e->errorCode],$e->status);}catch(Throwable $e){$response=Response::json(['error'=>'fixture_failure'],503);}
$response->withHeaders(['Cache-Control'=>'no-store','Referrer-Policy'=>'no-referrer'])->send();
