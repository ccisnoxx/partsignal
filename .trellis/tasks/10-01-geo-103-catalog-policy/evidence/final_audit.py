"""对初始工作树进行本任务范围、冻结输入和 manifest 状态核对。"""
from pathlib import Path
from difflib import unified_diff
import hashlib
import json
import subprocess

import yaml

root = Path.cwd()
task = root / '.trellis/tasks/10-01-geo-103-catalog-policy'
evidence = task / 'evidence'
initial = json.loads((evidence / 'initial-hashes.json').read_text())
task_data = json.loads((task / 'task.json').read_text())
related = task_data['relatedFiles']
allowed = set(related)
changed = []
missing = []
for name, old in initial.items():
    path = root / name
    if not path.is_file():
        missing.append(name)
    elif hashlib.sha256(path.read_bytes()).hexdigest() != old:
        changed.append(name)

def git_paths(*args):
    return set(subprocess.check_output(['git', *args, '-z'], text=True).split('\0')) - {''}

tracked = git_paths('ls-files', '--cached')
untracked = git_paths('ls-files', '--others', '--exclude-standard')
new = sorted(name for name in untracked if name not in initial and not name.startswith('.trellis/tasks/10-01-geo-103-catalog-policy/'))
unexpected = sorted((set(changed) | set(new) | set(missing)) - allowed)
# 原快照遗漏的五个已跟踪中文路径不属于新文件；保留原快照并补充 HEAD 对照证据。
unhashed_tracked = sorted(tracked - set(initial))
unhashed_diff = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '--', *unhashed_tracked], text=True)
assert not unhashed_diff.strip(), unhashed_diff
frozen = [name for name in initial if name.startswith('backend/alembic/versions/') or name == 'backend/app/migration_schema_v1.py']
manifest_path = 'docs/geo-monitoring/04-delivery/task-manifest.yaml'
old_manifest = yaml.safe_load((evidence / 'before' / manifest_path).read_text())
new_manifest = yaml.safe_load((root / manifest_path).read_text())
before = {value['id']: value for value in old_manifest['tasks']}
after = {value['id']: value for value in new_manifest['tasks']}
manifest_changed = [name for name in before if before[name] != after[name]]
assert manifest_changed == ['GEO-103'], manifest_changed
assert after['GEO-101']['status'] == after['GEO-102']['status'] == 'done'
assert after['GEO-103']['status'] == 'review' and after['GEO-104']['status'] == 'planned'
assert not missing and not unexpected, (missing, unexpected)
assert not any(name in frozen for name in changed)
for name in ['contracts/openapi.yaml', 'frontend/src/shared/api/generated/schema.d.ts']:
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == initial[name]
whitespace = []
checked_paths = related + [str(path.relative_to(root)) for path in [task/'prd.md', task/'design.md', task/'implement.md']]
for name in checked_paths:
    data = (root / name).read_text()
    for number, line in enumerate(data.splitlines(), 1):
        if line.rstrip(' \t') != line:
            whitespace.append(f'{name}:{number}')
    if not data.endswith('\n') or data.endswith('\n\n'):
        whitespace.append(f'{name}:EOF')
assert not whitespace, whitespace
patch_parts = []
for name in related:
    original = evidence / 'before' / name
    if original.is_file():
        before_lines = original.read_text().splitlines(keepends=True)
    else:
        assert name in new, name
        before_lines = []
    patch_parts.extend(unified_diff(before_lines, (root/name).read_text().splitlines(keepends=True), fromfile='a/'+name, tofile='b/'+name))
(evidence/'task-diff.patch').write_text(''.join(patch_parts))
report = {
    'status': 'passed', 'changed_existing': sorted(changed), 'new_task_source_files': new,
    'unexpected_scope': unexpected, 'missing_existing': missing,
    'frozen_migrations_checked': len(frozen), 'changed_frozen': [],
    'openapi_and_generated_unchanged': True, 'manifest_changed_ids': manifest_changed,
    'dependency_status': {name: after[name]['status'] for name in ['GEO-101','GEO-102','GEO-103','GEO-104']},
    'owned_whitespace_checked': len(checked_paths), 'owned_whitespace_errors': whitespace,
    'task_completedAt': task_data['completedAt'],
    'initial_hash_snapshot_unhashed_tracked_paths': unhashed_tracked,
    'unhashed_tracked_paths_initial_status_clean_and_final_HEAD_diff_empty': True,
    'scoped_patch': 'evidence/task-diff.patch',
}
(evidence/'final-scope-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
