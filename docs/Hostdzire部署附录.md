# PartSignal Hostdzire 部署附录

本文档是 Hostdzire 预发布低频操作的唯一事实源，承接首次初始化、共享环境文件生成、完整手工发布、备份恢复验证、Nginx 更新、完整浏览器验收、回滚和详细排障。日常普通代码发布请直接使用[主 Runbook](./Hostdzire部署上线流程.md)，跨环境原则见[部署与运维](./operations.md)。

本附录描述现有仓库脚本和 Compose，不创建第二套部署机制，也不授权连接服务器。执行任何真实远端操作前仍需获得相应授权。

## 1. 权威来源与边界

低频操作以当前已推送 `origin/main` 中的以下文件为准：

- `.env.example`
- `backend/alembic/versions/`
- `deploy/compose.staging.yaml`
- `deploy/nginx/partsignal.staging.conf.template`
- `deploy/scripts/deploy-staging.sh`
- `deploy/scripts/backup.sh`
- `deploy/scripts/restore-verify.sh`
- `deploy/scripts/smoke.sh`

不得从旧 release、临时 worktree、其他分支或本文复制脚本内容替代仓库事实源。

固定目录和运行边界：

| 项目 | 值或约束 |
| --- | --- |
| release 根目录 | `/root/partsignal/releases`，每个 release 不可覆盖 |
| 共享环境文件 | `/root/partsignal/shared/.env.staging`，权限 `0600` |
| 备份目录 | `/root/partsignal/backups` |
| 持久数据 | `/root/partsignal-data`，不得随 release 切换或删除 |
| Compose 项目 | `partsignal-staging` |
| 宿主机回环端口 | API `19000`、开发对象存储 `19001`、前端 `19080` |

PostgreSQL 和 Redis 不发布宿主机端口。`fake-oss` 必须同时连接 internal 与 edge 网络；staging 不注入生产 OSS 或生产模型凭据。Redis 只承担 Celery Broker，PostgreSQL 是业务状态唯一来源。

## 2. SSH 与凭据安全

所有 SSH 示例显式使用 `/Users/sc/.ssh/config`。`hostdzire` 是上传、目录、Compose、Nginx、环境文件和 `current` 的唯一写入目标；`dmit` 只允许第 6.3 节的公网入口只读诊断。

首次连接先只读确认目标身份：

```sh
ssh -F /Users/sc/.ssh/config hostdzire 'hostname; id; pwd'
```

OpenSSH 配置管理主机、端口、身份文件、主机密钥验证和连接复用。不得读取、复制或输出私钥。出现主机密钥冲突必须停止；只有通过 VPS 控制台等可信渠道核对指纹且获得明确指示后，才能处理旧记录，不能自动接受新密钥。

真实环境文件、数据库密码、会话密钥、上传密钥、账号密码和 `AI_CREDENTIAL_ENCRYPTION_KEY` 不得进入仓库、发布包、普通日志、对话或临时文件。正常升级只链接既有共享环境文件，不复制、下载或重新生成其中的密钥。

## 3. 首次初始化

本节只在 Hostdzire 首次启用当前部署机制时执行；正常升级不得重复执行。

### 3.1 基础设施与目录

通过操作系统和供应商维护的渠道安装 Docker Engine、Docker Compose 插件、Nginx、OpenSSL、PostgreSQL 客户端、gzip 和 curl，不使用来源不明的管道安装脚本。

进入 Hostdzire 后确认基础能力、证书片段和资源：

```sh
docker version
docker compose version
nginx -v
openssl version
psql --version
gzip --version
curl --version
systemctl is-active nginx
df -h /
free -h

test -f /etc/nginx/snippets/acme-challenge.conf
test -f /etc/nginx/snippets/cert-962850.xyz.conf
test -f /etc/nginx/snippets/ssl-common.conf
test -f /etc/nginx/snippets/security-headers-web.conf
```

确认没有端口冲突后，在 Hostdzire 创建受保护目录：

