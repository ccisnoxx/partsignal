# Frontend V2 Phase 4 Exit Gate Closeout

## Goal

在包含全部已批准修复的最终本地 `main` 候选上执行唯一一次 Frontend V2 Phase 4 Exit Gate，按 Product、Engineering、UX、Architecture、Contract、Documentation 六类 Definition of Done 给出可追溯的 `MET` 或 `NOT_MET` 结论，并只更新当前权威状态。历史归档 Task 的 `NOT_MET` 结论保持原样。

## Confirmed Candidate State

- 规划前基线位于本地 `main`，工作树干净且没有活动 Trellis Task；创建本 Task 后仅新增本 Task 目录。
- 最终候选 commit 为 `65b332e51499fb76e27feabcd1e4129b60b69ff9`；本地 `main` 相对 `origin/main` 为 ahead 128 / behind 0，本任务不 pull、不 push。
- `publication-work-projection-contract-correction` 已进入 `main`：业务 `eea4c10b89c8631d00d125f4acfd64eec9447945`、归档 `8408a117dbe0a7eac53e9548c404f937c55aa774`、journal `baa21a4464cc541ae497884e55b28cb3232f27e1`。
- `frontend-v2-new-content-task-dirty-guard-gate` 已进入 `main`：业务 `6f90b082966b00ac3c8689e05b865d08bd6be9e2`、归档 `66979793de3d8e19e17510bdd475d4f6366a4ca3`、journal `930a1c5c37fa682f35c9d6d4a30a7c4e3a4b20be`；归档证据为完整 V2 unit `282 tests passed`。
- `frontend-v2-content-ai-humanization-real-stack-gate` 已进入 `main`：业务 `0a27716a2592e90b3b62f2e843543ab38992e768`、归档 `d4622869bdeb64e998da43f8ec4e1b2404637201`、journal `65b332e51499fb76e27feabcd1e4129b60b69ff9`；归档证据包括 immediate-terminal component regression、固定 V2 real-stack `10 passed`、humanization/source immutability/lineage/current pointer 与 cleanup。
- Publishing 抽象回顾的 F-07/F-08/F-09 已在该回顾 Task 内关闭；F-14/F-15 已由 projection/contract blocker Task 关闭。根据已归档证据，目前没有已知未关闭的 Phase 4 产品、合同或 P0/P1/P2 finding。
- 根 `Makefile` 的 `verify` 已依赖 `contract-check lint typecheck test-unit test-integration build e2e`，其中 `e2e` 依次运行 `deploy/scripts/e2e-local.sh` 和完整 V2 fixture suite；最终门禁只运行一次 `make verify`，不重复运行完整 `make e2e`。
- `deploy/scripts/e2e-local.sh` 在同一隔离生命周期创建进程唯一 PostgreSQL、临时对象存储与 V2 production preview，运行固定 V2 real-stack 后运行 V1 E2E，并在退出 trap 中停止本次进程、删除数据库和存储目录。
- 分支核对发现没有本地 `codex/frontend-v2-*` 分支，但远端仍存在已合并入 `main` 的 `origin/codex/frontend-v2-agent-rules`。在未得到远端删除授权前，本 Task 只记录该仓库卫生前置条件，不执行删除或 push。
- 用户批准规划后，明确要求从候选 `main` 创建 `codex/frontend-v2-phase-4-exit-gate-closeout`；该分支是本 Task 唯一获授权的新分支，不改变候选 commit。

## Requirements

### R1. Candidate and authorization boundary

- 门禁只能在用户批准本规划后激活；只允许创建用户指定的 `codex/frontend-v2-phase-4-exit-gate-closeout`，不得创建其他分支或修改生产代码。
- 激活前重新确认 `main` 指向同一候选或重新记录新的候选 commit；除本 Task 规划文件外不得有未识别工作区改动。
- 正式运行前必须不存在残留 `codex/frontend-v2-*` 临时分支。当前已发现的合并远端分支必须由用户另行授权删除或由仓库 owner 清理后只读复核；不得自动删除远端 ref。
- 三个 blocker 的业务、归档、journal 提交必须继续可由最终候选 `main` 到达。

### R2. Single authoritative gate

- 唯一完整门禁命令为 `make verify`，完整 stdout/stderr 与退出码保存到本 Task `evidence/`。
- 不再单独运行完整 `make e2e`。只有 `make verify` 在特定节点失败，且代码、配置或环境发生了能影响该节点的有针对性变化后，才允许运行最小定向复验；不得无变化重复碰绿色。
- 只使用现有 Make target、测试入口和 `deploy/scripts/e2e-local.sh`；不创建验证脚本、wrapper、CI target、fixture、spec 或 orchestration。

### R3. Isolated real-stack environment

