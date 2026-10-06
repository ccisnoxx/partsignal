import subprocess,sys,json,time
from pathlib import Path
root=Path(__file__).parent
label=sys.argv[1];cmd=sys.argv[2:];start=time.time()
with (root/(label+'.log')).open('w') as out:
 p=subprocess.run(cmd,stdout=out,stderr=subprocess.STDOUT)
(root/(label+'.json')).write_text(json.dumps({'command':cmd,'exit_code':p.returncode,'duration_seconds':round(time.time()-start,2)},ensure_ascii=False,indent=2)+'\n')
print(label, 'exit', p.returncode, 'seconds', round(time.time()-start,1));sys.exit(p.returncode)
