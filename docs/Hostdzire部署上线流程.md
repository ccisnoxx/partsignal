# PartSignal Hostdzire 部署上线 Runbook

本文档描述 PartSignal 在 Hostdzire 上可重复执行的部署流程、验收边界、停止条件和回滚注意事项，供后续会话直接执行。通用部署原则见 [部署与运维](./operations.md)，本 Runbook 只描述 `geo.962850.xyz` 预发布环境，不记录逐次发布流水。

## 1. 已确认的基础设施边界

| 项目 | 值或约束 |
| --- | --- |
| 对外域名 | `https://geo.962850.xyz` |
| 公网入口 | DMIT，只做四层 SNI/端口转发和 `proxy_protocol` |
| 应用主机 | Hostdzire，运行 Docker Compose 和宿主机 Nginx |
| WireGuard 地址 | DMIT `10.0.0.1`，Hostdzire `10.0.0.2` |
| 发布根目录 | `/root/partsignal/releases/<release-id>` |
| 当前版本指针 | `/root/partsignal/current` |
| 共享环境文件 | `/root/partsignal/shared/.env.staging`，权限必须为 `0600` |
| 持久数据 | `/root/partsignal-data`，不得放入版本发布目录 |
| Compose 项目 | `partsignal-staging` |
| 回环端口 | API `19000`、开发对象存储 `19001`、前端 `19080` |

DMIT 当前把普通 Web SNI 默认转发到 Hostdzire，常规部署不修改 DMIT Nginx。Hostdzire 必须存在精确匹配 `geo.962850.xyz` 的虚拟主机。

服务器连接统一使用本机 `~/.ssh/config` 中已经验证的 alias：

| Alias | 用途 | 约束 |
| --- | --- | --- |
| `hostdzire` | PartSignal 应用机 | 常规部署、上传和运维只使用该 alias |
| `dmit` | 公网前置机 | 仅在入口链路异常时只读探测，常规部署不修改 |
| `aaitr` | 独立服务器 | 与本部署无关，仅在任务明确要求时访问 |

由 OpenSSH 配置管理主机、端口、身份文件、主机密钥验证和连接复用；部署命令不得读取、复制或输出私钥。首次只执行身份探测，确认目标为 Hostdzire 后再上传或写入：

```sh
ssh hostdzire 'hostname; id; pwd'
```

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

涉及数据库或异步生成时，还必须执行真实 PostgreSQL/Redis 集成测试和业务 E2E。不能用 SQLite、Celery eager 或固定成功响应替代。视觉基线截图不属于上线质量门：它不验证真实线上链路，在容器内执行还容易受字体、渲染器和运行环境影响而产生无效失败。

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
```

结果应指向既有公网入口。上线前记录 PartSignal 状态：

```sh
curl --fail --silent --show-error https://geo.962850.xyz/api/health/ready || true
```

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

### 3.5 必须停止部署的情况

出现以下任一情况时停止，不得用跳过检查、放宽安全配置或覆盖旧版本的方式继续：

- 本地主工作目录不是干净的 `main`，或 `HEAD` 与 `origin/main` 不一致。
- SSH 主机密钥冲突、`hostdzire` alias 到达的主机身份不符合预期。
- 发布包包含 `.env`、私钥、AppleDouble 文件，或缺少 `.env.example`。
- 数据库备份为空、`preflight-integrity` 非空、迁移失败或 Alembic 版本不符合预期。
- Compose 容器不健康、ready 持续失败、Nginx 配置校验失败或对象存储代理返回网关错误。
- Codex 本地浏览器无法渲染登录页、认证路由守卫失效，或控制台出现应用错误。

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
BAD=$(tar -tzf "$ARCHIVE" | \
  grep -E '(^|/)\._|(^|/)\.env($|\.)|private.*key' | \
  grep -vE '(^|/)\.env\.example$' || true)
test -z "$BAD" || { printf '%s\n' "$BAD"; exit 1; }
shasum -a 256 "$ARCHIVE"
```

