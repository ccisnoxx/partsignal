#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-e2e-lifecycle-test.XXXXXX")
trap 'rm -rf -- "$temporary_root"' EXIT INT TERM
runner="$temporary_root/runner.sh"
playwright_fixture="$temporary_root/playwright-fixture.sh"

cat >"$playwright_fixture" <<'EOF'
#!/bin/sh
set -u

if test "$E2E_PLAYWRIGHT_MODE" = return; then
  exit "$E2E_PLAYWRIGHT_STATUS"
fi

if test "$E2E_PLAYWRIGHT_MODE" = stubborn; then
  (
    trap '' INT TERM
    printf '%s\n' "$E2E_SECRET_VALUE" >"$E2E_MARKER"
    printf '%s\n' stubborn-descendant-started >>"$E2E_TEST_LOG"
    while :; do sleep 1; done
  ) &
  printf '%s\n' "$!" >"$E2E_REPORTER_PID_FILE"
  while test ! -s "$E2E_MARKER"; do sleep 0.01; done
  printf '%s\n' playwright-started >>"$E2E_TEST_LOG"
  exit 0
fi

reporter() {
  trap 'sleep 0.2; printf "%s\n" "$E2E_SECRET_VALUE" >"$E2E_MARKER"; printf "%s\n" reporter-finished >>"$E2E_TEST_LOG"; exit 130' INT
  trap 'sleep 0.2; printf "%s\n" "$E2E_SECRET_VALUE" >"$E2E_MARKER"; printf "%s\n" reporter-finished >>"$E2E_TEST_LOG"; exit 143' TERM
  printf '%s\n' reporter-started >>"$E2E_TEST_LOG"
  while :; do sleep 1; done
}

reporter &
printf '%s\n' "$!" >"$E2E_REPORTER_PID_FILE"
trap 'printf "%s\n" playwright-parent-exited >>"$E2E_TEST_LOG"; exit 130' INT
trap 'printf "%s\n" playwright-parent-exited >>"$E2E_TEST_LOG"; exit 143' TERM
printf '%s\n' playwright-started >>"$E2E_TEST_LOG"
while :; do sleep 1; done
EOF
chmod +x "$playwright_fixture"

cat >"$runner" <<'EOF'
#!/bin/sh
set -u
. "$E2E_LIFECYCLE_HELPER"

cleanup() {
  status=$?
  trap - EXIT
  rm -f -- "$E2E_SECRET_KEY" "$E2E_SECRET_MANIFEST"
  printf '%s\n' cleanup >>"$E2E_TEST_LOG"
  test "$status" -ne 0 && exit "$status"
  exit "$E2E_CLEANUP_STATUS"
}
trap cleanup EXIT

run_playwright() {
  exec python3 "$E2E_PROCESS_GROUP_HELPER" \
    --grace-seconds "$E2E_PROCESS_GROUP_GRACE_SECONDS" \
    --kill-wait-seconds "$E2E_PROCESS_GROUP_KILL_WAIT_SECONDS" -- \
    "$E2E_PLAYWRIGHT_FIXTURE"
}

run_secret_scan() {
  test -f "$E2E_SECRET_KEY"
  test -f "$E2E_SECRET_MANIFEST"
  if test "$E2E_PLAYWRIGHT_MODE" != return; then
    test "$(cat "$E2E_MARKER")" = "$E2E_SECRET_VALUE"
  fi
  printf '%s\n' scanner-called >>"$E2E_TEST_LOG"
  return "$E2E_SCAN_STATUS"
}

set +e
run_e2e_playwright_and_scan
status=$?
set -e
exit "$status"
EOF
chmod +x "$runner"

line_count() {
  expected_line=$1
  target_file=$2
  awk -v expected="$expected_line" '$0 == expected { count += 1 } END { print count + 0 }' "$target_file"
}

