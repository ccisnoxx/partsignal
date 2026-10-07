#!/bin/sh
set -eu

: "${DATABASE_URL:?必须设置本地或 CI PostgreSQL DATABASE_URL}"
: "${REDIS_URL:?必须设置本地或 CI Redis REDIS_URL}"
: "${PARTSIGNAL_SEED_ADMIN_PASSWORD:=partsignal-admin-dev}"
: "${PARTSIGNAL_SEED_ENGINEER_PASSWORD:=partsignal-engineer-dev}"
: "${PARTSIGNAL_E2E_STORAGE_PORT:=19009}"
: "${PARTSIGNAL_E2E_SPEC:=}"
: "${PARTSIGNAL_E2E_GEO_MODE:=}"
: "${PARTSIGNAL_E2E_GEO_PROVIDER_URL:=http://127.0.0.1:19012}"

# E2E 明确使用本机协议替身，不继承操作者可能存在的生产 AI 配置。
export APP_ENV=test
# canonical R1 纵向验收开启人工监测资格；GEO-408 phase 在下面显式选择 API 开关。
export GEO_MONITORING_ENABLED=true
export GEO_API_COLLECTION_ENABLED=false
export GEO_BROWSER_COLLECTION_ENABLED=false
# GEO-1010-UI：隔离 MANUAL 验收通过正式 ADMIN 页面显式评估；不注册自动评估。
export GEO_OPPORTUNITY_EVALUATION_ENABLED=true
# 人工提交由真实分析扫描推进；隔离test栈缩短扫描等待，十次采样不逐次等待生产默认60秒。
export GEO_RECOVERY_SCAN_SECONDS=5
geo_port_arguments=
api_entry=app.main:app
worker_entry=app.worker:celery_app
case "$PARTSIGNAL_E2E_GEO_MODE" in
  '') ;;
  enabled|api-disabled|monitoring-disabled)
    if test "$PARTSIGNAL_E2E_GEO_PROVIDER_URL" != http://127.0.0.1:19012; then
      printf '%s\n' 'GEO E2E provider 必须使用精确回环地址' >&2
      exit 1
    fi
    export GEO_MONITORING_ENABLED=true
    export GEO_API_COLLECTION_ENABLED=true
    test "$PARTSIGNAL_E2E_GEO_MODE" != api-disabled || export GEO_API_COLLECTION_ENABLED=false
    if test "$PARTSIGNAL_E2E_GEO_MODE" = monitoring-disabled; then
      export GEO_MONITORING_ENABLED=false
      export GEO_API_COLLECTION_ENABLED=false
    fi
    geo_port_arguments='--geo-provider-port 19012'
    api_entry=tests.geo_e2e_runtime:app
    worker_entry=tests.geo_e2e_runtime:celery_app
    # 真实 429 冷却后由既有 Beat 扫描恢复未发送新尝试；缩短测试等待，不绕过准入。
    export GEO_PENDING_REDISPATCH_SECONDS=2
    export GEO_RECOVERY_SCAN_SECONDS=5
    : "${PARTSIGNAL_E2E_SPEC:=tests/e2e/geo-api-real-stack.spec.ts}"
    ;;
  *) printf '%s\n' 'GEO E2E 模式无效' >&2; exit 1 ;;
esac
export PARTSIGNAL_E2E_GEO_MODE PARTSIGNAL_E2E_GEO_PROVIDER_URL
export CONTENT_GENERATOR=openai-compatible
export AI_ALLOW_LOCAL_HTTP=true
export AI_CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export CORS_ALLOWED_ORIGINS=http://127.0.0.1:4174

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export PYTHONPATH="$root/backend${PYTHONPATH:+:$PYTHONPATH}"
. "$root/deploy/scripts/e2e-run-lifecycle.sh"
. "$root/deploy/scripts/e2e-database-lifecycle.sh"
source_database_url=$DATABASE_URL
e2e_database_run_id=$(
  "$root/backend/.venv/bin/python" -c 'import secrets; print(secrets.token_hex(16))'
)
e2e_database_owner_token=$(
  "$root/backend/.venv/bin/python" -c 'import secrets; print(secrets.token_hex(16))'
)
e2e_database_name="partsignal_e2e_$(date +%Y%m%d)_$e2e_database_run_id"
e2e_database_cleanup_pending=0
storage_parent=${TMPDIR:-/tmp}
browser_session_parent=$(CDPATH= cd -- "$storage_parent" && pwd -P)
storage_dir=
browser_session_dir=
storage_endpoint=http://127.0.0.1:$PARTSIGNAL_E2E_STORAGE_PORT
secret_manifest=
secret_key_file=
api_pid=
storage_pid=
worker_pid=
scheduler_pid=
frontend_preview_pid=
ai_pid=
geo_provider_pid=