`.env.example` 是发布包的权威配置模板，必须保留；其他 `.env` 文件仍应阻断。

## 5. 上传并准备版本目录

上传只使用 `hostdzire` alias：

```sh
scp "$ARCHIVE" hostdzire:/tmp/
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

`PARTSIGNAL_SEED_ADMIN_PASSWORD` 与 `PARTSIGNAL_SEED_ENGINEER_PASSWORD` 只在对应账号不存在时用于创建账号；账号创建后，当前有效密码仍以 PostgreSQL 中的密码哈希为准，修改环境变量不会改变登录密码。为支持 Codex 本地浏览器执行登录后验收，可由运维人员在修改 admin 密码后手工同步 `PARTSIGNAL_SEED_ADMIN_PASSWORD`，但必须把它视为现用生产凭据并继续保持环境文件权限为 `0600`。

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

只修改 PartSignal 独立站点。模板中的监听地址由 Hostdzire WireGuard 地址替换：

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
```

预期结果：

- `geo.962850.xyz` 标题为 PartSignal。
- ready 检查中 PostgreSQL 与 Redis 均为 `ok`。

API 或容器刚重建时可能短暂出现 `connection reset by peer`，使用有上限的重试，不得把持续失败忽略为成功：

```sh
curl --fail --silent --show-error \
  --retry 12 --retry-all-errors --retry-delay 2 \
  https://geo.962850.xyz/api/health/ready
```

### 10.2 Codex 本地浏览器 UI 冒烟

命令行健康检查通过后，使用 Codex 控制本机浏览器访问 `https://geo.962850.xyz/`。这一步使用真实公网入口、本机浏览器引擎和线上静态资源，不在服务器或容器内安装 Playwright，也不截图或比较视觉基线。

至少验证以下内容：

1. 页面最终进入 `/login`，标题为 `PartSignal · GEO 内容运营`，登录页正文正常渲染而不是停留在加载态或空白页。
2. 从 `hostdzire` 的 `.env.staging` 只读取 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 到浏览器自动化的内存中，以 admin 登录；不得把变量值输出到命令结果、日志、对话或临时文件。
3. 登录后确认工作台正常渲染，再进入 `/configuration/ai`，确认配置中心导航、AI 配置页面和已有渠道列表可读。
4. 登录前后浏览器控制台均没有应用级 `error` 或 `warning`。静态资源失败、脚本异常、登录失败或路由错误均视为验收失败。

该检查只做只读 UI 冒烟，不创建业务数据、不修改线上配置。密码填入表单后不得抓取登录页 DOM 快照或截图，因为自动化输出可能包含密码字段值；提交登录后再读取页面状态。验收结束必须退出登录、关闭标签页并清除自动化运行时中的凭据引用。若本地浏览器控制能力不可用，必须明确记录“UI 未验证”，不能用 `curl` 成功代替浏览器渲染成功；恢复浏览器能力后再完成验收。

### 10.3 纵向业务 E2E 的环境边界

`tests/e2e/mvp-flow.spec.ts` 会创建 AI 渠道并访问 `http://127.0.0.1:9001` 的开发 Mock Provider。生产式预发布环境固定 `AI_ALLOW_LOCAL_HTTP=false`，服务端必须返回 `AI_URL_FORBIDDEN`；因此不得在公网环境直接执行整套 `npm run e2e`，也不得为让测试通过而放宽该安全策略。

事实快照审核、Celery 生成、内容审核、对象直传、人工发布登记和 GEO 观测的完整纵向 E2E，应在发布前的本地或 CI 隔离环境运行。该环境必须显式启动 Mock Provider，并使用真实 PostgreSQL、Redis 和 Celery。公网发布后的验收范围是健康检查、缓存响应头、对象存储代理、Codex 本地浏览器 UI 冒烟、容器状态和主机资源。

### 10.4 主机资源复核

