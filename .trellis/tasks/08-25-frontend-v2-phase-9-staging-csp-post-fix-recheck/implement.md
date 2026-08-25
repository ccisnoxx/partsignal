# Frontend V2 Phase 9 Staging CSP post-fix recheck 实施计划

## 当前状态

- [x] 从 clean `main` 固定 candidate `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`。
- [x] 创建已授权 Trellis Task 与唯一临时分支。
- [x] 完成本地 Git、Hostdzire runtime/artifact/protected state 与公网 HTTP 只读盘点。
- [x] 形成可 review 的 PRD、design、implement 与 inventory。
- [ ] 用户审核最新规划并明确批准进入实施。
- [ ] 取得 commit、push、Staging 部署、真实凭据登录和成功后更新 `current` 的分阶段授权。

## 阶段 0：规划与来源门禁

本轮停在 planning，不运行 `task.py start`。批准后先按 Trellis 进入实施，再在任何远端写操作前满足：

```sh
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = 2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9
test "$(git rev-parse origin/main)" = 2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9
test "$(git ls-remote origin refs/heads/main | cut -f1)" = \
  2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9
```

当前 live origin 仍为 `0e472399...`。唯一计划 push 是非强制：

```sh
git push origin main:main
```

push 必须在用户单独授权后执行；push 前重查 live origin 未漂移且它仍是 fixed candidate 祖先。

## 阶段 1：固定 release 归档

本机精确身份：

```sh
ps_candidate_commit=2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9
ps_candidate_release=mvp-20260825-172239-2a6fd940b848
ps_archive=$(mktemp "${TMPDIR:-/tmp}/partsignal-full.XXXXXX")

test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$ps_candidate_commit"
test "$(git rev-parse origin/main)" = "$ps_candidate_commit"
node deploy/scripts/check-nginx-security.mjs
git archive --format=tar.gz --output="$ps_archive" "$ps_candidate_commit"
test -s "$ps_archive"
tar -tzf "$ps_archive" | grep -qx '.env.example'
if tar -tzf "$ps_archive" | grep -Eq '^(\.agents|\.codex|\.playwright-cli|\.trellis)/'; then
  exit 1
fi
ps_bad_entries=$(
  tar -tzf "$ps_archive" |
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
test -z "$ps_bad_entries"
shasum -a 256 "$ps_archive"
scp -F /Users/sc/.ssh/config "$ps_archive" \
  "hostdzire:/root/partsignal/.incoming-${ps_candidate_release}.tar.gz"
```

Hostdzire 准备 release 的精确命令：

```sh
set -eu
ps_candidate_release=mvp-20260825-172239-2a6fd940b848
ps_release_dir="/root/partsignal/releases/$ps_candidate_release"
ps_archive="/root/partsignal/.incoming-${ps_candidate_release}.tar.gz"
ps_env=/root/partsignal/shared/.env.staging

test "$(id -u)" -eq 0
test -f "$ps_archive"
test -f "$ps_env"
test "$(stat -c '%a' "$ps_env")" = 600
test ! -e "$ps_release_dir" && test ! -L "$ps_release_dir"
mkdir "$ps_release_dir"
tar -xzf "$ps_archive" -C "$ps_release_dir"
rm "$ps_archive"
test -f "$ps_release_dir/.env.example"
! find "$ps_release_dir" -name '._*' -print -quit | grep -q .
ln -s "$ps_env" "$ps_release_dir/.env.staging"
```

## 阶段 2：运行态变化前门禁

先只读复核旧 candidate 的 V1 image、backup 与 audit 仍存在，再为新 candidate 记录 before snapshot。随后在 migration/full deploy 前构建新的 candidate-aligned V1：

