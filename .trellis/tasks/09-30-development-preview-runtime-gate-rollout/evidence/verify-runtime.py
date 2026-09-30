"""复用同一远端安全探针；将基线和候选身份按实际阶段比较。"""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path(__file__).resolve().parent
label=sys.argv[1];current='releases/'+('preview-20260930-111500-2f171300' if label.startswith('final') else 'preview-20260929-082104-4e85aaf9')
r=subprocess.run(['ssh','-o','BatchMode=yes','hostdzire','python3','-'],input=(p/'postcheck-remote.py').read_text(),capture_output=True,text=True,timeout=60)
assert r.returncode==0,'POSTCHECK_REMOTE_FAILED'
d=json.loads(r.stdout);f=p/(label+'.json');assert not f.exists();f.write_text(json.dumps(d,indent=2)+'\n')
b=json.loads((p/'remote-before.json').read_text());images=json.loads((p/'candidate-result.json').read_text())['records'][-1]['images']
assert d['current_target']==current
assert d['networks']==b['networks'] and len(d['networks'])==3
assert d['data']==b['data'] and d['other']==b['other'] and len(d['other'])==9
assert d['site_sha']==b['site_sha'] and d['nginx_full_sha']==b['nginx_full_sha'] and d['site_enabled_target']==b['site_enabled_target']
assert d['nginx_test_exit']==0 and not d['pending_any']
assert d['rollback_release_exists'] and d['old_release_directory_exists'] and d['historical_images']==b['historical_images']
assert d['archive_sha']=='c83c6ece8f11e1c4fa4d340dc50fd7dde6b828948598febd255f75577ef8e0d2'
assert d['env']['sha256']=='3f43478292b82002c4bc6bae44adb580f939f6c74219346d0cb5364fc41141cf' and d['env']['bytes']==1587
assert len(d['project'])==7 and all(x['running'] and x['restart_count']==0 and not x['oom'] and x['oneoff']=='False' and x['health'] in ['healthy',None] for x in d['project'])
assert all(x['status']==200 and x['security_headers_exact'] for x in d['http'].values())
assert all(x['status']==200 for x in d['loopback'].values())
root=p.parents[3]
for service,x in d['processes'].items():
 assert x['pid1_mode']==x['settings_mode']=='openai-compatible' and x['environment_matches']
 for name,h in x['source_sha256'].items():assert hashlib.sha256((root/'backend'/name).read_bytes()).hexdigest()==h
for x in d['project']:
 if x['service'] in ['api','worker','scheduler','fake-oss','frontend']:
  tag='partsignal-'+('frontend' if x['service']=='frontend' else 'backend')+':preview-20260930-111500-2f171300'
  assert x['image']==images[tag]['id'] and d['service_identity'][x['service']]['image_tag']==tag
assert d['candidate_images']=={k:v for k,v in images.items() if k.endswith('preview-20260930-111500-2f171300')}
backup=json.loads((p/'backup-result.json').read_text())['records'][-1]
for path,x in d['backups'].items():
 prefix='env' if path.endswith('original') else 'database'
 assert x['bytes']==backup[prefix+'_backup_bytes'] and x['sha256']==backup[prefix+'_backup_sha256'] and x['uid']==0 and x['mode']=='0o600'
print(json.dumps({'status':'RUNTIME_VERIFIED','phase':label,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'project':7,'oneoff':0,'networks':3,'other':9,'mode':'openai-compatible','current':d['current_target'],'http':d['http'],'loopback':d['loopback']}))
