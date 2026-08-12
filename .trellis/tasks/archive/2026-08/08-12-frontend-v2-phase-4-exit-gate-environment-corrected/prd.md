# Frontend V2 Phase 4 Exit Gate Environment Corrected

## Goal

在最新干净 `main` 候选 `b5c5919d96f53d6b3feff4e21f97f87c9a9fc42e` 上纠正最终门禁进程环境：从 `.env` 只读取并导出宿主机化的 `DATABASE_URL` 与独占 `REDIS_URL`，不导出其他开发变量，然后仅运行一次新的 `make verify`，完成 cleanup 与 Frontend V2 Phase 4 六类最终判定。

## Confirmed Background

- 前一 Task `frontend-v2-phase-4-exit-gate-final` 已归档；工作、归档与 journal 提交依次为 `bc59e2b`、`1ecc290`、`b5c5919`。
- 前次唯一 `make verify` 因门禁 shell 使用 `set -a` 导出整个 `.env`，使 `AI_ALLOW_LOCAL_HTTP=true` 污染 production Settings 单测；这是环境归因，不是生产代码或测试缺陷。
- 当前 `main` 干净、无活动 Task、无本地 `codex/frontend-v2-*` 分支；本任务不创建分支。
- 当前没有已知未解决的 Phase 4 产品、合同或 P0/P1/P2 finding。
- 根 `make verify` 已包含完整 E2E；本任务不单独运行 `make e2e`。

## Requirements

### R1. Exact environment allowlist

- 使用 Python `dotenv_values()` 从 `.env` 读取值，不使用 `set -a`，也不 `source` 后批量导出。
- 只将 Compose 内部 PostgreSQL `postgres:5432` 映射为 `127.0.0.1:55432`，只将 Redis `redis:6379/0` 映射为独占 `127.0.0.1:56379/15`；保留既有 scheme、凭据与查询参数，但不得写入日志。
- 在门禁子 shell 中枚举 `.env` 键并显式 `unset` 除 `DATABASE_URL`、`REDIS_URL` 外的所有键，再只 `export DATABASE_URL REDIS_URL`。
- 运行前证据必须证明 `.env` 键与门禁进程环境的交集精确为 `DATABASE_URL`、`REDIS_URL`；`AI_ALLOW_LOCAL_HTTP`、`APP_ENV`、`CONTENT_GENERATOR` 等不得存在。

### R2. Candidate and preflight

- 正式运行前确认 `main`、候选 commit、当前 Task 与工作区 allowlist；若 `HEAD` 变化则停止。
- PostgreSQL source 必须可访问且可创建 allowlisted 数据库。
- Redis DB 15 必须 `DBSIZE=0`、queue/unacked/binding 为空且无其他 Worker/Scheduler 客户端。
- `8000/9001/5173/4173/4174/19009` 无未知 listener。

### R3. Single gate and failure boundary

- 唯一完整门禁命令为 `make verify`；完整日志、退出码和北京时间起止时间保存到当前 Task evidence。
- 不单独运行完整 `make e2e`，不无变化重复运行。
- 失败时按产品、合同、测试、环境或 cleanup 分类并停止；本 Task 不修改生产代码、测试、合同、部署、配置或生成类型。

### R4. Cleanup and decision

- 核对临时数据库/存储删除、本次进程和端口退出、Redis queue/unacked 为空；确认 logical DB 独占后只删除精确 binding 键，最终 `DBSIZE=0`。
- 按 Product、Engineering、UX、Architecture、Contract、Documentation 六类判定。
- `MET` 必须同时满足：`make verify=0`、六类全为 `MET`、P0/P1/P2=0、fixture/real-stack/cleanup 全通过、generated types/代码/合同/文档无漂移。
- `MET` 时仅更新 `docs/frontend-v2/07-migration-plan.md` 与当前 Task；`08/09` 一致时保持不动。失败时只记录当前 Task并建议最小独立后续。

## Acceptance Criteria

