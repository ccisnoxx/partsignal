#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
harness="$root/deploy/scripts/test-deploy-production.sh"
suite_root=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${TMPDIR:-/tmp}")
suite_parent=

cleanup_suite() {
  if test -z "$suite_parent"; then
    return 0
  fi
  suite_parent_parent=$(dirname "$suite_parent")
  suite_parent_name=$(basename "$suite_parent")
  case "$suite_parent_name" in
    partsignal-production-cleanup-regression.*) ;;
    *)
      printf '%s\n' "拒绝清理不符合回归测试 owner 约束的目录：$suite_parent" >&2
      return 1
      ;;
  esac
  test "$suite_parent_parent" = "$suite_root"
  /bin/rm -rf "$suite_parent"
}

handle_suite_exit() {
  main_status=$?
  trap - 0 INT TERM
  cleanup_status=0
  cleanup_suite || cleanup_status=$?
  if test "$main_status" -ne 0; then
    exit "$main_status"
  fi
  exit "$cleanup_status"
}

handle_suite_signal() {
  exit "$1"
}
trap handle_suite_exit 0
trap 'handle_suite_signal 130' INT
trap 'handle_suite_signal 143' TERM

suite_parent=$(mktemp -d "$suite_root/partsignal-production-cleanup-regression.XXXXXX")
canonical_root="$suite_parent/canonical-root"
raw_root="$suite_parent/raw-root"
mkdir "$canonical_root"
ln -s "$canonical_root" "$raw_root"
raw_tmpdir="$raw_root/"
sibling="$canonical_root/unrelated-sibling"
mkdir "$sibling"
printf '%s\n' keep >"$sibling/marker"

assert_roots_differ() {
  canonical_from_raw=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$raw_tmpdir")
  test "$raw_tmpdir" != "$canonical_from_raw"
  test "$canonical_from_raw" = "$canonical_root"
}

owned_dirs() {
  find "$canonical_root" -mindepth 1 -maxdepth 1 -type d \
    -name 'partsignal-production-test.*' -print | sort
}

assert_clean_and_sibling_intact() {
  test -z "$(owned_dirs)"
  test -f "$sibling/marker"
  test "$(cat "$sibling/marker")" = keep
}

remove_owned_fixture() {
  owned_path=$1
  test "$(dirname "$owned_path")" = "$canonical_root"
  case "$(basename "$owned_path")" in
    partsignal-production-test.*) ;;
    *) return 1 ;;
  esac
  /bin/rm -rf "$owned_path"
}

run_exit_case() {
  mode=$1
  expected_status=$2
  log_file="$suite_parent/$mode.log"
  assert_clean_and_sibling_intact
  set +e
  TMPDIR="$raw_tmpdir" PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE="$mode" \
    "$harness" >"$log_file" 2>&1
  actual_status=$?
  set -e
  test "$actual_status" -eq "$expected_status"
  assert_clean_and_sibling_intact
}

run_cleanup_refusal_case() {
  log_file="$suite_parent/cleanup-refusal.log"
  assert_clean_and_sibling_intact
  set +e
  TMPDIR="$raw_tmpdir" PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE=success \
    PARTSIGNAL_PRODUCTION_HARNESS_TEST_CLEANUP_TARGET="$sibling" \
    "$harness" >"$log_file" 2>&1
  actual_status=$?
  set -e
  test "$actual_status" -ne 0
  grep -q '拒绝清理不属于 Production harness 的目录' "$log_file"
  test -f "$sibling/marker"
  refused_owned=$(owned_dirs)
  test -n "$refused_owned"
  test "$(printf '%s\n' "$refused_owned" | wc -l | tr -d ' ')" -eq 1
  remove_owned_fixture "$refused_owned"
  assert_clean_and_sibling_intact
}

run_cleanup_failure_case() {
  fake_bin="$suite_parent/fake-bin"
  log_file="$suite_parent/cleanup-failure.log"
  mkdir "$fake_bin"
  printf '%s\n' '#!/bin/sh' 'exit 71' >"$fake_bin/rm"
  chmod +x "$fake_bin/rm"
  assert_clean_and_sibling_intact
  set +e
  PATH="$fake_bin:$PATH" TMPDIR="$raw_tmpdir" \
    PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE=success \
    "$harness" >"$log_file" 2>&1
  actual_status=$?
  set -e
  test "$actual_status" -ne 0
  grep -q '清理 Production harness 临时目录失败' "$log_file"
  failed_owned=$(owned_dirs)
  test -n "$failed_owned"
  test "$(printf '%s\n' "$failed_owned" | wc -l | tr -d ' ')" -eq 1
  remove_owned_fixture "$failed_owned"
  assert_clean_and_sibling_intact
}

run_signal_case() {
  signal_name=$1
  expected_status=$2
  log_file="$suite_parent/$signal_name.log"
  assert_clean_and_sibling_intact
  python3 - "$harness" "$raw_tmpdir" "$canonical_root" "$signal_name" \
    "$expected_status" "$log_file" <<'PY'
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

harness, tmpdir, canonical_root, signal_name, expected_text, log_text = sys.argv[1:]
expected = int(expected_text)
environment = os.environ.copy()
environment.update(
    TMPDIR=tmpdir,
    PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE="wait-for-signal",
)
with open(log_text, "w", encoding="utf-8") as output:
    process = subprocess.Popen(
        [harness],
        env=environment,
        stdout=output,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    deadline = time.monotonic() + 10
    while not list(Path(canonical_root).glob("partsignal-production-test.*")):
        if process.poll() is not None:
            raise SystemExit(f"harness 在 owned 目录出现前退出：{process.returncode}")
        if time.monotonic() >= deadline:
            process.kill()
            process.wait()
            raise SystemExit("等待 harness owned 目录超时")
        time.sleep(0.02)
    process.send_signal(getattr(signal, signal_name))
    try:
        actual = process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise SystemExit("harness 接收 signal 后未退出")
if actual != expected:
    raise SystemExit(f"signal 退出码错误：expected={expected} actual={actual}")
PY
  assert_clean_and_sibling_intact
}

assert_roots_differ
run_exit_case success 0
run_exit_case failure 23
run_exit_case initialization-failure 24
run_cleanup_refusal_case
run_cleanup_failure_case
run_signal_case SIGINT 130
run_signal_case SIGTERM 143

printf '%s\n' "Production harness canonical TMPDIR 与 cleanup 生命周期回归检查通过"
