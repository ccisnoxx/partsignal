# Frontend V2 P9 外部 Staging Gate 实施计划

## 0. 当前状态

- [x] 规划前确认 clean `main`、无 active task、无遗留 `codex/frontend-v2-*` branch/worktree。
- [x] 固定候选提交为 `7c6e7c27de640a935662718a13ea49aa698609fe`，四个 P9.1 接入/文档/归档/journal 提交均已包含。
- [x] 已完成仓库、归档任务、Runbook、部署脚本、artifact、route/Auth/App Shell/权限的本地只读审计。
- [x] `prd.md`、`research/audit.md`、`design.md`、`implement.md`、`task.json` 和 context manifests 已形成。
- [x] 用户批准最终规划和 A 只读盘点。
- [x] 已运行 `task.py start` 并创建唯一 branch `codex/frontend-v2-phase-9-staging-activation-validation`。
- [x] A 只读盘点完成；证据见 `research/audit.md` 第 8 节。

当前只完成 A；用户已授权按本计划执行 B，但 B 仍被迁移后的 V1 rollback
不兼容和 `origin/main` 未对齐阻塞，不能执行。C/D 未授权；B 失败时只停止并报告，
不自动回滚。

## 1. 规划批准后的本地启动

仅在用户明确批准最新规划并授权 A 后执行：

```sh
python3 ./.trellis/scripts/task.py start frontend-v2-phase-9-staging-activation-validation
git switch -c codex/frontend-v2-phase-9-staging-activation-validation
```

性质：第一条只写 Trellis task status；第二条只创建已授权本地临时 branch。都不连接网络。创建前再次确认当前 branch 是 `main`，除本 task planning artifacts 外没有其他 dirty path；出现不认识的修改立即停止。

## 2. A — 只读盘点

### 2.1 本地来源与 SSH alias 解析

```sh
git rev-parse HEAD
git log --oneline --decorate -8
git merge-base --is-ancestor 87639ffb HEAD
git merge-base --is-ancestor f8d72aaa HEAD
git merge-base --is-ancestor c71c7ed7 HEAD
git merge-base --is-ancestor 7c6e7c27 HEAD
git worktree list --porcelain
git branch --list 'codex/frontend-v2-*'

ssh -G -F /Users/sc/.ssh/config hostdzire |
  awk '$1 == "hostname" || $1 == "user" || $1 == "port" { print }'
ssh -G -F /Users/sc/.ssh/config dmit |
  awk '$1 == "hostname" || $1 == "user" || $1 == "port" { print }'
```

性质：全部本地只读；`ssh -G` 只解析配置，不发起连接，且过滤掉 identity file 等无关字段。不得输出 SSH 私钥或读取 key 文件。

### 2.2 Hostdzire 身份、current、Compose 与 V1 image

执行一个只读 SSH 会话；命令不创建文件、容器或进程，不 reload/restart：

