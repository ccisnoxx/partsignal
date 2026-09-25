#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-e2e-database-lifecycle-test.XXXXXX")
trap 'rm -rf -- "$temporary_root"' EXIT INT TERM
fake_root="$temporary_root/project"
database_state="$temporary_root/databases"
drop_log="$temporary_root/drop.log"
mkdir -p "$fake_root/backend/.venv/bin" "$fake_root/deploy/scripts" "$database_state"

cat >"$fake_root/backend/.venv/bin/python" <<'EOF'
#!/bin/sh
set -eu
script_path=$1
action=$2
database_name=$3
owner_token=$4
database_file="$E2E_FAKE_DATABASE_STATE/$database_name"
test "$(basename "$script_path")" = e2e-database.py
case "$action" in
  create)
    if test -e "$database_file"; then
      printf '%s\n' "duplicate database: $database_name" >&2
      exit 42
    fi
    printf '%s\n' "$owner_token" >"$database_file"
    printf '%s\n' "postgresql+psycopg://fake.invalid/$database_name"
    exit "$E2E_FAKE_CREATE_EXIT"
    ;;
  drop)
    test -e "$database_file" || exit 0
    actual_owner_token=$(cat "$database_file")
    if test "$actual_owner_token" != "$owner_token"; then
      printf '%s\n' "owner mismatch: $database_name" >&2
      exit 43
    fi
    if test "$E2E_FAKE_DROP_EXIT" -ne 0; then
      printf '%s\n' "forced drop failure: $database_name" >&2
      exit "$E2E_FAKE_DROP_EXIT"
    fi
    printf '%s\n' "$database_name" >>"$E2E_FAKE_DROP_LOG"
    rm -f -- "$database_file"
    ;;
  *)
    exit 99
    ;;
esac
EOF
chmod +x "$fake_root/backend/.venv/bin/python"

runner="$temporary_root/runner.sh"
cat >"$runner" <<'EOF'
#!/bin/sh
set -eu
root=$E2E_FAKE_ROOT
source_database_url=postgresql+psycopg://fake.invalid/partsignal
e2e_database_name=$E2E_DATABASE_NAME
e2e_database_owner_token=$E2E_DATABASE_OWNER_TOKEN
e2e_database_cleanup_pending=0
storage_dir=$E2E_FAKE_STORAGE
. "$E2E_DATABASE_LIFECYCLE_HELPER"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  cleanup_status=0
  if test -n "${E2E_RESOURCE_CLEANUP_LOG:-}"; then
    printf '%s\n' resource-cleanup >>"$E2E_RESOURCE_CLEANUP_LOG"
  fi
  drop_owned_e2e_database || cleanup_status=$?
  test "$status" -ne 0 && exit "$status"
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

create_owned_e2e_database
if test "${E2E_WAIT_FOR_SIGNAL:-0}" -eq 1; then
  : >"$E2E_SIGNAL_READY"
  while :; do sleep 1; done
fi
EOF
chmod +x "$runner"

run_scenario() {
  scenario=$1
  database_name=$2
  owner_token=$3
  create_exit=$4
  drop_exit=$5
  scenario_storage="$temporary_root/storage-$scenario"
  mkdir -p "$scenario_storage"

  set +e
  E2E_FAKE_ROOT="$fake_root" \
  E2E_FAKE_DATABASE_STATE="$database_state" \
  E2E_FAKE_DROP_LOG="$drop_log" \
  E2E_FAKE_STORAGE="$scenario_storage" \
  E2E_FAKE_CREATE_EXIT="$create_exit" \
  E2E_FAKE_DROP_EXIT="$drop_exit" \
  E2E_DATABASE_NAME="$database_name" \
  E2E_DATABASE_OWNER_TOKEN="$owner_token" \
  E2E_DATABASE_LIFECYCLE_HELPER="$repository_root/deploy/scripts/e2e-database-lifecycle.sh" \
    "$runner" >"$temporary_root/output-$scenario" 2>&1
  scenario_status=$?
  set -e
}

collision_database=partsignal_e2e_20260925_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
collision_owner=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
printf '%s\n' 'cccccccccccccccccccccccccccccccc' >"$database_state/$collision_database"
run_scenario collision "$collision_database" "$collision_owner" 0 0
test "$scenario_status" -eq 42
test -e "$database_state/$collision_database"
test "$(cat "$database_state/$collision_database")" = cccccccccccccccccccccccccccccccc
test ! -e "$drop_log"
test "$(grep -c 'status=dropped' "$temporary_root/output-collision" || true)" -eq 0

