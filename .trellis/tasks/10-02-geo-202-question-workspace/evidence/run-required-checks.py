"""保存用户要求的精确命令、退出码和日志；失败不掩盖后续独立检查。"""
import json
import os
import subprocess
import time
from pathlib import Path

root = Path('/Users/sc/PycharmProjects/partsignal')
evidence = Path(__file__).resolve().parent
checks = [
    ('make-lint', ['make', 'lint']),
    ('make-typecheck', ['make', 'typecheck']),
    ('make-test-unit', ['make', 'test-unit']),
    ('frontend-test', ['npm', '--prefix', 'frontend', 'run', 'test']),
    ('frontend-typecheck', ['npm', '--prefix', 'frontend', 'run', 'typecheck']),
    ('git-diff-check', ['git', 'diff', '--check']),
]
results = []
check_env = os.environ.copy()
check_env['UV_CACHE_DIR'] = str(root / '.cache/uv')
for name, command in checks:
    start = time.monotonic()
    with (evidence / (name + '.log')).open('w') as log:
        completed = subprocess.run(command, cwd=root, env=check_env, stdout=log, stderr=subprocess.STDOUT, check=False)
    row = {'name': name, 'command': command, 'exit_code': completed.returncode, 'duration_seconds': round(time.monotonic()-start, 2), 'log': name+'.log'}
    results.append(row)
    (evidence/'required-checks.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(row, ensure_ascii=False), flush=True)
