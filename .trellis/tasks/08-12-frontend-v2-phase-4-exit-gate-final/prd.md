# Frontend V2 Phase 4 Exit Gate Final

## Goal

在包含 `fcb6c1d` 与全部既有 blocker 修复的最终本地 `main` 候选上，仅运行一次 `make verify`，保存完整门禁与 cleanup 证据，并按 Product、Engineering、UX、Architecture、Contract、Documentation 六类给出 Frontend V2 Phase 4 最终 `MET` 或 `NOT_MET` 判定。历史归档 Task 的结论保持原样；本任务不修复门禁发现的问题，也不进入 GEO。

## Confirmed Candidate State

- 创建本任务前，当前分支为 `main`，工作树干净，没有活动 Trellis Task。
- 最终候选 commit 冻结为 `51bf9c08b31fd6363ee3cb5a2539f03c4f076198`（`51bf9c0 chore: record journal`）。创建本任务后只有当前 planning Task 目录是已识别的未提交变化。
- 本地分支列表只有 `main`，不存在残留 `codex/frontend-v2-*` 临时分支；用户批准规划时明确授权从该候选创建唯一任务分支 `codex/frontend-v2-phase-4-exit-gate-final`。
- 上次唯一门禁失败的 test-only 修复及收尾提交均可由 `main` 到达：
  - `fcb6c1daff6d152200d1dd1a4b8ebc09e7544bcf`：修正 Publication reference filter 单元断言边界；
  - `254f1b522f536417a6d6480e3f589dc1062610db`：归档该修复 Task；
  - `51bf9c08b31fd6363ee3cb5a2539f03c4f076198`：记录对应 journal。
- 先前三组 Phase 4 blocker 的业务、归档与 journal 提交均可由 `main` 到达：
  - Work live/frozen projection 与 List 409 OpenAPI：`eea4c10b89c8631d00d125f4acfd64eec9447945`、`8408a117dbe0a7eac53e9548c404f937c55aa774`、`baa21a4464cc541ae497884e55b28cb3232f27e1`；
  - New Content Task DirtyGuard：`6f90b082966b00ac3c8689e05b865d08bd6be9e2`、`66979793de3d8e19e17510bdd475d4f6366a4ca3`、`930a1c5c37fa682f35c9d6d4a30a7c4e3a4b20be`；
  - Content AI immediate-terminal humanization Context refresh：`0a27716a2592e90b3b62f2e843543ab38992e768`、`d4622869bdeb64e998da43f8ec4e1b2404637201`、`65b332e51499fb76e27feabcd1e4129b60b69ff9`。
- `fcb6c1d` 的归档证据为：精确节点通过、目标文件 19 tests 全绿、backend 全部 unit tests 全绿、Ruff 与 diff check 通过，`backend/app/services/publication_queries.py` 零改动。
- 已归档 Publishing 抽象回顾的 F-07/F-08/F-09 与 F-14/F-15 已关闭；当前没有已知未解决的 Phase 4 产品、合同或 P0/P1/P2 finding。
- 根 `Makefile` 的 `verify` 依赖 `contract-check lint typecheck test-unit test-integration build e2e`；`e2e` 已依次运行 `deploy/scripts/e2e-local.sh` 与完整 V2 fixture suite。因此本任务只运行一次 `make verify`，不另行运行完整 `make e2e`。

## Requirements

### R1. Authorization and candidate boundary

- 用户已明确批准最新规划，并授权创建、绑定 `codex/frontend-v2-phase-4-exit-gate-final` 后运行 `task.py start`；不创建其他分支。
- 正式运行前重新确认 `HEAD` 仍为已冻结候选；若 `main` 已前进，停止并重新记录/审查候选，不把新提交静默纳入门禁。
- 工作区除当前 Task planning/evidence 文件外不得有未识别变化；本地不得存在 `codex/frontend-v2-*` 临时分支。
- 不修改生产代码、测试、合同、部署脚本、配置、生成类型或 GEO 文件。

### R2. Single authoritative gate

- 唯一完整门禁命令为：

  ```bash
  make verify
  ```

- 不单独运行完整 `make e2e`，不在相同代码和环境上重复 `make verify`。
- 不创建门禁 wrapper、Make target、fixture、spec 或新 orchestration；仅用 shell 将 `make verify` 的原始 stdout/stderr、退出码和时间写入当前 Task `evidence/`。
- 若门禁失败，立即按产品、合同、测试、环境或 cleanup 分类；本任务不顺手修复，不做无变化复验，只建议一个最小独立 Task。

### R3. Environment preflight

