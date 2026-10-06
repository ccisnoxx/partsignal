from pathlib import Path
import difflib
import hashlib
import json
root=Path('/Users/sc/PycharmProjects/partsignal')
evidence=root/'.trellis/tasks/10-02-geo-306-read-model/evidence'
initial=json.loads((evidence/'start-files.json').read_text())
files=set(initial)
for folder in ('backend/app','backend/tests','contracts','docs/geo-monitoring'):
    files.update(str(p.relative_to(root)) for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
changed=[];patch=[];snapshot={}
for name in sorted(files):
    path=root/name
    if not path.is_file():
        continue
    data=path.read_bytes();digest=hashlib.sha256(data).hexdigest();snapshot[name]=digest
    if digest==initial.get(name):
        continue
    if name not in initial and path.suffix not in {'.py','.md','.yaml','.yml','.json','.txt','.ts'}:
        continue
    old=evidence/'baseline'/name
    try:
        before=old.read_text().splitlines(keepends=True) if old.exists() else []
        after=data.decode().splitlines(keepends=True)
    except UnicodeDecodeError:
        continue
    changed.append(name)
    patch.extend(difflib.unified_diff(before,after,fromfile='a/'+name if old.exists() else '/dev/null',tofile='b/'+name))
(evidence/'candidate.patch').write_text(''.join(patch))
(evidence/'changed-files.json').write_text(json.dumps(changed,indent=2)+'\n')
(evidence/'candidate-files.json').write_text(json.dumps(snapshot,indent=2)+'\n')
print('\n'.join(changed))
