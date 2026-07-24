#!/bin/sh
set -eu

usage() {
  printf '%s\n' \
    '用法: deploy/scripts/redeploy-staging-fast.sh' \
    '' \
    '从干净且已同步 origin/main 的本地主工作目录快速重部署 Hostdzire 预发布环境。' \
    '该入口不会备份数据库、运行迁移或重复创建验收账号；迁移或部署配置变化请走完整 Runbook。'
}

case ${1:-} in
  -h | --help)
    usage
    exit 0
    ;;
  '')
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

start_time=$(date +%s)
current_stage=初始化
archive=

finish() {
  status=$?
  trap - 0
  test -z "$archive" || rm -f "$archive" || true
  elapsed=$(( $(date +%s) - start_time ))
  if test "$status" -eq 0; then
    printf '%s\n' "[fast] 完成，总耗时 ${elapsed} 秒"
  else
    printf '%s\n' "[fast] 失败阶段：${current_stage}；已耗时 ${elapsed} 秒" >&2
  fi
  exit "$status"
}
trap finish 0

stage() {
  current_stage=$1
  printf '%s\n' "[fast] ${current_stage}"
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

repo_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
ssh_config=/Users/sc/.ssh/config
ssh_host=hostdzire
public_url=https://geo.962850.xyz

stage "校验本地发布来源"
for required_command in git tar ssh scp curl; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "缺少快速重部署所需命令：$required_command"
done

cd "$repo_root"
test "$(git branch --show-current)" = main ||
  fail "快速重部署只接受本地主工作目录的 main 分支"
test -z "$(git status --porcelain)" ||
  fail "工作树不干净，快速重部署已停止"
test -f "$ssh_config" ||
  fail "缺少 OpenSSH 配置：$ssh_config"
ssh -G -F "$ssh_config" "$ssh_host" >/dev/null

git fetch --quiet origin main
head_commit=$(git rev-parse HEAD)
origin_commit=$(git rev-parse origin/main)
test "$head_commit" = "$origin_commit" ||
  fail "本地 HEAD 与 origin/main 不一致，快速重部署已停止"

stage "确认 Hostdzire 发布环境"
ssh -F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=15 "$ssh_host" \
  'set -eu
  test "$(id -u)" -eq 0
  test -d /root/partsignal/releases
  test -f /root/partsignal/shared/.env.staging
  test -L /root/partsignal/current'

release_id="mvp-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 "$head_commit")"
archive=$(mktemp "${TMPDIR:-/tmp}/partsignal-fast.XXXXXX")
archive_name="partsignal-${release_id}.tar.gz"
remote_archive="/root/partsignal/.incoming-${archive_name}"

stage "制作并检查发布包：$release_id"
git archive --format=tar.gz --output="$archive" "$head_commit"
test -s "$archive" || fail "发布包为空，快速重部署已停止"
tar -tzf "$archive" | grep -qx '.env.example' ||
  fail "发布包缺少 .env.example，快速重部署已停止"

bad_entries=$(
  tar -tzf "$archive" |
    awk '
      {
        lower = tolower($0)
        if ($0 ~ /(^|\/)\._/ ||
            ($0 ~ /(^|\/)\.env($|\.)/ && $0 !~ /(^|\/)\.env\.example$/) ||
            lower ~ /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/ ||
            lower ~ /(^|\/)[^\/]*(private[^\/]*key|\.pem|\.key)$/) {
          print
        }
      }
    '
)
if test -n "$bad_entries"; then
  printf '%s\n' "$bad_entries" >&2
  fail "发布包包含环境文件、密钥或 AppleDouble 文件，快速重部署已停止"
fi

stage "上传并执行远端资格门禁"
scp -F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=15 \
  "$archive" "${ssh_host}:${remote_archive}"
ssh -F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=15 \
  "$ssh_host" sh -s "$release_id" "$remote_archive" <<'REMOTE'
set -eu

release_id=$1
archive=$2
release_root=/root/partsignal
release_dir="${release_root}/releases/${release_id}"
shared_env="${release_root}/shared/.env.staging"
current_link="${release_root}/current"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$(id -u)" -eq 0 || fail "快速重部署必须以 Hostdzire root 用户执行"
case "$archive" in
  "${release_root}"/.incoming-partsignal-*.tar.gz) ;;
  *) fail "远端发布包路径不在 PartSignal 受保护目录内" ;;
esac
test -f "$archive" || fail "Hostdzire 缺少已上传的发布包"
trap 'rm -f "$archive"' 0
test -f "$shared_env" || fail "Hostdzire 缺少共享预发布环境文件"
test "$(stat -c '%a' "$shared_env")" = 600 ||
  fail "共享预发布环境文件权限必须为 0600"
test -L "$current_link" || fail "Hostdzire 缺少已验证的 current release，请先走完整流程"

current_dir=$(readlink -f "$current_link")
case "$current_dir" in
  "${release_root}"/releases/*) ;;
  *) fail "current 未指向 PartSignal release 目录，请先人工核对" ;;
esac
test -d "$current_dir" || fail "current 指向的 release 目录不存在"
test ! -e "$release_dir" && test ! -L "$release_dir" ||
  fail "release 已存在，拒绝覆盖：$release_id"

mkdir -p "${release_root}/releases"
mkdir "$release_dir"
tar -xzf "$archive" -C "$release_dir"

test -f "$release_dir/.env.example" || fail "远端发布包缺少 .env.example"
if find "$release_dir" -name '._*' -print -quit | grep -q .; then
  fail "远端发布包包含 AppleDouble 文件"
fi
ln -s "$shared_env" "$release_dir/.env.staging"

for critical_path in \
  backend/alembic/versions \
  .env.example \
  deploy/compose.staging.yaml \
  deploy/nginx/partsignal.staging.conf.template \
  deploy/scripts/deploy-staging.sh
do
  test -e "$current_dir/$critical_path" ||
    fail "当前 release 缺少关键路径：$critical_path，请走完整流程"
  test -e "$release_dir/$critical_path" ||
    fail "待发布 release 缺少关键路径：$critical_path，请走完整流程"
  diff -qr "$current_dir/$critical_path" "$release_dir/$critical_path" >/dev/null ||
    fail "关键路径发生变化：$critical_path，请走包含备份和迁移的完整流程"
done

cd "$release_dir/deploy"
PARTSIGNAL_DEPLOY_MODE=fast PARTSIGNAL_VERSION="$release_id" \
  ./scripts/deploy-staging.sh
nginx -t
REMOTE

probe() {
  curl --fail --silent --show-error \
    --retry 12 --retry-all-errors --retry-delay 2 "$1"
}

stage "执行公网 live、ready 与首页检查"
probe "${public_url}/api/health/live" >/dev/null
probe "${public_url}/api/health/ready" >/dev/null
homepage=$(probe "${public_url}/")
case "$homepage" in
  *'<title>PartSignal'*) ;;
  *) fail "公网首页未返回 PartSignal 标题，拒绝切换 current" ;;
esac

stage "原子切换 current：$release_id"
ssh -F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=15 \
  "$ssh_host" sh -s "$release_id" <<'REMOTE'
set -eu

release_id=$1
release_root=/root/partsignal
target="releases/${release_id}"
next_link="${release_root}/.current-${release_id}"

test -d "${release_root}/${target}"
test ! -e "$next_link" && test ! -L "$next_link"
trap 'rm -f "$next_link"' 0
ln -s "$target" "$next_link"
mv -Tf "$next_link" "${release_root}/current"
test "$(readlink "${release_root}/current")" = "$target"
readlink "${release_root}/current"
REMOTE