```sh
ssh -F /Users/sc/.ssh/config -o BatchMode=yes -o ConnectTimeout=15 hostdzire '
set -eu

printf "%s\n" "identity"
hostname
id -u
pwd
test -d /root/partsignal/releases
test -f /root/partsignal/shared/.env.staging
stat -c "%a|%U|%G|%n" /root/partsignal/shared/.env.staging
grep -Fx "APP_ENV=staging" /root/partsignal/shared/.env.staging
grep -Fx "APP_BASE_URL=https://geo.962850.xyz" /root/partsignal/shared/.env.staging
grep -Fx "CORS_ALLOWED_ORIGINS=https://geo.962850.xyz" /root/partsignal/shared/.env.staging

ps_current_target=$(readlink /root/partsignal/current)
ps_current_dir=$(readlink -f /root/partsignal/current)
case "$ps_current_dir" in
  /root/partsignal/releases/mvp-*) ;;
  *) printf "%s\n" "current target 非法" >&2; exit 1 ;;
esac
ps_current_release=$(basename "$ps_current_dir")
printf "%s\n" "current=${ps_current_target}" "release=${ps_current_release}"

ps_compose="$ps_current_dir/deploy/compose.staging.yaml"
test -f "$ps_compose"
grep -Fqx "name: partsignal-staging" "$ps_compose"
grep -Fqx "      context: ../frontend" "$ps_compose"
! grep -Fqx "      context: ../frontend-v2" "$ps_compose"
grep -Fqx "      - 127.0.0.1:19080:80" "$ps_compose"
sha256sum "$ps_compose"

(
  cd "$ps_current_dir"
  find . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 sha256sum
) | sha256sum

PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" config --quiet
PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" config --services
PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" ps

docker ps \
  --filter label=com.docker.compose.project=partsignal-staging \
  --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"
ps_frontend_container=$(docker ps -q \
  --filter label=com.docker.compose.project=partsignal-staging \
  --filter label=com.docker.compose.service=frontend)
test -n "$ps_frontend_container"
test "$(printf "%s\n" "$ps_frontend_container" | wc -l)" -eq 1
docker inspect --format "{{.Name}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}" \
  "$ps_frontend_container"

printf "%s\n" "v1-release-candidates"
for ps_release_compose in /root/partsignal/releases/*/deploy/compose.staging.yaml; do
  test -f "$ps_release_compose" || continue
  if grep -Fqx "      context: ../frontend" "$ps_release_compose"; then
    basename "$(dirname "$(dirname "$ps_release_compose")")"
  fi
done
'
```

性质与敏感边界：

| 命令族 | 性质 | 输出限制 |
| --- | --- | --- |
| `hostname/id/pwd/test/stat/readlink/basename` | 远程只读 | 只输出身份、权限与 release path。 |
| 三条 `grep -Fx` env | 远程只读 | 只允许输出固定非秘密 staging identity 行；禁止 `cat`/`env`/完整 grep。 |
| `sha256sum/find/sort/xargs` | 远程只读 | 只保留 aggregate checksum；不跟随 `.env.staging` symlink。 |
| `docker compose config --quiet/--services/ps` | 远程只读解析/状态查看 | 不输出完整 config/environment。 |
| `docker ps`、定向 `docker inspect --format` | 远程只读 | 只输出 name/tag/image ID/state；禁止未格式化 `docker inspect`，避免 env 泄露。 |

任一 `grep` 或唯一性断言失败即停止；不得改用“最接近的 release”。

### 2.3 Nginx owner、端口、DB 与 backup 前置

把 2.2 已确认的 release ID 作为非秘密参数传入：

```sh
ssh -F /Users/sc/.ssh/config -o BatchMode=yes -o ConnectTimeout=15 \
  hostdzire sh -s -- '<A_CONFIRMED_CURRENT_RELEASE>' <<'REMOTE'
set -eu
ps_current_release=$1
ps_current_dir="/root/partsignal/releases/${ps_current_release}"
ps_compose="$ps_current_dir/deploy/compose.staging.yaml"

ps_site=$(readlink -f /etc/nginx/sites-enabled/partsignal-staging.conf)
test "$ps_site" = /etc/nginx/sites-available/partsignal-staging.conf
test -f "$ps_site"
test -f /etc/nginx/snippets/partsignal-security-headers.conf
stat -c '%a|%U|%G|%n' "$ps_site" \
  /etc/nginx/snippets/partsignal-security-headers.conf
sha256sum "$ps_site" /etc/nginx/snippets/partsignal-security-headers.conf
grep -nE 'server_name geo\.962850\.xyz|server 127\.0\.0\.1:1900(0|1|80)|add_header Cache-Control' "$ps_site"
grep -nE 'Content-Security-Policy|Strict-Transport-Security|Cross-Origin-Opener-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy' \
  /etc/nginx/snippets/partsignal-security-headers.conf
nginx -t
ss -lnt | awk 'NR == 1 || /:19000|:19001|:19080|10\.0\.0\.2:80|10\.0\.0\.2:443/'

PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" exec -T postgres \
  psql -U partsignal -d partsignal -Atc \
  'select version_num from alembic_version'
PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" exec -T api alembic current
PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" exec -T api alembic heads
PARTSIGNAL_VERSION="$ps_current_release" \
  docker compose --env-file "$ps_current_dir/.env.staging" \
  -f "$ps_compose" exec -T api python -m app.cli preflight-integrity

test -d /root/partsignal/backups
stat -c '%a|%U|%G|%n' /root/partsignal/backups
find /root/partsignal/backups -maxdepth 1 -type f \
  -printf '%f|%s|%TY-%Tm-%TdT%TH:%TM:%TS%Tz\n' | sort | tail -10
df -B1 /root/partsignal /root/partsignal/backups /root/partsignal-data
REMOTE
```

