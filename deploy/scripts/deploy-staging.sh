#!/bin/sh
set -eu

: "${PARTSIGNAL_VERSION:?必须指定 PARTSIGNAL_VERSION}"

compose_file=${COMPOSE_FILE:-compose.staging.yaml}
env_file=${ENV_FILE:-../.env.staging}
deploy_mode=${PARTSIGNAL_DEPLOY_MODE:-full}

case "$deploy_mode" in
  full | fast) ;;
  *)
    printf '%s\n' "无效的预发布部署模式：${deploy_mode}（仅支持 full 或 fast）" >&2
    exit 2
    ;;
esac

test -f "$env_file" || {
  printf '%s\n' "缺少预发布环境文件：$env_file" >&2
  exit 2
}

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
docker compose --env-file "$env_file" -f "$compose_file" build api frontend
docker compose --env-file "$env_file" -f "$compose_file" up -d postgres redis fake-oss
docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
  python -m app.cli preflight-integrity
if test "$deploy_mode" = full; then
  docker compose --env-file "$env_file" -f "$compose_file" run --rm migrate
fi
docker compose --env-file "$env_file" -f "$compose_file" up -d --wait worker scheduler
docker compose --env-file "$env_file" -f "$compose_file" up -d --wait api frontend
if test "$deploy_mode" = full; then
  docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
    python -m app.cli seed-demo
fi
docker compose --env-file "$env_file" -f "$compose_file" ps

curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19000/api/health/ready >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19080/ >/dev/null
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} 预发布栈部署完成（${deploy_mode}）"
