#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-post-run-secret-test.XXXXXX")
output="$temporary_root/output.log"
artifacts="$root/frontend/.cache/playwright-results"
cleanup() {
  rm -rf -- "$temporary_root" "$artifacts"
}
trap cleanup EXIT INT TERM

set +e
PARTSIGNAL_E2E_SECRET_ARTIFACT_REGRESSION=1 \
  "$root/frontend/tests/e2e/run-with-secret-scan.sh" \
  tests/e2e/secret-artifact-post-run.spec.ts \
  --project=foundation-desktop >"$output" 2>&1
status=$?
set -e

test "$status" -eq 1 || {
  printf '%s\n' "post-run secret regression exit=$status expected=1" >&2
  exit 1
}
grep -F '1 passed' "$output" >/dev/null
grep -F '敏感值进入 Playwright 测试产物：' "$output" >/dev/null
grep -F 'error-context.md' "$output" >/dev/null
grep -F 'E2E_RESULT playwright=0 secret_scan=1' "$output" >/dev/null

python3 - "$artifacts" "$output" <<'PY'
from pathlib import Path
import sys

artifacts = Path(sys.argv[1])
output = Path(sys.argv[2]).read_bytes()
late_artifacts = list(artifacts.rglob("error-context.md"))
if len(late_artifacts) != 1:
    raise SystemExit(f"expected one late error-context artifact, got {len(late_artifacts)}")
payload = late_artifacts[0].read_bytes()
prefix = '测试函数返回后写入的受控产物：'.encode()
if not payload.startswith(prefix):
    raise SystemExit("late artifact payload missing controlled prefix")
secret = payload[len(prefix):]
if not secret or secret in output:
    raise SystemExit("controlled secret was empty or reached stdout/stderr")
PY

printf '%s\n' 'E2E_POST_RUN_SECRET_TEST status=passed'
