from pathlib import Path
import subprocess,sys,json,time
label=sys.argv[1];argv=sys.argv[2:];root=Path(__file__).resolve().parent
started=time.time()
with (root/(label+".log")).open("w") as out:
    result=subprocess.run(argv,stdout=out,stderr=subprocess.STDOUT)
record={"argv":argv,"exit_code":result.returncode,"seconds":round(time.time()-started,2)}
(root/(label+".json")).write_text(json.dumps(record,ensure_ascii=False,indent=2))
print(json.dumps(record,ensure_ascii=False));print((root/(label+".log")).read_text()[-5000:])
sys.exit(result.returncode)
