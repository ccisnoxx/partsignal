#!/bin/sh
set -eu

: "${DATABASE_URL:?必须设置本地或 CI PostgreSQL DATABASE_URL}"
: "${REDIS_URL:?必须设置本地或 CI Redis REDIS_URL}"
: "${PARTSIGNAL_SEED_ADMIN_PASSWORD:=partsignal-admin-dev}"
: "${PARTSIGNAL_SEED_ENGINEER_PASSWORD:=partsignal-engineer-dev}"
: "${PARTSIGNAL_E2E_STORAGE_PORT:=19009}"
: "${PARTSIGNAL_E2E_V2_SPEC:=}"

# E2E 明确使用本机协议替身，不继承操作者可能存在的生产 AI 配置。
export APP_ENV=test
export CONTENT_GENERATOR=openai-compatible
export AI_ALLOW_LOCAL_HTTP=true
export AI_CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
source_database_url=$DATABASE_URL
e2e_database_name="partsignal_e2e_$(date +%Y%m%d)_$$"
e2e_database_created=0
storage_parent=${TMPDIR:-/tmp}
storage_dir=
storage_endpoint=http://127.0.0.1:$PARTSIGNAL_E2E_STORAGE_PORT
api_pid=
storage_pid=
worker_pid=
scheduler_pid=
frontend_pid=
preview_pid=
v2_preview_pid=
ai_pid=

stop_process() {
  process_pid=$1
  test -z "$process_pid" && return 0
  kill "$process_pid" 2>/dev/null || true
  wait "$process_pid" 2>/dev/null || true
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  stop_process "$v2_preview_pid"
  stop_process "$preview_pid"
  stop_process "$frontend_pid"
  stop_process "$ai_pid"
  stop_process "$scheduler_pid"
  stop_process "$worker_pid"
  stop_process "$storage_pid"
  stop_process "$api_pid"
  cleanup_status=0
  if ! "$root/backend/.venv/bin/python" "$root/deploy/scripts/e2e-environment.py" cleanup \
    --redis-url "$REDIS_URL" --storage-port "$PARTSIGNAL_E2E_STORAGE_PORT"; then
    cleanup_status=1
  fi
  if test "$e2e_database_created" -eq 1; then
    if ! DATABASE_URL="$source_database_url" "$root/backend/.venv/bin/python" \
      "$root/deploy/scripts/e2e-database.py" drop "$e2e_database_name" >/dev/null; then
      cleanup_status=1
    else
      printf '%s\n' "E2E_CLEANUP database=$e2e_database_name status=dropped"
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
  test "$status" -ne 0 && exit "$status"
  exit "$cleanup_status"
}
cd "$root"
backend/.venv/bin/python deploy/scripts/e2e-environment.py preflight \
  --redis-url "$REDIS_URL" --storage-port "$PARTSIGNAL_E2E_STORAGE_PORT"
storage_dir=$(mktemp -d "$storage_parent/partsignal-e2e-storage.XXXXXX")
trap cleanup EXIT
trap 'exit 130' INT TERM
DATABASE_URL="$source_database_url" backend/.venv/bin/python \
  deploy/scripts/e2e-database.py create "$e2e_database_name" >"$storage_dir/database-url"
e2e_database_created=1
IFS= read -r DATABASE_URL <"$storage_dir/database-url"
export DATABASE_URL
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
if test -z "$PARTSIGNAL_E2E_V2_SPEC"; then
  npm --prefix frontend run build
fi
VITE_API_BASE_URL=http://127.0.0.1:8000 npm --prefix frontend-v2 run build
PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  backend/.venv/bin/python -m app.cli initialize-accounts

OBJECT_STORAGE_ENDPOINT="$storage_endpoint" \
OBJECT_STORAGE_PUBLIC_ENDPOINT="$storage_endpoint" OBJECT_STORAGE_PATH="$storage_dir" \
  backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