- `DATABASE_URL` 指向本机可访问、允许脚本创建/删除 allowlisted 临时数据库的 PostgreSQL source；业务服务、migration 和 seed 只能使用脚本创建的 `partsignal_e2e_YYYYMMDD_PID` 数据库。
- `REDIS_URL` 指向运行前 `DBSIZE=0`、无 queued/unacked 数据且没有其他 Worker/Scheduler 客户端的独占 logical DB；不得使用共享 DB 0。
- 运行前确认 `8000/9001/5173/4173/4174/19009` 没有外部 listener；发现未知 owner 时停止，不连接外部服务、不擅自终止进程。
- 对象存储、Celery beat 文件和 production preview 继续由现有脚本拥有；不改变端口、服务拓扑或 preview 方式。

### R4. Required evidence and cleanup

- 保存 `make verify` 的完整输出，记录候选 commit、开始/结束时间、退出码和失败节点（如有）。
- 核对脚本输出的临时数据库与对象存储 `status=deleted`，并只读确认实际目标已不存在。
- 核对本次 API、Worker、Scheduler、fake provider、storage、V1 dev server 与 V1/V2 preview 均退出，相关端口无本次 listener。
- Redis 退出后必须没有 `celery` queue、`unacked`、`unacked_index` 或其他 queued/unacked 工作项。先重新确认 logical DB 独占，再枚举精确 `_kombu.binding.*` 键并逐个删除；禁止通配或清理非独占 DB。最终 `DBSIZE=0`。
- cleanup 任一项失败时 Gate 为 `NOT_MET`，不能用测试绿色覆盖。

### R5. Six-category Definition of Done

- **Product**：三组 canonical Publishing URL 与 Flow A、Flow B、PublishedArticle readonly、Issue/repair/resolve 生命周期由最终候选证据覆盖，失败核验不伪装成功，历史 snapshot 不可变。
- **Engineering**：contract-check、backend Ruff/mypy/unit/integration、V1/V2 lint/typecheck/unit、双前端 production build、V1/V2 E2E 与 V2 real-stack 全部通过；`make verify` 退出码为 0。
- **UX**：适用的 responsive、keyboard/focus、Back/Forward、direct URL、refresh、loading/empty/error 与 no-overflow 证据通过。
- **Architecture**：三资源边界、server-driven actions、单请求 read model、依赖方向成立；没有 browser join、第二 DTO/owner、状态推导、静默 fallback 或新通用抽象。
- **Contract**：OpenAPI、FastAPI runtime、两套 generated types、代码、测试、错误矩阵和不可变投影一致；unresolved P0/P1/P2 findings 为 0。
- **Documentation**：代码、OpenAPI、`07/08/09`、稳定 specs、归档历史与当前 closeout 记录一致；不改写历史 `NOT_MET`。

### R6. Outcome recording

- 全部门禁和 cleanup 通过后，向 `docs/frontend-v2/07-migration-plan.md` 追加 Phase 4 最终 `Gate=MET`、候选 commit、唯一门禁命令、关键数量证据和 cleanup 结果。
- `08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md` 当前与最终预期事实一致；没有新差异时不机械修改。
- 当前 Task 的 `prd.md` / `implement.md` 记录精确执行结果。完整原始日志保存在当前 Task `evidence/`。
- 若失败，只在当前 Task 记录精确命令、退出码、失败节点、日志、分类与 owner；`07` 不追加 `MET`，Gate 保持 `NOT_MET`，并建议一个最小独立 Task。本 closeout Task 不顺手修复。
- 完成前运行 `git diff --check`，确认 generated types 无漂移，除已批准文档/Task evidence 外工作区无生成或构建漂移。提交、归档和 journal 仍需按项目 Git/Trellis 规则另行取得确认。

## Acceptance Criteria

- [ ] AC1：最终 `main` 候选包含三个 blocker 的业务、归档和 journal 提交，且没有残留 `codex/frontend-v2-*` 临时分支。
- [x] AC2：最终候选 commit 被精确记录；门禁期间生产代码、合同、配置、部署脚本和测试均未修改，只创建了用户指定分支，没有新架构抽象。
- [x] AC3：运行前 Redis logical DB 为空且独占，PostgreSQL/对象存储/端口环境满足现有隔离契约。
- [ ] AC4：仅运行一次完整 `make verify`，退出码为 0；未重复运行完整 `make e2e`。
- [ ] AC5：contract-check、generated types、backend lint/mypy/unit/integration、V1/V2 lint/typecheck/unit、双前端 build、V1/V2 E2E 与 V2 real-stack 全部通过。
- [ ] AC6：Publishing Flow A、Flow B、PublishedArticle readonly、Issue/repair lifecycle，以及 fixture 与 real-stack 均通过。
- [x] AC7：门禁在 backend unit 阶段停止，未进入 E2E、未创建临时数据库/对象存储/服务进程；复核无候选数据库、端口 listener 或 Redis queued/unacked/binding 元数据，独占 Redis logical DB 最终 `DBSIZE=0`。
- [ ] AC8：Product、Engineering、UX、Architecture、Contract、Documentation 六类 DoD 全部为 `MET`，unresolved P0/P1/P2 findings 为 0。
- [ ] AC9：OpenAPI、两套 generated types、代码、测试、稳定 specs 与权威文档一致，门禁后没有生成漂移；`git diff --check` 通过。
- [ ] AC10：`docs/frontend-v2/07-migration-plan.md` 正式追加 Phase 4 `Gate=MET` 与最终证据；`08/09` 无事实变化时保持不动，历史归档 `NOT_MET` 不被重写。
- [ ] AC11：当前 Task 记录精确结果；提交/归档完成后主工作区最终干净。

