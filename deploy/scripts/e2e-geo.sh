#!/bin/sh
set -eu

# 每个 phase 复用现有 runner，前一栈精确清理完成后才创建下一随机数据库。
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
: "${REDIS_URL:?必须设置本地或 CI Redis REDIS_URL}"
# 本地独占非 0 DB 的归属、空库与并发检查由每个 runner 的统一 preflight 裁决；CI 使用 14。
for mode in enabled api-disabled monitoring-disabled; do
  printf '%s\n' "E2E_GEO phase=$mode status=begin"
  PARTSIGNAL_E2E_GEO_MODE="$mode" \
    "$root/deploy/scripts/e2e-local.sh" "$@"
  printf '%s\n' "E2E_GEO phase=$mode status=passed"
done
