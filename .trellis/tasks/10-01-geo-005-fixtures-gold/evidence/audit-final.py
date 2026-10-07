"""审计 GEO-005 自有变更、初始工作保护、文件链接与文档哈希。"""
import difflib
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[4]
evidence = Path(__file__).resolve().parent
task_root = evidence.parent
task = json.loads((task_root / 'task.json').read_text())
initial = json.loads((evidence / 'initial-state.json').read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


protected = {}
for name, digest in initial['sha256'].items():
    if name in {'Makefile', 'docs/geo-monitoring/04-delivery/task-manifest.yaml'}:
        continue
    protected[name] = sha(repo / name) == digest
assert all(protected.values()), '非本任务文件或公共合同发生变化'

before = (evidence / 'Makefile-before').read_text()
after = (repo / 'Makefile').read_text()
expected = before.replace(' staging-redeploy-fast down\n',
                          ' staging-redeploy-fast down test-geo-fixtures\n')
expected = expected.replace('test-deploy-scripts: test-frontend-container\n',
                            'test-geo-fixtures:\n'
                            '\t$(UV) run --project backend python deploy/scripts/check-geo-fixtures.py\n\n'
                            'test-deploy-scripts: test-frontend-container\n'
                            '\t$(UV) run --project backend python deploy/scripts/check-geo-fixtures.py\n')
assert expected == after, 'Makefile 超出本任务追加片段'
assert hashlib.sha256(before.encode()).hexdigest() == initial['sha256']['Makefile']
(evidence / 'Makefile-task.diff').write_text(''.join(difflib.unified_diff(
    before.splitlines(True), after.splitlines(True), fromfile='initial/Makefile', tofile='final/Makefile')))

manifest = (repo / 'docs/geo-monitoring/04-delivery/task-manifest.yaml').read_text()
entry = re.search(r'- id: GEO-005\n.*?(?=- id:|\Z)', manifest, re.S).group()
original_entry = (evidence / 'GEO-005-manifest-before.yaml').read_text()
restored = manifest.replace(entry, original_entry)
assert hashlib.sha256(restored.encode()).hexdigest() == initial['sha256'][
    'docs/geo-monitoring/04-delivery/task-manifest.yaml'], 'manifest 其他任务发生变化'
assert task['status'] == task['meta']['manifest_status'] == 'review'
assert '  status: review\n' in entry and task['completedAt'] is None
for identity in ('GEO-402', 'GEO-501'):
    assert '  status: planned\n' in re.search(
        rf'- id: {identity}\n.*?(?=- id:|\Z)', manifest, re.S).group()

link_files = [
    repo / 'backend/tests/fixtures/geo_analysis/README.md',
    repo / 'docs/geo-monitoring/README.md',
    repo / 'docs/geo-monitoring/03-technical/07-testing-and-quality.md',
    task_root / 'prd.md', task_root / 'implement.md',
]
link_count = 0
for path in link_files:
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        if target.startswith(('http:', 'https:', '#', 'mailto:')):
            continue
        assert (path.parent / target.split('#')[0]).exists(), f'失效相对链接：{path.name}'
        link_count += 1

checks = [
    ('diff-check-final', ['git', 'diff', '--check'], repo),
    ('document-hashes', ['shasum', '-a', '256', '-c', 'SHA256SUMS'], repo / 'docs/geo-monitoring'),
]
results = []
for name, command, cwd in checks:
    run = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    (evidence / f'{name}.log').write_text(run.stdout + run.stderr)
    results.append({'command': ' '.join(command), 'cwd': str(cwd), 'exit_code': run.returncode})
    assert run.returncode == 0, f'{name} 未通过'

index = repo / '.git/index'
index_before = sha(index) if index.exists() else None
owned = task['relatedFiles'] + [str((task_root / name).relative_to(repo))
                               for name in ('prd.md', 'implement.md', 'task.json')]
with tempfile.TemporaryDirectory(prefix='geo-005-index-') as directory:
    environment = dict(os.environ, GIT_INDEX_FILE=str(Path(directory) / 'index'))
    subprocess.run(['git', 'read-tree', 'HEAD'], cwd=repo, env=environment, check=True)
    subprocess.run(['git', 'add', '--', *owned], cwd=repo, env=environment, check=True)
    run = subprocess.run(['git', 'diff', '--cached', '--check'], cwd=repo, env=environment,
                         capture_output=True, text=True, check=False)
    (evidence / 'owned-new-files-diff-check.log').write_text(run.stdout + run.stderr)
    assert run.returncode == 0, '本任务文件 whitespace 检查未通过'
    stat = subprocess.run(['git', 'diff', '--cached', '--stat'], cwd=repo, env=environment,
                          capture_output=True, text=True, check=True)
    (evidence / 'owned-files.diffstat').write_text(stat.stdout)
assert (sha(index) if index.exists() else None) == index_before, '真实 Git index 被改变'

runtime = subprocess.run(['rg', '-n', 'geo-fixtures|geo_fixtures|geo_analysis',
                          'backend/app', 'frontend/src', '--glob', '!**/test/**'],
                         cwd=repo, capture_output=True, text=True, check=False)
assert runtime.returncode == 1 and not runtime.stdout, '运行时导入了测试夹具'
status = subprocess.run(['git', 'status', '--short'], cwd=repo,
                        capture_output=True, text=True, check=True).stdout.splitlines()
report = {
    'task_id': 'GEO-005', 'task_status': 'review',
    'protected_initial_files': protected,
    'Makefile_only_expected_additions': True,
    'manifest_only_GEO_005_entry_changed': True,
    'GEO_402_GEO_501_remain_planned': True,
    'public_contracts_unchanged': True,
    'actual_git_index_preserved': True,
    'runtime_test_fixture_imports': 0,
    'relative_links_verified': link_count,
    'checks': results,
    'owned_new_files_diff_check_exit_code': 0,
    'owned_file_sha256': {name: sha(repo / name) for name in task['relatedFiles']},
    'working_tree': status,
    'known_validation_gap': 'make test-deploy-scripts 前置构建缺少 Docker socket，后续 recipe 与真实容器未验证',
    'delegated': False,
}
(evidence / 'final-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(f'GEO-005 最终审计通过：{len(task["relatedFiles"])} 个实施文件，{link_count} 个相对链接；状态 review。')