```sh
set -eu
mkdir -p /root/partsignal/releases /root/partsignal/shared \
  /root/partsignal/backups /root/partsignal-data
chmod 700 /root/partsignal/shared /root/partsignal/backups
```

不得占用其他服务端口；PartSignal 只使用主 Runbook 记录的三个回环端口。

### 3.2 首次生成共享环境文件

先以待部署 `origin/main` 的 `.env.example` 只读核对必填项，不在本地仓库创建 `.env.staging`。以下命令只在 Hostdzire 执行，且只允许创建不存在的目标文件：

```sh
set -eu
ENV_FILE=/root/partsignal/shared/.env.staging
test ! -e "$ENV_FILE"
umask 077

DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 48)
UPLOAD_SECRET=$(openssl rand -hex 48)
ADMIN_PASSWORD=$(openssl rand -hex 18)
ENGINEER_PASSWORD=$(openssl rand -hex 18)
AI_KEY=$(openssl rand 32 | openssl base64 -A)

printf '%s\n' \
  'APP_ENV=staging' \
  'APP_BASE_URL=https://geo.962850.xyz' \
  'API_BASE_URL=http://api:8000' \
  'LOG_LEVEL=INFO' \
  "DATABASE_URL=postgresql+psycopg://partsignal:${DB_PASSWORD}@postgres:5432/partsignal" \
  'POSTGRES_DB=partsignal' \
  'POSTGRES_USER=partsignal' \
  "POSTGRES_PASSWORD=${DB_PASSWORD}" \
  'REDIS_URL=redis://redis:6379/0' \
  "SESSION_SECRET=${SESSION_SECRET}" \
  'SESSION_COOKIE_SECURE=true' \
  "PARTSIGNAL_SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
  "PARTSIGNAL_SEED_ENGINEER_PASSWORD=${ENGINEER_PASSWORD}" \
  'CELERY_CONCURRENCY=1' \
  'CONTENT_GENERATOR=deterministic' \
  "AI_CREDENTIAL_ENCRYPTION_KEY=${AI_KEY}" \
  'AI_ALLOW_LOCAL_HTTP=false' \
  'GENERATION_PENDING_REDISPATCH_SECONDS=120' \
  'GENERATION_FINALIZE_GRACE_SECONDS=120' \
  'GENERATION_RECOVERY_BATCH_SIZE=100' \
  'GENERATION_RECOVERY_SCAN_SECONDS=60' \
  'OBJECT_STORAGE_BACKEND=development' \
  'OBJECT_STORAGE_ENDPOINT=http://fake-oss:9000' \
  'OBJECT_STORAGE_PUBLIC_ENDPOINT=https://geo.962850.xyz/object-storage' \
  'OBJECT_STORAGE_PATH=/data' \
  'OSS_BUCKET=partsignal-staging' \
  'OSS_ACCESS_KEY_ID=' \
  'OSS_ACCESS_KEY_SECRET=' \
  "UPLOAD_SIGNING_SECRET=${UPLOAD_SECRET}" \
  'CORS_ALLOWED_ORIGINS=https://geo.962850.xyz' \
  'VITE_API_BASE_URL=' \
  'PARTSIGNAL_DATA_ROOT=/root/partsignal-data' \
  'PARTSIGNAL_BACKEND_IMAGE=partsignal-backend' \
  'PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend' \
  >"$ENV_FILE"

chmod 600 "$ENV_FILE"
test "$(stat -c '%a' "$ENV_FILE")" = 600
unset DB_PASSWORD SESSION_SECRET UPLOAD_SECRET ADMIN_PASSWORD ENGINEER_PASSWORD AI_KEY
```

账号种子只在账号不存在时生效；现有账号密码以 PostgreSQL 哈希为准，修改种子变量不会修改登录密码。为支持登录后验收，运维人员可以把 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 同步为当前 admin 密码，但必须继续把它视为现用凭据。