stop_process() {
  process_pid=$1
  test -z "$process_pid" && return 0
  kill "$process_pid" 2>/dev/null || true
  wait "$process_pid" 2>/dev/null || true
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  stop_process "$frontend_preview_pid"
  stop_process "$geo_provider_pid"
  stop_process "$ai_pid"
  stop_process "$scheduler_pid"
  stop_process "$worker_pid"
  stop_process "$storage_pid"
  stop_process "$api_pid"
  cleanup_status=0
  if ! "$root/backend/.venv/bin/python" "$root/deploy/scripts/e2e-environment.py" cleanup \
    --redis-url "$REDIS_URL" --storage-port "$PARTSIGNAL_E2E_STORAGE_PORT" $geo_port_arguments; then
    cleanup_status=1
  fi
  if test "$e2e_database_cleanup_pending" -eq 1; then
    if ! drop_owned_e2e_database; then
      cleanup_status=1
    fi
  fi
  case "$storage_dir" in
    "$storage_parent"/partsignal-e2e-storage.*)
      if rm -rf -- "$storage_dir"; then
        printf '%s\n' "E2E_CLEANUP storage=$storage_dir status=removed"
      else
        cleanup_status=1
      fi
      ;;
    *)
      printf '%s\n' "E2E_CLEANUP storage=$storage_dir status=refused" >&2
      cleanup_status=1
      ;;
  esac
  case "$browser_session_dir" in
    "$browser_session_parent"/partsignal-e2e-browser-session.*)
      rm -rf -- "$browser_session_dir" || cleanup_status=1
      ;;
    '') ;;
    *) cleanup_status=1 ;;
  esac
  if test "$cleanup_status" -ne 0; then
    printf '%s\n' "E2E_CLEANUP status=failed" >&2
  fi
  test "$status" -ne 0 && exit "$status"
  exit "$cleanup_status"
}