created_database=partsignal_e2e_20260925_dddddddddddddddddddddddddddddddd
created_owner=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
run_scenario post-create-failure "$created_database" "$created_owner" 17 0
test "$scenario_status" -eq 17
test ! -e "$database_state/$created_database"
test -e "$database_state/$collision_database"
test "$(awk -v expected="$created_database" '$0 == expected { count += 1 } END { print count + 0 }' "$drop_log")" -eq 1
test "$(wc -l <"$drop_log" | tr -d ' ')" -eq 1
test "$(grep -c 'status=dropped' "$temporary_root/output-post-create-failure")" -eq 1

drop_failure_database=partsignal_e2e_20260925_ffffffffffffffffffffffffffffffff
drop_failure_owner=0123456789abcdef0123456789abcdef
run_scenario drop-failure "$drop_failure_database" "$drop_failure_owner" 0 44
test "$scenario_status" -eq 44
test -e "$database_state/$drop_failure_database"
test "$(grep -c 'status=dropped' "$temporary_root/output-drop-failure" || true)" -eq 0

signal_database=partsignal_e2e_20260925_11111111111111111111111111111111
signal_owner=22222222222222222222222222222222
signal_storage="$temporary_root/storage-signal"
signal_ready="$temporary_root/signal-ready"
signal_output="$temporary_root/output-signal"
signal_status_file="$temporary_root/status-signal"
resource_cleanup_log="$temporary_root/resource-cleanup.log"
mkdir -p "$signal_storage"
E2E_FAKE_ROOT="$fake_root" \
E2E_FAKE_DATABASE_STATE="$database_state" \
E2E_FAKE_DROP_LOG="$drop_log" \
E2E_FAKE_STORAGE="$signal_storage" \
E2E_FAKE_CREATE_EXIT=0 \
E2E_FAKE_DROP_EXIT=0 \
E2E_DATABASE_NAME="$signal_database" \
E2E_DATABASE_OWNER_TOKEN="$signal_owner" \
E2E_DATABASE_LIFECYCLE_HELPER="$repository_root/deploy/scripts/e2e-database-lifecycle.sh" \
E2E_WAIT_FOR_SIGNAL=1 \
E2E_SIGNAL_READY="$signal_ready" \
E2E_RESOURCE_CLEANUP_LOG="$resource_cleanup_log" \
  python3 - "$runner" "$signal_ready" "$signal_output" "$signal_status_file" <<'PY'
from pathlib import Path
import os
import signal
import subprocess
import sys
import time

runner, ready, output, status_file = sys.argv[1:]
with open(output, "wb") as stream:
    process = subprocess.Popen([runner], stdout=stream, stderr=subprocess.STDOUT)
    for _ in range(300):
        if Path(ready).exists():
            break
        if process.poll() is not None:
            raise SystemExit("signal runner exited before setup completed")
        time.sleep(0.01)
    else:
        process.kill()
        raise SystemExit("signal runner did not reach the setup wait")
    process.send_signal(signal.SIGTERM)
    status = process.wait(timeout=10)
Path(status_file).write_text(str(status if status >= 0 else 128 - status))
PY
test "$(cat "$signal_status_file")" -eq 143
test ! -e "$database_state/$signal_database"
test "$(awk -v expected="$signal_database" '$0 == expected { count += 1 } END { print count + 0 }' "$drop_log")" -eq 1
test "$(grep -c '^resource-cleanup$' "$resource_cleanup_log")" -eq 1
test "$(grep -c 'status=dropped' "$signal_output")" -eq 1

restore_signal_runner="$temporary_root/restore-signal-runner.sh"
cat >"$restore_signal_runner" <<'EOF'
#!/bin/sh
set -u
. "$E2E_RUN_LIFECYCLE_HELPER"

run_playwright() {
  return 0
}

run_secret_scan() {
  return 0
}

restore_e2e_signal_handlers() {
  kill -TERM "$$"
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

set +e
run_e2e_playwright_and_scan
status=$?
set -e
exit "$status"
EOF
chmod +x "$restore_signal_runner"

set +e
E2E_RUN_LIFECYCLE_HELPER="$repository_root/deploy/scripts/e2e-run-lifecycle.sh" \
  "$restore_signal_runner" >"$temporary_root/output-restore-signal" 2>&1
restore_signal_status=$?
set -e
test "$restore_signal_status" -eq 143
grep -F 'E2E_RESULT playwright=143 secret_scan=0' \
  "$temporary_root/output-restore-signal" >/dev/null

printf '%s\n' 'E2E_DATABASE_LIFECYCLE_TEST scenarios=5 status=passed'
