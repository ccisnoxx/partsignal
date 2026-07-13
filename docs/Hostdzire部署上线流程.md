# PartSignal Hostdzire 部署上线 Runbook

本文档归档 PartSignal 在 Hostdzire 的已验证部署流程，供后续会话直接执行。通用部署原则见 [部署与运维](./operations.md)，本 Runbook 只描述 `geo.962850.xyz` 预发布环境的具体操作。

## 1. 已确认的基础设施边界

| 项目 | 值或约束 |
| --- | --- |
| 对外域名 | `https://geo.962850.xyz` |
| Sub2API 域名 | `https://api.962850.xyz`，不得修改 |
| 公网入口 | DMIT，只做四层 SNI/端口转发和 `proxy_protocol` |
| 应用主机 | Hostdzire，运行 Docker Compose 和宿主机 Nginx |
| WireGuard 地址 | DMIT `10.0.0.1`，Hostdzire `10.0.0.2` |
| 发布根目录 | `/root/partsignal/releases/<release-id>` |
| 当前版本指针 | `/root/partsignal/current` |
| 共享环境文件 | `/root/partsignal/shared/.env.staging`，权限必须为 `0600` |
| 持久数据 | `/root/partsignal-data`，不得放入版本发布目录 |
| Compose 项目 | `partsignal-staging` |
| 回环端口 | API `19000`、开发对象存储 `19001`、前端 `19080` |

DMIT 当前把普通 Web SNI 默认转发到 Hostdzire，常规部署不修改 DMIT Nginx。Hostdzire 必须存在精确匹配 `geo.962850.xyz` 的虚拟主机，否则请求会落到默认站点，看起来像 Sub2API。

DMIT 与 Hostdzire 共用公网地址 `154.21.86.86`，但不是同一个 SSH 入口：

| 主机 | SSH 入口 | 身份文件 |
| --- | --- | --- |
| DMIT 前置机 | `root@154.21.86.86:22` | DMIT 对应私钥 |
| Hostdzire 应用机 | `root@154.21.86.86:2222` | Hostdzire 对应独立 RSA 私钥 |

部署只能连接 Hostdzire 的 `2222` 端口。连接 `22` 端口实际到达 DMIT；使用本机默认公钥或 Hostdzire 私钥访问 DMIT 都可能得到 `Permission denied (publickey)`，这不表示 Hostdzire 拒绝了密钥。

SSH 连接信息位于本机受保护清单 `/Users/sc/work_file/bak_file/VPS.txt` 的 `hostdzire` profile。只能按清单规则将 Hostdzire 私钥临时写入 `/private/tmp` 并设置 `0600`；不得把清单内容、私钥或生成的环境变量输出到日志、对话或仓库。所有 SSH/SCP 命令必须显式指定端口、私钥和 `IdentitiesOnly=yes`，不要依赖 `~/.ssh/config`、SSH Agent 或默认身份文件：

```sh
SSH_HOST=154.21.86.86
SSH_PORT=2222
SSH_USER=root
SSH_KEY=/private/tmp/partsignal-hostdzire-deploy-key

chmod 600 "$SSH_KEY"
ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -p "$SSH_PORT" \
  "$SSH_USER@$SSH_HOST" 'hostname; id; pwd'
```

首次只运行上面的只读探测。确认目标确实是 Hostdzire 后再上传或执行部署命令；任务结束立即删除临时私钥文件。

## 2. 权威文件

部署前必须以已推送到 `origin/main` 的以下文件为准，不从旧会话、临时 worktree 或其他分支复制 Compose 或 Nginx 内容：

- `deploy/compose.staging.yaml`
- `deploy/scripts/deploy-staging.sh`
- `deploy/nginx/partsignal.staging.conf.template`
- `.env.example`
- `backend/alembic/versions/`
- `frontend/package-lock.json`

`deploy/compose.prod.yaml` 要求真实 OSS 和真实模型配置，不用于当前 Hostdzire 预发布环境。当前预发布环境使用真实 PostgreSQL、Redis 和 Celery，但对象存储为显式开发适配器；除非另行批准，不注入生产 OSS 或生产模型凭据。

## 3. 发布前检查

