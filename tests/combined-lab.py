# Explicit later-execution harness. The builder never invokes this file.
import os,sys,pathlib,tempfile,subprocess,socket,time,json,hashlib,shutil,secrets,re,signal
P=pathlib.Path;source=P(__file__).resolve().parents[1]
if len(sys.argv)<2 or sys.argv[1] not in ('postgres','browser'):raise SystemExit('Usage: python3 tests/combined-lab.py postgres | browser [--browser-mode=isolated|trusted-local]')
browser_mode='isolated'
if sys.argv[1]=='postgres':
 if len(sys.argv)!=2:raise SystemExit('PostgreSQL mode accepts no browser options')
elif len(sys.argv)==3 and sys.argv[2] in ('--browser-mode=isolated','--browser-mode=trusted-local'):
 browser_mode=sys.argv[2].split('=',1)[1]
elif len(sys.argv)!=2:raise SystemExit('Use an explicit supported browser mode')
if os.geteuid()==0:raise SystemExit('Run disposable fixtures as an ordinary user')
mode=sys.argv[1];os.umask(0o077);job=P(tempfile.mkdtemp(prefix='combined-lab-'));procs=[];handles=[];initialized=False
receipt={'format':'combined-lab-receipt/1','mode':mode,'run':True,'pass':False,'job':str(job),'production_access':False};limit=time.monotonic()+(1800 if mode=='browser' else 180)
env={k:v for k,v in os.environ.items() if not k.startswith(('PG','WOWIE_','ROMJS_','COMBINED_'))};env['ROMJS_NETPLAY_TEST_ALLOW']='disposable-local-database'
if mode=='browser':
 receipt.update({'browser_mode_requested':browser_mode,'browser_mode_effective':None,'sandbox_validated':False,'host_security_changed':False})
 env.update({'COMBINED_BROWSER_MODE':browser_mode,'COMBINED_BROWSER_MODE_RECEIPT':str(job/'browser-mode.json')})
 if browser_mode=='trusted-local':env['COMBINED_TRUSTED_LOCAL']='authored-loopback-fixture'
def run(args,timeout=60,**kw):
 remaining=limit-time.monotonic()
 if remaining<=0:raise TimeoutError('Fixture deadline exceeded')
 p=subprocess.Popen(args,env=env,cwd=source,start_new_session=True,**kw)
 try:
  out,err=p.communicate(timeout=min(timeout,remaining))
 except BaseException:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=5);raise
 result=subprocess.CompletedProcess(args,p.returncode,out,err)
 if p.returncode:raise subprocess.CalledProcessError(p.returncode,args,output=out,stderr=err)
 return result
def launch(args):
 log=open(job/('process-'+str(len(procs))+'.log'),'wb');handles.append(log);p=subprocess.Popen(args,env=env,cwd=source,stdout=log,stderr=log,start_new_session=True);procs.append(p);return p
def freeport():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def ready(port,p):
 until=time.monotonic()+20
 while time.monotonic()<until:
  if p.poll() is not None:raise RuntimeError('Fixture service exited; inspect private process log')
  try:
   with socket.create_connection(('127.0.0.1',port),.2):return
  except OSError:time.sleep(.1)
 raise RuntimeError('Fixture startup timeout')