`AI_CREDENTIAL_ENCRYPTION_KEY` 用于解密数据库中的 AI 渠道凭据，丢失或误换不可恢复。预发布保持确定性生成器，除非已明确批准并在配置中心录入专用低权限测试渠道；真实调用失败不得静默回退。

## 4. 完整手工发布

### 4.1 校验来源并制作发布包

在本地主工作目录执行。先完成与本次改动相称的本地最小检查；开发阶段不等待 GitHub Actions，也不使用其构建产物。以下任一断言失败都停止：

```sh
set -eu
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

DEPLOY_COMMIT=$(git rev-parse origin/main)
RELEASE_ID="mvp-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 "$DEPLOY_COMMIT")"
ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/partsignal-full.XXXXXX")

git archive --format=tar.gz --output="$ARCHIVE" "$DEPLOY_COMMIT"
test -s "$ARCHIVE"
tar -tzf "$ARCHIVE" | grep -qx '.env.example'

BAD_ENTRIES=$(
  tar -tzf "$ARCHIVE" |
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
test -z "$BAD_ENTRIES" || { printf '%s\n' "$BAD_ENTRIES" >&2; exit 1; }
shasum -a 256 "$ARCHIVE"
printf '%s\n' "$RELEASE_ID"
```

release ID 必须是秒级时间戳加 12 位 commit，且不得复用。只允许 `git archive` 打包已推送提交；不存在未提交工作树部署路径。

### 4.2 上传并准备 release

保持上一节 shell 中的 `ARCHIVE` 和 `RELEASE_ID`，从本机只上传到 `hostdzire`：

```sh
set -eu
scp -F /Users/sc/.ssh/config "$ARCHIVE" \
  "hostdzire:/root/partsignal/.incoming-${RELEASE_ID}.tar.gz"
rm -f "$ARCHIVE"
ssh -F /Users/sc/.ssh/config hostdzire
```

以下命令只在刚进入的 Hostdzire 会话执行：

```sh
set -eu
printf '输入第 4.1 节输出的 release ID：' >&2
IFS= read -r RELEASE_ID
printf '%s\n' "$RELEASE_ID" |
  grep -Eq '^mvp-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$'

RELEASE_DIR="/root/partsignal/releases/${RELEASE_ID}"
REMOTE_ARCHIVE="/root/partsignal/.incoming-${RELEASE_ID}.tar.gz"
ENV_FILE=/root/partsignal/shared/.env.staging

test "$(id -u)" -eq 0
test -f "$REMOTE_ARCHIVE"
test -f "$ENV_FILE"
test "$(stat -c '%a' "$ENV_FILE")" = 600
test ! -e "$RELEASE_DIR" && test ! -L "$RELEASE_DIR"

mkdir -p /root/partsignal/releases
mkdir "$RELEASE_DIR"
tar -xzf "$REMOTE_ARCHIVE" -C "$RELEASE_DIR"
rm "$REMOTE_ARCHIVE"

test -f "$RELEASE_DIR/.env.example"
! find "$RELEASE_DIR" -name '._*' -print -quit | grep -q .
ln -s "$ENV_FILE" "$RELEASE_DIR/.env.staging"
```

正常升级不得修改共享环境文件。若共享环境文件缺失或权限不是 `0600`，停止；只有首次初始化才执行第 3.2 节。

### 4.3 备份与恢复验证

首次空库可以跳过备份。已有数据时，在 Hostdzire 的同一会话、迁移之前执行：

```sh
cd "$RELEASE_DIR/deploy"
set -a
. ../.env.staging
set +a

export PARTSIGNAL_VERSION="$RELEASE_ID"
export BACKUP_DIR=/root/partsignal/backups
export COMPOSE_FILE=compose.staging.yaml
BACKUP=$(./scripts/backup.sh)
test -s "$BACKUP"
printf '%s\n' "$BACKUP"
```

