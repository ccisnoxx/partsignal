#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-production-test.XXXXXX")
test_dir=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$test_dir")
candidate_release=production-20260829-120000-0123456789ab
next_release=production-20260829-130000-fedcba987654

cleanup() {
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/partsignal-production-test.*) rm -rf "$test_dir" ;;
  esac
}
trap cleanup 0 INT TERM

node "$root/deploy/scripts/check-nginx-security.mjs"
mkdir -p "$test_dir/live/postgres" "$test_dir/live/redis" "$test_dir/live/objects"
printf '%s\n' old-postgres >"$test_dir/live/postgres/marker"
printf '%s\n' old-redis >"$test_dir/live/redis/marker"
printf '%s\n' old-object >"$test_dir/live/objects/marker"

PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=test \
PARTSIGNAL_RUNTIME_ENV_FILE="$root/.env.example" \
PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  docker compose --env-file "$root/.env.example" -f "$root/deploy/compose.prod.yaml" \
  config --no-env-resolution --format json >"$test_dir/compose.json"
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=test \
PARTSIGNAL_RUNTIME_ENV_FILE="$root/.env.example" \
PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  docker compose --profile production-async --env-file "$root/.env.example" \
  -f "$root/deploy/compose.prod.yaml" \
  config --no-env-resolution --format json >"$test_dir/compose-async.json"

python3 - "$test_dir/compose.json" "$test_dir/live" "$root/.env.example" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

assert config["name"] == "partsignal-staging"
services = config["services"]
assert "frontend" in services
assert "fake-oss" not in services
frontend = services["frontend"]
assert frontend["image"] == "partsignal-frontend-v2:test"
assert "build" not in frontend
assert frontend["ports"] == [{
    "mode": "ingress",
    "target": 80,
    "published": "19080",
    "protocol": "tcp",
    "host_ip": "127.0.0.1",
}]
assert services["postgres"]["volumes"][0]["source"] == f"{sys.argv[2]}/postgres"
assert services["redis"]["volumes"][0]["source"] == f"{sys.argv[2]}/redis"
assert services["api"]["env_file"] == [{"path": sys.argv[3]}]
assert services["frontend"]["networks"] == {"partsignal-edge": None}
assert "worker" not in services
assert "scheduler" not in services
assert config["networks"]["partsignal-edge"]["name"] == "partsignal-staging-edge"
PY

python3 - "$test_dir/compose-async.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    services = json.load(config_file)["services"]

assert services["worker"]["profiles"] == ["production-async"]
assert services["scheduler"]["profiles"] == ["production-async"]
PY

grep -q 'server 127.0.0.1:19080;' "$root/deploy/nginx/partsignal.conf.template"
grep -q 'proxy_pass http://partsignal_frontend;' "$root/deploy/nginx/partsignal.conf.template"
! grep -q '/var/www/partsignal-frontend/current' "$root/deploy/nginx/partsignal.conf.template"
! grep -q '/object-storage/' "$root/deploy/nginx/partsignal.conf.template"

maintenance_template="$root/deploy/nginx/partsignal-maintenance.conf.template"
grep -q 'listen <HOSTDZIRE_WG_ADDRESS>:80 proxy_protocol;' "$maintenance_template"
grep -q 'listen <HOSTDZIRE_WG_ADDRESS>:443 ssl proxy_protocol;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/acme-challenge.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/cert-962850.xyz.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/ssl-common.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/partsignal-security-headers.conf;' "$maintenance_template"
grep -q 'add_header_inherit merge;' "$maintenance_template"
grep -q 'default_type text/plain;' "$maintenance_template"
grep -q 'add_header Cache-Control "no-store" always;' "$maintenance_template"
grep -q 'add_header Retry-After "3600" always;' "$maintenance_template"
grep -q 'return 503 "PartSignal maintenance\\n";' "$maintenance_template"
! grep -Eq '^[[:space:]]*upstream[[:space:]]' "$maintenance_template"
! grep -q 'proxy_pass' "$maintenance_template"
! grep -Eq '^[[:space:]]*root[[:space:]]' "$maintenance_template"
! grep -Eq '(^|[^0-9])19000([^0-9]|$)' "$maintenance_template"
! grep -Eq '(^|[^0-9])19001([^0-9]|$)' "$maintenance_template"
! grep -Eq '(^|[^0-9])19080([^0-9]|$)' "$maintenance_template"
! grep -q '/object-storage/' "$maintenance_template"

