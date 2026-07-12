#!/bin/sh
set -eu

: "${PARTSIGNAL_VERSION:?必须指定 PARTSIGNAL_VERSION}"
: "${PARTSIGNAL_BACKEND_IMAGE:?必须指定 PARTSIGNAL_BACKEND_IMAGE}"

compose_file=${COMPOSE_FILE:-compose.prod.yaml}

docker compose -f "$compose_file" pull api worker scheduler
docker compose -f "$compose_file" run --rm api python -m app.cli preflight-integrity
docker compose -f "$compose_file" run --rm migrate
docker compose -f "$compose_file" up -d --wait worker scheduler postgres redis
docker compose -f "$compose_file" up -d --wait api
docker compose -f "$compose_file" ps

curl --fail --silent --show-error http://127.0.0.1:19000/api/health/ready >/dev/null
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} 后端部署完成"
