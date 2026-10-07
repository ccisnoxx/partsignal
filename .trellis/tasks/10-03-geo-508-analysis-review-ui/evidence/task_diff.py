"""从任务前像生成任务范围 diff，排除已存在但未纳入维护源码快照的历史证据。"""
import difflib
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
baseline = json.loads((root / 'baseline-files.json').read_text())
paths = subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z']).decode().split('\0')
changed = []
sections = []
for name in sorted(set(filter(None, paths))):
    if '/evidence/' in name or name.startswith(('frontend/.cache/', 'backend/.cache/')):
        continue
    path = Path(name)
    if not path.is_file():
        continue
    if hashlib.sha256(path.read_bytes()).hexdigest() == baseline.get(name):
        continue
    before = root / 'before' / name
    if name in baseline and not before.exists() and not name.startswith(str(root.parent.relative_to(Path.cwd())) + "/"):
        raise SystemExit(f'缺少已变更文件的任务前像：{name}')
    old = before.read_text().splitlines(keepends=True) if before.exists() else []
    new = path.read_text().splitlines(keepends=True)
    changed.append(name)
    sections.extend(difflib.unified_diff(old, new, fromfile=f'a/{name}' if old else '/dev/null', tofile=f'b/{name}'))
(root / 'task-only.diff').write_text(''.join(sections))
(root / 'changed-files.json').write_text(json.dumps(changed, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'changed_files': len(changed), 'diff_lines': len(sections)}, ensure_ascii=False))
