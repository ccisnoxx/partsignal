from pathlib import Path
import sys,subprocess,json,datetime
p=Path(__file__).parent
name,*cmd=sys.argv[1:]
start=datetime.datetime.now(datetime.UTC).isoformat()
with (p/(name+".log")).open("w") as log:
 result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
(p/(name+".json")).write_text(json.dumps(dict(argv=cmd,exit_code=result.returncode,started_at=start,finished_at=datetime.datetime.now(datetime.UTC).isoformat()),indent=2))
print(name,result.returncode)
print((p/(name+".log")).read_text()[-1800:])
sys.exit(result.returncode)