- [x] AC1：候选、工作区、PostgreSQL、Redis、端口与环境键 allowlist preflight 全部通过。
- [x] AC2：只运行一次 `make verify`，未单独运行完整 `make e2e`。
- [x] AC3：contract、lint、typecheck、unit/integration、build、V2 real-stack、V1 E2E、V2 fixture 与 Compose config 全部通过。
- [x] AC4：Publishing Flow A/B、Article readonly、Issue/repair lifecycle 与不可变历史通过。
- [x] AC5：数据库、存储、进程、端口与 Redis cleanup 全部通过，最终 Redis `DBSIZE=0`。
- [x] AC6：六类均为 `MET`，P0/P1/P2=0，代码/合同/生成类型/文档无漂移。
- [x] AC7：成功时只更新 `07` 与当前 Task；`08/09` 事实一致，保持不动。

## Out of Scope

- 不修改生产代码、测试、OpenAPI、数据库、部署脚本、配置、依赖或生成类型。
- 不创建分支、门禁 wrapper、Make target、fixture、spec 或兼容逻辑。
- 不进入 GEO，不创建或实施范围外 follow-up。

## Planning Decision

这是一次环境 allowlist 纠正后的操作性 closeout，没有技术设计内容，不创建 `design.md`。用户已明确授权创建、激活并执行本任务。

## Final Gate Decision

- 最终候选：`b5c5919d96f53d6b3feff4e21f97f87c9a9fc42e`，分支 `main`。
- 门禁环境：`.env` 与进程环境的导出交集精确为 `DATABASE_URL,REDIS_URL`；`AI_ALLOW_LOCAL_HTTP`、`APP_ENV`、`CONTENT_GENERATOR` 等开发变量不存在。
- 唯一门禁：`make verify`，开始于 `2026-08-12 16:17:15 +0800`，结束于 `2026-08-12 16:32:47 +0800`，退出码 `0`；未单独运行 `make e2e`。
- 数量：backend unit `181 passed`；V1 unit `203 passed`、visual contract `24 passed`；V2 unit `282 passed`；backend integration `93 passed`；V2 real-stack `10 passed`；V1 E2E `52 passed`；V2 fixture E2E `209 passed / 21 skipped`（real-stack 用例在 fixture 项目按配置跳过，已由独立 real-stack 阶段执行）。
- contract-check、V1/V2 generated API check、Ruff、mypy、V1/V2 lint/typecheck、backend/V1/V2 production build、Compose dev/prod config 全部通过。
- cleanup：数据库 `partsignal_e2e_20260812_66472` 与对象存储已删除；六端口无 listener；Redis DB 15 无外部客户端、queue/unacked/other keys，精确删除两个 `_kombu.binding.*` 键后 `DBSIZE=0`。

| 类别 | 判定 | 证据 |
| --- | --- | --- |
| Product | MET | Content、Product 与 Publishing 关键真实栈流程通过，Publishing Flow A/B、Article readonly、Issue/repair lifecycle 完整。 |
| Engineering | MET | lint、typecheck、unit、integration、三套 production build、real-stack、两套 E2E 与 Compose config 全部通过。 |
| UX | MET | V1 E2E 与 V2 fixture/real-stack 覆盖 direct/refresh/Back/Forward、响应式、键盘、焦点、DirtyGuard 与只读状态。 |
| Architecture | MET | server-driven action、canonical context、current pointer、不可变历史与隔离真实栈均通过，生产实现零改动。 |
| Contract | MET | FastAPI/OpenAPI 递归语义一致，V1/V2 生成类型与根合同一致，无 generated-type 漂移。 |
| Documentation | MET | 本 Task 保存完整证据，`07-migration-plan.md` 追加最终事实；`08/09` 已一致且不机械修改。 |

未解决 P0/P1/P2 finding 为 `0`。fixture、real-stack 与 cleanup 全部通过，代码、合同、生成类型和文档无漂移，因此 **Frontend V2 Phase 4 Gate = MET**；本任务不进入 GEO。