- `DATABASE_URL` 必须指向本机可访问、允许现有脚本创建/删除 allowlisted 临时数据库的 PostgreSQL source；正式门禁前只读验证连接。
- `REDIS_URL` 必须指向独占 logical DB；运行前 `DBSIZE=0`，`celery`、`unacked`、`unacked_index` 均为空，且没有其他 Worker/Scheduler 使用该 logical DB。不得使用共享 DB 0。
- `8000/9001/5173/4173/4174/19009` 六个端口必须无未知 listener；发现未知 owner 时停止，不连接外部服务，也不擅自终止未知进程。
- 正式运行前再次确认候选 commit、分支、Task 状态和工作区 allowlist；preflight 不满足时不消耗唯一门禁机会。

### R4. Evidence and covered stages

- 保存完整日志、退出码、候选 commit、北京时间开始/结束时间，至少使用：
  - `evidence/make-verify.log`
  - `evidence/make-verify.exit-code`
  - `evidence/make-verify.started-at`
  - `evidence/make-verify.finished-at`
  - `evidence/preflight.txt`
  - `evidence/cleanup-check.txt`
- 从同一次日志记录以下节点的实际结果与数量，不以历史绿色代替最终候选证据：
  1. contract-check 与 V1/V2 generated API check；
  2. backend Ruff、mypy、unit、integration；
  3. V1/V2 lint、typecheck、unit；
  4. backend、V1、V2 production build；
  5. V2 real-stack、V1 E2E、V2 fixture E2E；
  6. Compose dev/prod config；
  7. Publishing Flow A、Flow B、PublishedArticle readonly、Issue/repair lifecycle。

### R5. Cleanup is part of the gate

- 核对日志中的临时数据库与对象存储 `E2E_CLEANUP ... status=deleted`，并只读确认数据库和目录实际不存在。
- 核对本次 API、Worker、Scheduler、fake AI、对象存储、V1 dev server、V1/V2 preview 进程均退出，六个端口无本次 listener。
- Redis 退出后 `celery` queue、`unacked`、`unacked_index` 与其他 queued/unacked 项必须为空。
- 再次确认 Redis logical DB 独占后，枚举精确 `_kombu.binding.*` 键并逐个删除；不得使用通配删除、`FLUSHDB` 或清理非独占 DB。最终 `DBSIZE=0`。
- cleanup 任一项失败，Gate 必须为 `NOT_MET`，不能用测试通过覆盖。

### R6. Six-category final decision

- **Product**：三组 canonical Publishing URL、失败核验不伪装成功，以及 Work → verification → Article → Issue → repair → resolution 生命周期通过最终证据覆盖。
- **Engineering**：唯一 `make verify` 退出码 0；静态检查、unit/integration、build、fixture 与 real-stack 全部通过。
- **UX**：direct/refresh/Back/Forward、responsive、keyboard/focus、loading/empty/error 与 no-overflow 的适用证据通过。
- **Architecture**：三资源边界、server-driven actions、单请求 read model 与依赖方向成立；没有 browser join、第二 DTO/owner、状态推导、静默 fallback 或新增通用抽象。
- **Contract**：FastAPI runtime、OpenAPI、两套 generated types、代码、错误矩阵与不可变 snapshot/history 一致；unresolved P0/P1/P2 findings 为 0。
- **Documentation**：代码、合同、稳定 specs、`07/08/09`、归档历史与当前 Task 记录一致；历史 `NOT_MET` 不被改写。

### R7. Outcome recording

- 仅当 `make verify` 退出码为 0、六类全为 `MET`、unresolved P0/P1/P2 为 0、fixture/real-stack/cleanup 全部通过且 generated types/代码/合同/文档无漂移时，Gate 才能判为 `MET`。
- `MET` 时只向 `docs/frontend-v2/07-migration-plan.md` 的 Phase 4 追加最终状态、候选 commit、唯一门禁命令、关键数量与 cleanup 证据；`08-testing-quality-and-acceptance.md` 与 `09-architecture-decisions.md` 若仍一致则保持不动。
- 失败时不追加 `MET`，在当前 Task 记录精确失败、分类、owner、cleanup 与最小后续 Task；Gate 保持 `NOT_MET`。
- 完成前检查 generated types、业务代码、合同与文档 diff；当前 Task 文档记录完整结果。提交、归档、journal 与任何 Git 写操作仍需另行确认。

## Acceptance Criteria

