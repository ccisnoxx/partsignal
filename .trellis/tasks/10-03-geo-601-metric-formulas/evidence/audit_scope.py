"""基于起始字节审计本任务范围，保留其他 dirty/untracked 工作。"""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess
import yaml

root = Path('.trellis/tasks/10-03-geo-601-metric-formulas')
evidence = root / 'evidence'
base = json.loads((evidence / 'baseline-files.json').read_text())
expected = {
    'docs/geo-monitoring/01-product/02-geo-core-prd.md',
    'docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md',
    'docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md',
    'docs/geo-monitoring/04-delivery/task-manifest.yaml',
    'docs/geo-monitoring/README.md', 'docs/geo-monitoring/SHA256SUMS',
}
new_code = {
    'backend/app/services/geo_metrics.py', 'backend/app/services/geo_metric_types.py',
    'backend/app/services/geo_metric_inputs.py', 'backend/tests/unit/geo_metrics_gold.py',
    'backend/tests/unit/test_geo_metrics.py', 'backend/tests/unit/test_geo_metric_inputs.py',
}
changed = sorted(name for name, digest in base.items() if Path(name).is_file()
                 and hashlib.sha256(Path(name).read_bytes()).hexdigest() != digest)
deleted = sorted(name for name in base if not Path(name).is_file())
current = subprocess.check_output(['git', 'ls-files', '--cached', '--others',
                                   '--exclude-standard', '-z']).decode().split('\0')
new = sorted(name for name in current if name and name not in base
             and not name.startswith(str(root) + '/') and not name.startswith('.trellis/.runtime/'))
unexpected = sorted((set(changed) - expected) | (set(new) - new_code) | set(deleted))
manifest = 'docs/geo-monitoring/04-delivery/task-manifest.yaml'
before = yaml.safe_load((evidence / 'before' / manifest).read_text())
after = yaml.safe_load(Path(manifest).read_text())
# 同一清单结构只允许 GEO-601 条目变化。
entries_before = {item['id']: item for item in before['tasks']}
entries_after = {item['id']: item for item in after['tasks']}
other_tasks = sorted(identity for identity in entries_before.keys() | entries_after.keys()
                     if identity != 'GEO-601' and entries_before.get(identity) != entries_after.get(identity))
assert not unexpected, unexpected
assert not other_tasks, other_tasks
assert entries_after['GEO-507']['status'] == 'done'
assert entries_after['GEO-601']['status'] in {'in_progress', 'review'}
diffs = []
for name in changed:
    original = evidence / 'before' / name
    assert original.is_file(), name
    assert hashlib.sha256(original.read_bytes()).hexdigest() == base[name], name
    diffs.extend(difflib.unified_diff(original.read_text().splitlines(True),
                                    Path(name).read_text().splitlines(True),
                                    fromfile='before/' + name, tofile='after/' + name))
for name in sorted(new_code):
    diffs.extend(difflib.unified_diff([], Path(name).read_text().splitlines(True),
                                    fromfile='/dev/null', tofile=name))
(evidence / 'candidate-task-only.diff').write_text(''.join(diffs))
result = {'changed_preexisting_files': changed, 'new_source_and_test_files': new,
          'deleted_preexisting_files': deleted, 'unexpected_changes': unexpected,
          'other_manifest_task_changes': other_tasks,
          'contracts_changed': False, 'migration_changed': False,
          'frontend_changed': False, 'dependency_status': 'done',
          'delivery_status': entries_after['GEO-601']['status'],
          'source_sha256': {name: hashlib.sha256(Path(name).read_bytes()).hexdigest()
                            for name in sorted(new_code)}}
(evidence / 'candidate-scope-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