性质：

- `readlink/stat/sha256sum/grep/ss/find/df` 是远程只读。
- `nginx -t` 只验证当前配置，不写配置、不 reload。
- `docker compose exec -T` 仅进入现有容器；SQL 只有 `SELECT`，Alembic 只有 `current/heads`，`preflight-integrity` 是仓库定义的只读命令。
- 明确禁止 `docker compose run`、`alembic upgrade/downgrade`、backup、build、pull、up、restart、reload。

### 2.4 本地候选对账

A 输出 current release 的 12 位 suffix 后，本地执行：

```sh
ps_candidate=7c6e7c27de640a935662718a13ea49aa698609fe
ps_current_suffix='<A_CONFIRMED_12_HEX_SUFFIX>'
ps_current_commit=$(git rev-parse "${ps_current_suffix}^{commit}")
test "$(git rev-list --all | grep -c "^${ps_current_suffix}")" -eq 1
git merge-base --is-ancestor "$ps_current_commit" "$ps_candidate"
git diff --name-status "$ps_current_commit" "$ps_candidate" -- \
  backend/alembic/versions deploy/compose.staging.yaml \
  deploy/nginx/partsignal.staging.conf.template \
  deploy/nginx/partsignal-security-headers.conf \
  deploy/scripts/deploy-staging.sh frontend frontend-v2
git log --oneline "$ps_current_commit..$ps_candidate" -- backend/alembic/versions
```

性质：本地只读。若 suffix 不唯一/不存在、不是 candidate ancestor，或 migration diff 无法证明 V1 兼容，停止。

### 2.5 公网匿名 baseline

```sh
ps_public_url=https://geo.962850.xyz
curl --fail --silent --show-error --retry 2 \
  --write-out 'remote_ip=%{remote_ip}\nstatus=%{http_code}\n' \
  --output /dev/null "$ps_public_url/"
curl --fail --silent --show-error -D - -o /dev/null \
  "$ps_public_url/api/health/live"
curl --fail --silent --show-error -D - -o /dev/null \
  "$ps_public_url/api/health/ready"
curl --silent --show-error -D - -o /dev/null \
  "$ps_public_url/api/v1/auth/me"
curl --fail --silent --show-error -D - -o /dev/null "$ps_public_url/"
curl --fail --silent --show-error -D - -o /dev/null "$ps_public_url/login"
```

性质：公网匿名只读 HTTP。只记录 status、remote IP、headers；不发送 cookie/Authorization，不输出 response body 中的业务数据。

### 2.6 A 结果与停止点

A 完成后更新 `research/audit.md` 和 `task.json.meta`，报告：

- `CONFIRMED/UNCONFIRMED` staging identity；
- current release/full commit/source checksum；
- frontend tag/image ID、Compose/Nginx owner；
- DB current/candidate head、pending migrations、preflight/backup capacity；
- 精确 V1 rollback release/tag/image ID/checksum/command；
- DMIT、credential 等仍不可确认事实。

此处必须停止，等待用户批准 Git 来源同步、条件 D 和 B。A 不自动进入 B。

Observed：A 于 2026-08-25 完成。Hostdzire runtime 与公网 staging URL 已确认；DMIT 生效配置未直接确认。当前 V1 artifact 精确存在，但候选 `0043` 迁移后的旧 backend 写兼容性不成立，因此没有满足 design 第 4 节全部条件的安全整栈 rollback target。按门禁停止，不请求或执行 B。

## 3. B 前 Git 与 rollback 授权门禁

