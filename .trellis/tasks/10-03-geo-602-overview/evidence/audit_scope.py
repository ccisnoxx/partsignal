"""按起始字节核对602范围；既有dirty/untracked文件不得被本任务覆盖。"""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess
import yaml

root = Path('.trellis/tasks/10-03-geo-602-overview')
evidence = root / 'evidence'
base = json.loads((evidence / 'baseline-files.json').read_text())
expected = {
    'contracts/openapi.yaml', 'contracts/database.md', 'backend/app/main.py',
    'backend/app/services/geo_metric_types.py', 'backend/app/services/geo_metric_inputs.py',
    'backend/tests/unit/test_geo_metric_inputs.py', 'backend/tests/unit/test_contract.py',
    'backend/tests/unit/test_runtime_response_metadata.py',
    'frontend/src/shared/api/generated/schema.d.ts',
    'docs/geo-monitoring/01-product/02-geo-core-prd.md',
    'docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md',
    'docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md',
    'docs/geo-monitoring/04-delivery/task-manifest.yaml',
    'docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md',
    'docs/geo-monitoring/README.md', 'docs/geo-monitoring/SHA256SUMS',
}
new_code = {
    'backend/app/services/geo_overview.py', 'backend/app/services/geo_overview_queries.py',
    'backend/app/schemas/geo_insights.py', 'backend/app/schemas/geo_metric_values.py',
    'backend/app/routers/geo_overview.py',
    'backend/tests/unit/test_geo_overview.py', 'backend/tests/integration/test_geo_overview.py',
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
entries_before = {item['id']: item for item in before['tasks']}
entries_after = {item['id']: item for item in after['tasks']}
other_tasks = sorted(identity for identity in entries_before.keys() | entries_after.keys()
                     if identity != 'GEO-602' and entries_before.get(identity) != entries_after.get(identity))
assert not unexpected, unexpected
assert not other_tasks, other_tasks
assert entries_after['GEO-601']['status'] == 'done'
assert entries_after['GEO-602']['status'] in {'in_progress', 'review'}
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
(evidence / 'task-only.diff').write_text(''.join(diffs))
result = {'changed_preexisting_files': changed, 'new_source_and_test_files': new,
          'deleted_preexisting_files': deleted, 'unexpected_changes': unexpected,
          'other_manifest_task_changes': other_tasks,
          'contracts_changed': True, 'migration_changed': False,
          'frontend_changed': 'generated schema only', 'dependency_status': 'done',
          'delivery_status': entries_after['GEO-602']['status'],
          'source_sha256': {name: hashlib.sha256(Path(name).read_bytes()).hexdigest()
                            for name in sorted(new_code | (expected - {'docs/geo-monitoring/SHA256SUMS'}))}}
(evidence / 'scope-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'changed_count':len(changed),'new_count':len(new),'unexpected':unexpected,
                  'other_manifest_changes':other_tasks,'status':result['delivery_status']},ensure_ascii=False))