```sh
docker ps --format '{{.Names}}|{{.Status}}' | grep '^partsignal-staging-' | sort
nginx -t
free -h
df -h /
```

## 11. 切换发布指针

命令行验收、Codex 本地浏览器 UI 冒烟和主机资源复核全部通过后才切换：

```sh
ln -sfn "releases/${RELEASE_ID}" /root/partsignal/current
readlink /root/partsignal/current
```

保留至少一个已验证旧版本及其镜像。清理旧版本、镜像、备份或持久数据属于独立破坏性操作，不包含在常规上线流程中。

## 12. 登录账号

部署脚本会幂等确保 `admin` 管理员和 `content_editor` 工程师。`PARTSIGNAL_SEED_ADMIN_PASSWORD` 与 `PARTSIGNAL_SEED_ENGINEER_PASSWORD` 在账号不存在时用于首次创建；账号存在时，重复部署不会读取它们覆盖已有密码。

```text
/root/partsignal/shared/.env.staging
```

当前有效密码以 PostgreSQL 中的密码哈希为准，更新种子变量本身不会修改账号密码。为了让 Codex 本地浏览器进行登录后验收，运维人员可在修改 admin 密码后手工将 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 同步为当前密码；后续自动化只能读取该单一变量到内存，不能输出整个环境文件或密码值。`content_editor` 首次登录必须修改密码；任何现用密码都不得写入仓库、本 Runbook、临时文件或部署日志。

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

随后重新执行 ready、Nginx、公网首页、Codex 本地浏览器 UI 冒烟和主机资源复核。

### 13.2 数据库回滚

不要默认执行 Alembic downgrade。若新迁移有删除列、重写账号类型或其他不可逆操作，必须停止应用，恢复迁移前完整数据库备份，再启动旧版本。恢复前先保留故障现场备份；具体恢复窗口和数据取舍需人工确认。

`AI_CREDENTIAL_ENCRYPTION_KEY` 必须与数据库备份成对保留。恢复数据库但使用另一主密钥，会导致 AI 渠道凭据无法解密。

## 14. 常见故障

| 现象 | 已验证原因 | 处理 |
| --- | --- | --- |
| Alembic 报源码含空字节 | macOS `._*.py` 被打入发布包 | 使用 `COPYFILE_DISABLE=1`，排除并检查 `._*`，重新制作新版本包 |
| `/object-storage/` 返回 `502` | `fake-oss` 只有 internal 网络，宿主机端口未发布 | 保持 `fake-oss` 同时连接 internal 与 edge 网络并重建容器 |
| 直接访问 WireGuard HTTPS 被重置 | Hostdzire Nginx 监听要求 `proxy_protocol` | 通过公网域名和 DMIT 入口验证 |
| API 重建后短暂 reset | Uvicorn 尚未完成启动 | 使用有限次数的 `--retry-all-errors`，随后检查 API 日志 |
| 生成作业不推进 | Worker/Beat 未运行、Redis 不通或租约恢复失败 | 检查 `worker`、`scheduler` 日志和 PostgreSQL 作业状态；Redis 只排查 Broker，不把它当业务状态源 |
| AI 凭据无法解密 | `AI_CREDENTIAL_ENCRYPTION_KEY` 变化或密文损坏 | 恢复匹配的主密钥，或显式重新录入渠道凭据；不得静默回退 |
| SSH 报 `Permission denied (publickey)` | 使用了错误 alias，或本机 OpenSSH 配置/身份不可用 | 固定使用 `ssh hostdzire` 先执行只读 `hostname` 探测；不要绕过 `~/.ssh/config` 手工拼接身份参数 |
| 公网纵向 E2E 创建 AI 渠道返回 `AI_URL_FORBIDDEN` | 测试依赖回环 HTTP Mock Provider，但预发布环境正确禁止本地 HTTP AI 出站 | 只在本地/CI 隔离环境执行纵向 E2E；不得修改 `AI_ALLOW_LOCAL_HTTP=false` |