`backup.sh` 生成权限受限的 `pg_dump --clean --if-exists --no-owner` gzip 文件，但不等于已完成异地、加密和保留策略。备份与对应的 `AI_CREDENTIAL_ENCRYPTION_KEY` 必须成对保护。

涉及删除列、数据重写或其他有损迁移时，必须在隔离的一次性 PostgreSQL 验证恢复。`VERIFY_DATABASE_URL` 绝不能指向 staging 主库：

```sh
: "${VERIFY_DATABASE_URL:?请先设置隔离验证数据库 URL}"
VERIFY_DATABASE_URL="$VERIFY_DATABASE_URL" ./scripts/restore-verify.sh "$BACKUP"
```

恢复验证会导入备份，并确认 `alembic_version` 与 `users` 可查询。备份为空、隔离数据库不明确或恢复验证失败都必须停止完整发布。

### 4.4 构建、迁移与启动

继续在 Hostdzire 的 `"$RELEASE_DIR/deploy"` 执行默认 `full` 模式：

```sh
PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh
```

脚本依次校验 Compose，构建 API 和前端镜像，启动 PostgreSQL、Redis、`fake-oss`，运行只读 `preflight-integrity`，执行 `alembic upgrade head`，等待 Worker、Scheduler、API、前端健康，幂等创建开发种子账号，输出容器状态，并检查回环 API ready 和前端首页。

任一步失败都停止，不手工跳过，也不设置 `PARTSIGNAL_DEPLOY_MODE=fast`。需要复核容器和迁移版本时执行：

```sh
PARTSIGNAL_VERSION="$RELEASE_ID" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml ps
PARTSIGNAL_VERSION="$RELEASE_ID" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  exec -T postgres psql -U partsignal -d partsignal -Atc \
  'select version_num from alembic_version'
```

### 4.5 首次安装或更新 Nginx

只有首次启用或 `deploy/nginx/partsignal.staging.conf.template` 变化时执行；只修改 PartSignal 独立站点：

```sh
set -eu
TEMPLATE="$RELEASE_DIR/deploy/nginx/partsignal.staging.conf.template"
TARGET=/etc/nginx/sites-available/partsignal-staging.conf

sed 's/<HOSTDZIRE_WG_ADDRESS>/10.0.0.2/g' "$TEMPLATE" >"$TARGET"
ln -sfn "$TARGET" /etc/nginx/sites-enabled/partsignal-staging.conf
nginx -t
systemctl reload nginx
```

Hostdzire WireGuard 的 `80/443` 监听要求 `proxy_protocol`。不要用普通 `curl` 直连 `10.0.0.2:443`；缺少 PROXY Header 会被重置，所有外部验收都走公网域名。

### 4.6 完整验收与更新 `current`

退出 Hostdzire，在本地主工作目录检查公共 DNS、健康端点和首页：

```sh
set -eu
dig +short @8.8.8.8 geo.962850.xyz A
deploy/scripts/smoke.sh https://geo.962850.xyz
curl --fail --silent --show-error https://geo.962850.xyz/ |
  grep -o '<title>[^<]*'
```

公共 DNS 必须指向既有入口，首页标题必须是 PartSignal，ready 响应中的 PostgreSQL 与 Redis 均应为 `ok`。API 刚替换时可以使用有上限的重试；持续失败不能忽略为成功。

涉及前端或 Nginx 缓存策略时，检查真实构建产物：

```sh
set -eu
ASSET_PATH=$(curl --fail --silent https://geo.962850.xyz/ |
  sed -n 's#.*src="\(/assets/[^"]*\.js\)".*#\1#p')
test -n "$ASSET_PATH"
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  "https://geo.962850.xyz${ASSET_PATH}"
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/index.html
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/products/route-fallback-check
```

带哈希的 `/assets/` 必须返回 `Cache-Control: public, max-age=31536000, immutable` 和 `Vary: Accept-Encoding`；`index.html` 与 SPA fallback 必须返回 `Cache-Control: no-cache`。WOFF2 不应返回 `Content-Encoding: gzip`。`/object-storage/` 出现 `502` 时停止验收，检查 `fake-oss` 的 internal 与 edge 网络。

