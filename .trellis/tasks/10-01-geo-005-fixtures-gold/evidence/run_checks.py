"""保存 GEO-005 的实际命令、退出码、耗时与原始输出，不把阻断当通过。"""
from __future__ import annotations

import json
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent
CHECKS = [
    ('fixture-cli', 'make test-geo-fixtures'),
    ('fixture-pytest', 'UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_fixtures.py'),
    ('fixture-frontend', 'npm --prefix frontend run test -- src/test/geo-fixtures.test.ts'),
    ('fixture-script-lint', 'UV_CACHE_DIR=.cache/uv uv run --project backend ruff check deploy/scripts/check-geo-fixtures.py'),
    ('diff-check', 'git diff --check'),
    ('contract-check', 'make contract-check'),
    ('lint', 'make lint'),
    ('typecheck', 'make typecheck'),
    ('test-unit', 'make test-unit'),
    ('frontend-test', 'npm --prefix frontend run test'),
    ('frontend-typecheck', 'npm --prefix frontend run typecheck'),
    ('test-deploy-scripts', 'make test-deploy-scripts'),
]
results = []
for name, command in CHECKS:
    started = datetime.now(UTC).isoformat()
    before = time.monotonic()
    log = EVIDENCE / f'{name}.log'
    with log.open('w', encoding='utf-8') as output:
        run = subprocess.run(command, shell=True, cwd=REPO, stdout=output,
                             stderr=subprocess.STDOUT, check=False)
    results.append({'name': name, 'command': command, 'cwd': str(REPO),
                    'started_at': started, 'exit_code': run.returncode,
                    'elapsed_seconds': round(time.monotonic() - before, 3),
                    'log': str(log.relative_to(REPO))})
    (EVIDENCE / 'commands.json').write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{name}: exit={run.returncode} elapsed={results[-1]["elapsed_seconds"]}s', flush=True)