- [x] AC1：创建任务前位于干净 `main`，没有活动 Trellis Task；当前最终候选 commit 已精确冻结。
- [x] AC2：`fcb6c1d` 及其 archive/journal、先前三组 blocker 的业务/archive/journal 提交均可从 `main` 到达，本地无残留 `codex/frontend-v2-*` 分支。
- [x] AC3：正式运行前 PostgreSQL source 可访问；Redis logical DB 为空且独占；六个端口无未知 listener；工作区仅含已识别 Task 文件。
- [ ] AC4：只运行一次完整 `make verify`，退出码为 0，未另行运行完整 `make e2e`。
- [ ] AC5：R4 所列全部静态检查、unit/integration、build、real-stack、V1/V2 E2E、fixture 与 Compose config 均通过并有最终候选日志证据。
- [ ] AC6：Publishing Flow A/B、PublishedArticle readonly、Issue/repair lifecycle 及不可变历史断言全部通过。
- [x] AC7：门禁在 E2E 前停止，未创建临时数据库、对象存储或服务进程；端口和 Redis 均按 R5 复核，最终 Redis `DBSIZE=0`。
- [ ] AC8：Product、Engineering、UX、Architecture、Contract、Documentation 六类均为 `MET`，unresolved P0/P1/P2 findings 为 0。
- [x] AC9：generated types、代码、合同、测试、稳定 specs 与权威文档无漂移；没有范围外改动。
- [x] AC10：失败时仅在当前 Task 记录失败并建议最小独立 Task；未修改实现，未把 `07` 错误标记为 `MET`。

## Out of Scope

- 不进入 GEO，不创建 GEO placeholder。
- 不修改生产代码、测试、OpenAPI、数据库、配置、部署脚本、CI、生成类型或依赖。
- 不修复本次门禁发现的问题，不创建或实施 follow-up Task。
- 不新增门禁脚本、wrapper、target、fixture、spec、兼容逻辑、fallback 或通用抽象。
- 不重写任何已归档 Task 的历史结论。

## Planning Decision

这是一个复用现有入口的单一操作性 closeout，没有新的架构、合同、数据流或兼容设计，因此按用户要求不创建空 `design.md`。当前没有已知 Phase 4 产品/合同/P0/P1/P2 blocker，但最终候选尚未执行唯一 `make verify`，故初步 Gate 判定为 `NOT_MET（待执行）`。

## Final Gate Result — 2026-08-12

最终候选 `51bf9c08b31fd6363ee3cb5a2539f03c4f076198` 上只运行了一次完整 `make verify`，北京时间 `2026-08-12 15:58:31 +0800` 开始、`15:58:49 +0800` 结束，退出码为 `2`。门禁在 backend unit 阶段停止：`180 passed / 1 failed`；未进入 integration、build 或 E2E，也未单独运行完整 `make e2e`。

失败节点与归因：

- 节点：`backend/tests/unit/test_security_and_publication.py::test_production_rejects_development_session_secret`。
- 现象：测试期望 production Settings 因开发 `SESSION_SECRET` 报“独立 SESSION_SECRET”，实际先因 `AI_ALLOW_LOCAL_HTTP=true` 报错。
- 归因：**ENVIRONMENT**。为向 E2E 提供宿主机 PostgreSQL/Redis URL，门禁 shell 使用 `set -a` 读取了整个 `.env`，把开发环境的 `AI_ALLOW_LOCAL_HTTP=true` 注入 backend unit 进程。测试显式 `_env_file=None` 不会忽略已有进程环境，因此 production Settings 的 AI 本地 HTTP 守卫先于 session secret 守卫失败。
- 边界：没有证据表明生产实现、测试合同或 `fcb6c1d` 回归失效；本任务未修改代码或测试，也未在修正环境后重跑任何门禁。
- 最小独立后续 Task 建议：`frontend-v2-phase-4-exit-gate-environment-corrected`。只导出宿主机化的 `DATABASE_URL` 与独占 `REDIS_URL`，明确不导出 `.env` 的其他开发变量，再从最新批准候选执行一次新的完整退出门禁。

六类最终判定：

| Category | Result | Evidence |
| --- | --- | --- |
| Product | `NOT_MET_FINAL_EVIDENCE` | 最终门禁未到达 V2 real-stack，不能用归档绿色替代最终候选闭环。 |
| Engineering | `NOT_MET` | 唯一 `make verify` 在 backend unit 因环境污染退出 2；integration、build、fixture/real-stack 未执行。 |
| UX | `NOT_MET_FINAL_EVIDENCE` | 最终门禁未到达 V1/V2 Playwright 与 fixture suite。 |
| Architecture | `MET_BY_EVIDENCE` | 候选包含全部已关闭 blocker，合同/静态检查通过；本任务无代码、测试或架构变化。 |
| Contract | `MET` | FastAPI/OpenAPI contract check、V1/V2 generated API check、Ruff、mypy 与双前端 typecheck 在失败前通过。 |
| Documentation | `MET` | 历史 `NOT_MET` 保留，`07/08/09` 未机械修改，当前 Task 精确记录环境失败与 cleanup。 |

Cleanup：E2E 未启动，因此没有本次临时数据库、对象存储或服务 PID；复核没有 `partsignal_e2e_20260812_%` 数据库，六端口无 listener，Redis DB 15 的 queue/unacked/unacked_index/binding/external clients 全为 0，最终 `DBSIZE=0`。

**Final verdict: `NOT_MET`.** 当前未解决产品、合同或 P0/P1/P2 finding 为 0；未解决最终门禁 blocker 为 1 个环境配置问题。
