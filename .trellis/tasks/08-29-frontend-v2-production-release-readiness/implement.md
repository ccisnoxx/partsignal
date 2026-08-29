# Frontend V2 Production Release Readiness — Implementation Plan

## 0. 当前状态与授权边界

- Task 状态：`in_progress`，当前阶段为 Repository Readiness 验证。
- 已确认产品决定：原地转换当前 `geo.962850.xyz`/Compose 运行边界；目标状态 V2-only，不保留 V1 fallback。
- 已获授权：创建 Task、`hostdzire` 只读 inventory、生产发布规划和本地 Repository Readiness 实施/验证。
- 未获授权：hostdzire Production env 写、备份/数据处置、Docker/Compose 运行态变更、Nginx reload、业务流量切换、V1 删除或物理清理。
- 用户已批准最终规划并进入实施阶段；`task.py start` 已执行。Repository Gate 完成后必须先提交精确远端写授权包，不得直接继续线上操作。

## 1. Planning 收敛

- [x] 创建 `frontend-v2-production-release-readiness` Trellis Task。
- [x] 完成仓库发布合同、历史 Phase 9 与 `hostdzire` 脱敏只读 inventory。
- [x] 确认采用原地 Production 转换，不创建并行长期 Production stack。
- [x] 确认目标 V2-only；V1 不再是构建、部署或回滚目标。
- [x] 确认当前 PostgreSQL、Redis 与 fake OSS objects 全部丢弃，不迁移到 Production。
- [x] 确认旧目录先进入同文件系统 quarantine，Production 从空 PostgreSQL/Redis 与真实 OSS 初始化；观察通过后另行授权物理清理。
- [x] `implement.jsonl` 与 `check.jsonl` 各有 2 个真实条目，Task context validation 已通过。
- [x] 执行最终 PRD convergence pass，移除阻塞问题并收敛原地 V2-only/clean-init 设计。
- [x] 向用户提交最终 planning summary；同一轮不运行 `task.py start`。

## 2. Repository Readiness（已批准，实施中）

- [x] 把容器化 Frontend V2 确立为唯一 Production owner：Production Compose 包含 `frontend`，外层 Nginx 代理 loopback frontend port。
- [x] 退役 Production 静态 root `/var/www/partsignal-frontend/current` 模板/文档，避免静态和容器双 owner。
- [x] 让 Production Compose 可以复用当前 project、service 名与回环端口原地替换，同时显式拥有 Production data root、env file、network 与 external-service contract。
- [x] 明确 fake-oss orphan 的移除时点；只有真实 OSS 和数据引用 Gate 通过并另获授权后才物理移除；Worker/Scheduler 也只在真实 AI/OSS Gate=`MET` 后由独立激活入口启动。
- [x] 补齐不可覆盖 candidate manifest、backend/frontend image ID/digest、上一份 V2 rollback image 与原地转换/恢复命令。
- [x] 补齐 fail-closed Production config preflight，只输出键名、状态和脱敏摘要。
- [x] 把开发语义 `seed-demo` 收敛为 Production 可用的幂等 `initialize-accounts`，继续复用现有账号创建 owner，不复制第二套逻辑；同步 CLI、测试、部署脚本、数据库合同和 Trellis spec。
- [x] 更新 Hostdzire runbook、Frontend V2 migration/quality plan 与旧 GEO 部署路径，使“原地 V2-only Production”成为唯一权威设计。
- [x] V1 source/build/test pipeline 保留到 Observation Gate=`MET`；Production Compose、deploy、Nginx 与 runbook 不再构建、部署或回滚到 V1。

### 必需验证

```sh
node deploy/scripts/check-nginx-security.mjs
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend \
PARTSIGNAL_VERSION=test PARTSIGNAL_RUNTIME_ENV_FILE="$PWD/.env" \
PARTSIGNAL_DATA_ROOT="$PWD/data" \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
git diff --check
```

根据实际 owner 变化补充 Production Compose、deploy script、V2 container、Nginx proxy 和无 V1 引用定向测试。上述 build/Compose 命令会产生本地产物或运行态，不属于当前只读授权。

### 可选完整验证

```sh
make verify
```

共享发布合同、核心模块或 candidate 冻结时运行；其镜像构建与隔离服务生命周期需要实施批准。

### 2026-08-29 验证证据

- [x] `deploy/scripts/test-deploy-production.sh`：验证默认 Compose 不包含异步 profile、固定 project identity、V2-only frontend/Nginx、完整维护锁、clean `main`/归档来源候选合同、manifest/image ID/RepoDigest/tracked-file 绑定、权威 Compose 路径、受控 previous-V2 frontend rollback、clean-init/upgrade 两阶段激活、未准备/错候选拒绝、quarantine/restore 中断续跑、恢复后 symlink 篡改拒绝、路径/挂载/运行容器拒绝及 manifest 不可覆盖。
- [x] `deploy/scripts/test-deploy-staging.sh`：现有 Staging full/fast、V1 保留边界与 Production V2-only 合同通过。
- [x] `uv run --project backend ruff check ...`、`sh -n ...`、`uv run --project backend pytest backend/tests/unit/test_cli.py`、Trellis context validation 与 `git diff --check` 通过。
- [x] Frontend V2 `api:check`、lint、typecheck、489 个单测与 build 通过；build 仅出现既有 `markdown-editor` 大 chunk warning。
- [x] `make verify` 在 Docker 阶段前通过 backend runtime/OpenAPI、V1/V2 API check、Ruff、V1/V2 lint/typecheck、mypy、backend unit 208、V1 unit 205、V1 visual contract 24、V2 unit 489。
- [ ] 当前本机没有可连接的 Docker daemon；`make verify` 在首个 `docker compose ... run --rm backend-test` 以 `unix:///var/run/docker.sock` 不存在停止。因此 Docker backend integration、镜像构建、真实栈 E2E 与容器级完整门禁仍须在 candidate/rehearsal 环境补跑；环境未变化，未无效重跑同一失败阶段。
- [x] 独立高风险复审发现的恢复续跑、候选错配、挂载重叠、目录持久化与异步 Gate 绕过问题均已修复，并由上述 Production 脚本测试覆盖关键失败路径。

