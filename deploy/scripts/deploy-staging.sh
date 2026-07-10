#!/bin/sh
set -eu

: "${PARTSIGNAL_VERSION:?必须指定 PARTSIGNAL_VERSION}"

compose_file=${COMPOSE_FILE:-compose.staging.yaml}
env_file=${ENV_FILE:-../.env.staging}

test -f "$env_file" || {
  printf '%s\n' "缺少预发布环境文件：$env_file" >&2
  exit 2
}

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
docker compose --env-file "$env_file" -f "$compose_file" build api fake-oss frontend
docker compose --env-file "$env_file" -f "$compose_file" up -d postgres redis fake-oss
docker compose --env-file "$env_file" -f "$compose_file" run --rm migrate
docker compose --env-file "$env_file" -f "$compose_file" up -d api worker scheduler frontend
docker compose --env-file "$env_file" -f "$compose_file" run --rm api python -m app.cli seed-demo
docker compose --env-file "$env_file" -f "$compose_file" ps

curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19000/api/health/ready >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19080/ >/dev/null
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} 预发布栈部署完成"

