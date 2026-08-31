# Package A1 Exact Authorization：Artifact Build

## Authorization status

- package：`A1_BUILD_production-20260830-101614-a663bcce`
- baseline：`A1-BASELINE-20260830T105357+0800`（只读采集延续至约 T+2 分钟）
- target：SSH alias `hostdzire` / hostname `scrapy`
- status：`EXECUTED_MET`
- 用户于 `2026-08-30` 明确批准按本文件 exact command 逐字执行；命令 SHA-256=`67dedb028dd5eeeb923b751a28858b88e65b5210ba7dd8e7baa231c375ec926b`，完成时间=`2026-08-30T11:52:33+08:00`，退出状态=`0`
- actual identity 与未触碰边界证据：`research/package-a1-execution.md`
- maintenance window：不开始；旧 7-service runtime 与 Nginx 保持活动
- package approval 不授权 A2、Nginx、container stop/recreate、data、env provision、cleanup 或任何 reload

## Fixed inputs

- origin：`https://github.com/ccisnoxx/partsignal.git`
- commit：`a663bcce9fd49da9c5aea7f257372fc318447234`
- schema head：`0043_geo_platform_identity`
- release ID：`production-20260830-101614-a663bcce`
- release checkout：`/root/partsignal/releases/production-20260830-101614-a663bcce`
- source archive：`/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz`
- backend tag：`partsignal-backend:production-20260830-101614-a663bcce`
- frontend tag：`partsignal-frontend:production-20260830-101614-a663bcce`
- rollback reference：`partsignal-frontend:mvp-20260825-172239-2a6fd940b848`
- rollback image ID：`sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`
- rollback RepoDigest：`partsignal-frontend@sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`
- required platform：`linux/amd64`
- advisory lock：`/run/lock/partsignal-production-artifact.lock`，授权 baseline 时 absent；A1 已以 `root:root 0600` 排他创建、持锁至最终核验完成并保留文件，执行后 advisory lock=`FREE`

## Authorized pre-execution dependency and capacity state

- `python:3.12-slim`：absent；A1 允许在 baseline 仍为 absent 时执行一次 `docker pull --platform linux/amd64 python:3.12-slim`
- `node:22-alpine`：absent；A1 允许在 baseline 仍为 absent 时执行一次 `docker pull --platform linux/amd64 node:22-alpine`
- `ghcr.io/astral-sh/uv:0.7.13`：present，ID=`sha256:6c1e19020ec221986a210027040044a5df8de762eb36d5240e382bc41d7a9043`，RepoDigest=`ghcr.io/astral-sh/uv@sha256:6c1e19020ec221986a210027040044a5df8de762eb36d5240e382bc41d7a9043`，`linux/amd64`
- `nginx:1.27-alpine`：present，ID=`sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`，RepoDigest=`nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`，`linux/amd64`
- observed available memory=`2,280,304,640` bytes；硬门仍为每次 build 前 `≥2,147,483,648` bytes
- root、`/var/lib/docker`、`/var/lib/containerd` 同 device，observed available=`46,525,460,480` bytes；三者硬门均为 `≥10,737,418,240` bytes
- no swap。当前内存仅比获批硬门高约 126.7 MiB；A1 不能证明峰值内存不会影响旧 runtime，只能在 backend 前后、frontend 前后做完整 identity/health/restart/OOM/public Gate。用户授权 A1 即接受这一明确残余风险；任一 Gate 漂移立即停止并保留现场。

缺失 base image 的 pull 是 Dockerfile build 的显式依赖，只允许上述两个 exact mutable tag；其 registry digest 要到 A1 pull 后才能观察。build 固定 `--pull=false`，不会主动更新已存在 base tag。最终候选仍由 A1 实际 backend/frontend ID 与 RepoDigest、A2 manifest 绑定。A1 可能新增 build cache；失败时保留，不 prune、不删除。

## Concurrency contract

A1 使用唯一 advisory lock，并要求从用户授权到命令结束期间，不得由其他 agent/operator/process 创建或移动两个 candidate tag 及两个 initially-absent base tag。普通 Docker tag 没有原子 `create-if-absent`；本合同依赖获批执行期的排他运维纪律，同时在每次 pull/build 前检查 absent、build 后捕获 exact ID/RepoDigest，并在结束前重新核对。如果发现 lock 已存在、tag 出现或 identity 漂移，A1 立即失败，不能把其他 writer 的镜像当成本轮产物。

