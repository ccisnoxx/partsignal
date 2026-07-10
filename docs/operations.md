# PartSignal 部署与运维

生产配置模板位于 `deploy/`，只描述部署方式，不包含主机地址、密钥、AccessKey 或模型密钥。自动化只有在获得明确批准后才能连接目标 VPS，SSH 凭据和生成的环境文件不得进入仓库或日志。

开发和生产 Compose 都从仓库根目录读取未提交的 `.env`；生产执行脚本默认从 `deploy/` 目录运行。`PARTSIGNAL_BACKEND_IMAGE` 与 `PARTSIGNAL_VERSION` 由部署环境注入，不写入仓库。

## 部署顺序

```text
构建并标记镜像
→ 数据库备份
→ 一次性 Alembic 迁移
→ 启动 API 和 Worker
→ 检查 live/ready
→ 原子切换前端静态目录
→ 执行冒烟测试
```

API 只绑定 `127.0.0.1:19000`，PostgreSQL、Redis 和 Worker 不暴露宿主机端口。宿主机 Nginx 提供静态文件并代理 `/api/`。

PostgreSQL 与 Redis 只加入 `partsignal-internal` 隔离网络。API、迁移任务和 Worker 同时加入 `partsignal-egress`，用于 OSS 元数据校验和后续经批准的大模型调用；不得把数据库或 Redis 加入出站网络。

生产文件存储必须显式设置 `OBJECT_STORAGE_BACKEND=aliyun_oss` 并注入 OSS 凭据。部署前应使用非生产前缀验证浏览器预签名直传、后端 HEAD 校验、短期下载 URL 和 CORS 白名单，配置错误不得回退到开发存储。

## Hostdzire 预发布

`compose.staging.yaml` 是独立的 MVP 验收环境，不是生产配置。它使用真实 PostgreSQL、Redis 和 Celery，但只启用确定性内容生成器与显式开发对象存储；不得向该环境注入生产 OSS 或真实模型凭据。

预发布栈使用 `partsignal-staging-*` 容器网络，业务端口只绑定宿主机回环地址：API `19000`、开发对象存储 `19001`、前端 `19080`。持久数据统一位于 `PARTSIGNAL_DATA_ROOT`，默认 `/root/partsignal-data`，避免随发布目录切换而丢失。

部署前在仓库根目录创建权限为 `0600` 的 `.env.staging`，至少设置随机 `POSTGRES_PASSWORD`、`SESSION_SECRET`、`UPLOAD_SIGNING_SECRET`、`PARTSIGNAL_SEED_ADMIN_PASSWORD`，并固定以下边界：

```dotenv
APP_ENV=staging
APP_BASE_URL=https://geo.962850.xyz
SESSION_COOKIE_SECURE=true
CONTENT_GENERATOR=deterministic
OBJECT_STORAGE_BACKEND=development
OBJECT_STORAGE_ENDPOINT=http://fake-oss:9000
OBJECT_STORAGE_PUBLIC_ENDPOINT=https://geo.962850.xyz/object-storage
CORS_ALLOWED_ORIGINS=https://geo.962850.xyz
```

Hostdzire Nginx 使用 `nginx/partsignal.staging.conf.template` 新增 `geo.962850.xyz` 独立虚拟主机；`api.962850.xyz` 等已有站点不得修改。配置生效前必须通过 `8.8.8.8` 确认 DNS A 记录指向公网入口，并依次执行 `nginx -t`、HTTPS 冒烟和公网 E2E。

```sh
cd deploy
PARTSIGNAL_VERSION=<release-id> ./scripts/deploy-staging.sh
```

预发布回滚只切换上一发布目录与镜像标签，不删除 `/root/partsignal-data`。停止栈使用 `docker compose --env-file ../.env.staging -f compose.staging.yaml down`，默认保留持久数据。

## 回滚

前端通过软链接切换上一版本。API 和 Worker 使用上一镜像标签重启。数据库迁移优先向后兼容，破坏性迁移前必须备份，不自动执行未验证的降级迁移。

## 备份

`backup.sh` 只生成本地 `pg_dump` 压缩暂存文件，不假装已完成生产备份。生产部署必须由受控主机任务继续执行加密和上传对象存储，保留 7 个每日、4 个每周和 6 个每月备份；启用前需明确选定加密与上传工具并验证恢复。每月至少在隔离数据库执行一次 `restore-verify.sh`。
