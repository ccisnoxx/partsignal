# PartSignal 部署与运维

生产配置模板位于 `deploy/`，只描述部署方式，不包含主机地址、密钥、AccessKey 或模型密钥。自动化只有在获得明确批准后才能连接目标 VPS，SSH 凭据和生成的环境文件不得进入仓库或日志。

开发和生产 Compose 都从仓库根目录读取未提交的 `.env`；生产执行脚本默认从 `deploy/` 目录运行。`PARTSIGNAL_BACKEND_IMAGE` 与 `PARTSIGNAL_VERSION` 由部署环境注入，不写入仓库。

## 部署顺序

```text
构建并标记镜像
→ 数据库备份
→ 运行只读 preflight-integrity 并清零历史问题
→ 一次性 Alembic 迁移
→ 启动并确认 Worker 和 Beat 健康
→ 启动 API
→ 检查 live/ready 与生成诊断
→ 原子切换前端静态目录
→ 执行冒烟测试
```

API 只绑定 `127.0.0.1:19000`，PostgreSQL、Redis 和 Worker 不暴露宿主机端口。宿主机 Nginx 提供静态文件并代理 `/api/`。

PostgreSQL 与 Redis 只加入 `partsignal-internal` 隔离网络。API、迁移任务和 Worker 同时加入 `partsignal-egress`，用于 OSS 元数据校验和 OpenAI-compatible 模型调用；不得把数据库或 Redis 加入出站网络。应用层 DNS 校验不能替代出站防火墙，生产环境仍应只允许必要的供应商地址。

生产部署必须设置随机且备份验证过的 `AI_CREDENTIAL_ENCRYPTION_KEY`（Base64 编码的 32 字节密钥）、`CONTENT_GENERATOR=openai-compatible` 和 `AI_ALLOW_LOCAL_HTTP=false`。主密钥丢失后数据库密文无法恢复；轮换前必须显式重新加密或重新录入全部渠道 API Key 与敏感 Header。日志、审计和作业快照不得包含这些明文。

AI 请求只连接单次 DNS 解析批准的公网地址，TLS 身份和 Host 仍使用渠道原 hostname。连接兼容故障、peer 越界、重定向或响应超限时，应立即停用相关渠道并保留非敏感错误码；不得恢复旧 hostname 二次解析路径、关闭证书校验或增加发送后自动重试。只有任务完整生成输入和绑定事实快照全部 Evidence 均为 `PUBLIC` 时才允许出站，历史未分级任务必须人工重新保存 Prompt 与分级。

生成恢复默认每 60 秒扫描一次，超过 120 秒未投递的 `PENDING` Job 才会限批次补投递。`RUNNING` 租约按作业快照供应商超时加 120 秒收尾裕量计算；供应商已接收但 Worker 丢失的 Job 只会失败，不会自动重新调用。可按负载显式设置 `GENERATION_PENDING_REDISPATCH_SECONDS`、`GENERATION_FINALIZE_GRACE_SECONDS`、`GENERATION_RECOVERY_BATCH_SIZE` 和 `GENERATION_RECOVERY_SCAN_SECONDS`，不得把阈值设为零规避状态机。

部署后使用以下命令同时确认进程和 PostgreSQL 业务积压。诊断输出只包含数量、年龄、错误码和供应商耗时，不包含 Prompt、响应正文或凭据：

```sh
docker compose -f compose.prod.yaml ps worker scheduler
docker compose -f compose.prod.yaml run --rm api python -m app.cli generation-diagnostics
```

如果补投递出现消息风暴，先停止 `scheduler`，不要批量修改 Job 状态。修复后恢复 Beat；已进入 `RUNNING` 或 `FAILED` 的 Job 不得通过运维命令自动重放。

阶段二迁移前必须使用将要部署的后端镜像执行只读历史门禁：

```sh
docker compose -f compose.prod.yaml run --rm api python -m app.cli preflight-integrity
```