## Exact command

以下变量全部赋予固定字面量，不是待替换 placeholder。执行时必须逐字使用本 package；任何 precondition 失败即由显式状态检查或 `set -Eeuo pipefail` 停止。

```bash
ssh hostdzire 'bash -se' <<'PARTSIGNAL_A1'
set -Eeuo pipefail
shopt -s inherit_errexit

readonly expected_hostname='scrapy'
readonly expected_commit='a663bcce9fd49da9c5aea7f257372fc318447234'
readonly expected_origin='https://github.com/ccisnoxx/partsignal.git'
readonly release_dir='/root/partsignal/releases/production-20260830-101614-a663bcce'
readonly source_archive='/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz'
readonly manifest_path='/root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json'
readonly backend_image='partsignal-backend:production-20260830-101614-a663bcce'
readonly frontend_image='partsignal-frontend:production-20260830-101614-a663bcce'
readonly rollback_image='partsignal-frontend:mvp-20260825-172239-2a6fd940b848'
readonly rollback_image_id='sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111'
readonly rollback_repo_digest='partsignal-frontend@sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111'
readonly artifact_lock='/run/lock/partsignal-production-artifact.lock'
readonly minimum_memory_bytes='2147483648'
readonly minimum_disk_bytes='10737418240'

readonly expected_compose='cliproxyapi|running(1)|/root/CLIProxyAPI/docker-compose.yml
md2word-p0|running(4)|/root/md2word-releases/a1088a3/docker/prod/docker-compose.yml,/root/md2word/docker-compose.p0.yml
partsignal-staging|running(7)|/root/partsignal/releases/mvp-20260825-172239-2a6fd940b848/deploy/compose.staging.yaml,/root/partsignal/releases/mvp-20260716-1623/deploy/compose.staging.yaml,/root/partsignal/releases/mvp-20260710-2125/deploy/compose.staging.yaml
sub2api-plus|running(3)|/root/sub2api-plus/docker-compose.yml
vaultwarden|running(1)|/opt/vaultwarden/compose.yaml'

readonly expected_runtime='0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94|partsignal-staging|api|partsignal-backend:mvp-20260825-172239-2a6fd940b848|sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f|running|0|false|healthy|
4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba|partsignal-staging|redis|redis:7.4-alpine|sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99|running|0|false|healthy|/root/partsignal-data/redis>/data:true;
57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34|partsignal-staging|fake-oss|partsignal-backend:mvp-20260825-172239-2a6fd940b848|sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f|running|0|false|none|/root/partsignal-data/objects>/data:true;
680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc|partsignal-staging|postgres|postgres:16-alpine|sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777|running|0|false|healthy|/root/partsignal-data/postgres>/var/lib/postgresql/data:true;
7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75|partsignal-staging|frontend|partsignal-frontend:mvp-20260825-172239-2a6fd940b848|sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111|running|0|false|none|
dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d|partsignal-staging|worker|partsignal-backend:mvp-20260825-172239-2a6fd940b848|sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f|running|0|false|healthy|
e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8|partsignal-staging|scheduler|partsignal-backend:mvp-20260825-172239-2a6fd940b848|sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f|running|0|false|healthy|'

readonly expected_listeners='LISTEN|0|8192|0.0.0.0:80
LISTEN|0|8192|10.0.0.2:443
LISTEN|0|8192|127.0.0.1:19000
LISTEN|0|8192|127.0.0.1:19001
LISTEN|0|8192|127.0.0.1:19080
LISTEN|0|8192|23.80.89.175:443'

readonly expected_data_metadata='/root/partsignal-data|directory|755|0:0|2049
/root/partsignal-data/postgres|directory|700|70:0|2049
/root/partsignal-data/redis|directory|755|999:0|2049
/root/partsignal-data/objects|directory|755|0:0|2049'

readonly expected_nginx='enabled=/etc/nginx/sites-available/partsignal-staging.conf
/etc/nginx/sites-available/partsignal-staging.conf|regular file|644|0:0|2049
/etc/nginx/snippets/partsignal-security-headers.conf|regular file|644|0:0|2049
ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982  /etc/nginx/sites-available/partsignal-staging.conf
c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e  /etc/nginx/snippets/partsignal-security-headers.conf
unit=active
nginx_test=successful'

readonly expected_base_images='python:3.12-slim|ABSENT
ghcr.io/astral-sh/uv:0.7.13|PRESENT|sha256:6c1e19020ec221986a210027040044a5df8de762eb36d5240e382bc41d7a9043|["ghcr.io/astral-sh/uv@sha256:6c1e19020ec221986a210027040044a5df8de762eb36d5240e382bc41d7a9043"]|linux|amd64|["ghcr.io/astral-sh/uv:0.7.13"]
node:22-alpine|ABSENT
nginx:1.27-alpine|PRESENT|sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10|["nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"]|linux|amd64|["nginx:1.27-alpine"]'

check_capacity() {
  local available_memory_bytes root_available_bytes docker_available_bytes containerd_available_bytes
  available_memory_bytes=$(awk '/MemAvailable:/ {printf "%.0f", $2 * 1024}' /proc/meminfo) || return 1
  root_available_bytes=$(df -B1 --output=avail / | awk 'NR == 2 {print $1}') || return 1
  docker_available_bytes=$(df -B1 --output=avail /var/lib/docker | awk 'NR == 2 {print $1}') || return 1
  containerd_available_bytes=$(df -B1 --output=avail /var/lib/containerd | awk 'NR == 2 {print $1}') || return 1
  printf 'capacity|memory=%s|root=%s|docker=%s|containerd=%s\n' \
    "$available_memory_bytes" "$root_available_bytes" \
    "$docker_available_bytes" "$containerd_available_bytes"
  test "$available_memory_bytes" -ge "$minimum_memory_bytes"
  test "$root_available_bytes" -ge "$minimum_disk_bytes"
  test "$docker_available_bytes" -ge "$minimum_disk_bytes"
  test "$containerd_available_bytes" -ge "$minimum_disk_bytes"
}

compose_snapshot() {
  docker compose ls --format json \
    | python3 -c 'import json, sys; rows = json.load(sys.stdin); print("\n".join(sorted("{}|{}|{}".format(row["Name"], row["Status"], row["ConfigFiles"]) for row in rows)))'
}

runtime_snapshot() {
  local container_ids cid identity health health_value mounts
  container_ids=$(docker ps -aq \
    --filter label=com.docker.compose.project=partsignal-staging) || return 1
  test -n "$container_ids"
  for cid in $container_ids; do
    identity=$(docker inspect "$cid" \
      --format '{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}|{{.RestartCount}}|{{.State.OOMKilled}}') || return 1
    health=none
    if health_value=$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null); then
      health=$health_value
    fi
    mounts=$(docker inspect "$cid" \
      --format '{{range .Mounts}}{{.Source}}>{{.Destination}}:{{.RW}};{{end}}') || return 1
    printf '%s|%s|%s\n' "$identity" "$health" "$mounts"
  done | LC_ALL=C sort
}

listener_snapshot() {
  ss -ltnH \
    | awk '$4 ~ /:(80|443|19000|19001|19080)$/ {print $1 "|" $2 "|" $3 "|" $4}' \
    | LC_ALL=C sort
}

data_metadata() {
  stat -c '%n|%F|%a|%u:%g|%d' \
    /root/partsignal-data \
    /root/partsignal-data/postgres \
    /root/partsignal-data/redis \
    /root/partsignal-data/objects
}

data_sizes() {
  local path
  for path in \
    /root/partsignal-data \
    /root/partsignal-data/postgres \
    /root/partsignal-data/redis \
    /root/partsignal-data/objects; do
    du -sb "$path" || return 1
  done
}

nginx_snapshot() {
  local enabled_target unit_state
  enabled_target=$(readlink /etc/nginx/sites-enabled/partsignal-staging.conf) || return 1
  printf 'enabled=%s\n' "$enabled_target"
  stat -c '%n|%F|%a|%u:%g|%d' \
    /etc/nginx/sites-available/partsignal-staging.conf \
    /etc/nginx/snippets/partsignal-security-headers.conf || return 1
  sha256sum \
    /etc/nginx/sites-available/partsignal-staging.conf \
    /etc/nginx/snippets/partsignal-security-headers.conf || return 1
  unit_state=$(systemctl is-active nginx) || return 1
  printf 'unit=%s\n' "$unit_state"
  nginx -t >/dev/null 2>&1 || return 1
  printf 'nginx_test=successful\n'
}

env_metadata() {
  if test -L /root/partsignal/shared/.env.production; then
    printf 'SYMLINK\n'
  elif test -e /root/partsignal/shared/.env.production; then
    stat -c 'PRESENT|%F|%a|%u:%g|%d|%s' /root/partsignal/shared/.env.production
  else
    printf 'MISSING\n'
  fi
}

public_snapshot() {
  local root_status live_status
  root_status=$(curl --silent --show-error --output /dev/null \
    --max-time 15 --write-out '%{http_code}' https://geo.962850.xyz/) || return 1
  live_status=$(curl --silent --show-error --output /dev/null \
    --max-time 15 --write-out '%{http_code}' https://geo.962850.xyz/api/v1/live) || return 1
  [[ "$root_status" =~ ^[0-9]{3}$ ]] || return 1
  [[ "$live_status" =~ ^[0-9]{3}$ ]] || return 1
  printf 'root=%s|live=%s\n' "$root_status" "$live_status"
}

db_snapshot() {
  local revision database_size
  revision=$(docker exec partsignal-staging-postgres-1 \
    psql -U partsignal -d partsignal -Atqc \
    'select version_num from alembic_version;') || return 1
  database_size=$(docker exec partsignal-staging-postgres-1 \
    psql -U partsignal -d partsignal -Atqc \
    'select pg_database_size(current_database());') || return 1
  printf 'revision=%s|size=%s\n' "$revision" "$database_size"
}

base_image_snapshot() {
  local image
  for image in \
    python:3.12-slim \
    ghcr.io/astral-sh/uv:0.7.13 \
    node:22-alpine \
    nginx:1.27-alpine; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      docker image inspect "$image" \
        --format "$image|PRESENT|{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}" || return 1
    else
      printf '%s|ABSENT\n' "$image"
    fi
  done
}

verify_image_identity() {
  local image_reference=$1
  test "$(docker image inspect "$image_reference" --format '{{.Os}}/{{.Architecture}}')" = 'linux/amd64'
  test "$(docker image inspect "$image_reference" --format '{{len .RepoDigests}}')" -gt 0
}

check_protected_baseline() {
  local actual current_target
  actual=$(compose_snapshot) || return 1
  test "$actual" = "$expected_compose"
  actual=$(runtime_snapshot) || return 1
  test "$actual" = "$expected_runtime"
  actual=$(listener_snapshot) || return 1
  test "$actual" = "$expected_listeners"
  actual=$(data_metadata) || return 1
  test "$actual" = "$expected_data_metadata"
  actual=$(data_sizes) || return 1
  printf 'data_sizes_observed_begin\n%s\ndata_sizes_observed_end\n' "$actual"
  actual=$(nginx_snapshot) || return 1
  test "$actual" = "$expected_nginx"
  actual=$(env_metadata) || return 1
  test "$actual" = 'MISSING'
  actual=$(public_snapshot) || return 1
  test "$actual" = 'root=200|live=404'
  actual=$(db_snapshot) || return 1
  test "$actual" = 'revision=0043_geo_platform_identity|size=10714135'
  current_target=$(readlink -f /root/partsignal/current) || return 1
  test "$current_target" = '/root/partsignal/releases/mvp-20260825-172239-2a6fd940b848'
  test ! -e /root/partsignal-data-quarantine
  test ! -e /root/partsignal-data/.partsignal-production-cutover.json
}

check_artifact_preconditions() {
  local remote_commit actual
  test "$(hostname)" = "$expected_hostname"
  test "$(uname -m)" = 'x86_64'
  test "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" = 'linux/amd64'
  test "$(stat -c '%F|%a|%u:%g|%d' /root/partsignal/releases)" = 'directory|755|0:0|2049'
  remote_commit=$(git ls-remote "$expected_origin" refs/heads/main | awk '{print $1}') || return 1
  test "$remote_commit" = "$expected_commit"
  test ! -e "$release_dir"
  test ! -e "$source_archive"
  test ! -e "$manifest_path"
  if docker image inspect "$backend_image" >/dev/null 2>&1; then return 1; fi
  if docker image inspect "$frontend_image" >/dev/null 2>&1; then return 1; fi
  test "$(docker image inspect "$rollback_image" --format '{{.Id}}')" = "$rollback_image_id"
  test "$(docker image inspect "$rollback_image" --format '{{.Os}}/{{.Architecture}}')" = 'linux/amd64'
  test "$(docker image inspect "$rollback_image" --format '{{len .RepoDigests}}')" -gt 0
  docker image inspect "$rollback_image" --format '{{json .RepoDigests}}' \
    | grep -Fq "$rollback_repo_digest"
  actual=$(base_image_snapshot) || return 1
  test "$actual" = "$expected_base_images"
  check_capacity
  check_protected_baseline
}

check_artifact_preconditions
test ! -e "$artifact_lock"

ARTIFACT_LOCK="$artifact_lock" python3 - <<'PY'
import os

path = os.environ["ARTIFACT_LOCK"]
descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.close(descriptor)
PY
exec 9<>"$artifact_lock"
flock --nonblock 9
test "$(stat -c '%F|%a|%u:%g|%s' "$artifact_lock")" = 'regular empty file|600|0:0|0'
check_artifact_preconditions

mkdir -m 0755 "$release_dir"
git -C "$release_dir" init --quiet --initial-branch=main
git -C "$release_dir" remote add origin "$expected_origin"
git -C "$release_dir" fetch --quiet --no-tags origin \
  refs/heads/main:refs/remotes/origin/main
test "$(git -C "$release_dir" rev-parse origin/main)" = "$expected_commit"
git -C "$release_dir" checkout --quiet -B main origin/main
test "$(git -C "$release_dir" branch --show-current)" = 'main'
test "$(git -C "$release_dir" rev-parse HEAD)" = "$expected_commit"
git_status=$(git -C "$release_dir" status --porcelain) || exit 1
test -z "$git_status"

SOURCE_ARCHIVE="$source_archive" RELEASE_DIR="$release_dir" EXPECTED_COMMIT="$expected_commit" \
python3 - <<'PY'
import os
import subprocess

archive = os.environ["SOURCE_ARCHIVE"]
release_dir = os.environ["RELEASE_DIR"]
commit = os.environ["EXPECTED_COMMIT"]
descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "wb") as output:
    subprocess.run(
        ["git", "-C", release_dir, "archive", "--format=tar.gz", commit],
        check=True,
        stdout=output,
    )
    output.flush()
    os.fsync(output.fileno())
parent_descriptor = os.open(os.path.dirname(archive), os.O_RDONLY)
try:
    os.fsync(parent_descriptor)
finally:
    os.close(parent_descriptor)
PY
test -s "$source_archive"

check_capacity
if docker image inspect python:3.12-slim >/dev/null 2>&1; then
  printf 'python base tag 在 pull 前出现，拒绝覆盖\n' >&2
  exit 1
fi
timeout --signal=TERM --kill-after=60s 900s \
  docker pull --platform linux/amd64 python:3.12-slim
if docker image inspect node:22-alpine >/dev/null 2>&1; then
  printf 'node base tag 在 pull 前出现，拒绝覆盖\n' >&2
  exit 1
fi
timeout --signal=TERM --kill-after=60s 900s \
  docker pull --platform linux/amd64 node:22-alpine
verify_image_identity python:3.12-slim
verify_image_identity ghcr.io/astral-sh/uv:0.7.13
verify_image_identity node:22-alpine
verify_image_identity nginx:1.27-alpine
check_protected_baseline

check_capacity
if docker image inspect "$backend_image" >/dev/null 2>&1; then
  printf 'backend tag 在 build 前出现，拒绝覆盖：%s\n' "$backend_image" >&2
  exit 1
fi
timeout --signal=TERM --kill-after=60s 2400s \
  docker build --pull=false \
    --file "$release_dir/backend/Dockerfile" \
    --tag "$backend_image" \
    "$release_dir/backend"
verify_image_identity "$backend_image"
backend_image_id=$(docker image inspect "$backend_image" --format '{{.Id}}') || exit 1
backend_repo_digests=$(docker image inspect "$backend_image" --format '{{json .RepoDigests}}') || exit 1
check_protected_baseline

check_capacity
test "$(docker image inspect "$backend_image" --format '{{.Id}}')" = "$backend_image_id"
test "$(docker image inspect "$backend_image" --format '{{json .RepoDigests}}')" = "$backend_repo_digests"
if docker image inspect "$frontend_image" >/dev/null 2>&1; then
  printf 'frontend tag 在 build 前出现，拒绝覆盖：%s\n' "$frontend_image" >&2
  exit 1
fi
timeout --signal=TERM --kill-after=60s 2400s \
  docker build --pull=false \
    --file "$release_dir/frontend/Dockerfile" \
    --tag "$frontend_image" \
    "$release_dir/frontend"
verify_image_identity "$frontend_image"
frontend_image_id=$(docker image inspect "$frontend_image" --format '{{.Id}}') || exit 1
frontend_repo_digests=$(docker image inspect "$frontend_image" --format '{{json .RepoDigests}}') || exit 1
check_protected_baseline

git_status=$(git -C "$release_dir" status --porcelain) || exit 1
test -z "$git_status"
test "$(docker image inspect "$backend_image" --format '{{.Id}}')" = "$backend_image_id"
test "$(docker image inspect "$backend_image" --format '{{json .RepoDigests}}')" = "$backend_repo_digests"
test "$(docker image inspect "$frontend_image" --format '{{.Id}}')" = "$frontend_image_id"
test "$(docker image inspect "$frontend_image" --format '{{json .RepoDigests}}')" = "$frontend_repo_digests"

date --iso-8601=seconds
stat -c '%n|%F|%a|%u:%g|%d|%s' "$release_dir" "$source_archive" "$artifact_lock"
sha256sum "$source_archive"
docker image inspect "$backend_image" \
  --format '{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}'
docker image inspect "$frontend_image" \
  --format '{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}'
docker image inspect "$rollback_image" \
  --format '{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}'
docker image inspect python:3.12-slim \
  --format '{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}'
docker image inspect node:22-alpine \
  --format '{{.Id}}|{{json .RepoDigests}}|{{.Os}}|{{.Architecture}}|{{json .RepoTags}}'
check_capacity
printf 'A1_ARTIFACT_BUILD_COMPLETE\n'
PARTSIGNAL_A1
```

