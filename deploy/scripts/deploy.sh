#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
python3 "$script_dir/check-production-inputs.py" --deployment-boundary \
  "${ENV_FILE:?必须通过 ENV_FILE 指定 Production 环境文件}"
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

upgrade_started=0
deployment_stage=data_services
deployment_signal=0
finish_deployment() {
  deployment_status=$?
  trap - 0 INT TERM
  if test "$upgrade_started" = 1 && test "$deployment_status" -ne 0; then
    if ! python3 "$script_dir/prepare-production-data.py" record-upgrade-failure \
      "$PARTSIGNAL_RELEASE_MANIFEST" --stage "$deployment_stage" \
      --exit-code "$deployment_status" --signal "$deployment_signal" \
      --evidence-ref "deploy-exit/$deployment_stage"; then
      printf '%s\n' "部署失败记录未完成；保持维护，禁止用阶段或当前配置补造失败证明。" >&2
    fi
  fi
  exit "$deployment_status"
}
trap finish_deployment 0
trap 'deployment_signal=2; exit 130' INT
trap 'deployment_signal=15; exit 143' TERM

if test "$deploy_mode" = clean-init; then
  : "${PARTSIGNAL_CUTOVER_RUN_ID:?clean-init 必须指定 PARTSIGNAL_CUTOVER_RUN_ID}"
  python3 "$script_dir/prepare-production-data.py" \
    begin-clean-init "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    verify-upgrade-entry "$PARTSIGNAL_RELEASE_MANIFEST"
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
if test "$image_delivery_mode" = registry; then
  docker compose --env-file "$env_file" -f "$compose_file" pull api worker scheduler frontend migrate
fi
python3 "$script_dir/prepare-production-data.py" \
  verify-candidate-images "$PARTSIGNAL_RELEASE_MANIFEST"
if test "$deploy_mode" = upgrade; then
  # registry 先交付并核对，再证明执行策略/绑定候选，始终早于 run/up。
  python3 "$script_dir/prepare-production-data.py" \
    begin-upgrade "$PARTSIGNAL_RELEASE_MANIFEST"
  upgrade_started=1
fi
compose_up -d --wait postgres redis
deployment_stage=configuration_preflight
compose_run --rm api \
  python -m app.cli preflight-production-config

if test "$deploy_mode" = upgrade; then
  deployment_stage=integrity_preflight
  compose_run --rm api \
    python -m app.cli preflight-integrity
  deployment_stage=stop_application
  docker compose --env-file "$env_file" -f "$compose_file" stop api worker scheduler
fi

deployment_stage=migration
compose_run --rm migrate

if test "$deploy_mode" = clean-init; then
  compose_run --rm api \
    python -m app.cli preflight-integrity
fi

deployment_stage=account_initialization
compose_run --rm api \
  python -m app.cli initialize-accounts
deployment_stage=application_start
compose_up -d --wait api frontend
deployment_stage=status
docker compose --env-file "$env_file" -f "$compose_file" ps

deployment_stage=api_readiness
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19000/api/health/ready >/dev/null
deployment_stage=frontend_readiness
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19080/ >/dev/null
deployment_stage=prepared_proof
if test "$deploy_mode" = clean-init; then
  python3 "$script_dir/prepare-production-data.py" \
    mark-prepared "$PARTSIGNAL_CUTOVER_RUN_ID" "$PARTSIGNAL_RELEASE_MANIFEST"
else
  python3 "$script_dir/prepare-production-data.py" \
    mark-upgrade-prepared "$PARTSIGNAL_RELEASE_MANIFEST"
fi
printf '%s\n' "PartSignal ${PARTSIGNAL_VERSION} Production V2 已准备（${deploy_mode}）；Worker/Scheduler 尚未激活"