```sh
set -eu
ps_candidate_release=mvp-20260825-172239-2a6fd940b848
ps_audit_dir="/root/partsignal/csp-post-fix-$ps_candidate_release"
test ! -e "$ps_audit_dir"
mkdir "$ps_audit_dir"
chmod 0700 "$ps_audit_dir"

ps_snapshot_runtime() {
  ps_snapshot_file=$1
  {
    for ps_service in postgres redis fake-oss api worker scheduler frontend
    do
      ps_container_id=$(docker ps -aq \
        --filter label=com.docker.compose.project=partsignal-staging \
        --filter label=com.docker.compose.service="$ps_service" | head -n 1)
      test -n "$ps_container_id"
      printf '%s|' "$ps_service"
      docker inspect --format \
        '{{.Id}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}|{{.RestartCount}}' \
        "$ps_container_id"
    done
    for ps_service in postgres redis api worker scheduler
    do
      ps_container_id=$(docker ps -q \
        --filter label=com.docker.compose.project=partsignal-staging \
        --filter label=com.docker.compose.service="$ps_service" | head -n 1)
      printf 'health|%s|' "$ps_service"
      docker inspect --format '{{.State.Health.Status}}' "$ps_container_id"
    done
    docker ps -aq \
      --filter label=com.docker.compose.project=partsignal-staging \
      --filter label=com.docker.compose.service=migrate |
      sort |
      while IFS= read -r ps_migrate_id
      do
        test -z "$ps_migrate_id" || docker inspect --format \
          'migrate|{{.Id}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}' \
          "$ps_migrate_id"
      done
    ps_postgres=$(docker ps -q \
      --filter label=com.docker.compose.project=partsignal-staging \
      --filter label=com.docker.compose.service=postgres | head -n 1)
    printf 'alembic_version|'
    docker exec "$ps_postgres" psql -U partsignal -d partsignal -Atc \
      'select version_num from alembic_version'
    printf 'current|%s\n' "$(readlink /root/partsignal/current)"
    printf 'nginx_target|%s\n' \
      "$(readlink -f /etc/nginx/sites-enabled/partsignal-staging.conf)"
    sha256sum \
      /etc/nginx/sites-enabled/partsignal-staging.conf \
      /etc/nginx/snippets/partsignal-security-headers.conf
  } >"$ps_snapshot_file"
}

nginx -t
ps_snapshot_runtime "$ps_audit_dir/before-full.txt"
```

快照只记录非敏感身份与状态，不读取 container environment。

随后构建 V1 artifact：

```sh
set -eu
ps_candidate_release=mvp-20260825-172239-2a6fd940b848
ps_release_dir="/root/partsignal/releases/$ps_candidate_release"
ps_v1_image="partsignal-frontend-v1:$ps_candidate_release"

cd "$ps_release_dir"
docker build --file frontend/Dockerfile --tag "$ps_v1_image" frontend
ps_v1_image_id=$(docker image inspect --format '{{.Id}}' "$ps_v1_image")
case "$ps_v1_image_id" in sha256:*) ;; *) exit 1 ;; esac
printf 'V1_UI_IMAGE=%s\nV1_UI_IMAGE_ID=%s\n' \
  "$ps_v1_image" "$ps_v1_image_id"
```

已有数据必须创建本次 fresh backup：

```sh
cd "$ps_release_dir/deploy"
set -a
. ../.env.staging
set +a
export PARTSIGNAL_VERSION="$ps_candidate_release"
export BACKUP_DIR=/root/partsignal/backups
export COMPOSE_FILE=compose.staging.yaml
ps_backup=$(./scripts/backup.sh)
test -s "$ps_backup"
sha256sum "$ps_backup"
```

## 阶段 3：完整部署

唯一入口：

```sh
cd /root/partsignal/releases/mvp-20260825-172239-2a6fd940b848/deploy
PARTSIGNAL_VERSION=mvp-20260825-172239-2a6fd940b848 \
  ./scripts/deploy-staging.sh
```

禁止设置 `PARTSIGNAL_DEPLOY_MODE=fast`。完成后冻结：

```sh
ps_backend_image=partsignal-backend:mvp-20260825-172239-2a6fd940b848
ps_v2_image=partsignal-frontend:mvp-20260825-172239-2a6fd940b848
ps_backend_image_id=$(docker image inspect --format '{{.Id}}' "$ps_backend_image")
ps_v2_image_id=$(docker image inspect --format '{{.Id}}' "$ps_v2_image")
case "$ps_backend_image_id" in sha256:*) ;; *) exit 1 ;; esac
case "$ps_v2_image_id" in sha256:*) ;; *) exit 1 ;; esac
printf 'BACKEND_IMAGE_ID=%s\nV2_UI_IMAGE_ID=%s\n' \
  "$ps_backend_image_id" "$ps_v2_image_id"
ps_snapshot_runtime "$ps_audit_dir/after-full.txt"
cp "$ps_audit_dir/after-full.txt" "$ps_audit_dir/candidate-protected.txt"
```

阶段 2–3 在同一个 Hostdzire shell 中执行，因此复用已定义的 `ps_snapshot_runtime` 与 `ps_audit_dir`。`before-full.txt` 与 `after-full.txt` 按 design 的允许变化矩阵逐项审查，不做错误的全量 `cmp`。不更新 Nginx 文件，不 reload；只执行 `nginx -t`、target/checksum、容器、DB revision、`current` 和 protected snapshot 核对。

## 阶段 4：HTTP Gate

按以下矩阵逐项记录状态、headers、artifact 和容器身份：

