import pathlib,subprocess,json,sys,time
root=pathlib.Path(__file__).resolve().parents[1];results=[];end=time.monotonic()+300;commands=[]
for p in sorted(root.rglob('*')):
 if not p.is_file():continue
 if p.suffix=='.mjs':commands.append(('node_syntax',['node','--check',str(p)]))
 if p.suffix=='.php':commands.append(('php_syntax',['php','-l',str(p)]))
commands.extend([('node_unit',['node','--test','tests/arcade-ui.test.mjs','tests/combined-integration.test.mjs','tests/combined-followup.test.mjs']),('node_unit',['node','tests/romjs-netplay-roles.test.mjs']),('php_unit',['php','tests/combined-policy.php'])])
for suite,cmd in commands:
 try:
  p=subprocess.run(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=max(.1,min(120,end-time.monotonic())))
  results.append({'suite':suite,'command':cmd,'run':True,'pass':p.returncode==0,'exit_code':p.returncode})
  if p.returncode:sys.stderr.buffer.write(p.stdout[-8000:]+p.stderr[-8000:]);break
 except (OSError,subprocess.TimeoutExpired) as e:results.append({'suite':suite,'command':cmd,'run':True,'pass':False,'error':type(e).__name__});break
ok=len(results)==len(commands) and all(r['pass'] for r in results)
print(json.dumps({'format':'combined-check-receipt/1','pass':ok,'results':results}));sys.exit(0 if ok else 1)