api_pid=$!
OBJECT_STORAGE_PATH="$storage_dir" backend/.venv/bin/uvicorn app.dev_storage:app \
  --host 127.0.0.1 --port "$PARTSIGNAL_E2E_STORAGE_PORT" --no-access-log &
storage_pid=$!
backend/.venv/bin/uvicorn app.ai_fake_server:app --host 127.0.0.1 --port 9001 &
ai_pid=$!
backend/.venv/bin/celery --quiet -A app.worker:celery_app worker \
  --loglevel=WARNING --concurrency=1 --pool=solo &
worker_pid=$!
backend/.venv/bin/celery --quiet -A app.worker:celery_app beat \
  --loglevel=WARNING --schedule "$storage_dir/celerybeat" &
scheduler_pid=$!
if test -z "$PARTSIGNAL_E2E_V2_SPEC"; then
  (cd "$root/frontend" && exec ./node_modules/.bin/vite --host 127.0.0.1 --config vite.config.ts) &
  frontend_pid=$!
  (cd "$root/frontend" && exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort) &
  preview_pid=$!
fi
(cd "$root/frontend-v2" && exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4174 --strictPort) &
v2_preview_pid=$!

services_ready() {
  if test -n "$PARTSIGNAL_E2E_V2_SPEC"; then
    curl --fail --silent http://127.0.0.1:8000/api/health/ready >/dev/null \
      && curl --fail --silent http://127.0.0.1:9001/v1/models >/dev/null \
      && curl --fail --silent http://127.0.0.1:4174 >/dev/null
  else
    curl --fail --silent http://127.0.0.1:8000/api/health/ready >/dev/null \
      && curl --fail --silent http://127.0.0.1:9001/v1/models >/dev/null \
      && curl --fail --silent http://127.0.0.1:5173 >/dev/null \
      && curl --fail --silent http://127.0.0.1:4173 >/dev/null \
      && curl --fail --silent http://127.0.0.1:4174 >/dev/null
  fi
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

if test -n "$PARTSIGNAL_E2E_V2_SPEC"; then
  PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
  PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  PARTSIGNAL_E2E_API_BASE_URL=http://127.0.0.1:8000 \
  PARTSIGNAL_E2E_FAKE_AI_BASE_URL=http://127.0.0.1:9001 \
  PARTSIGNAL_E2E_REAL_STACK=1 \
  PARTSIGNAL_E2E_V2_BASE_URL=http://127.0.0.1:4174 \
    npm --prefix frontend-v2 run e2e -- \
    "$PARTSIGNAL_E2E_V2_SPEC" \
    --project=foundation-desktop
else
  PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
  PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  PARTSIGNAL_E2E_API_BASE_URL=http://127.0.0.1:8000 \
  PARTSIGNAL_E2E_FAKE_AI_BASE_URL=http://127.0.0.1:9001 \
  PARTSIGNAL_E2E_REAL_STACK=1 \
  PARTSIGNAL_E2E_V2_BASE_URL=http://127.0.0.1:4174 \
    npm --prefix frontend-v2 run e2e -- \
    tests/e2e/ai-channel-configuration-real-stack.spec.ts \
    tests/e2e/product-facts-real-stack.spec.ts \
    tests/e2e/content-ai-real-stack.spec.ts \
    tests/e2e/content-review-real-stack.spec.ts \
    tests/e2e/content-version-detail-real-stack.spec.ts \
    tests/e2e/publication-workspace-real-stack.spec.ts \
    tests/e2e/geo-real-stack.spec.ts \
    tests/e2e/auth-session-real-stack.spec.ts \
    tests/e2e/system-admin-real-stack.spec.ts \
    --project=foundation-desktop
  PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
  PARTSIGNAL_E2E_REAL_STACK=1 \
  PARTSIGNAL_E2E_PRODUCTION_BASE_URL=http://127.0.0.1:4173 \
    npm --prefix frontend run e2e -- "$@"
fi
