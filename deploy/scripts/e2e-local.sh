#!/bin/sh
set -eu

: "${DATABASE_URL:?必须设置本地或 CI PostgreSQL DATABASE_URL}"
: "${REDIS_URL:?必须设置本地或 CI Redis REDIS_URL}"
: "${PARTSIGNAL_SEED_ADMIN_PASSWORD:=partsignal-admin-dev}"
: "${PARTSIGNAL_SEED_ENGINEER_PASSWORD:=partsignal-engineer-dev}"

# E2E 明确使用本机协议替身，不继承操作者可能存在的生产 AI 配置。
export APP_ENV=test
export CONTENT_GENERATOR=openai-compatible
export AI_ALLOW_LOCAL_HTTP=true
export AI_CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
storage_dir=${OBJECT_STORAGE_PATH:-/tmp/partsignal-e2e-storage}
api_pid=
storage_pid=
worker_pid=
scheduler_pid=
frontend_pid=
ai_pid=

cleanup() {
  test -z "$frontend_pid" || kill "$frontend_pid" 2>/dev/null || true
  test -z "$ai_pid" || kill "$ai_pid" 2>/dev/null || true
  test -z "$scheduler_pid" || kill "$scheduler_pid" 2>/dev/null || true
  test -z "$worker_pid" || kill "$worker_pid" 2>/dev/null || true
  test -z "$storage_pid" || kill "$storage_pid" 2>/dev/null || true
  test -z "$api_pid" || kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$root"
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
PARTSIGNAL_SEED_ENGINEER_PASSWORD=$PARTSIGNAL_SEED_ENGINEER_PASSWORD \
  backend/.venv/bin/python -m app.cli seed-demo

OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
OBJECT_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9000 OBJECT_STORAGE_PATH="$storage_dir" \
  backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
api_pid=$!
OBJECT_STORAGE_PATH="$storage_dir" backend/.venv/bin/python -m app.files.fake_server &
storage_pid=$!
backend/.venv/bin/uvicorn app.ai_fake_server:app --host 127.0.0.1 --port 9001 &
ai_pid=$!
backend/.venv/bin/celery -A app.worker:celery_app worker \
  --loglevel=WARNING --concurrency=1 --pool=solo &
worker_pid=$!
backend/.venv/bin/celery -A app.worker:celery_app beat \
  --loglevel=WARNING --schedule /tmp/partsignal-e2e-celerybeat &
scheduler_pid=$!
npm --prefix frontend run dev -- --host 127.0.0.1 &
frontend_pid=$!

attempt=0
until curl --fail --silent http://127.0.0.1:8000/api/health/ready >/dev/null \
  && curl --fail --silent http://127.0.0.1:9001/v1/models >/dev/null \
  && curl --fail --silent http://127.0.0.1:5173 >/dev/null; do
  attempt=$((attempt + 1))
  if test "$attempt" -ge 60; then
    printf '%s\n' "PartSignal E2E 服务在 60 秒内未就绪" >&2
    exit 1
  fi
  sleep 1
done

PARTSIGNAL_SEED_ADMIN_PASSWORD=$PARTSIGNAL_SEED_ADMIN_PASSWORD \
  npm --prefix frontend run e2e -- "$@"
