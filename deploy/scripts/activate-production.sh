#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

: "${PARTSIGNAL_VERSION:?必须指定 PARTSIGNAL_VERSION}"
: "${PARTSIGNAL_BACKEND_IMAGE:?必须指定 PARTSIGNAL_BACKEND_IMAGE}"
: "${PARTSIGNAL_FRONTEND_IMAGE:?必须指定 PARTSIGNAL_FRONTEND_IMAGE}"
: "${PARTSIGNAL_DATA_ROOT:?必须指定 PARTSIGNAL_DATA_ROOT}"
: "${PARTSIGNAL_RELEASE_MANIFEST:?必须指定 PARTSIGNAL_RELEASE_MANIFEST}"
: "${PARTSIGNAL_EXTERNAL_SERVICES_GATE:?必须指定 PARTSIGNAL_EXTERNAL_SERVICES_GATE}"
test "${COMPOSE_PROJECT_NAME:-partsignal-staging}" = partsignal-staging || {
  printf '%s\n' "Production Compose project 必须是固定的 partsignal-staging" >&2
  exit 2
}
COMPOSE_PROJECT_NAME=partsignal-staging
export COMPOSE_PROJECT_NAME
test -z "${PARTSIGNAL_FRONTEND_VERSION:-}" || \
  test "$PARTSIGNAL_FRONTEND_VERSION" = "$PARTSIGNAL_VERSION" || {
  printf '%s\n' "Production activate 不允许覆盖 frontend version" >&2
  exit 2
}
PARTSIGNAL_FRONTEND_VERSION=$PARTSIGNAL_VERSION
export PARTSIGNAL_FRONTEND_VERSION

test "$PARTSIGNAL_EXTERNAL_SERVICES_GATE" = MET || {
  printf '%s\n' "真实 AI/OSS Gate 未达到 MET，拒绝激活 Worker/Scheduler" >&2
  exit 2
}

if test -z "${PARTSIGNAL_MAINTENANCE_LOCK_FD:-}"; then
  exec python3 "$script_dir/prepare-production-data.py" run-locked \
    "$script_dir/activate-production.sh" "$@"
fi

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
  clean-init)
    : "${PARTSIGNAL_CUTOVER_RUN_ID:?clean-init 必须指定 PARTSIGNAL_CUTOVER_RUN_ID}"
    python3 "$script_dir/prepare-production-data.py" \
      verify-prepared "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
    ;;
  upgrade)
    python3 "$script_dir/prepare-production-data.py" \
      verify-upgrade-prepared "$PARTSIGNAL_RELEASE_MANIFEST"
    ;;
  *)
    printf '%s\n' "无效的 Production 激活模式：${deploy_mode}" >&2
    exit 2
    ;;
esac

test -f "$env_file" || {
  printf '%s\n' "缺少 Production 环境文件：$env_file" >&2
  exit 2
}
PARTSIGNAL_RUNTIME_ENV_FILE=$env_file
export PARTSIGNAL_RUNTIME_ENV_FILE

compose_up_async() {
  if test "$image_delivery_mode" = local; then
    docker compose --profile production-async --env-file "$env_file" \
      -f "$compose_file" up --pull never "$@"
  else
    docker compose --profile production-async --env-file "$env_file" \
      -f "$compose_file" up "$@"
  fi
}

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
python3 "$script_dir/prepare-production-data.py" \
  verify-candidate-images "$PARTSIGNAL_RELEASE_MANIFEST"
curl --fail --silent --show-error http://127.0.0.1:19000/api/health/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:19080/ >/dev/null
compose_up_async -d --wait worker scheduler
docker compose --profile production-async --env-file "$env_file" \
  -f "$compose_file" ps

if test "$deploy_mode" = clean-init; then
  python3 "$script_dir/prepare-production-data.py" \
    mark-initialized "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    mark-upgrade-initialized "$PARTSIGNAL_RELEASE_MANIFEST"
fi
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} Production 异步服务已激活（${deploy_mode}）"
