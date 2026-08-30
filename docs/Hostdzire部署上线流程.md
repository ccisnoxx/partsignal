# PartSignal Hostdzire Production 发布 Runbook

本文档是 `https://geo.962850.xyz` 的 Production 发布权威入口。当前目标是在一次获批维护窗口中原地转换既有运行边界，容器化 Frontend V2 是唯一前端 owner。详细命令和恢复检查见[部署附录](./Hostdzire部署附录.md)，稳定安全边界见[部署与运维](./operations.md)。

仓库就绪不等于已经获准修改服务器。上传 release、写入环境文件、停止容器、移动数据、替换 Nginx、reload、受控业务写入和物理清理都需要针对精确目标的远端授权。

## 1. 固定运行边界

| 项目 | Production 合同 |
| --- | --- |
| 公网入口 | DMIT 只做四层 SNI/端口转发和 `proxy_protocol` |
| 应用主机 | Hostdzire，TLS 终止、站点 Nginx 与全部应用容器的唯一写入目标 |
| Compose project | `partsignal-staging`；仅为原地转换保留的历史 runtime identifier，不代表环境语义 |
| Production env | `/root/partsignal/shared/.env.production`，权限 `0600`，不与 `.env.staging` 共享 |
| 活动数据 | `/root/partsignal-data/postgres`、`/root/partsignal-data/redis` |
| 旧环境隔离 | `/root/partsignal-data-quarantine/<run-id>`，不得被 Production mount |
| 回环端口 | API `127.0.0.1:19000`；Frontend V2 `127.0.0.1:19080` |
| Production services | `postgres`、`redis`、`migrate`、`api`、`worker`、`scheduler`、`frontend` |
| Frontend owner | `deploy/compose.prod.yaml` 的 `frontend` service，源码只来自 canonical `frontend/`；现有 Production image identity 保持 V2 命名 |
| Nginx owner | `deploy/nginx/partsignal-maintenance.conf.template` 在维护阶段阻断全部应用 upstream；`deploy/nginx/partsignal.conf.template` 在 Gate 通过后代理 API 与 Frontend V2 回环端口 |
| 对象存储 | 真实 `aliyun_oss`；Production 不运行或代理 `fake-oss` |
| 业务状态 | PostgreSQL 是唯一来源；Redis 只承担 Celery Broker |

Production 不使用 `/var/www/partsignal-frontend/current`，`/root/partsignal/current` 也只可作为验收记录，不能充当容器或流量回滚开关。

## 2. Gate 与停止条件

发布按 Repository、Artifact、Configuration/Capacity、Rehearsal、Remote Preparation、Cutover、Observation 顺序推进。前一 Gate 未通过时不得进入后一 Gate。

出现以下任一情况立即停止：

- 本地不是干净的 `main`，候选提交与 `origin/main` 不一致，或 release/image/manifest 可覆盖。
- SSH 主机密钥冲突、目标身份或只读 inventory 与授权包不一致。
- Production env 引用 `.env.staging`，或配置为 `deterministic`、development storage、fake OSS、非安全 Cookie、`AI_ALLOW_LOCAL_HTTP=true`。
- 三个旧数据目录、同文件系统 quarantine、恢复命令或上一份已验证 V2 镜像不明确。
- migration、完整性、账号初始化、Compose health、`nginx -t`、live/ready、缓存/CSP/source-map 或浏览器验收失败。
- 真实 AI/OSS 只能通过放宽安全策略、固定成功适配器或输出凭据才能验证。

## 3. Repository 与 Candidate

本地至少运行：

```sh
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production.sh
uv run --project backend pytest backend/tests/unit/test_cli.py
git diff --check
```

候选必须来自 clean、已推送的 `main`。使用 `git archive` 生成不可覆盖源归档，构建 backend 和 Frontend V2 镜像后，通过 `deploy/scripts/create-release-manifest.py` 冻结完整 commit、源归档 SHA-256、backend/current V2/previous V2 image ID 与非空 RepoDigest、schema head，以及固定 allowlist 中的 Production Compose、状态/部署/激活脚本、Production/maintenance Nginx 模板和安全 snippet 校验和。manifest 采用排他创建；部署和激活会复算 tracked files，并要求 `PARTSIGNAL_VERSION` 精确等于 release ID。不得复用 tag、覆盖文件或从 release 目录名推断 Git 状态。

Production 镜像交付模式由 `PARTSIGNAL_IMAGE_DELIVERY_MODE` 显式控制；未设置时默认为 `registry`，按既有顺序 pull 后校验 manifest 中的 image ID 与 RepoDigest。Hostdzire 本地构建候选必须明确设置为 `local`：脚本跳过 pull，但要求候选镜像已存在，并在任何 `docker compose run`/`up` 前完成同一 manifest 的身份校验，同时为相关路径传入 `--pull never`。空值或其他模式，以及任何 V1 镜像仓库，均立即拒绝；不得用手工 Compose 命令绕过该合同。

## 4. Production 配置

`/root/partsignal/shared/.env.production` 只能在 Hostdzire 受控创建或更新，权限必须为 `0600`。至少满足 `APP_ENV=production`、安全 Cookie、`CONTENT_GENERATOR=openai-compatible`、`AI_ALLOW_LOCAL_HTTP=false`、`OBJECT_STORAGE_BACKEND=aliyun_oss`，并使用独立 session/encryption/database/account secrets 和完整低权限 OSS 配置。

