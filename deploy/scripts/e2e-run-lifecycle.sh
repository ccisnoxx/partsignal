#!/bin/sh

# 调用方需要提供 run_playwright 与 run_secret_scan 两个函数。
e2e_active_pid=
e2e_signal_status=0

e2e_forward_signal() {
  signal_name=$1
  signal_status=$2
  if test "$e2e_signal_status" -eq 0; then
    e2e_signal_status=$signal_status
  fi
  if test -n "$e2e_active_pid" && kill -0 "$e2e_active_pid" 2>/dev/null; then
    kill -s "$signal_name" "$e2e_active_pid" 2>/dev/null || true
  fi
}

e2e_wait_for_active_process() {
  while :; do
    wait "$e2e_active_pid"
    wait_status=$?
    if ! kill -0 "$e2e_active_pid" 2>/dev/null; then
      return "$wait_status"
    fi
  done
}

run_e2e_playwright_and_scan() {
  e2e_signal_status=0
  trap 'e2e_forward_signal INT 130' INT
  trap 'e2e_forward_signal TERM 143' TERM

  run_playwright "$@" &
  e2e_active_pid=$!
  e2e_wait_for_active_process
  playwright_status=$?
  e2e_active_pid=

  # reporter、fixture teardown 和 error-context 在 Playwright 子进程退出前完成。
  run_secret_scan &
  e2e_active_pid=$!
  e2e_wait_for_active_process
  secret_scan_status=$?
  e2e_active_pid=

  if command -v restore_e2e_signal_handlers >/dev/null 2>&1; then
    restore_e2e_signal_handlers
  else
    trap - INT TERM
  fi
  if test "$e2e_signal_status" -ne 0; then
    playwright_status=$e2e_signal_status
  fi

  printf '%s\n' "E2E_RESULT playwright=$playwright_status secret_scan=$secret_scan_status"
  if test "$playwright_status" -ne 0; then
    return "$playwright_status"
  fi
  return "$secret_scan_status"
}