### 3.1 本地仓库

当前开发阶段采用 `main` 单分支流程。标准上线只部署已经提交、通过质量门并推送到 `origin/main` 的版本；不得从 `codex/*`、`agent/*`、功能分支、detached worktree 或未提交工作树直接上线。

```sh
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git log -1 --oneline
git diff --check
```

任一断言失败都必须停止部署：先回到主工作目录处理未提交变更，或按第 3.2 节完成 `main` 同步和推送。不能为了继续上线而改用临时分支的提交。

执行质量门：

```sh
make contract-check
make lint
make typecheck
make test-unit
npm --prefix frontend run build
```

涉及数据库或异步生成时，还必须执行真实 PostgreSQL/Redis 集成测试和 Playwright E2E。不能用 SQLite、Celery eager 或固定成功响应替代。

### 3.2 提交与推送流程

开始新工作前，从主工作目录同步 `main`。工作区不干净时不得执行 pull，也不得另开分支绕过现有变更：

```sh
git switch main
test -z "$(git status --porcelain)"
git pull --ff-only origin main
```

完成修改后，先核对范围并运行与改动匹配的质量门。暂存时显式列出本次文件，不得把无法识别的并行改动一起提交：

```sh
git status --short
git diff --check

git add -- <本次文件...>
git diff --cached --check
git diff --cached --stat
git commit -m "<type>: <中文摘要>"
```

提交前仍须按项目规则向用户展示提交计划并获得确认。推送属于远端写操作，也必须获得用户明确授权；授权后直接推送 `main`，不创建中转分支或 Pull Request：

```sh
git push origin main
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short --branch
```

正常结果应为 `main...origin/main` 且工作区为空。如果平台自动提供 detached worktree，它只用于隔离执行；最终提交仍必须落到主工作目录的 `main`。只有用户明确要求并行分支或以后启用受保护分支/PR 制度时，才调整此流程；临时分支合入后应删除本地和远端引用。

### 3.3 DNS 与现有站点

DNS 只以公共解析器结果为准，不使用本机缓存判断：

```sh
dig +short @8.8.8.8 geo.962850.xyz A
dig +short @8.8.8.8 api.962850.xyz A
```

两者应指向同一公网入口。上线前记录现有站点状态：

```sh
curl --fail --silent --show-error https://api.962850.xyz/ | grep -o '<title>[^<]*' | head -1
curl --fail --silent --show-error https://geo.962850.xyz/api/health/ready || true
```

`api.962850.xyz` 应继续返回 Sub2API。不要把 `geo.962850.xyz` 当前显示为 Sub2API 误判为 DNS 错误；这通常表示 Hostdzire 缺少精确 `server_name`。

### 3.4 Hostdzire 资源与冲突

通过 SSH 只读确认：

```sh
docker version
docker compose version
systemctl is-active nginx
df -h /
free -h
ss -lnt
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

不得占用现有服务端口。PartSignal 只允许绑定 `127.0.0.1:19000`、`127.0.0.1:19001` 和 `127.0.0.1:19080`；PostgreSQL 与 Redis 不发布宿主机端口。

## 4. 制作发布包

发布标识使用可排序且不可复用的值：

```sh
RELEASE_ID="mvp-$(date +%Y%m%d-%H%M)"
ARCHIVE="/private/tmp/partsignal-${RELEASE_ID}.tar.gz"
```

### 4.1 标准方式：已推送到 main 的版本

```sh
DEPLOY_COMMIT=$(git rev-parse origin/main)
test "$(git rev-parse HEAD)" = "$DEPLOY_COMMIT"
git archive --format=tar.gz --output="$ARCHIVE" "$DEPLOY_COMMIT"
```

### 4.2 仅限明确批准：未提交验收版本

未提交工作树只能用于临时验收，必须先确认变更范围。macOS 打包必须关闭 AppleDouble，并显式排除 `._*`；否则 Alembic 会把 `._0001_*.py` 当成迁移脚本并报 `source code string cannot contain null bytes`。

```sh
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" \
  --exclude='./.git' \
  --exclude='./.agents' \
  --exclude='./.codex' \
  --exclude='./.trellis' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  --exclude='./backend/.venv' \
  --exclude='./frontend/node_modules' \
  --exclude='./frontend/dist' \
  --exclude='./.cache' \
  --exclude='._*' \
  --exclude='*/._*' \
  --exclude='*/__pycache__' \
  --exclude='*/.pytest_cache' \
  --exclude='*/.mypy_cache' \
  --exclude='*/.ruff_cache' \
  .