assert_case() {
  name=$1
  playwright_mode=$2
  playwright_status=$3
  scan_status=$4
  cleanup_status=$5
  signal_name=$6
  expected_status=$7
  expected_result=$8
  case_root="$temporary_root/$name"
  mkdir -p "$case_root"
  log="$case_root/events.log"
  output="$case_root/output"
  status_file="$case_root/status"
  marker="$case_root/.last-run.json"
  key="$case_root/secret-key"
  manifest="$case_root/secret-manifest"
  reporter_pid_file="$case_root/reporter.pid"
  : >"$log"
  : >"$key"
  : >"$manifest"

  E2E_LIFECYCLE_HELPER="$root/deploy/scripts/e2e-run-lifecycle.sh" \
  E2E_PROCESS_GROUP_HELPER="$root/deploy/scripts/e2e-process-group.py" \
  E2E_PLAYWRIGHT_FIXTURE="$playwright_fixture" \
  E2E_TEST_LOG="$log" \
  E2E_PLAYWRIGHT_MODE="$playwright_mode" \
  E2E_PLAYWRIGHT_STATUS="$playwright_status" \
  E2E_PROCESS_GROUP_GRACE_SECONDS=0.5 \
  E2E_PROCESS_GROUP_KILL_WAIT_SECONDS=0.5 \
  E2E_SCAN_STATUS="$scan_status" \
  E2E_CLEANUP_STATUS="$cleanup_status" \
  E2E_MARKER="$marker" \
  E2E_SECRET_KEY="$key" \
  E2E_SECRET_MANIFEST="$manifest" \
  E2E_SECRET_VALUE="controlled-secret-$name" \
  E2E_REPORTER_PID_FILE="$reporter_pid_file" \
    python3 - "$runner" "$output" "$log" "$signal_name" "$status_file" "$reporter_pid_file" <<'PY'
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

runner, output, log, signal_name, status_file, reporter_pid_file = sys.argv[1:]
with open(output, "wb") as stream:
    process = subprocess.Popen([runner], stdout=stream, stderr=subprocess.STDOUT, env=os.environ.copy())
    if signal_name != "none":
        for _ in range(300):
            events = Path(log).read_text()
            if "playwright-started" in events and "reporter-started" in events:
                break
            if process.poll() is not None:
                raise SystemExit("runner exited before Playwright descendants started")
            time.sleep(0.01)
        else:
            process.kill()
            raise SystemExit("Playwright descendants did not start")
        process.send_signal(getattr(signal, f"SIG{signal_name}"))
    status = process.wait(timeout=10)

if Path(reporter_pid_file).exists():
    reporter_pid = int(Path(reporter_pid_file).read_text())
    try:
        os.kill(reporter_pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise SystemExit("reporter descendant survived lifecycle completion")
Path(status_file).write_text(str(status if status >= 0 else 128 - status))
PY
  actual_status=$(cat "$status_file")
  test "$actual_status" -eq "$expected_status" || {
    cat "$output" >&2
    printf '%s\n' "$name: exit=$actual_status expected=$expected_status" >&2
    exit 1
  }
  grep -F "$expected_result" "$output" >/dev/null
  test "$(line_count scanner-called "$log")" -eq 1
  test "$(line_count cleanup "$log")" -eq 1
  test "$(tail -n 1 "$log")" = cleanup
  test ! -e "$key"
  test ! -e "$manifest"
  if test "$playwright_mode" = wait; then
    parent_line=$(grep -n '^playwright-parent-exited$' "$log" | cut -d: -f1)
    reporter_line=$(grep -n '^reporter-finished$' "$log" | cut -d: -f1)
    scanner_line=$(grep -n '^scanner-called$' "$log" | cut -d: -f1)
    test "$parent_line" -lt "$reporter_line"
    test "$reporter_line" -lt "$scanner_line"
  fi
  if test "$playwright_mode" = stubborn; then
    grep -F 'E2E_PROCESS_GROUP status=timeout action=SIGKILL' "$output" >/dev/null
  fi
}

assert_case int-scan-fails wait 0 9 11 INT 130 'E2E_RESULT playwright=130 secret_scan=9'
assert_case term-clean wait 0 0 11 TERM 143 'E2E_RESULT playwright=143 secret_scan=0'
assert_case playwright-wins return 7 9 11 none 7 'E2E_RESULT playwright=7 secret_scan=9'
assert_case scan-wins return 0 9 11 none 9 'E2E_RESULT playwright=0 secret_scan=9'
assert_case cleanup-wins return 0 0 11 none 11 'E2E_RESULT playwright=0 secret_scan=0'
assert_case stubborn-escalates stubborn 0 9 11 none 137 'E2E_RESULT playwright=137 secret_scan=9'

printf '%s\n' 'E2E_LIFECYCLE_TEST status=passed'