## Out of Scope

- 不进入 GEO，不创建 GEO placeholder。
- 不修改 Publishing、Content 或其他生产实现，不修复门禁暴露的问题。
- 不修改 OpenAPI、数据库、配置、部署、CI、测试实现或 generated types。
- 不新增门禁脚本、wrapper、target、fixture、spec、orchestration、fallback 或通用抽象。
- 不修改或重新解释任何已归档 Task 的历史结论。

## Planning Decision

这是一个使用既有入口的操作性 closeout，不引入新的跨层设计或合同，因此按用户要求不创建空 `design.md`。当前候选没有已知产品/合同 blocker，但最终 `make verify` 尚未执行，且已发现一个待清理的已合并远端临时分支；初步 Gate 判定为 `NOT_MET（待执行）`。

## Final Gate Result — 2026-08-12

最终候选 `65b332e51499fb76e27feabcd1e4129b60b69ff9` 上只运行了一次完整 `make verify`，执行时间为北京时间 `2026-08-12 14:47:13` 至 `14:47:31`，退出码 `2`。门禁在 backend unit 停止：`180 passed / 1 failed`。

失败节点：

- 命令：`UV_CACHE_DIR=/Users/sc/PycharmProjects/partsignal/.cache/uv uv run --project backend pytest backend/tests/unit`
- 测试：`backend/tests/unit/test_workflow_projections.py::test_publication_reference_filter_includes_terminal_history`
- 失败断言：引用模式查询的完整 SQL 文本不应包含 `publication_works.status IN`。
- 归因：**TEST**。`eea4c10` 在共享 `_work_context_query()` 的 SELECT projection 中加入按状态选择 live/frozen identity 的合法 `CASE WHEN publication_works.status IN ...`；失败测试扫描整条 SQL 字符串，因此把 SELECT projection 误判为引用列表的 WHERE 状态门禁。`list_publication_works()` 的实际条件仍只在没有 `platform_account_id/content_task_id` 引用筛选时追加非终态 WHERE，未发现产品或合同行为错误。
- owner：backend Publication query unit test。
- 最小独立 Task 建议：`publication-work-reference-filter-unit-contract-correction`，只把回归断言收敛到真实 WHERE/filter 结构；修复后重新执行独立 Phase 4 Exit Gate，不在本 closeout Task 修改测试。

六类最终判定：

| Category | Result | Evidence |
| --- | --- | --- |
| Product | `MET_BY_ARCHIVED_EVIDENCE` | 三资源、Flow A/B、readonly Article、Issue/repair lifecycle 的已归档真实栈证据完整；本次未到 E2E 阶段。 |
| Engineering | `NOT_MET` | 唯一 `make verify` 在 backend unit 以 1 个 test failure、退出码 2 停止。 |
| UX | `MET_BY_ARCHIVED_EVIDENCE` | fixture/component/real-stack 已覆盖 canonical URL、responsive、keyboard/focus 与错误状态；本次未重新运行 E2E。 |
| Architecture | `MET_BY_EVIDENCE` | 失败由测试扫描粒度导致；共享 live/frozen projection、单一 owner 与服务端状态条件未发现实现缺陷。 |
| Contract | `MET` | FastAPI/OpenAPI contract check、V1/V2 generated API check、Ruff、mypy 与双前端 typecheck 在失败前全部通过。 |
| Documentation | `MET` | 历史 `NOT_MET` 保留；`07` 不追加 `MET`，`08/09` 不机械修改，当前 Task 精确记录失败。 |

Cleanup：E2E 未启动，因此没有本次临时数据库、对象存储或服务 PID；只读复核候选数据库为 none，Redis DB 15 的 `DBSIZE/queue/unacked/unacked_index` 均为 0，六个端口无 listener。完整证据见 `evidence/make-verify.log`、`make-verify.exit-code` 与 `cleanup-check.txt`。

**Final verdict: `NOT_MET`.** 未解决产品/合同 P0/P1/P2 finding 为 0；未解决最终门禁 blocker 为 1 个 TEST failure。