当前状态：`BLOCKED`。只有另行审查并批准一个既保留 V1 UI 回退能力、又不把旧 backend 接到 `0043` 数据库的精确方案后，才可继续本节；不得把下面的来源同步或 B 命令视为已获授权。

### 3.1 建议提交 planning + A evidence

A 后先运行：

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-9-staging-activation-validation
```

展示 commit plan，获确认后在临时 branch 提交 planning/A evidence，使工作树可安全切回 clean `main`。建议提交：

```text
docs(task): 规划 frontend v2 staging gate
```

文件仅包括本 task artifacts；不包括产品、部署实现或权威 Gate 文档。

### 3.2 候选来源同步

切回 `main` 后，只有单独 Git 授权才执行 Runbook 的来源同步。必须保持 candidate 不变：

```sh
git switch main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = 7c6e7c27de640a935662718a13ea49aa698609fe

# 只有用户另行授权 push/pull 后才执行。
git push origin main
git pull --ff-only origin main

test "$(git rev-parse HEAD)" = 7c6e7c27de640a935662718a13ea49aa698609fe
test "$(git rev-parse origin/main)" = 7c6e7c27de640a935662718a13ea49aa698609fe
```

任何 non-fast-forward、remote drift 或候选变化都停止；不 rebase/merge/reset/force push。

### 3.3 条件 D 预授权

B 前向用户展示 A 冻结的：

- `<PREVIOUS_V1_RELEASE>`；
- image tag/image ID、source checksum；
- DB revision/compatibility；
- 第 7 节精确 rollback 命令和触发条件。

没有针对该精确 target 的 D 预授权，不启动 B。

## 4. B — 完整 staging 激活（当前禁止执行）

### 4.1 本地 archive

以下命令只在 clean `main`、Git 来源已同步且用户批准 B 后执行：

```sh
set -eu
ps_candidate=7c6e7c27de640a935662718a13ea49aa698609fe
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$ps_candidate"
test "$(git rev-parse origin/main)" = "$ps_candidate"
node deploy/scripts/check-nginx-security.mjs

ps_release_id="mvp-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 "$ps_candidate")"
ps_archive=$(mktemp "${TMPDIR:-/tmp}/partsignal-p9-staging.XXXXXX")
git archive --format=tar.gz --output="$ps_archive" "$ps_candidate"
test -s "$ps_archive"
tar -tzf "$ps_archive" | grep -qx '.env.example'
if tar -tzf "$ps_archive" | grep -Eq '^(\.agents|\.codex|\.playwright-cli|\.trellis)/'; then
  printf '%s\n' '发布包包含开发代理、Trellis 或浏览器临时文件' >&2
  exit 1
fi
ps_bad_entries=$(
  tar -tzf "$ps_archive" |
    awk '{
      lower = tolower($0)
      if ($0 ~ /(^|\/)\._/ ||
          ($0 ~ /(^|\/)\.env($|\.)/ && $0 !~ /(^|\/)\.env\.example$/) ||
          lower ~ /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/ ||
          lower ~ /(^|\/)[^\/]*(private[^\/]*key|\.pem|\.key)$/) print
    }'
)
test -z "$ps_bad_entries" || { printf '%s\n' "$ps_bad_entries" >&2; exit 1; }
shasum -a 256 "$ps_archive"
printf '%s\n' "$ps_release_id"
```

性质：本地只读 Git + 创建一个本地临时 archive。该临时文件是发布所必需且会在上传后精确删除；不包含工作树或 secret。

### 4.2 上传并准备 immutable release

```sh
scp -F /Users/sc/.ssh/config "$ps_archive" \
  "hostdzire:/root/partsignal/.incoming-${ps_release_id}.tar.gz"
rm -f "$ps_archive"

ssh -F /Users/sc/.ssh/config hostdzire sh -s -- "$ps_release_id" <<'REMOTE'
set -eu
ps_release_id=$1
printf '%s\n' "$ps_release_id" |
  grep -Eq '^mvp-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$'
