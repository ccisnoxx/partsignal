
import json,subprocess,re,hashlib
from pathlib import Path
job='abc4e3cd-efc2-40fb-a87d-330a378bfecb'
p=subprocess.run(['docker','logs','--since','2026-09-30T12:00:00Z','partsignal-staging-worker-1'],capture_output=True,text=True)
pattern=re.compile(r'AI 作业完成 job_id='+re.escape(job)+r' job_type=(GENERATE) source_content_version_id=(None) status=(SUCCEEDED) content_version_id=([0-9a-f-]{36}) provider_duration_ms=(\d+)')
records=[]
for line in (p.stdout+p.stderr).splitlines():
 m=pattern.search(line)
 if m:records.append({'job_id':job,'job_type':m[1],'status':m[3],'version_id':m[4],'duration_ms':int(m[5])})
paths=['backend/app/worker.py','backend/app/services/generation.py','backend/app/services/openai_client.py']
r={'docker_log_exit':p.returncode,'safe_worker_completions':records,'release_source_sha256':{x:hashlib.sha256((Path('/root/partsignal/releases/preview-20260930-111500-2f171300')/x).read_bytes()).hexdigest() for x in paths}}
print(json.dumps(r))
