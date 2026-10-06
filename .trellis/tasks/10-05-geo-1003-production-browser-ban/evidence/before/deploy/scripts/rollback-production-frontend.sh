#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if test -z "${PARTSIGNAL_MAINTENANCE_LOCK_FD:-}"; then
  exec python3 "$script_dir/prepare-production-data.py" run-locked \
    "$script_dir/rollback-production-frontend.sh" "$@"
fi

: "${PARTSIGNAL_VERSION:?必须指定当前 PARTSIGNAL_VERSION}"
: "${PARTSIGNAL_BACKEND_IMAGE:?必须指定当前 PARTSIGNAL_BACKEND_IMAGE}"
: "${PARTSIGNAL_FRONTEND_IMAGE:?必须指定当前 PARTSIGNAL_FRONTEND_IMAGE}"
: "${PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE:?必须指定回滚 frontend image repository}"
: "${PARTSIGNAL_ROLLBACK_FRONTEND_VERSION:?必须指定回滚 frontend version}"
: "${PARTSIGNAL_DATA_ROOT:?必须指定 PARTSIGNAL_DATA_ROOT}"
: "${PARTSIGNAL_RELEASE_MANIFEST:?必须指定 PARTSIGNAL_RELEASE_MANIFEST}"

test "${COMPOSE_PROJECT_NAME:-partsignal-staging}" = partsignal-staging || {
  printf '%s\n' "Production Compose project 必须是固定的 partsignal-staging" >&2
  exit 2
}
COMPOSE_PROJECT_NAME=partsignal-staging
export COMPOSE_PROJECT_NAME

expected_compose_file=$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve(strict=True))' "$script_dir/../compose.prod.yaml")
compose_file=${COMPOSE_FILE:-$expected_compose_file}
compose_file=$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve(strict=True))' "$compose_file")
test "$compose_file" = "$expected_compose_file" || {
  printf '%s\n' "Production 只允许仓库权威 Compose：${expected_compose_file}" >&2
  exit 2
}
env_file=${ENV_FILE:?必须通过 ENV_FILE 指定 Production 环境文件}
test -f "$env_file" || {
  printf '%s\n' "缺少 Production 环境文件：$env_file" >&2
  exit 2
}
PARTSIGNAL_RUNTIME_ENV_FILE=$env_file
export PARTSIGNAL_RUNTIME_ENV_FILE

python3 "$script_dir/prepare-production-data.py" \
  verify-rollback-frontend "$PARTSIGNAL_RELEASE_MANIFEST"

PARTSIGNAL_FRONTEND_IMAGE="$PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE" \
PARTSIGNAL_FRONTEND_VERSION="$PARTSIGNAL_ROLLBACK_FRONTEND_VERSION" \
  docker compose --env-file "$env_file" -f "$compose_file" config --quiet
PARTSIGNAL_FRONTEND_IMAGE="$PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE" \
PARTSIGNAL_FRONTEND_VERSION="$PARTSIGNAL_ROLLBACK_FRONTEND_VERSION" \
  docker compose --env-file "$env_file" -f "$compose_file" up -d \
  --no-deps --no-build --pull never --force-recreate --wait frontend
curl --fail --silent --show-error http://127.0.0.1:19080/ >/dev/null
python3 "$script_dir/prepare-production-data.py" \
  mark-frontend-rollback "$PARTSIGNAL_RELEASE_MANIFEST"
printf '%s\n' "Production frontend 已切换到 manifest 冻结的上一份 V2"