## Mutation allowlist

A1 只授权：

1. 排他创建 `/run/lock/partsignal-production-artifact.lock`，`root:root 0600`，并持 advisory lock 至最终核验完成；文件完成后保留。
2. 创建 `/root/partsignal/releases/production-20260830-101614-a663bcce` 并在其中建立 fixed clean Git checkout。
3. 以 `O_EXCL`、mode `0600` 创建 `/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz`。
4. 仅在授权 baseline 为 absent 的前提下 pull `python:3.12-slim` 与 `node:22-alpine` 的 `linux/amd64` image。
5. 顺序 build 两个新 tag：`partsignal-backend:production-20260830-101614-a663bcce`、`partsignal-frontend:production-20260830-101614-a663bcce`。
6. Docker build 可产生与上述两个 build 直接相关的 cache；失败时保留，不删除、不 prune。

A1 不授权 manifest、`.env.production` 创建/修改、Compose run/up、container stop/recreate/remove、Nginx write/reload、data/quarantine、旧 tag/image/release/cache 删除、DNS/TLS/证书或其他资源变更。

## Failure and timeout boundary

- 两次 base pull 各自最多 900 秒；backend/frontend build 各自最多 2400 秒。A1 在 maintenance window 外执行。
- 执行前必须仍逐项等于本 package 的 Compose projects、7 个 full container/service/image/state/health/restart/OOM/mount、listeners、data path type/device/owner/mode、DB revision/size、Nginx enabled target/checksum/unit/`nginx -t`、env metadata、public HTTP、current、quarantine/cutover 与 base-image baseline。任何 identity/state 漂移使授权失效；业务 data byte size 每次安全记录但不做 equality Gate。
- backend build 后、frontend build 后都重新验证完整 protected identity baseline并记录 byte size；Package M 仍须在停机后重新冻结 exact size。
- 任一 precondition、capacity、Git identity、platform、RepoDigest、runtime protected baseline、tag identity 或 timeout 失败，命令立即停止。
- 已创建的 lock/release/archive/base image/new image/build cache全部保留；不得复用同一 release ID 继续猜测执行，不得执行清理。
- A1 成功后只形成 A2 输入，不授权自动生成 manifest 或运行 configuration preflight。