| 类别 | 路径/检查 | 通过条件 |
| --- | --- | --- |
| 健康 | loopback/public live、ready | 全部 200，ready dependencies=`ok` |
| 匿名 session | `/api/v1/auth/me` | 204 |
| SPA | `/`、`/index.html`、`/login`、业务代表 deep links | 200、V2 index、`no-cache` |
| artifact | 实际 HTML 引用的全部 JS/CSS | 200、hashed、immutable、`Vary: Accept-Encoding` |
| source map | missing asset、主 JS `.map`、容器文件与 JS 内容 | 404、0 个 `.map`、无 `sourceMappingURL` |
| security | HTML/JS/CSS headers | CSP/Trusted Types/HSTS/COOP/DENY/nosniff/referrer 唯一正确 |
| identity | frontend container/image/release | 精确等于新 candidate V2 image ID |
| stability | 6 次、间隔 6 秒公网与回环 ready | 全通过；窗口内无新 premature-close |

任一失败立即停止，不创建 `playwright-cli` session。

## 阶段 5：Browser Gate

HTTP Gate 全绿且取得真实凭据登录授权后，读取项目 `playwright-cli` skill，创建唯一 session：

```text
frontend-v2-p9-staging-csp-post-fix-recheck
```

### 5.1 blocker-specific

| 项目 | Required |
| --- | --- |
| 匿名 `/login` | 标题、heading、用户名、密码、登录按钮可见可用 |
| Auth probe | `/api/v1/auth/me=204` |
| CSP | `securitypolicyviolation=0`、TrustedScript error=0 |
| Runtime | `console.error=0`、`pageerror=0`、非预期 requestfailed=0 |

### 5.2 完整矩阵

| 类别 | 路径/行为 |
| --- | --- |
| ADMIN Auth | `/login` 登录、`/` session restore、logout |
| ENGINEER Auth | 登录、System/ADMIN 路由保持 URL 并显示服务端 403 |
| Workbench | `/` 与一个现有 attention link |
| Products | `/products` 与页面现有的代表 detail/facts link |
| Content | `/content/tasks` 与页面现有的代表 detail/editor/review link |
| Publishing | `/publishing/work` 与页面现有的代表 workspace link |
| GEO | `/geo/observations` 与页面现有的 detail/insights link |
| Configuration | `/settings/platforms`、`/settings/ai` |
| System | `/system/users`、`/system/audit` |
| History | 代表路由 direct、refresh、Back、Forward |
| Responsive | 375、768、1024、1440 的代表 shell/list/workspace |
| Accessibility | 登录、导航、菜单/链接、代表焦点恢复的 keyboard/focus 基础行为 |
| Runtime | 全过程 CSP/TrustedScript/console/page/request/失败静态资源审计 |

任一 Required 项失败立即停止剩余矩阵并记录 `NOT_MET`。结束前 logout、关闭专属 session，并用 session list 证明无遗留 browser/server。

## 阶段 6：protected state 与 `current`

Browser Gate 后重新拍 protected snapshot，确认没有未授权变化。只有全部 Gate 通过、open P0/P1/P2=`0/0/0` 且用户针对精确 release 单独授权后，才运行：

```sh
ps_snapshot_runtime "$ps_audit_dir/after-browser.txt"
cmp "$ps_audit_dir/candidate-protected.txt" \
  "$ps_audit_dir/after-browser.txt"
```

上述 `cmp` 通过后，才进入单独授权的 `current` 命令：

```sh
set -eu
ps_candidate_release=mvp-20260825-172239-2a6fd940b848
ps_next="/root/partsignal/.current-$ps_candidate_release"
test -d "/root/partsignal/releases/$ps_candidate_release"
test ! -e "$ps_next" && test ! -L "$ps_next"
ln -s "releases/$ps_candidate_release" "$ps_next"
mv -Tf "$ps_next" /root/partsignal/current
test "$(readlink /root/partsignal/current)" = \
  "releases/$ps_candidate_release"
```

## Required Validation

规划阶段：

```sh
git diff --check
python3 -m json.tool \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-csp-post-fix-recheck/task.json >/dev/null
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-csp-post-fix-recheck
```

实施阶段 Required 为阶段 0–6 的真实观察结果与 Gate matrix。产品修复已在固定 candidate 中验证，本 Task 不改产品/contract/deploy owner，因此不重复 `make verify`；真实 Staging Gate 不能由本地 full suite 替代。

## Optional Validation

无。

## 提交边界

本 Task 当前只产生 planning/inventory 文件。提交前展示精确 commit plan 并等待确认；不自动 commit、push、merge、archive 或开始后续 Task。
