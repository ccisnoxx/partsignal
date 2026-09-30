
import json,hashlib,re,stat,os,tarfile
from pathlib import Path
rid='preview-20260930-111500-2f171300';root=Path('/root/partsignal');rel=root/'releases'/rid;env=root/'shared/.env.staging';backup=root/'shared/runtime-gate-rollout-backups'/rid/'env.staging.original'
raw=env.read_bytes();old=backup.read_bytes();assert old.replace(b'CONTENT_GENERATOR=deterministic\n',b'CONTENT_GENERATOR=openai-compatible\n')==raw
values=dict(line.split('=',1) for line in raw.decode().splitlines() if line and not line.startswith('#'))
secrets=[values[k].encode() for k in ['POSTGRES_PASSWORD','SESSION_SECRET','AI_CREDENTIAL_ENCRYPTION_KEY','UPLOAD_SIGNING_SECRET','PARTSIGNAL_SEED_ADMIN_PASSWORD','PARTSIGNAL_SEED_ENGINEER_PASSWORD']]
patterns=[rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',rb'\b(?:sk-(?:proj-)?|sk_live_)[A-Za-z0-9_-]{20,}',rb'\bAKIA[A-Z0-9]{16}\b',rb'Bearer [A-Za-z0-9._-]{20,}',rb'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}']
hits=[];known=0;count=0;symlinks=[]
with tarfile.open(root/'releases'/(rid+'.tar.gz')) as tar:
 for member in tar:
  path=rel/member.name
  if member.isfile():
   data=path.read_bytes();count+=1;assert hashlib.sha256(data).digest()==hashlib.sha256(tar.extractfile(member).read()).digest(),'EXTRACTED_SOURCE_DRIFT'
   known+=sum(bool(v) and v in data for v in secrets)
   for i,pattern in enumerate(patterns):
    if re.search(pattern,data):hits.append({'path':member.name,'pattern':i})
for path in rel.rglob('*'):
 if path.is_symlink():symlinks.append(str(path.relative_to(rel)));assert path==rel/'.env.staging' and path.resolve()==env
 if re.search(r'(^|/)\._',str(path.relative_to(rel))):raise ValueError('APPLEDOUBLE')
assert known==0 and hits==[{'path':'backend/app/ai_fake_server.py','pattern':3}]
assert symlinks==['.env.staging']
print(json.dumps({'status':'POST_DEPLOY_SECRET_SCAN_PASSED','source_files_exact':count,'known_env_secret_hits':known,'baseline_fixture_hits':hits,'runtime_env_symlink_only':True,'only_env_changed_key':'CONTENT_GENERATOR','env_bytes':len(raw),'env_sha256':hashlib.sha256(raw).hexdigest(),'backup_unchanged':True}))