restore_e2e_signal_handlers() {
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

cd "$root"
backend/.venv/bin/python deploy/scripts/e2e-environment.py preflight \
  --redis-url "$REDIS_URL" --storage-port "$PARTSIGNAL_E2E_STORAGE_PORT" $geo_port_arguments
storage_dir=$(mktemp -d "$storage_parent/partsignal-e2e-storage.XXXXXX")
trap cleanup EXIT
restore_e2e_signal_handlers
# GEO-802 的虚构会话密文与普通 fake OSS 使用不同目录；仅 API 持临时公钥。
browser_session_dir=$(mktemp -d "$browser_session_parent/partsignal-e2e-browser-session.XXXXXX")
export GEO_BROWSER_SESSION_ROOT="$browser_session_dir/cipher"
export GEO_BROWSER_SESSION_PUBLIC_KEY_FILE="$browser_session_dir/public.pem"
mkdir -m 700 "$GEO_BROWSER_SESSION_ROOT"
node -e "const c=require('node:crypto');const f=require('node:fs');const k=c.generateKeyPairSync('rsa',{modulusLength:3072});f.writeFileSync(process.argv[1],k.publicKey.export({type:'spki',format:'pem'}),{mode:0o600})" \
  "$GEO_BROWSER_SESSION_PUBLIC_KEY_FILE"
secret_manifest="$storage_dir/playwright-secret-manifest.jsonl"
secret_key_file="$storage_dir/playwright-secret-key"
: >"$secret_manifest"
node -e "require('node:fs').writeFileSync(process.argv[1], require('node:crypto').randomBytes(32), { mode: 0o600 })" \
  "$secret_key_file"
chmod 600 "$secret_manifest"
printf '%s\000%s\000' "$PARTSIGNAL_SEED_ADMIN_PASSWORD" "$PARTSIGNAL_SEED_ENGINEER_PASSWORD" | \
  PARTSIGNAL_E2E_SECRET_MANIFEST="$secret_manifest" \
  PARTSIGNAL_E2E_SECRET_KEY_FILE="$secret_key_file" \
    node --experimental-strip-types frontend/tests/e2e/secret-artifact.ts register-seed
create_owned_e2e_database
export PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN="$e2e_database_owner_token"
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
VITE_API_BASE_URL=http://127.0.0.1:8000 npm --prefix frontend run build
PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  backend/.venv/bin/python -m app.cli initialize-accounts

if test -n "$PARTSIGNAL_E2E_GEO_MODE"; then
  # 本 phase 的预算仅由显式 fixture 的批次预算决定，不继承全局日预算。
  unset GEO_DAILY_BUDGET_LIMIT
  export GENERATION_EAGER=false
  backend/.venv/bin/python -m tests.geo_e2e_provider &
  geo_provider_pid=$!
  geo_ready_attempt=0
  until curl --fail --silent "$PARTSIGNAL_E2E_GEO_PROVIDER_URL/health" >/dev/null; do
    geo_ready_attempt=$((geo_ready_attempt + 1))
    if test "$geo_ready_attempt" -ge 30; then
      printf '%s\n' 'GEO E2E provider 未能就绪' >&2
      exit 1
    fi
    sleep 1
  done
  export PARTSIGNAL_E2E_GEO_FIXTURE_FILE="$storage_dir/geo-fixture.json"
  export PARTSIGNAL_E2E_GEO_MESSAGE_RECEIPTS="$storage_dir/geo-message-receipts"
  mkdir "$PARTSIGNAL_E2E_GEO_MESSAGE_RECEIPTS"
  if test "$PARTSIGNAL_E2E_GEO_MODE" != enabled; then
    # 前置创建是独立启用进程；随后 API/Worker 均从关闭配置全新启动。
    PARTSIGNAL_E2E_GEO_MODE=enabled GEO_MONITORING_ENABLED=true GEO_API_COLLECTION_ENABLED=true \
      backend/.venv/bin/python -m tests.geo_e2e_fixture
  fi
fi

OBJECT_STORAGE_ENDPOINT="$storage_endpoint" \
OBJECT_STORAGE_PUBLIC_ENDPOINT="$storage_endpoint" OBJECT_STORAGE_PATH="$storage_dir" \
  backend/.venv/bin/uvicorn "$api_entry" --host 127.0.0.1 --port 8000 &
api_pid=$!
OBJECT_STORAGE_PATH="$storage_dir" backend/.venv/bin/uvicorn app.dev_storage:app \
  --host 127.0.0.1 --port "$PARTSIGNAL_E2E_STORAGE_PORT" --no-access-log &
storage_pid=$!
backend/.venv/bin/uvicorn app.ai_fake_server:app --host 127.0.0.1 --port 9001 &
ai_pid=$!
backend/.venv/bin/celery --quiet -A "$worker_entry" worker \
  --loglevel=WARNING --concurrency=1 --pool=solo &
worker_pid=$!
backend/.venv/bin/celery --quiet -A "$worker_entry" beat \
  --loglevel=WARNING --schedule "$storage_dir/celerybeat" &
scheduler_pid=$!
(cd "$root/frontend" && exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4174 --strictPort) &
frontend_preview_pid=$!

services_ready() {
  curl --fail --silent http://127.0.0.1:8000/api/health/ready >/dev/null \
    && curl --fail --silent http://127.0.0.1:9001/v1/models >/dev/null \
    && curl --fail --silent http://127.0.0.1:4174 >/dev/null \
    && { test -z "$PARTSIGNAL_E2E_GEO_MODE" \
      || curl --fail --silent "$PARTSIGNAL_E2E_GEO_PROVIDER_URL/v1/models" >/dev/null; }
}

attempt=0
until services_ready; do
  attempt=$((attempt + 1))
  if test "$attempt" -ge 60; then
    printf '%s\n' "PartSignal E2E 服务在 60 秒内未就绪" >&2
    exit 1
  fi
  sleep 1
done

run_playwright() {
  export PARTSIGNAL_E2E_GEO_MODE PARTSIGNAL_E2E_GEO_PROVIDER_URL
  export PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN
  if test -n "$PARTSIGNAL_E2E_GEO_MODE"; then
    export PARTSIGNAL_E2E_GEO_FIXTURE_FILE
  fi
  # e2e:raw 只供本脚本使用；本脚本已经持有 post-run scan 与 cleanup，不能作为独立门禁入口。
  if test -n "$PARTSIGNAL_E2E_SPEC"; then
    PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
    PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
    PARTSIGNAL_E2E_API_BASE_URL=http://127.0.0.1:8000 \
    PARTSIGNAL_E2E_FAKE_AI_BASE_URL=http://127.0.0.1:9001 \
    PARTSIGNAL_E2E_REAL_STACK=1 \
    PARTSIGNAL_E2E_BASE_URL=http://127.0.0.1:4174 \
    PARTSIGNAL_E2E_SECRET_MANIFEST="$secret_manifest" \
    PARTSIGNAL_E2E_SECRET_KEY_FILE="$secret_key_file" \
      exec "$root/backend/.venv/bin/python" "$root/deploy/scripts/e2e-process-group.py" -- \
      npm --prefix frontend run e2e:raw -- \
      "$PARTSIGNAL_E2E_SPEC" \
      "$@" \
      --project=foundation-desktop
    return
  fi

  PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
  PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  PARTSIGNAL_E2E_API_BASE_URL=http://127.0.0.1:8000 \
  PARTSIGNAL_E2E_FAKE_AI_BASE_URL=http://127.0.0.1:9001 \
  PARTSIGNAL_E2E_REAL_STACK=1 \
  PARTSIGNAL_E2E_BASE_URL=http://127.0.0.1:4174 \
  PARTSIGNAL_E2E_SECRET_MANIFEST="$secret_manifest" \
  PARTSIGNAL_E2E_SECRET_KEY_FILE="$secret_key_file" \
    exec "$root/backend/.venv/bin/python" "$root/deploy/scripts/e2e-process-group.py" -- \
    npm --prefix frontend run e2e:raw -- \
    tests/e2e/ai-channel-configuration-real-stack.spec.ts \
    tests/e2e/product-facts-real-stack.spec.ts \
    tests/e2e/catalog-real-stack.spec.ts \
    tests/e2e/questions-real-stack.spec.ts \
    tests/e2e/surfaces-real-stack.spec.ts \
    tests/e2e/browser-session-real-stack.spec.ts \
    tests/e2e/plans-real-stack.spec.ts \
    tests/e2e/runs-real-stack.spec.ts \
    tests/e2e/geo-review-real-stack.spec.ts \
    tests/e2e/insights-real-stack.spec.ts \
    tests/e2e/reports-real-stack.spec.ts \
    tests/e2e/opportunities-real-stack.spec.ts \
    tests/e2e/geo-loop-real-stack.spec.ts \
    tests/e2e/content-ai-real-stack.spec.ts \
    tests/e2e/content-review-real-stack.spec.ts \
    tests/e2e/content-version-detail-real-stack.spec.ts \
    tests/e2e/publication-workspace-real-stack.spec.ts \
    tests/e2e/geo-real-stack.spec.ts \
    tests/e2e/auth-session-real-stack.spec.ts \
    tests/e2e/system-admin-real-stack.spec.ts \
    "$@" \
    --project=foundation-desktop
}

# Playwright 启动时会清理 outputDir，并在 onEnd 写入 .last-run.json。先删除旧 marker，
# 确保配置/收集阶段提前失败时最终扫描不会误认上一次运行。
rm -f -- frontend/.cache/playwright-results/.last-run.json

run_secret_scan() {
  node --experimental-strip-types frontend/tests/e2e/secret-artifact.ts scan \
    frontend/.cache/playwright-results "$secret_manifest" "$secret_key_file"
}

# 信号也通过同一收敛路径：先等 Playwright 产物落盘，再扫描，最后 EXIT cleanup。
set +e
run_e2e_playwright_and_scan "$@"
final_status=$?
set -e
exit "$final_status"