ps_release_dir="/root/partsignal/releases/${ps_release_id}"
ps_remote_archive="/root/partsignal/.incoming-${ps_release_id}.tar.gz"
ps_env=/root/partsignal/shared/.env.staging
test "$(id -u)" -eq 0
test -f "$ps_remote_archive"
test -f "$ps_env"
test "$(stat -c '%a' "$ps_env")" = 600
test ! -e "$ps_release_dir" && test ! -L "$ps_release_dir"
mkdir "$ps_release_dir"
tar -xzf "$ps_remote_archive" -C "$ps_release_dir"
rm "$ps_remote_archive"
test -f "$ps_release_dir/.env.example"
! find "$ps_release_dir" -name '._*' -print -quit | grep -q .
ln -s "$ps_env" "$ps_release_dir/.env.staging"
REMOTE
```

性质：`scp/mkdir/tar/rm/ln` 是 B 已授权的远程写；只创建一个不可覆盖 release并删除对应 incoming archive。不得修改 shared env、旧 release 或 `current`。

### 4.3 Fresh backup + full deploy

```sh
ssh -F /Users/sc/.ssh/config hostdzire sh -s -- "$ps_release_id" <<'REMOTE'
set -eu
ps_release_id=$1
ps_release_dir="/root/partsignal/releases/${ps_release_id}"
cd "$ps_release_dir/deploy"
set -a
. ../.env.staging
set +a
export PARTSIGNAL_VERSION="$ps_release_id"
export BACKUP_DIR=/root/partsignal/backups
export COMPOSE_FILE=compose.staging.yaml
ps_backup=$(./scripts/backup.sh)
test -s "$ps_backup"
printf '%s\n' "backup=$ps_backup"

PARTSIGNAL_VERSION="$ps_release_id" ./scripts/deploy-staging.sh
nginx -t

PARTSIGNAL_VERSION="$ps_release_id" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml ps
PARTSIGNAL_VERSION="$ps_release_id" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  exec -T postgres psql -U partsignal -d partsignal -Atc \
  'select version_num from alembic_version'

ps_frontend_container=$(docker ps -q \
  --filter label=com.docker.compose.project=partsignal-staging \
  --filter label=com.docker.compose.service=frontend)
test -n "$ps_frontend_container"
docker inspect --format '{{.Name}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}' \
  "$ps_frontend_container"
readlink /root/partsignal/current
REMOTE
```

性质：backup、build、container replace、migration、seed 是远程写。`deploy-staging.sh` 必须使用默认 `full`；不得设置 `PARTSIGNAL_DEPLOY_MODE=fast`。Nginx 只 test，不 install/reload。最后一行证明 `current` 仍是 A 的 V1 record。

任何步骤失败：立即停止 B，保留 V2 release 现场并报告失败点、服务替换范围与当时已确认的回滚边界。不得自动执行第 7 节；只有失败后用户另行明确授权，且已有安全的精确 D 命令时才可回滚。

### 4.4 B core HTTP gate

```sh
deploy/scripts/smoke.sh https://geo.962850.xyz
curl --fail --silent --show-error https://geo.962850.xyz/ |
  grep -o '<title>[^<]*'

ps_asset_path=$(curl --fail --silent https://geo.962850.xyz/ |
  sed -n 's#.*src="\(/assets/[^"]*\.js\)".*#\1#p')
test -n "$ps_asset_path"
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  "https://geo.962850.xyz${ps_asset_path}"
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/index.html
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/login
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  https://geo.962850.xyz/assets/partsignal-p9-missing.js)" = 404
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "https://geo.962850.xyz${ps_asset_path}.map")" = 404
! curl --fail --silent --show-error \
  "https://geo.962850.xyz${ps_asset_path}" | grep -q 'sourceMappingURL'
