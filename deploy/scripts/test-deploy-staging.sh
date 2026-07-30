#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-deploy-test.XXXXXX")

cleanup() {
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/partsignal-deploy-test.*) rm -rf "$test_dir" ;;
  esac
}
trap cleanup 0 INT TERM

node "$root/deploy/scripts/check-nginx-security.mjs"

test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.conf.template")" -eq 1
test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.staging.conf.template")" -eq 1
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '2']" \
  "$root/deploy/compose.prod.yaml"
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '1']" \
  "$root/deploy/compose.staging.yaml"

mkdir "$test_dir/bin"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "docker %s\n" "$*" >>"$COMMAND_LOG"' \
  >"$test_dir/bin/docker"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "curl %s\n" "$*" >>"$COMMAND_LOG"' \
  >"$test_dir/bin/curl"
chmod +x "$test_dir/bin/docker" "$test_dir/bin/curl"
: >"$test_dir/env"
: >"$test_dir/full.log"
: >"$test_dir/fast.log"
: >"$test_dir/invalid.log"

unset PARTSIGNAL_DEPLOY_MODE
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/full.log" \
  PARTSIGNAL_VERSION=test ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/fast.log" \
  PARTSIGNAL_VERSION=test PARTSIGNAL_DEPLOY_MODE=fast \
  ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null

grep -q 'preflight-integrity' "$test_dir/fast.log"
grep -q 'build api frontend' "$test_dir/fast.log"
grep -q 'up -d --wait worker scheduler' "$test_dir/fast.log"
grep -q '/api/health/ready' "$test_dir/fast.log"
grep -q 'http://127.0.0.1:19080/' "$test_dir/fast.log"
! grep -q 'run --rm migrate' "$test_dir/fast.log"
! grep -q 'seed-demo' "$test_dir/fast.log"
grep -q 'build api frontend' "$test_dir/full.log"
grep -q 'run --rm migrate' "$test_dir/full.log"
grep -q 'seed-demo' "$test_dir/full.log"
! grep -q 'build api fake-oss frontend' "$test_dir/full.log"

awk '
  /config --quiet/ { config = NR }
  /build api frontend/ { build = NR }
  /up -d postgres redis fake-oss/ { base = NR }
  /preflight-integrity/ { preflight = NR }
  /up -d --wait worker scheduler/ { workers = NR }
  /up -d --wait api frontend/ { application = NR }
  / compose .* ps$/ { status = NR }
  /api\/health\/ready/ { ready = NR }
  /127\.0\.0\.1:19080/ { homepage = NR }
  END {
    exit !(config < build &&
           build < base &&
           base < preflight &&
           preflight < workers &&
           workers < application &&
           application < status &&
           status < ready &&
           ready < homepage)
  }
' "$test_dir/fast.log"

awk '
  /preflight-integrity/ { preflight = NR }
  /run --rm migrate/ { migrate = NR }
  /up -d --wait worker scheduler/ { workers = NR }
  /up -d --wait api frontend/ { application = NR }
  /seed-demo/ { seed = NR }
  END {
    exit !(preflight < migrate &&
           migrate < workers &&
           workers < application &&
           application < seed)
  }
' "$test_dir/full.log"

set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid.log" \
  PARTSIGNAL_VERSION=test PARTSIGNAL_DEPLOY_MODE=invalid \
  ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null 2>&1
invalid_status=$?
set -e
test "$invalid_status" -eq 2
test ! -s "$test_dir/invalid.log"

awk '
  /for critical_path in/ { critical_gate = NR }
  /diff -qr "\$current_dir\/\$critical_path"/ { critical_compare = NR }
  /PARTSIGNAL_DEPLOY_MODE=fast PARTSIGNAL_VERSION/ { deploy = NR }
  /^nginx -t$/ { nginx = NR }
  /probe "\${public_url}\/api\/health\/live"/ { live = NR }
  /probe "\${public_url}\/api\/health\/ready"/ { ready = NR }
  /homepage=\$\(probe "\${public_url}\/"\)/ { homepage = NR }
  /stage "原子切换 current/ { current_switch = NR }
  END {
    exit !(critical_gate < critical_compare &&
           critical_compare < deploy &&
           deploy < nginx &&
           nginx < live &&
           live < ready &&
           ready < homepage &&
           homepage < current_switch)
  }
' "$root/deploy/scripts/redeploy-staging-fast.sh"

grep -q 'deploy/nginx/partsignal-security-headers.conf' \
  "$root/deploy/scripts/redeploy-staging-fast.sh"

printf '%s\n' "预发布 full/fast 部署模式自检通过"
