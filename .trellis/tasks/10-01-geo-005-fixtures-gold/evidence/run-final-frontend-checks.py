"""前端加载边界修正后保存受影响检查的实际结果。"""
import json
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

repo = Path(__file__).resolve().parents[4]
evidence = Path(__file__).resolve().parent
checks = [
    ('fixture-frontend-final', 'npm --prefix frontend run test -- src/test/geo-fixtures.test.ts'),
    ('lint-final', 'make lint'),
    ('typecheck-final', 'make typecheck'),
    ('test-unit-final', 'make test-unit'),
    ('frontend-test-final', 'npm --prefix frontend run test'),
    ('frontend-typecheck-final', 'npm --prefix frontend run typecheck'),
    ('isolated-frontend-build', 'python3 .trellis/tasks/10-01-geo-005-fixtures-gold/evidence/check-frontend-context.py'),
]
results = []
for name, command in checks:
    started = datetime.now(UTC).isoformat()
    before = time.monotonic()
    log = evidence / f'{name}.log'
    with log.open('w', encoding='utf-8') as output:
        run = subprocess.run(command, shell=True, cwd=repo, stdout=output,
                             stderr=subprocess.STDOUT, check=False)
    results.append({'name': name, 'command': command, 'cwd': str(repo),
                    'started_at': started, 'exit_code': run.returncode,
                    'elapsed_seconds': round(time.monotonic() - before, 3),
                    'log': str(log.relative_to(repo))})
    (evidence / 'final-frontend-commands.json').write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{name}: exit={run.returncode} elapsed={results[-1]["elapsed_seconds"]}s', flush=True)