```

性质：公网匿名只读。逐项人工核对 design 第 7 节所有 cache/security/content-type 断言，不只检查 exit code。任一失败即停止并报告，记为命中 D 条件但不得自动回滚；不进入 C。

此处停止，等待 C 授权与 credential 准备。

## 5. C — 浏览器验收

### 5.1 前置

- 用户明确批准 C，并说明是否包含专用 must-change account 的一次密码变更。
- 用户批准仓库外 `0600` credential file path；文件由用户创建，agent 只验证 path/mode，不读取或输出内容。
- 执行前重新完整读取 `.agents/skills/playwright-cli/SKILL.md`。
- `playwright-cli list --all --json` 不存在同名 open session。
- 禁止 trace、video、screenshot、state-save；不在服务器安装浏览器。

### 5.2 Session 与 runtime audit

固定 session：

```sh
playwright-cli -s=frontend-v2-p9-staging-activation-validation \
  open https://geo.962850.xyz/login
```

使用无 secret 的 task-owned `run-code --filename` helper：

- 注册 `console(error|warning)`、`pageerror`、`requestfailed` 和页面 `securitypolicyviolation` 收集；请求只记录 method+pathname+errorText，不记录 query/header/body。
- credential helper 在 Node 内存读取批准文件并一次完成 fill+submit；失败先清空 password input。
- 角色顺序：anonymous → ADMIN → logout → ENGINEER → logout → must-change（若获 auth-write 授权）→ logout。
- 每个角色执行 design 第 8 节 matrix；Workspace ID 只从实际列表 link 获取。
- 每次 direct/reload/back/forward 后检查 page title/heading/focus、同源 API 和新加载 route chunks。
- 最后输出脱敏 runtime summary；任何 credential substring 检查只返回 boolean/count，不把 secret 作为 matcher failure operand。

不得使用 `playwright-cli requests` 查看 login/change-password 请求详情；不得抓密码页 snapshot/screenshot。普通 CLI command 自动 snapshot 只在密码提交并离开密码页后返回。

### 5.3 关闭和确认

无论 PASS/FAIL/BLOCKED：

```sh
playwright-cli -s=frontend-v2-p9-staging-activation-validation close
playwright-cli list --all --json
```

同名 session 仍为 open 时不能结束任务；不得用 `close-all` 或 `kill-all`。

### 5.4 C 成功后的条件 `current` 更新

只有全部 HTTP/browser Required 通过，才执行 B 已批准的条件尾声：

```sh
ssh -F /Users/sc/.ssh/config hostdzire sh -s -- "$ps_release_id" <<'REMOTE'
set -eu
ps_release_id=$1
ps_next_link="/root/partsignal/.current-${ps_release_id}"
test -d "/root/partsignal/releases/${ps_release_id}"
test ! -e "$ps_next_link" && test ! -L "$ps_next_link"
ln -s "releases/${ps_release_id}" "$ps_next_link"
mv -Tf "$ps_next_link" /root/partsignal/current
test "$(readlink /root/partsignal/current)" = "releases/${ps_release_id}"
REMOTE

deploy/scripts/smoke.sh https://geo.962850.xyz
```

性质：原子更新最后验收记录是远程写；不切容器。最后 smoke 是公网只读。失败则停止并报告、把 Gate 判为 `NOT_MET`，不得自动执行 D。

## 6. Staging Gate 判定与文档

### `MET`

只有下列同时成立：

1. A identity/owner/current/DB/V1 rollback 全 confirmed；
2. B 固定 candidate full deploy、backup、migration、service/core smoke 全绿；
3. HTTP cache/CSP/chunk/fallback/source map matrix 全绿；
4. C anonymous/ADMIN/ENGINEER/must-change（含获批 auth-write）/deep-link/history/runtime matrix 全绿；
5. `current` 精确记录 V2 release；
6. V1 source、old release、tag/image ID 与回滚命令仍可用；
7. 没有 open P0/P1/P2 blocker，未触发 rollback。

### `NOT_MET`

任一 Required 失败/不可运行、凭据或外部事实缺失、触发 D、V2 未保持激活、`current` 未完成或 V1 基线破坏。V1 恢复成功不改变 NOT_MET。

### `PENDING`

等待 A/B/C/D/Git 授权或阶段尚未执行。不能写成“部分 MET”。

### 文档更新

- 更新本 task artifacts 的 observed commands、时间、release/commit/image/checksum、结果与 Gate。
- 更新 `docs/frontend-v2/07-migration-plan.md` Phase 9 P9.1 外部 Gate记录。
- 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md` Deployment Smoke evidence。
- 只有 A/B 证明现行 Runbook 与真实 owner 不一致时，才最小更新 Hostdzire 主文档/附录；否则明确 `unchanged`。
- 不修改 product/backend/OpenAPI/database/permission/production 文档。

