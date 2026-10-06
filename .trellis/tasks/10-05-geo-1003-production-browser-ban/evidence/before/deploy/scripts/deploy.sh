#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if test -z "${PARTSIGNAL_MAINTENANCE_LOCK_FD:-}"; then
  exec python3 "$script_dir/prepare-production-data.py" run-locked \
    "$script_dir/deploy.sh" "$@"
fi

: "${PARTSIGNAL_VERSION:?必须指定 PARTSIGNAL_VERSION}"
: "${PARTSIGNAL_BACKEND_IMAGE:?必须指定 PARTSIGNAL_BACKEND_IMAGE}"
: "${PARTSIGNAL_FRONTEND_IMAGE:?必须指定 PARTSIGNAL_FRONTEND_IMAGE}"
: "${PARTSIGNAL_DATA_ROOT:?必须指定 PARTSIGNAL_DATA_ROOT}"
: "${PARTSIGNAL_RELEASE_MANIFEST:?必须指定 PARTSIGNAL_RELEASE_MANIFEST}"
test "${COMPOSE_PROJECT_NAME:-partsignal-staging}" = partsignal-staging || {
  printf '%s\n' "Production Compose project 必须是固定的 partsignal-staging" >&2
  exit 2
}
COMPOSE_PROJECT_NAME=partsignal-staging
export COMPOSE_PROJECT_NAME
test -z "${PARTSIGNAL_FRONTEND_VERSION:-}" || \
  test "$PARTSIGNAL_FRONTEND_VERSION" = "$PARTSIGNAL_VERSION" || {
  printf '%s\n' "Production deploy 不允许覆盖 frontend version" >&2
  exit 2
}
PARTSIGNAL_FRONTEND_VERSION=$PARTSIGNAL_VERSION
export PARTSIGNAL_FRONTEND_VERSION

expected_compose_file=$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve(strict=True))' "$script_dir/../compose.prod.yaml")
compose_file=${COMPOSE_FILE:-$expected_compose_file}
compose_file=$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve(strict=True))' "$compose_file")
test "$compose_file" = "$expected_compose_file" || {
  printf '%s\n' "Production 只允许仓库权威 Compose：${expected_compose_file}" >&2
  exit 2
}
env_file=${ENV_FILE:?必须通过 ENV_FILE 指定 Production 环境文件}
deploy_mode=${PARTSIGNAL_DEPLOY_MODE:-upgrade}
image_delivery_mode=${PARTSIGNAL_IMAGE_DELIVERY_MODE-registry}

case "$image_delivery_mode" in
  registry | local) ;;
  *)
    printf '%s\n' "无效的 Production 镜像交付模式：${image_delivery_mode}（仅支持 registry 或 local）" >&2
    exit 2
    ;;
esac

case "$PARTSIGNAL_BACKEND_IMAGE:$PARTSIGNAL_FRONTEND_IMAGE" in
  *backend-v1:* | *frontend-v1)
    printf '%s\n' "Production 不允许使用 V1 镜像仓库：${PARTSIGNAL_BACKEND_IMAGE}:${PARTSIGNAL_VERSION} / ${PARTSIGNAL_FRONTEND_IMAGE}:${PARTSIGNAL_VERSION}" >&2
    exit 2
    ;;
esac

case "$deploy_mode" in
  clean-init | upgrade) ;;
  *)
    printf '%s\n' "无效的 Production 部署模式：${deploy_mode}（仅支持 clean-init 或 upgrade）" >&2
    exit 2
    ;;
esac

test -f "$env_file" || {
  printf '%s\n' "缺少 Production 环境文件：$env_file" >&2
  exit 2
}

PARTSIGNAL_RUNTIME_ENV_FILE=$env_file
export PARTSIGNAL_RUNTIME_ENV_FILE

compose_run() {
  if test "$image_delivery_mode" = local; then
    docker compose --env-file "$env_file" -f "$compose_file" run --pull never "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" run "$@"
  fi
}

compose_up() {
  if test "$image_delivery_mode" = local; then
    docker compose --env-file "$env_file" -f "$compose_file" up --pull never "$@"
  else
    docker compose --env-file "$env_file" -f "$compose_file" up "$@"
  fi
}

if test "$deploy_mode" = clean-init; then
  : "${PARTSIGNAL_CUTOVER_RUN_ID:?clean-init 必须指定 PARTSIGNAL_CUTOVER_RUN_ID}"
  python3 "$script_dir/prepare-production-data.py" \
    begin-clean-init "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    begin-upgrade "$PARTSIGNAL_RELEASE_MANIFEST"
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
if test "$image_delivery_mode" = registry; then
  docker compose --env-file "$env_file" -f "$compose_file" pull api worker scheduler frontend
fi
python3 "$script_dir/prepare-production-data.py" \
  verify-candidate-images "$PARTSIGNAL_RELEASE_MANIFEST"
compose_up -d --wait postgres redis
compose_run --rm api \
  python -m app.cli preflight-production-config

if test "$deploy_mode" = upgrade; then
  compose_run --rm api \
    python -m app.cli preflight-integrity
  docker compose --env-file "$env_file" -f "$compose_file" stop api worker scheduler
fi

compose_run --rm migrate

if test "$deploy_mode" = clean-init; then
  compose_run --rm api \
    python -m app.cli preflight-integrity
fi

compose_run --rm api \
  python -m app.cli initialize-accounts
compose_up -d --wait api frontend
docker compose --env-file "$env_file" -f "$compose_file" ps

curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19000/api/health/ready >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19080/ >/dev/null
if test "$deploy_mode" = clean-init; then
  python3 "$script_dir/prepare-production-data.py" \
    mark-prepared "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    mark-upgrade-prepared "$PARTSIGNAL_RELEASE_MANIFEST"
fi
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} Production V2 已准备（${deploy_mode}）；Worker/Scheduler 尚未激活"