def canon(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(v if isinstance(v,bytes) else canon(v)+b'\n')
def h(b):return hashlib.sha256(b).hexdigest()
try:
 if mode=='browser':
  resolved=run(['node','--input-type=module','-e',"process.stdout.write(import.meta.resolve('playwright'))"],stdout=subprocess.PIPE).stdout.decode()
  if not resolved.startswith('file:'):raise RuntimeError('Resolve a local Playwright installation before running the fixture')
  env['COMBINED_PLAYWRIGHT_MODULE']=resolved
 pgdir=run(['pg_config','--bindir'],stdout=subprocess.PIPE).stdout.decode().strip();pg=lambda n:str(P(pgdir)/n)
 data=job/'pgdata';sock=job/'socket';sock.mkdir(mode=0o700)
 run([pg('initdb'),'-D',str(data),'--auth-local=peer','--auth-host=reject','--no-locale','--encoding=UTF8'],stdout=subprocess.DEVNULL);initialized=True
 with (data/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(sock)+"'\nunix_socket_permissions=0700\n")
 run([pg('pg_ctl'),'-D',str(data),'-l',str(job/'postgres.log'),'-w','-t','30','start'],stdout=subprocess.DEVNULL)
 run([pg('createdb'),'-h',str(sock),'romjs_netplay_test']);env['ROMJS_NETPLAY_TEST_DSN']='pgsql:host='+str(sock)+';dbname=romjs_netplay_test'
 if mode=='postgres':
  p=run(['php','tests/romjs-netplay-roles.php'],stdout=subprocess.PIPE);detail=json.loads(p.stdout);assert detail['status']=='passed';receipt['detail']=detail;receipt['pass']=True
 else:
  lab=job/'site';shutil.copytree(source,lab,ignore=shutil.ignore_patterns('node_modules'));source=lab
  for migration in ('028_romjs_netplay.sql','029_romjs_netplay_roles.sql'):run([pg('psql'),'-X','-v','ON_ERROR_STOP=1','-h',str(sock),'-d','romjs_netplay_test','-f',str(source/'docs/postgres/updates'/migration)],stdout=subprocess.DEVNULL)
  catalog=json.loads((source/'htdocs/games/arcade/catalog.json').read_bytes());e=json.loads((source/('htdocs'+catalog[0]['manifest'])).read_bytes());m=e['manifest']
  m.update({'id':'transport-diagnostic','title':'Transport diagnostic — not two-player gameplay','platform':'Diagnostic','publisher':'Test fixture','year':'2026','route':'/games/transport-diagnostic/','entry':'/games/transport-diagnostic/host-entry.mjs','image':None,'notes':{'usage':'/games/transport-diagnostic/NOTICE.txt','attribution':'/games/transport-diagnostic/NOTICE.txt'}})
  m['capabilities']={'verified':True,'evidence':'Trusted authored diagnostic; transport/controller isolation only, not gameplay','nativePlayers':2,'mode':'simultaneous','play':'host-p1-guest-p2','watch':True};m['timing']={'nominalHz':60,'clockOwner':'adapter'}
  adapter=(source/'tests/fixtures/combined-diagnostic.mjs').read_bytes();notice=b'Diagnostic transport/controller isolation only. Not real two-player gameplay.\n';write(source/'htdocs/games/transport-diagnostic/host-entry.mjs',adapter);write(source/'htdocs/games/transport-diagnostic/NOTICE.txt',notice)
  m['files']={m['entry']:{'bytes':len(adapter),'sha256':h(adapter)},m['notes']['usage']:{'bytes':len(notice),'sha256':h(notice)}};digest=h(canon(m));write(source/'htdocs/games/transport-diagnostic/game-package.json',{'manifest':m,'artifactDigest':digest});catalog.append({'id':m['id'],'manifest':m['route']+'game-package.json','artifactDigest':digest});write(source/'htdocs/games/arcade/catalog.json',catalog)
  nc=json.loads((source/'includes/api/classes/netplay-catalog.json').read_bytes());b=dict(next(iter(nc['packages'].values())));b.update({'packageId':m['id'],'route':m['route'],'entryAdapter':m['entry'],'adapter':'diagnostic/1','artifactDigest':digest,'compatibility':'native-two/1','players':{'local':'left-player','remote':'right-player'},'capabilities':{'nativePlayers':2,'play':'independent','watch':True,'video':True,'audio':True}});nc['packages'][m['id']]=b;nb=canon(nc)+b'\n'
  write(source/'htdocs/games/netplay/catalog.json',nb);write(source/'includes/api/classes/netplay-catalog.json',nb);policy=source/'includes/api/classes/NetplayPolicy.php';text,n=re.subn(r"private const DIGEST='[a-f0-9]{64}';","private const DIGEST='"+h(nb)+"';",policy.read_text());assert n==1;policy.write_text(text)
  phpport,tlsport,turnport=freeport(),freeport(),freeport();origin='https://127.0.0.1:'+str(tlsport);fixture_key=secrets.token_hex(32)
  env.update({'WOWIE_NETPLAY_ENABLED':'true','WOWIE_NETPLAY_TURN_URLS':'turn:127.0.0.1:'+str(turnport)+'?transport=udp','WOWIE_NETPLAY_TURN_SECRET':fixture_key,'WOWIE_NETPLAY_ORIGINS':origin,'WOWIE_NETPLAY_STUN_URLS':'','WOWIE_NETPLAY_ICE_POLICY':'relay','COMBINED_TEST_ORIGIN':origin})
  key=job/'key.pem';cert=job/'cert.pem';run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  # Structured serialization of freshly generated disposable credentials; no credential literals or production inputs.
  settings={'listening-ip':'127.0.0.1','relay-ip':'127.0.0.1','listening-port':turnport,'min-port':51000,'max-port':51100,'realm':'combined-fixture','use-auth-secret':None,'static-auth-secret':fixture_key,'fingerprint':None,'no-tls':None,'no-dtls':None,'no-cli':None,'cli-password':secrets.token_hex(32),'allow-loopback-peers':None,'no-multicast-peers':None,'no-tcp-relay':None,'user-quota':8,'total-quota':32,'log-file':str(job/'turn.log'),'pidfile':str(job/'turn.pid')}
  tc=job/'turn.conf';tc.write_text(''.join(name+('' if value is None else '='+str(value))+'\n' for name,value in settings.items()))
  turn=launch(['turnserver','-c',str(tc)]);ready(turnport,turn)
  php=launch(['php','-S','127.0.0.1:'+str(phpport),str(source/'tests/combined-lab-router.php')]);ready(phpport,php)
  web=launch(['node',str(source/'tests/combined-lab-server.mjs'),str(source),str(tlsport),str(phpport),str(key),str(cert)]);ready(tlsport,web)
  p=run(['node','--test','--test-concurrency=1','tests/combined-browser.test.mjs'],timeout=1620,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  (job/'browser.tap').write_bytes(p.stdout);(job/'browser.stderr').write_bytes(p.stderr);receipt.update({'pass':p.returncode==0,'browser_receipt':str(job/'browser.tap'),'scope':'Real game streams and diagnostic transport in independent browser contexts, disposable PostgreSQL and authenticated loopback TURN; diagnostic is not gameplay'})
except Exception as e:
 receipt['error']=type(e).__name__+': '+str(e)[:240]
 if isinstance(e,subprocess.CalledProcessError):
  if e.stdout:(job/'failed.stdout').write_bytes(e.stdout)
  if e.stderr:(job/'failed.stderr').write_bytes(e.stderr)
finally:
 cleanup=True
 for p in reversed(procs):
  try:
   if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
   p.wait(timeout=10)
  except Exception:
   try:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   except Exception:cleanup=False
 if initialized and (data/'postmaster.pid').exists():
  try:subprocess.run([pg('pg_ctl'),'-D',str(data),'-w','-t','20','-m','fast','stop'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=25,check=True)
  except Exception:cleanup=False
 for f in handles:f.close()
 for name in ('turn.conf','key.pem'):
  try:(job/name).unlink(missing_ok=True)
  except Exception:cleanup=False
 if mode=='browser' and (job/'browser-mode.json').exists():
  try:
   launch_mode=json.loads((job/'browser-mode.json').read_bytes())
   if launch_mode.get('format')!='combined-browser-mode/1' or launch_mode.get('requested')!=browser_mode or launch_mode.get('effective')!=browser_mode or launch_mode.get('sandbox_validated') is not False or launch_mode.get('chromium_sandbox_requested')!=(browser_mode=='isolated'):raise ValueError('Browser mode receipt differs')
   receipt['browser_mode_effective']=launch_mode['effective'];receipt['browser_launch']=launch_mode
  except Exception:cleanup=False;receipt['browser_mode_receipt_error']=True
 if mode=='browser' and receipt.get('browser_mode_effective')!=browser_mode:receipt['pass']=False
 receipt['cleanup_pass']=cleanup;receipt['pass']=receipt['pass'] and cleanup;(job/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));sys.exit(0 if receipt['pass'] else 1)
