#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
. "$root/deploy/scripts/e2e-run-lifecycle.sh"

for argument in "$@"; do
  case "$argument" in
    --output|--output=*)
      printf '%s\n' 'fixture E2E output 根由敏感产物扫描入口统一管理' >&2
      exit 2
      ;;
  esac
done

secret_parent=${TMPDIR:-/tmp}
secret_dir=$(mktemp -d "$secret_parent/partsignal-fixture-e2e-secrets.XXXXXX")
secret_manifest="$secret_dir/manifest.jsonl"
secret_key_file="$secret_dir/key"
output_dir="$root/frontend/.cache/playwright-results"

cleanup() {
  status=$?
  trap - EXIT
  cleanup_status=0
  case "$secret_dir" in
    "$secret_parent"/partsignal-fixture-e2e-secrets.*)
      rm -rf -- "$secret_dir" || cleanup_status=1
      ;;
    *)
      printf '%s\n' 'fixture E2E 敏感文件目录不符合清理 allowlist' >&2
      cleanup_status=1
      ;;
  esac
  test "$status" -ne 0 && exit "$status"
  exit "$cleanup_status"
}
trap cleanup EXIT

umask 077
: >"$secret_manifest"
node - "$secret_key_file" <<'NODE'
const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
writeFileSync(process.argv[2], randomBytes(32), { mode: 0o600 });
NODE

# 删除完整根目录，使缺 marker 或配置阶段失败不能复用历史产物。
rm -rf -- "$output_dir"

run_playwright() {
  cd "$root/frontend"
  PARTSIGNAL_E2E_SECRET_MANIFEST="$secret_manifest" \
  PARTSIGNAL_E2E_SECRET_KEY_FILE="$secret_key_file" \
    exec ./node_modules/.bin/playwright test "$@" --output "$output_dir"
}

run_secret_scan() {
  node --experimental-strip-types "$root/frontend/tests/e2e/secret-artifact.ts" scan \
    "$output_dir" "$secret_manifest" "$secret_key_file"
}

set +e
run_e2e_playwright_and_scan "$@"
final_status=$?
set -e
exit "$final_status"
