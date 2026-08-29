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

if test "$deploy_mode" = clean-init; then
  : "${PARTSIGNAL_CUTOVER_RUN_ID:?clean-init 必须指定 PARTSIGNAL_CUTOVER_RUN_ID}"
  python3 "$script_dir/prepare-production-data.py" \
    begin-clean-init "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    begin-upgrade "$PARTSIGNAL_RELEASE_MANIFEST"
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
docker compose --env-file "$env_file" -f "$compose_file" pull api worker scheduler frontend
python3 "$script_dir/prepare-production-data.py" \
  verify-candidate-images "$PARTSIGNAL_RELEASE_MANIFEST"
docker compose --env-file "$env_file" -f "$compose_file" up -d --wait postgres redis
docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
  python -m app.cli preflight-production-config

if test "$deploy_mode" = upgrade; then
  docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
    python -m app.cli preflight-integrity
  docker compose --env-file "$env_file" -f "$compose_file" stop api worker scheduler
fi

docker compose --env-file "$env_file" -f "$compose_file" run --rm migrate

if test "$deploy_mode" = clean-init; then
  docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
    python -m app.cli preflight-integrity
fi

docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
  python -m app.cli initialize-accounts
docker compose --env-file "$env_file" -f "$compose_file" up -d --wait api frontend
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