## 3. Candidate 与维护窗口授权包

- [ ] 从 clean、已推送且 `HEAD == origin/main` 的提交生成不可覆盖 release。
- [ ] 冻结 backend/frontend image digest、schema head、Nginx/snippet checksum、当前 V2 rollback image 和 release manifest。
- [ ] 完成 clean-init rehearsal：空 PostgreSQL migration-to-head、空 Redis broker、Production 账号初始化、真实 OSS 空 namespace 与零旧对象引用；不执行 snapshot sanitization 或 Staging 数据迁移。
- [ ] 验证 Production env 合同和真实 AI/OSS 连接，不输出任何 secret 值。
- [ ] 完成 V2 核心浏览器、legacy redirect、响应式、可访问性与 V2→previous-V2→V2 rollback drill。
- [ ] 生成精确维护窗口 write set、命令顺序、停止条件、预计不可用窗口和逐层回滚命令。

## 4. Hostdzire 原地转换（新的远端写授权）

- [ ] 切换前重新执行只读 drift inventory：资源、端口、Compose/container/image、Nginx target/checksum、iptables、TLS、release/current、DB revision、migrate 集合与 backup metadata。
- [ ] 验证 drift 与授权包一致；任何 target 或 checksum 漂移则停止并重新评审。
- [ ] 进入维护窗口并停止新增业务写入；保存当前 V2、Compose、Nginx、DB 与对象状态证据。
- [ ] 验证 PostgreSQL 约 66 MiB、Redis 约 7.8 MiB、objects 约 592 KiB 的 source 与授权包一致；创建唯一 run-scoped quarantine target。
- [ ] 停止旧 service 后，把 `postgres`、`redis`、`objects` 三个精确目录同文件系统原子移入 quarantine；不得 `rm -rf`，不得让 Production mount quarantine。
- [ ] 新建空 PostgreSQL/Redis owner，使用 Production env 和 Production Compose 原地启动 data services，执行 migration-to-head 与 Production 账号初始化，先启动 API/V2 frontend 完成真实 AI/OSS Gate，再单独激活 Worker/Scheduler。
- [ ] 验证真实 OSS 空 namespace、零旧对象引用与受控上传/读取；fake-oss 保持停止并从目标 service 集合移除，禁止用 `--remove-orphans` 模糊删除未核验 service。
- [ ] 需要修改 Nginx 时先精确备份、原子替换、`nginx -t`，再经单独 reload 授权生效。
- [ ] 验证回环与公网 live/ready、V2 title/deep links、CSP/cache/source-map、权限、真实 AI/OSS 和受控 Production 写路径。
- [ ] 全部通过后更新 release 验收记录；`current` 不作为容器或流量回滚手段。

## 5. Observation 与 V1 退役

- [ ] 在批准窗口观察 Nginx 5xx/upstream、API 错误、container restart/OOM、Worker/Scheduler 异常、DB/Redis health、AI/OSS 和核心业务结果。
- [ ] 达到停止阈值时不删除 V1 pipeline；按 frontend、Nginx、application、data 中实际故障层回滚。
- [ ] Observation Gate=`MET` 后执行已批准的 V1 source/build/deploy pipeline 删除，并验证仓库、release archive 和 Production runtime 不再引用 V1。
- [ ] Observation Gate=`MET` 后，quarantine 不再作为业务回滚源；其与 V1 历史 artifact、旧 release/image、fake-oss container/image、`.env.staging` 的物理清理另取破坏性授权。
- [ ] 完整验证通过后判定 Production Release Ready，并按 Trellis finish/commit 流程收口。

## 6. Candidate 证据失效矩阵

| 变化 | 必须重跑 |
| --- | --- |
| Frontend V2、路由、权限、API client、Vite/Nginx | artifact、contract、unit、browser、CSP/cache/source-map、previous-V2 rollback |
| Backend、migration、权限或状态转换 | backend tests、integration、data recovery/init、核心 browser、application rollback |
| Compose、deploy script、Nginx/snippet、env contract | config parse、script tests、remote dry-run、Nginx/HTTP/browser |
| 数据处置、RPO/RTO、AI/OSS 或 object mapping | backup/init、restore、external-service 与 reference rehearsal |
| 远端 service、port、vhost、certificate、iptables、resource 或 checksum | inventory、write set、rollback snapshot 与用户复核 |
| V1 删除范围 | V2-only build/deploy、release archive allowlist、文档引用与完整验证 |

## 7. Planning 验证

```sh
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-29-frontend-v2-production-release-readiness
git diff --check
```

Planning convergence 后再执行一次；失败只修复当前 Task 归因的问题。