mkdir "$test_dir/bin"
printf '%s\n' \
  '#!/bin/sh' \
  'case "$*" in' \
  '  "image inspect "*)' \
  '    printf "docker %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}"' \
  '    case "$*" in *"${MISSING_IMAGE_REFERENCE:-__never__}"*) exit 1 ;; esac' \
  '    printf '\''[{"Id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","RepoDigests":["example@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}]\n'\''' \
  '    ;;' \
  '  "ps -q --filter label=com.docker.compose.project="*) printf "%s\n" "${DOCKER_PROJECT_IDS:-}" ;;' \
  '  "ps -q") printf "%s\n" "${DOCKER_RUNNING_IDS:-}" ;;' \
  '  "inspect "*) printf "%s\n" "${DOCKER_INSPECT_JSON:-[]}" ;;' \
  '  *) printf "docker %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}" ;;' \
  'esac' \
  >"$test_dir/bin/docker"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "curl %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}"' \
  >"$test_dir/bin/curl"
chmod +x "$test_dir/bin/docker" "$test_dir/bin/curl"

printf '%s\n' source >"$test_dir/source.tar.gz"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-110000-unverified \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:unverified \
  --frontend-image partsignal-frontend-v2:unverified \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --output "$test_dir/unverified-manifest.json" >/dev/null 2>&1
unverified_source_status=$?
set -e
test "$unverified_source_status" -ne 0
test ! -e "$test_dir/unverified-manifest.json"

set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-110001-unverified \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:unverified \
  --frontend-image partsignal-frontend-v2:unverified \
  --rollback-frontend-image partsignal-frontend-v1:previous \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/v1-manifest.json" >/dev/null 2>"$test_dir/v1-manifest.err"
v1_manifest_status=$?
set -e
test "$v1_manifest_status" -ne 0
test ! -e "$test_dir/v1-manifest.json"
grep -q 'V1 镜像仓库' "$test_dir/v1-manifest.err"

PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id "$candidate_release" \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image "partsignal-backend:$candidate_release" \
  --frontend-image "partsignal-frontend-v2:$candidate_release" \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/release-manifest.json" >/dev/null
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id "$next_release" \
  --commit fedcba9876543210fedcba9876543210fedcba98 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image "partsignal-backend:$next_release" \
  --frontend-image "partsignal-frontend-v2:$next_release" \
  --rollback-frontend-image "partsignal-frontend-v2:$candidate_release" \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/release-manifest-next.json" >/dev/null

python3 - "$test_dir/release-manifest.json" "$test_dir/release-manifest-drift.json" \
  "$test_dir/release-manifest-digest-mismatch.json" \
  "$test_dir/release-manifest-v1-rollback.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)

drifted = json.loads(json.dumps(manifest))
drifted["tracked_files"]["deploy/compose.prod.yaml"] = "0" * 64
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump(drifted, output)

digest_mismatch = json.loads(json.dumps(manifest))
digest_mismatch["images"]["backend"]["repo_digests"] = ["example@sha256:" + "c" * 64]
with open(sys.argv[3], "w", encoding="utf-8") as output:
    json.dump(digest_mismatch, output)

v1_rollback = json.loads(json.dumps(manifest))
v1_rollback["images"]["rollback_frontend"]["reference"] = (
    "partsignal-frontend-v1:previous"
)
with open(sys.argv[4], "w", encoding="utf-8") as output:
    json.dump(v1_rollback, output)
PY
for invalid_manifest in "$test_dir/release-manifest-drift.json" \
  "$test_dir/release-manifest-digest-mismatch.json"; do
  set +e
  PATH="$test_dir/bin:$PATH" PARTSIGNAL_VERSION="$candidate_release" \
    PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
    PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
    PARTSIGNAL_DATA_ROOT="$test_dir/live" \
    PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
    PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-manifest.lock" \
    PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
    python3 "$root/deploy/scripts/prepare-production-data.py" \
    verify-candidate-images "$invalid_manifest" >/dev/null 2>&1
  invalid_manifest_status=$?
  set -e
  test "$invalid_manifest_status" -eq 2
done

set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-consumer.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  verify-candidate-images "$test_dir/release-manifest-v1-rollback.json" \
  >/dev/null 2>"$test_dir/v1-consumer.err"
v1_consumer_status=$?
set -e
test "$v1_consumer_status" -eq 2
grep -q 'V1 rollback_frontend 镜像仓库' "$test_dir/v1-consumer.err"

data_env() {
  PATH="$test_dir/bin:$PATH" \
  COMMAND_LOG="$test_dir/data.log" \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
    "$@"
}

data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_120000 >/dev/null
data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_120000 >/dev/null
test -f "$test_dir/quarantine/prr_20260829_120000/postgres/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/redis/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/objects/marker"
test -d "$test_dir/live/postgres"
test -d "$test_dir/live/redis"
test ! -e "$test_dir/live/objects"

: >"$test_dir/wrong-compose.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/wrong-compose.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.staging.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>&1
wrong_compose_status=$?
set -e
test "$wrong_compose_status" -eq 2
test ! -s "$test_dir/wrong-compose.log"

: >"$test_dir/wrong-project.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/wrong-project.log" \
  COMPOSE_PROJECT_NAME=wrong-project \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>&1
wrong_project_status=$?
set -e
test "$wrong_project_status" -eq 2
test ! -s "$test_dir/wrong-project.log"

: >"$test_dir/invalid-image-delivery-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid-image-delivery-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=invalid \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-image-delivery-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/invalid-image-delivery-mode.out" \
  2>"$test_dir/invalid-image-delivery-mode.err"
invalid_image_delivery_mode_status=$?
set -e
test "$invalid_image_delivery_mode_status" -eq 2
test ! -s "$test_dir/invalid-image-delivery-mode.log"
grep -q '无效的 Production 镜像交付模式：invalid' \
  "$test_dir/invalid-image-delivery-mode.err"

: >"$test_dir/empty-image-delivery-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/empty-image-delivery-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE= \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/empty-image-delivery-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/empty-image-delivery-mode.out" \
  2>"$test_dir/empty-image-delivery-mode.err"
empty_image_delivery_mode_status=$?
set -e
test "$empty_image_delivery_mode_status" -eq 2
test ! -s "$test_dir/empty-image-delivery-mode.log"
grep -q '无效的 Production 镜像交付模式：' \
  "$test_dir/empty-image-delivery-mode.err"

: >"$test_dir/v1-deploy.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-deploy.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-deploy.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>"$test_dir/v1-deploy.err"
v1_deploy_status=$?
set -e
test "$v1_deploy_status" -eq 2
test ! -s "$test_dir/v1-deploy.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-deploy.err"

: >"$test_dir/v1-backend-deploy.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-backend-deploy.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend-v1 \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-backend-deploy.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/v1-backend-deploy.out" \
  2>"$test_dir/v1-backend-deploy.err"
v1_backend_deploy_status=$?
set -e
test "$v1_backend_deploy_status" -eq 2
test ! -s "$test_dir/v1-backend-deploy.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-backend-deploy.err"

: >"$test_dir/missing-image.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/missing-image.log" \
  MISSING_IMAGE_REFERENCE="partsignal-backend:$candidate_release" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/missing-image.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/missing-image.out" \
  2>"$test_dir/missing-image.err"
missing_image_status=$?
set -e
test "$missing_image_status" -eq 2
grep -q "partsignal-backend:$candidate_release" "$test_dir/missing-image.err"
! grep -q ' compose .*\(run\|up\) ' "$test_dir/missing-image.log"

: >"$test_dir/clean.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/clean.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null

awk '
  /config --quiet/ { config = NR }
  /pull api worker scheduler frontend/ { pull = NR }
  /image inspect/ { verify = NR }
  /up -d --wait postgres redis/ { data = NR }
  /preflight-production-config/ { production = NR }
  /run --rm migrate/ { migrate = NR }
  /preflight-integrity/ { integrity = NR }
  /initialize-accounts/ { accounts = NR }
  /up -d --wait api frontend/ { application = NR }
  / compose .* ps$/ { status = NR }
  /api\/health\/ready/ { ready = NR }
  /127\.0\.0\.1:19080/ { frontend = NR }
  END {
    exit !(config < pull && pull < verify && verify < data && data < production &&
           production < migrate && migrate < integrity && integrity < accounts &&
           accounts < application && application < status && status < ready &&
           ready < frontend)
  }
' "$test_dir/clean.log"
! grep -q 'up -d --wait worker scheduler' "$test_dir/clean.log"
! grep -q -- '--pull never' "$test_dir/clean.log"

: >"$test_dir/local.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/local.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/local.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null
! grep -q ' pull ' "$test_dir/local.log"
grep -q 'up --pull never -d --wait postgres redis' "$test_dir/local.log"
grep -q 'run --pull never --rm api' "$test_dir/local.log"
grep -q 'run --pull never --rm migrate' "$test_dir/local.log"
grep -q 'up --pull never -d --wait api frontend' "$test_dir/local.log"
awk '
  /image inspect/ { verify = NR }
  /up --pull never -d --wait postgres redis/ { first_up = NR }
  END { exit !(verify && first_up && verify < first_up) }
' "$test_dir/local.log"

: >"$test_dir/blocked-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/blocked-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=NOT_MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
blocked_status=$?
set -e
test "$blocked_status" -eq 2
test ! -s "$test_dir/blocked-activation.log"

: >"$test_dir/invalid-activation-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid-activation-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=invalid \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-activation-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >"$test_dir/invalid-activation-mode.out" \
  2>"$test_dir/invalid-activation-mode.err"
invalid_activation_mode_status=$?
set -e
test "$invalid_activation_mode_status" -eq 2
test ! -s "$test_dir/invalid-activation-mode.log"
grep -q '无效的 Production 镜像交付模式：invalid' \
  "$test_dir/invalid-activation-mode.err"

: >"$test_dir/empty-activation-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/empty-activation-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE= \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/empty-activation-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >"$test_dir/empty-activation-mode.out" \
  2>"$test_dir/empty-activation-mode.err"
empty_activation_mode_status=$?
set -e
test "$empty_activation_mode_status" -eq 2
test ! -s "$test_dir/empty-activation-mode.log"
grep -q '无效的 Production 镜像交付模式：' \
  "$test_dir/empty-activation-mode.err"

: >"$test_dir/v1-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-activation.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>"$test_dir/v1-activation.err"
v1_activation_status=$?
set -e
test "$v1_activation_status" -eq 2
test ! -s "$test_dir/v1-activation.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-activation.err"

: >"$test_dir/activate.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/activate.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null
grep -q -- '--profile production-async.*up --pull never -d --wait worker scheduler' "$test_dir/activate.log"

: >"$test_dir/rollback-mismatch.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/rollback-mismatch.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_VERSION=wrong \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/rollback-production-frontend.sh" >/dev/null 2>&1
rollback_mismatch_status=$?
set -e
test "$rollback_mismatch_status" -eq 2
test ! -s "$test_dir/rollback-mismatch.log"

: >"$test_dir/rollback.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/rollback.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_VERSION=previous \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/rollback-production-frontend.sh" >/dev/null
grep -q 'up -d --no-deps --no-build --pull never --force-recreate --wait frontend' \
  "$test_dir/rollback.log"
! grep -Eq 'up .*api|up .*worker|up .*scheduler|up .*postgres|up .*redis' \
  "$test_dir/rollback.log"

: >"$test_dir/unprepared-upgrade-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/unprepared-upgrade-activation.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
unprepared_upgrade_status=$?
set -e
test "$unprepared_upgrade_status" -eq 2
test ! -s "$test_dir/unprepared-upgrade-activation.log"

: >"$test_dir/upgrade.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/upgrade.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null
awk '
  /preflight-integrity/ { integrity = NR }
  /stop api worker scheduler/ { stop = NR }
  /run --rm migrate/ { migrate = NR }
  /initialize-accounts/ { accounts = NR }
  END { exit !(integrity < stop && stop < migrate && migrate < accounts) }
' "$test_dir/upgrade.log"
! grep -q 'up -d --wait worker scheduler' "$test_dir/upgrade.log"

: >"$test_dir/mismatched-upgrade-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/mismatched-upgrade-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
mismatched_upgrade_status=$?
set -e
test "$mismatched_upgrade_status" -eq 2
test ! -s "$test_dir/mismatched-upgrade-activation.log"

: >"$test_dir/upgrade-activation.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/upgrade-activation.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$root/.env.example" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null
grep -q -- '--profile production-async.*up -d --wait worker scheduler' \
  "$test_dir/upgrade-activation.log"

for log_file in "$test_dir/clean.log" "$test_dir/activate.log" "$test_dir/upgrade.log" \
  "$test_dir/upgrade-activation.log"; do
  ! grep -Eq 'fake-oss|remove-orphans|build|frontend-v1|/var/www/partsignal' "$log_file"
done

printf '%s\n' failed-production >"$test_dir/live/postgres/new-marker"
data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_120000 >/dev/null
test -f "$test_dir/live/postgres/marker"
test -f "$test_dir/live/redis/marker"
test -f "$test_dir/live/objects/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/failed-production/postgres/new-marker"

mkdir -p "$test_dir/resume/postgres" "$test_dir/resume/redis" "$test_dir/resume/objects"
printf '%s\n' resume-old >"$test_dir/resume/postgres/marker"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=2 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_130000 >/dev/null 2>&1
resume_status=$?
set -e
test "$resume_status" -eq 2
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_130000 >/dev/null
test -f "$test_dir/resume-quarantine/prr_20260829_130000/postgres/marker"

mkdir -p "$test_dir/restore-resume/postgres" "$test_dir/restore-resume/redis" \
  "$test_dir/restore-resume/objects"
printf '%s\n' restore-old >"$test_dir/restore-resume/postgres/marker"
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_133000 >/dev/null
printf '%s\n' restore-new >"$test_dir/restore-resume/postgres/new-marker"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_133000 >/dev/null 2>&1
restore_resume_status=$?
set -e
test "$restore_resume_status" -eq 2
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_133000 >/dev/null
test -f "$test_dir/restore-resume/postgres/marker"
test -f "$test_dir/restore-resume-quarantine/prr_20260829_133000/failed-production/postgres/new-marker"

mkdir -p "$test_dir/tampered-restore/postgres" "$test_dir/tampered-restore/redis" \
  "$test_dir/tampered-restore/objects" "$test_dir/tampered-outside"
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_134000 >/dev/null
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=2 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_134000 >/dev/null 2>&1
tampered_interrupt_status=$?
set -e
test "$tampered_interrupt_status" -eq 2
rmdir "$test_dir/tampered-restore-quarantine/prr_20260829_134000/redis"
ln -s "$test_dir/tampered-outside" \
  "$test_dir/tampered-restore-quarantine/prr_20260829_134000/redis"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_134000 >/dev/null 2>&1
tampered_restore_status=$?
set -e
test "$tampered_restore_status" -eq 2
test ! -L "$test_dir/tampered-restore/redis"

LOCK_READY="$test_dir/lock-ready" \
PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/contention.lock" \
PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" run-locked \
  sh -c 'touch "$LOCK_READY"; sleep 2' &
lock_holder=$!
lock_wait_count=0
while test ! -f "$test_dir/lock-ready"; do
  lock_wait_count=$((lock_wait_count + 1))
  test "$lock_wait_count" -lt 40
  sleep 0.05
done
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/contention.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
contention_status=$?
set -e
test "$contention_status" -eq 2
wait "$lock_holder"

set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume/nested-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/nested.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
nested_status=$?
set -e
test "$nested_status" -eq 2

ln -s "$test_dir/resume" "$test_dir/resume-link"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume-link" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/other-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/symlink.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
symlink_status=$?
set -e
test "$symlink_status" -eq 2

mkdir -p "$test_dir/running/postgres" "$test_dir/running/redis" "$test_dir/running/objects"
set +e
PATH="$test_dir/bin:$PATH" DOCKER_PROJECT_IDS=running-container \
  PARTSIGNAL_DATA_ROOT="$test_dir/running" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/running-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/running.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_140000 >/dev/null 2>&1
running_status=$?
set -e
test "$running_status" -eq 2
test -d "$test_dir/running/postgres"
test ! -e "$test_dir/running-quarantine/prr_20260829_140000"

mkdir -p "$test_dir/mounted/postgres" "$test_dir/mounted/redis" \
  "$test_dir/mounted/objects"
mounted_payload=$(printf '[{"Mounts":[{"Source":"%s/postgres/base"}]}]' \
  "$test_dir/mounted")
set +e
PATH="$test_dir/bin:$PATH" DOCKER_RUNNING_IDS=backup-container \
  DOCKER_INSPECT_JSON="$mounted_payload" \
  PARTSIGNAL_DATA_ROOT="$test_dir/mounted" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/mounted-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/mounted.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_143000 >/dev/null 2>&1
mounted_status=$?
set -e
test "$mounted_status" -eq 2
test -d "$test_dir/mounted/postgres"
test ! -e "$test_dir/mounted-quarantine/prr_20260829_143000"

python3 - "$test_dir/release-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

assert manifest["release_id"] == "production-20260829-120000-0123456789ab"
assert manifest["images"]["frontend"]["image_id"].startswith("sha256:")
assert set(manifest["tracked_files"]) == {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-maintenance.conf.template",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
PY
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-120000-0123456789ab \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:test \
  --frontend-image partsignal-frontend-v2:test \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --output "$test_dir/release-manifest.json" >/dev/null 2>&1
overwrite_status=$?
set -e
test "$overwrite_status" -ne 0

printf '%s\n' "Production V2 编排、两阶段激活、可续跑数据状态机与候选清单合同自检通过"