命令行检查通过后，用本机浏览器通过真实公网域名完成登录后只读验收：

1. 未登录访问最终进入 `/login`，标题和正文正常渲染，不停留在加载态或空白页。
2. 只把 Hostdzire 共享环境文件中的 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 读入浏览器自动化内存；不得输出、记录、写入临时文件或读取整个环境文件。
3. 密码提交前不抓取可能包含密码值的 DOM 快照或截图；登录后检查工作台和 `/configuration/ai` 的导航、页面和已有渠道列表。
4. 登录前后控制台无应用级 `error` 或 `warning`；静态资源、认证、脚本或路由失败均视为验收失败。
5. 只做只读检查，不创建业务数据、不修改线上配置；结束后退出登录、关闭标签页并清除运行时凭据引用。

不得在服务器或容器安装浏览器环境，也不运行视觉基线截图。浏览器能力不可用时记录“UI 未验证”并停止完整发布，不能用 `curl` 代替真实渲染。

公网固定 `AI_ALLOW_LOCAL_HTTP=false`，不得运行依赖 `http://127.0.0.1:9001` Mock Provider 的纵向 E2E，也不得为测试放宽策略。完整纵向 E2E 只在本地或 CI 隔离环境使用真实 PostgreSQL、Redis、Celery 和显式 Mock Provider。

通过 SSH 对 Hostdzire 做最后只读复核：

```sh
ssh -F /Users/sc/.ssh/config hostdzire \
  "docker ps --format '{{.Names}}|{{.Status}}'; nginx -t; free -h; df -h /"
```

全部验收通过后，从本机进入 Hostdzire：

```sh
ssh -F /Users/sc/.ssh/config hostdzire
```

在 Hostdzire 原子更新最后验收记录：

```sh
set -eu
printf '输入已验收的 release ID：' >&2
IFS= read -r RELEASE_ID
printf '%s\n' "$RELEASE_ID" |
  grep -Eq '^mvp-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$'

NEXT_LINK="/root/partsignal/.current-${RELEASE_ID}"
test -d "/root/partsignal/releases/${RELEASE_ID}"
test ! -e "$NEXT_LINK" && test ! -L "$NEXT_LINK"
ln -s "releases/${RELEASE_ID}" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" /root/partsignal/current
test "$(readlink /root/partsignal/current)" = "releases/${RELEASE_ID}"
```

`current` 只记录最后完成相应验收范围的 release，不是流量开关。固定 Compose 项目和端口上的容器在记录更新前已经替换。至少保留一个已验证旧 release 及其镜像；清理操作不属于发布。

## 5. 回滚与恢复

### 5.1 应用回滚

只在旧应用与当前数据库契约兼容时回滚。若生成、认证、发布状态机或数据库契约不兼容，先停止相关写流量与 Scheduler，再由负责人确认数据处置。

从本机进入 Hostdzire：

```sh
ssh -F /Users/sc/.ssh/config hostdzire
```

在 Hostdzire 选择已验证旧 release，并用旧镜像标签重启固定 Compose 栈：

```sh
set -eu
printf '输入已验证且兼容的旧 release ID：' >&2
IFS= read -r PREVIOUS_RELEASE
printf '%s\n' "$PREVIOUS_RELEASE" |
  grep -Eq '^mvp-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$'

PREVIOUS_DIR="/root/partsignal/releases/${PREVIOUS_RELEASE}"
test -d "$PREVIOUS_DIR"
cd "$PREVIOUS_DIR/deploy"

PARTSIGNAL_VERSION="$PREVIOUS_RELEASE" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait worker scheduler api frontend fake-oss
```

重新执行第 4.6 节的公网、浏览器与主机验收，通过后再按同节原子更新 `current`。只切换 `current` 不会改变运行容器，不能作为应用回滚。

