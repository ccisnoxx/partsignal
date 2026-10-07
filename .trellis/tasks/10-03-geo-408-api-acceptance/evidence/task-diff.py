import difflib, hashlib, json, subprocess
from pathlib import Path
root=Path.cwd(); evidence=root/'.trellis/tasks/10-03-geo-408-api-acceptance/evidence'
baseline=json.loads((evidence/'baseline-sha256.json').read_text())
paths=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z']).decode().split('\0')
changes=[]; new=[]; patch=[]
for name in sorted(set(paths)-{''}):
 p=root/name
 if not p.is_file() or name.startswith('.trellis/tasks/10-03-geo-408-api-acceptance/') or name.startswith('.env'): continue
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
 if baseline.get(name)==digest:continue
 if name not in baseline: new.append(name)
 else: changes.append(name)
 before=evidence/'before'/name
 if before.is_file(): original=before.read_text().splitlines(keepends=True)
 elif name not in baseline: original=[]
 else: continue
 try: after=p.read_text().splitlines(keepends=True)
 except UnicodeDecodeError: continue
 patch.extend(difflib.unified_diff(original,after,fromfile='a/'+name,tofile='b/'+name))
(evidence/'candidate.patch').write_text(''.join(patch))
(evidence/'task-changes.json').write_text(json.dumps({'modified_since_start':changes,'new_since_start':new},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'modified':changes,'new':new},ensure_ascii=False,indent=2))