```

验证包中没有密钥、环境文件或 AppleDouble 文件：

```sh
tar -tzf "$ARCHIVE" | grep -E '(^|/)\._|(^|/)\.env($|\.)|private.*key' && exit 1 || true
shasum -a 256 "$ARCHIVE"
```

## 5. 上传并准备版本目录

下面的 `<SSH_USER>`、`<SSH_HOST>`、`<SSH_PORT>` 和 `<SSH_KEY>` 从 `hostdzire` profile 读取，不写入仓库：

```sh
scp -i "$SSH_KEY" -o IdentitiesOnly=yes -P "$SSH_PORT" "$ARCHIVE" \
  "$SSH_USER@$SSH_HOST:/tmp/"
```

在 Hostdzire 创建全新版本目录，不覆盖旧版本：

```sh
RELEASE_ID=<release-id>
RELEASE_DIR="/root/partsignal/releases/${RELEASE_ID}"

mkdir -p "$RELEASE_DIR" /root/partsignal/shared /root/partsignal-data
tar -xzf "/tmp/partsignal-${RELEASE_ID}.tar.gz" -C "$RELEASE_DIR"

if find "$RELEASE_DIR" -name '._*' -print -quit | grep -q .; then
  echo '发布包包含 AppleDouble 文件，停止部署' >&2
  exit 1
fi
```

## 6. 首次创建预发布环境文件

升级已有环境时复用 `/root/partsignal/shared/.env.staging`，不得重新生成 `POSTGRES_PASSWORD` 或 `AI_CREDENTIAL_ENCRYPTION_KEY`。后者用于解密数据库中的 AI 渠道凭据，丢失或误换会使已有密文不可恢复。

仅首次部署执行以下逻辑，变量值不得打印：

```sh
ENV_FILE=/root/partsignal/shared/.env.staging

if [ ! -f "$ENV_FILE" ]; then
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
fi

chmod 600 "$ENV_FILE"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.staging"
```

预发布保持 `CONTENT_GENERATOR=deterministic`，除非已明确批准并在配置中心录入专用低权限测试渠道。真实调用失败时不得自动回退到确定性生成器。

## 7. 升级前备份

首次空库可跳过备份。已有数据时，在新版本迁移前执行：

```sh
cd "$RELEASE_DIR/deploy"
set -a
. ../.env.staging
set +a
export PARTSIGNAL_VERSION="$RELEASE_ID"
export BACKUP_DIR=/root/partsignal/backups
export COMPOSE_FILE=compose.staging.yaml
./scripts/backup.sh
```

必须确认脚本输出的 `.sql.gz` 文件非空。涉及有损迁移时，还要在隔离 PostgreSQL 中运行 `restore-verify.sh`；只生成备份而未验证恢复，不算完成备份。

## 8. 构建、迁移和启动

先验证 Compose 展开结果，再调用仓库脚本：

```sh
cd "$RELEASE_DIR/deploy"

PARTSIGNAL_VERSION="$RELEASE_ID" \
  docker compose --env-file ../.env.staging \
  -f compose.staging.yaml config --quiet

PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh
```

脚本按以下顺序执行：

1. 构建后端、开发对象存储和前端镜像。
2. 启动 PostgreSQL、Redis 和开发对象存储。
3. 运行一次性 `alembic upgrade head`。
4. 启动 API、Celery Worker、Celery Beat 和前端。
5. 幂等创建验收账号。
6. 检查 API ready 与前端首页。

开发对象存储必须同时加入 `partsignal-staging-internal` 和 `partsignal-staging-edge`。如果只加入 `internal` 网络，Compose 虽声明 `127.0.0.1:19001`，Docker 实际不会发布端口，Nginx `/object-storage/` 会返回 `502`。

确认迁移版本和容器状态：

```sh
docker compose --env-file ../.env.staging -f compose.staging.yaml ps
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  exec -T postgres psql -U partsignal -d partsignal -Atc \
  'select version_num from alembic_version'