## 7. D — 精确 V1 回滚

下列是规划前基于“旧整栈与迁移后数据库兼容”假设形成的命令。A 已证明该假设不成立：artifact 候选虽精确为 `mvp-20260806-195740-afb1b8c82f40`，但旧 backend 不写 `0043` 强制的 `platform_profile_id_snapshot`。因此本段命令当前明确禁止执行，也不能据此批准 B；本任务目前没有安全的精确 D 命令。

```sh
ssh -F /Users/sc/.ssh/config hostdzire sh -s -- \
  '<PREVIOUS_V1_RELEASE>' <<'REMOTE'
set -eu
ps_previous_release=$1
printf '%s\n' "$ps_previous_release" |
  grep -Eq '^mvp-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$'
ps_previous_dir="/root/partsignal/releases/${ps_previous_release}"
test -d "$ps_previous_dir"
grep -Fqx '      context: ../frontend' \
  "$ps_previous_dir/deploy/compose.staging.yaml"
cd "$ps_previous_dir/deploy"
PARTSIGNAL_VERSION="$ps_previous_release" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  config --quiet
PARTSIGNAL_VERSION="$ps_previous_release" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait worker scheduler api frontend fake-oss
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19000/api/health/ready >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 2 \
  http://127.0.0.1:19080/ >/dev/null
nginx -t

ps_next_link="/root/partsignal/.current-${ps_previous_release}"
if test "$(readlink /root/partsignal/current)" != "releases/${ps_previous_release}"; then
  test ! -e "$ps_next_link" && test ! -L "$ps_next_link"
  ln -s "releases/${ps_previous_release}" "$ps_next_link"
  mv -Tf "$ps_next_link" /root/partsignal/current
fi
test "$(readlink /root/partsignal/current)" = \
  "releases/${ps_previous_release}"
REMOTE

deploy/scripts/smoke.sh https://geo.962850.xyz
```

执行边界：

- `up -d --wait` 和必要的 `current` 记录恢复是 D 远程写；其余为验证。
- 不执行 `build`、migrate、seed、DB downgrade、Nginx install/reload、DNS/DMIT 操作。
- 不删除失败 V2 release、V2 image、backup 或持久数据。
- 回滚后如公网/login/V1 core route仍失败，停止并保留现场；不现场改配置。

## 8. Required Validation 与提交范围

### Required

```sh
git diff --check
python3 -m json.tool \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-activation-validation/task.json \
  >/dev/null
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-9-staging-activation-validation
```

外部 Required 是 A/B/C/D 各节命令和 Gate matrix，不以本地 product test 替代。

### 明确不运行

- `make verify`：P9.1 Repository Gate 已在固定候选通过，本任务不改产品/contract/build owner；本任务验证真实 staging。
- 本地 E2E/real-stack：不能证明 outer Nginx/public topology，且会重复已完成 Repository Gate。
- fast deploy：被本任务明确禁止。

### 最终建议提交

在 task branch 上形成最多两个 docs-only commit：

1. `docs(task): 规划 frontend v2 staging gate`
   - 本 task 的 `prd.md`、`research/audit.md`、`design.md`、`implement.md`、`task.json`、`implement.jsonl`、`check.jsonl`。
2. `docs(frontend-v2): 记录外部 staging gate`
   - 实际执行后更新的 task evidence；
   - `docs/frontend-v2/07-migration-plan.md`；
   - `docs/frontend-v2/08-testing-quality-and-acceptance.md`；
   - 仅在证据证明 stale 时包含两份 Hostdzire Runbook。

每次提交前展示精确 plan 并取得确认。不包含 product/backend/contracts/schema/production，不 push、不建 PR。完成并经用户确认后才把临时 branch 合回本地 `main` 并删除本地 branch；不自动 push。