### 5.2 数据库恢复边界

默认不执行 Alembic downgrade。新迁移涉及删除列、数据重写或其他不可逆行为时，停止应用写入并保留故障现场备份；负责人确认恢复窗口和数据取舍后，才可恢复迁移前完整备份并启动兼容旧 release。

恢复前必须按第 4.3 节在隔离数据库通过 `restore-verify.sh`。仓库当前只提供备份生成和隔离恢复验证脚本，不提供可推测执行的 staging 主库覆盖脚本；真实主库恢复必须使用经审核的维护方案，不能把 `VERIFY_DATABASE_URL` 指向 staging 主库。

数据库备份与当时的 `AI_CREDENTIAL_ENCRYPTION_KEY` 必须成对保留。恢复数据库但使用另一主密钥，会使已有 AI 渠道凭据无法解密。任何恢复都不删除 `/root/partsignal-data`、旧 release、镜像或其他备份。

## 6. 详细排障

### 6.1 常见故障

| 现象 | 判断与处理 |
| --- | --- |
| 快速脚本报告关键路径变化 | 不绕过，改走主 Runbook 的完整发布 |
| 快速失败且 `current` 仍是旧值 | 容器可能已更新；检查固定 Compose 栈，必要时按第 5.1 节重启旧镜像 |
| Alembic 报源码含空字节，或发布包出现 `._*` | AppleDouble 文件进入提交；清理后形成新的已推送提交，不改用未提交打包 |
| 发布包含环境文件或密钥 | 立即停止，清理仓库敏感文件并形成新的已推送提交 |
| `/object-storage/` 返回 `502` | 确认 `fake-oss` 同时位于 `partsignal-staging-internal` 与 `partsignal-staging-edge` |
| 直接访问 WireGuard HTTPS 被重置 | Hostdzire Nginx 要求 `proxy_protocol`；通过公网域名验证 |
| API 重建后短暂 reset | 使用有上限的重试；持续失败时检查 API 日志，不忽略为成功 |
| 生成作业不推进 | 检查 Worker、Scheduler、Redis Broker 和 PostgreSQL 作业状态；Redis 不是业务状态源 |
| AI 凭据无法解密 | 恢复匹配主密钥或显式重新录入；不得静默回退 |
| SSH `Permission denied (publickey)` | 用指定 OpenSSH 配置对 `hostdzire` 做只读身份探测，不手工拼接主机、端口或身份文件 |
| 公网 E2E 返回 `AI_URL_FORBIDDEN` | 安全策略正常；纵向 E2E 只在隔离的本地或 CI 环境执行 |

### 6.2 Hostdzire 只读诊断

进入 Hostdzire 后先观察，不先清理或重启：

```sh
readlink -f /root/partsignal/current
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
nginx -t
ss -lnt
free -h
df -h /
```

排查生成积压时同时检查 Worker、Scheduler、Redis Broker 和 PostgreSQL 作业状态。诊断输出只允许包含数量、年龄、错误码和供应商耗时，不包含 Prompt、响应正文或凭据。消息风暴时先停止 Scheduler；不得批量改写 PostgreSQL 作业状态或自动重放已经进入 `RUNNING`、`FAILED` 的作业。

`preflight-integrity` 的任何记录都必须通过明确业务处置修复，不得自动改绑、删除、回退或维护隐藏 allowlist。应用、迁移、Nginx 或探针失败应保留非敏感日志和现场，不用固定成功响应、静默回退或放宽安全配置掩盖。

### 6.3 DMIT 入口只读诊断

只有 Hostdzire 本机服务正常、但公网入口异常时，才通过 `/Users/sc/.ssh/config` 在 DMIT 执行只读探测：

```sh
ssh -F /Users/sc/.ssh/config dmit \
  'systemctl is-active nginx; ss -lnt; wg show'
```

不得通过 `dmit` 上传 release、修改 Nginx、重启服务或更新任何 PartSignal 状态。