```

## 9. 安装或更新 Hostdzire Nginx

只修改 PartSignal 独立站点，不修改 `api.962850.xyz`。模板中的监听地址由 Hostdzire WireGuard 地址替换：

```sh
TEMPLATE="$RELEASE_DIR/deploy/nginx/partsignal.staging.conf.template"
TARGET=/etc/nginx/sites-available/partsignal-staging.conf

sed 's/<HOSTDZIRE_WG_ADDRESS>/10.0.0.2/g' "$TEMPLATE" >"$TARGET"
ln -sfn "$TARGET" /etc/nginx/sites-enabled/partsignal-staging.conf
nginx -t
systemctl reload nginx
```

前端资源策略变更时，必须在 reload 前使用当前前端镜像和渲染后的站点配置分别执行 `nginx -t`。reload 后通过公网域名检查响应头，不得只检查状态码：

```sh
ASSET_PATH=$(curl --fail --silent https://geo.962850.xyz/ | sed -n 's#.*src="\(/assets/[^"]*\.js\)".*#\1#p')
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  "https://geo.962850.xyz${ASSET_PATH}"
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/index.html
curl --fail --silent --show-error --compressed -D - -o /dev/null \
  https://geo.962850.xyz/products/route-fallback-check
```

带哈希的 `/assets/` 必须返回 gzip、`Vary: Accept-Encoding` 和 `Cache-Control: public, max-age=31536000, immutable`；`index.html` 与 SPA fallback 必须返回 `Cache-Control: no-cache`。WOFF2 不应返回 `Content-Encoding: gzip`。

Hostdzire 的 `80/443` 监听使用 `proxy_protocol`。不要直接对 `10.0.0.2:443` 做普通 `curl`，因为缺少 PROXY Header 会被重置；应始终通过公网域名验证。

## 10. 上线验证

### 10.1 公网冒烟

```sh
dig +short @8.8.8.8 geo.962850.xyz A
curl --fail --silent --show-error https://geo.962850.xyz/api/health/live
curl --fail --silent --show-error https://geo.962850.xyz/api/health/ready
curl --fail --silent --show-error https://geo.962850.xyz/ | grep -o '<title>[^<]*'
curl --fail --silent --show-error https://api.962850.xyz/ | grep -o '<title>[^<]*' | head -1
```

预期结果：

- `geo.962850.xyz` 标题为 PartSignal。
- ready 检查中 PostgreSQL 与 Redis 均为 `ok`。
- `api.962850.xyz` 仍为 Sub2API。

API 或容器刚重建时可能短暂出现 `connection reset by peer`，使用有上限的重试，不得把持续失败忽略为成功：

```sh
curl --fail --silent --show-error \
  --retry 12 --retry-all-errors --retry-delay 2 \
  https://geo.962850.xyz/api/health/ready
```

### 10.2 公网视觉与无障碍回归

Playwright 镜像版本必须与 `frontend/package-lock.json` 中的 `@playwright/test` 一致。以下示例版本仅是本次验证值；依赖升级后同步修改：

```sh
docker run --rm \
  -e PARTSIGNAL_E2E_BASE_URL=https://geo.962850.xyz \
  --mount type=bind,src="$RELEASE_DIR/frontend",dst=/src,readonly \
  --mount type=volume,dst=/work \
  -w /work \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  sh -c 'cp -a /src/. /work/ && npm ci && npm run e2e -- tests/e2e/visual-regression.spec.ts'
```

这里使用一次性 Docker volume 作为可执行工作目录，容器退出后自动删除，不写入版本目录。视觉测试通过路由夹具验证页面、四档响应式基线和严重级无障碍问题，不创建生产业务数据。

不要采用以下挂载方式：

- 不要把整个 `/work` 只读绑定后再向 `/work/test-results`、`/work/playwright-report` 挂载子目录。Docker 需要先在只读根挂载中创建挂载点，会报 `read-only file system`。
- 不要把整个 `/work` 挂载为 `tmpfs`。当前宿主机的该挂载不可执行，`npm ci` 校验 `esbuild` 时会报 `spawnSync ... EACCES`。

### 10.3 纵向业务 E2E 的环境边界

`tests/e2e/mvp-flow.spec.ts` 会创建 AI 渠道并访问 `http://127.0.0.1:9001` 的开发 Mock Provider。生产式预发布环境固定 `AI_ALLOW_LOCAL_HTTP=false`，服务端必须返回 `AI_URL_FORBIDDEN`；因此不得在公网环境直接执行整套 `npm run e2e`，也不得为让测试通过而放宽该安全策略。

事实快照审核、Celery 生成、内容审核、对象直传、人工发布登记和 GEO 观测的完整纵向 E2E，应在发布前的本地或 CI 隔离环境运行。该环境必须显式启动 Mock Provider，并使用真实 PostgreSQL、Redis 和 Celery。公网发布后的验收范围是健康检查、视觉与无障碍回归、容器状态及相邻服务回归。

### 10.4 现有服务回归

```sh
docker ps --format '{{.Names}}|{{.Status}}' | \
  grep -E '^(partsignal-staging|md2word|vaultwarden|sub2api|cliproxy)' | sort
nginx -t
free -h
df -h /
```

md2word、Vaultwarden、Sub2API 和 CLIProxy 的状态必须与部署前一致。

## 11. 切换发布指针

所有验证通过后才切换：

```sh
ln -sfn "releases/${RELEASE_ID}" /root/partsignal/current
readlink /root/partsignal/current
```

保留至少一个已验证旧版本及其镜像。清理旧版本、镜像、备份或持久数据属于独立破坏性操作，不包含在常规上线流程中。

## 12. 登录账号

部署脚本会幂等确保 `admin` 管理员和 `content_editor` 工程师。两个账号使用独立初始密码，重复部署不会覆盖任一账号已经修改过的密码。初始密码只保存在：

```text
/root/partsignal/shared/.env.staging
```

按需只提取 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 或 `PARTSIGNAL_SEED_ENGINEER_PASSWORD`，不要输出整个环境文件。`content_editor` 首次登录必须修改密码；密码不得写入仓库或本 Runbook。

## 13. 回滚

### 13.1 应用回滚

仅在新旧版本数据库契约兼容时，进入上一发布目录并用旧镜像标签重建应用容器：

```sh
PREVIOUS_RELEASE=<previous-release-id>
PREVIOUS_DIR="/root/partsignal/releases/${PREVIOUS_RELEASE}"

cd "$PREVIOUS_DIR/deploy"
PARTSIGNAL_VERSION="$PREVIOUS_RELEASE" \
  docker compose --env-file ../.env.staging \
  -f compose.staging.yaml up -d api worker scheduler fake-oss frontend

ln -sfn "releases/${PREVIOUS_RELEASE}" /root/partsignal/current
```

随后重新执行 ready、Nginx、公网首页和现有服务回归检查。

### 13.2 数据库回滚

不要默认执行 Alembic downgrade。若新迁移有删除列、重写账号类型或其他不可逆操作，必须停止应用，恢复迁移前完整数据库备份，再启动旧版本。恢复前先保留故障现场备份；具体恢复窗口和数据取舍需人工确认。

`AI_CREDENTIAL_ENCRYPTION_KEY` 必须与数据库备份成对保留。恢复数据库但使用另一主密钥，会导致 AI 渠道凭据无法解密。

## 14. 常见故障

| 现象 | 已验证原因 | 处理 |
| --- | --- | --- |
| Alembic 报源码含空字节 | macOS `._*.py` 被打入发布包 | 使用 `COPYFILE_DISABLE=1`，排除并检查 `._*`，重新制作新版本包 |
| `geo.962850.xyz` 显示 Sub2API | Hostdzire 缺少精确 `server_name`，请求落入默认站点 | 安装 PartSignal 独立 Nginx 配置，先 `nginx -t` 再 reload；不要修改 `api.962850.xyz` |
| `/object-storage/` 返回 `502` | `fake-oss` 只有 internal 网络，宿主机端口未发布 | 保持 `fake-oss` 同时连接 internal 与 edge 网络并重建容器 |
| 直接访问 WireGuard HTTPS 被重置 | Hostdzire Nginx 监听要求 `proxy_protocol` | 通过公网域名和 DMIT 入口验证 |
| API 重建后短暂 reset | Uvicorn 尚未完成启动 | 使用有限次数的 `--retry-all-errors`，随后检查 API 日志 |
| 生成作业不推进 | Worker/Beat 未运行、Redis 不通或租约恢复失败 | 检查 `worker`、`scheduler` 日志和 PostgreSQL 作业状态；Redis 只排查 Broker，不把它当业务状态源 |
| AI 凭据无法解密 | `AI_CREDENTIAL_ENCRYPTION_KEY` 变化或密文损坏 | 恢复匹配的主密钥，或显式重新录入渠道凭据；不得静默回退 |
| SSH 报 `Permission denied (publickey)` | 使用 `154.21.86.86:22` 实际连接到 DMIT，或 SSH Agent 发送了错误身份 | Hostdzire 固定使用端口 `2222`、独立 RSA 私钥和 `IdentitiesOnly=yes`；先执行只读 `hostname` 探测 |
| Playwright 容器创建挂载点失败 | 整个 `/work` 是只读 bind，Docker 无法创建测试输出子挂载点 | 源码只读挂到 `/src`，用一次性 volume 挂到 `/work`，先复制再测试 |
| `npm ci` 校验 `esbuild` 报 `EACCES` | `/work` 使用了不可执行的 `tmpfs` | 改用一次性 Docker volume，不要放宽宿主机安全挂载选项 |
| 公网纵向 E2E 创建 AI 渠道返回 `AI_URL_FORBIDDEN` | 测试依赖回环 HTTP Mock Provider，但预发布环境正确禁止本地 HTTP AI 出站 | 在本地/CI 隔离环境执行纵向 E2E；公网只跑视觉/无障碍和冒烟，不得修改 `AI_ALLOW_LOCAL_HTTP=false` |
| 单项 GEO 截图在完整 E2E 失败后出现差异 | 前序业务测试中断后继续执行整套用例，验收上下文不再等同于独立视觉回归 | 修复前序环境问题后单独运行 `visual-regression.spec.ts`；不要直接更新基线掩盖差异 |

## 15. 本次验证记录

- 验证日期：`2026-07-10` 至 `2026-07-11`。
- 验证版本：`mvp-20260710-2135`。
- DNS：通过 `8.8.8.8` 确认 `geo.962850.xyz` 指向公网入口。
- 运行时：PostgreSQL、Redis、Celery Worker、Celery Beat、FastAPI、前端 Nginx 和开发对象存储均正常。
- 数据库：从空库迁移成功；后续版本仍必须以当前 Alembic `head` 为准。
- 验收：真实 HTTPS 域名、真实 PostgreSQL/Redis/Celery 的 Playwright 纵向 E2E 通过。
- 隔离：`api.962850.xyz` 的 Sub2API 及 md2word、Vaultwarden、CLIProxy 未受影响。

### 2026-07-12 发布记录

- 发布版本：`mvp-20260712-1a18cb2`，Git 提交 `1a18cb2`。
- SSH：确认 `154.21.86.86:22` 是 DMIT，Hostdzire 必须使用 `154.21.86.86:2222` 和独立 RSA 私钥；显式设置 `IdentitiesOnly=yes` 后连接成功。
- 备份：迁移前生成并确认 `/root/partsignal/backups/partsignal-20260712T115453Z.sql.gz` 非空。
- 部署：Compose 构建、Alembic `0013_publication_closure`、API/Worker/Scheduler/Frontend 启动成功，发布指针切换到 `releases/mvp-20260712-1a18cb2`。
- 公网：live、ready、PartSignal 首页和 Sub2API 首页验证通过；PostgreSQL、Redis、Nginx 及相邻服务正常。
- CI：发布提交的契约、单元、集成、构建、E2E 和 Linux 视觉基线检查全部通过。
- 公网 Playwright：错误尝试整套测试得到 `8/10`；纵向用例因生产安全策略拒绝回环 HTTP Mock Provider，后续明确改为公网只执行隔离的视觉与无障碍用例。