输出始终是按类型和稳定 ID 排序的 JSON 数组。`COMPLETED_WITHOUT_VERIFIED_PUBLICATION` 表示旧任务缺少任何追加式 `VERIFIED` 发布状态事件；曾验证成功、后来移除或验证失败的发布仍是合法完成历史，由发布异常待办继续处置。`PUBLICATION_PLATFORM_MISMATCH` 表示尚未进入 `REJECTED`、`REMOVED` 或 `VERIFICATION_FAILED` 的发布账号与任务锁定平台不一致；已显式终态处置的错绑历史继续保留，但不再阻断。任一输出记录都会以非零状态退出并阻断部署；只能通过明确业务处置修复，不得自动改绑、删除、回退或维护隐藏 allowlist。`0013` 迁移会重复关键检查，直接运行 Alembic 也不能绕过。

生产文件存储必须显式设置 `OBJECT_STORAGE_BACKEND=aliyun_oss` 并注入 OSS 凭据。部署前应使用非生产前缀验证浏览器预签名直传、后端 HEAD 校验、短期下载 URL 和 CORS 白名单，配置错误不得回退到开发存储。

## Hostdzire 预发布

`compose.staging.yaml` 是独立的 MVP 验收环境，不是生产配置。它使用真实 PostgreSQL、Redis 和 Celery，可显式选择确定性生成器或专用低权限模型测试渠道；不得向该环境注入生产 OSS 或生产模型凭据。

预发布栈使用 `partsignal-staging-*` 容器网络，业务端口只绑定宿主机回环地址：API `19000`、开发对象存储 `19001`、前端 `19080`。持久数据统一位于 `PARTSIGNAL_DATA_ROOT`，默认 `/root/partsignal-data`，避免随发布目录切换而丢失。

部署前在仓库根目录创建权限为 `0600` 的 `.env.staging`，至少设置随机 `POSTGRES_PASSWORD`、`SESSION_SECRET`、`UPLOAD_SIGNING_SECRET`、`PARTSIGNAL_SEED_ADMIN_PASSWORD`、`PARTSIGNAL_SEED_ENGINEER_PASSWORD`。两个初始账号密码必须独立生成；重复部署必须复用原环境文件，初始化命令不会覆盖账号已经修改过的密码。

```dotenv
APP_ENV=staging
APP_BASE_URL=https://geo.962850.xyz
SESSION_COOKIE_SECURE=true
CONTENT_GENERATOR=deterministic
AI_CREDENTIAL_ENCRYPTION_KEY=<Base64 编码的 32 字节预发布专用密钥>
AI_ALLOW_LOCAL_HTTP=false
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

`0010_user_cleanup` 执行前必须备份 PostgreSQL。若迁移报告旧版初始化账号仍被业务表或审计记录引用，迁移会整体回滚；不得绕过外键、清空历史或把归属猜测迁移给其他用户。开发验收数据可在确认无保留价值后整体重建，否则应保留数据库并重新规划账号处置。

## 回滚

前端通过软链接切换上一版本。API 和 Worker 使用上一镜像标签重启。回滚生成恢复代码前先停止 `scheduler`；`0011` 的新增列可由旧代码安全忽略，通常保留迁移而不删除诊断元数据。`0012` 降级会移除当前任务分级；任何不识别固定地址传输或 PUBLIC 门禁的旧应用启动前必须先停用全部 AI 渠道，不能以旧应用作为安全回退。`0013` 一旦产生发布异常或修复任务来源就拒绝 downgrade；旧应用不能理解新状态时停止发布/审核写流量并前滚修复，不删除异常、修复任务或审核历史。本次账号类型映射、内容追溯列删除和旧账号清理均为有损迁移：迁移前必须备份 PostgreSQL 和 AI 凭据主密钥；需要回退到旧应用时恢复完整迁移前数据库，不执行 `0009` 或 `0010` 的有损降级。仅回退同一数据库契约内的应用版本时，先停用全部 AI 渠道。

## 备份

`backup.sh` 只生成本地 `pg_dump` 压缩暂存文件，不假装已完成生产备份。生产部署必须由受控主机任务继续执行加密和上传对象存储，保留 7 个每日、4 个每周和 6 个每月备份；启用前需明确选定加密与上传工具并验证恢复。每月至少在隔离数据库执行一次 `restore-verify.sh`。