只允许通过 `python -m app.cli preflight-production-config` 输出固定枚举与 `*_configured` 状态；不得输出 URL、bucket、AccessKey 或 secret 值。结构预检不能替代真实 AI/OSS 的权限、连通性、超时、CORS、上传/HEAD/读取验证。

## 5. 原地转换

转换必须获得包含 release ID、镜像、目录、Nginx target 和命令顺序的远端写授权：

1. 重新只读 inventory，冻结当前 V2 image、Compose/Nginx checksum、容器集合、DB revision 和三个数据目录元数据。
2. 从同一 manifest 固定的 `partsignal-maintenance.conf.template` 渲染维护配置；在 N1 写授权内完成排他备份、同目录临时文件、checksum/owner/mode、原子替换和 `nginx -t`。N2 reload 必须独立授权；公网首次稳定返回 `503 PartSignal maintenance` 后记录 T0，维护配置不得包含应用、静态或对象存储 upstream。
3. T+10 前只按重新读取的 full container ID 和 project/service label，依次停止 `scheduler`、`worker`、`api`、`frontend`、`fake-oss`、`postgres`、`redis`；必须先停止调度和写入生产者，再停止状态存储，不得使用 `--remove-orphans`。
4. 运行 `prepare-production-data.py quarantine <run-id>`。脚本在固定排他锁内验证 canonical 路径、停止的 Compose project、活动 mount、同一 device 和持久阶段，再逐目录原子 rename；失败后以相同 run ID 续跑，不删除数据。
5. 以 `PARTSIGNAL_RELEASE_MANIFEST`、`PARTSIGNAL_DEPLOY_MODE=clean-init`、`PARTSIGNAL_IMAGE_DELIVERY_MODE=local` 和同一 `PARTSIGNAL_CUTOVER_RUN_ID` 运行 Production deploy script。它只在状态为 `QUARANTINED` 且 PostgreSQL/Redis 活动目录为空时，把 manifest 摘要、release/commit/schema 和镜像 ID 绑定到状态；local 模式不 pull，在任何 create/run/up 前核对实际 image ID 与 RepoDigest，再执行配置预检、migration、完整性检查、`initialize-accounts`，随后只启动 API/Frontend V2 并把阶段推进到 `PRODUCTION_PREPARED`。
6. 通过 API/Frontend 完成真实 AI/OSS 权限、失败、空 namespace、零旧对象引用和受控上传/读取 Gate；`fake-oss` 保持停止且不属于 Production service 集合。Gate=`MET` 后，只有同一 manifest 才能运行 `activate-production.sh`，显式启用非默认 `production-async` profile 并把阶段推进到 `PRODUCTION_INITIALIZED`。
7. 从同一 manifest 固定的 Production 模板生成最终站点；N3 写授权仍要求原子替换和 `nginx -t`，N4 reload 再单独授权。此前运行中的 Nginx 必须持续返回维护响应。
8. 完成回环、公网、浏览器、权限、AI/OSS 与受控写验收，进入观察期。T+60 前必须得到经验证的新 Production 或经验证恢复的旧运行态，不能延长窗口继续排障。

物理删除 quarantine、`.env.staging`、fake-oss container/image 或旧 release/image 不属于上述转换授权。V1 仓库源码已在独立的开发阶段 cutover 中退役，该事实不扩大任何远端删除或 Production 转换授权。

## 6. 验收

必须验证回环与公网 live/ready、V2 首页和 canonical deep links；`/assets/*` immutable、HTML/SPA `no-cache`、缺失 asset 与 `.map` 为 `404`、JS 无 `sourceMappingURL`；CSP/安全头只由外层 Nginx 持有，Production 不暴露 `/object-storage/`。

浏览器覆盖 `/login`、首页、Product、Content、Publishing、GEO、Configuration、System 与 legacy redirect，以及 direct link、refresh、Back/Forward、登录 return-to、权限拒绝、revision conflict、375/768/1024/1440 和键盘/焦点基线。浏览器运行在本机独立 Playwright session 或既有测试中，不在服务器安装浏览器，不输出或持久化密码。

## 7. 分层恢复

- Frontend：只切回 manifest 冻结的上一份已验证 V2 image，frontend-only recreate；其他 service、DB 和 Nginx 不变。
- Nginx：恢复同一已验证版本的站点和安全 snippet，先 `nginx -t`，再单独授权 reload。
- Application：只有上一份 V2 backend 与当前 schema 合同时才可切回。
- Data：停止新 Production 写入和全部新 service，把失败数据保留到 `failed-production/`，运行 `prepare-production-data.py restore <run-id>` 按持久阶段续跑并恢复旧三个目录，再按旧 Staging 配置恢复运行态。

默认不执行 Alembic downgrade。恢复保留失败现场，不删除 release、镜像、manifest、quarantine 或日志。

## 8. Observation 与仓库退役状态

观察期跟踪 Nginx 5xx/upstream、API 错误、container restart/OOM、Worker/Scheduler、DB/Redis health、AI/OSS 和核心业务结果。该观察期仍是未来真实 Production 发布的独立 Gate。

2026-08-29 的开发阶段范围决策已允许在仓库内删除 V1 并把原 V2 提升为 canonical `frontend/`，不以 Observation Gate 为前置条件；这不是 Production 发布，也不能把未执行的 Remote Preparation、Cutover 或 Observation Gate 写成 `MET`。这些 Gate 对本次任务均为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。quarantine、旧镜像、release 和旧环境文件的物理清理仍需另一份破坏性授权。
