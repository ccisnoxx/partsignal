# Research: A26 归档证据与 Phase 8 Gate 约束

- Query: 完整归档 Workbench abstraction review 中 A26、E2E infra/final gate 证据，A25 blocker 的关闭边界，以及 Phase 8 父任务对当前 blocker 与 Exit Gate 的约束；不选择最终修复方案。
- Scope: internal
- Date: 2026-08-24

## Findings

### 1. Files found

- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md` — A25/A26 finding、独立阶段实际结果与 Phase 8 `NOT_MET` 的权威归档证据。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/e2e-infra-audit.md` — Workbench 测试分层、真实栈生命周期、独立诊断顺序、cleanup/敏感产物与 final gate 规则。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/{prd.md,design.md,implement.md,task.json}` — abstraction review 的验收口径、固定候选 gate 模型、实际执行摘要及归档状态。
- `.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/{prd.md,design.md,implement.md,research/audit.md,task.json}` — A25 的根因、精确修复边界、验证结果与 A26 隔离证明。
- `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/{prd.md,design.md,implement.md,task.json}` — Phase 8 父任务的 Exit Gate 条件、blocker/recheck 顺序和当前唯一 blocker 元数据。
- `.trellis/spec/frontend/quality-guidelines.md` — production-artifact、`requestfailed`、真实失败与受限 `net::ERR_ABORTED` 排除边界。
- `.trellis/spec/infra/e2e-isolation.md` — 定向真实栈、独占资源、cleanup、trace 与安全失败输出合同。
- `.trellis/spec/infra/ci-execution.md` — `make e2e`/`make verify` 在完整 gate 和手动 CI 中的 owner。
- `/Users/sc/.codex/attachments/74a9cc29-608a-4a2a-86d2-c91936c750f2/pasted-text.txt` — 本 blocker 的用户授权、诊断优先、决策门、范围与验证约束。

### 2. A26 的归档事实

#### 已确定

1. Abstraction review 已归档完成，但其最终状态不是 Phase 8 完成：task metadata 明确记录 A19 已关闭、A25/A26 为两个独立 P1、`current_gate=NOT_MET`，且未运行 `make verify`、未更新 07/08 完成态（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/task.json:42-60`）。
2. A26 的可观察症状是 Auth 真实栈收集到 `requestfailed: GET /api/v1/workbench`。归档矩阵把证据定位到 `auth-session-real-stack.spec.ts:21-27,41-51`，owner 候选限定为 Auth/session + query lifecycle，并要求独立任务先确认时点和 `errorText`（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:52-53`）。
3. 该失败真实阻断 required stage：`make e2e` 的 V2 real-stack 结果为 `15 passed, 1 failed`，失败归因 A26；同次运行中的 GEO A/B 通过，database/storage/Redis/ports cleanup 全部完成（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:123-134`）。因此归档证据支持“Auth spec 失败且资源清理完整”，不支持把失败归为 cleanup 残留。
4. 根 `make e2e` 在 real-stack 子阶段 fail-fast，未继续到 V1 与 V2 strict fixture；维护者随后只运行安全的下游独立诊断，没有重跑相同根命令（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:130-136`）。
5. Abstraction review 的实际执行摘要把症状描述为“Auth logout 后在途 Workbench GET 被记录为 request failure”（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/implement.md:162-170`），但同一任务的精确 finding 明确说现有无 trace 证据，不能确定事件发生在离开首页还是 logout（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:53`）。前者只能作为粗粒度场景标签，不能替代时点证据。
6. 最终 Exit Gate 已明确判为 `NOT_MET`，原因包括 A25/A26 仍开放且 required independent stages 非全绿；07/08 没有写入 Phase 8 完成声明（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:138-145`）。

#### 未确定

1. 归档证据没有记录 `request.failure().errorText` 的实际值；A26 finding 只记录 method/pathname，并明确要求独立确认 `errorText`（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:53`）。
2. 归档证据没有精确标定失败发生在从 Workbench 导航到 System Users、点击 logout、查询清理、session 置空或 router invalidate 的哪一步；用户源请求也明确列出该缺口（`pasted-text.txt:30-37,66-80`）。
3. 归档证据不能判定事件是 Chromium 正常导航取消、QueryClient/query destruction 的预期取消、production Auth/query lifecycle 缺陷，还是普通网络失败；也不能据此在 production owner 与 test collector owner 之间做最终选择（`pasted-text.txt:30-37,97-125`）。
4. 没有归档 trace 可补足时点；real-stack 按安全合同关闭 trace，而不是遗漏了一份可读取的 trace（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/e2e-infra-audit.md:74-80`；`.trellis/spec/frontend/quality-guidelines.md:100-101`）。

### 3. E2E infra 与 gate 证据

1. 测试责任是分层且互补的：real-stack 负责真实业务状态到 Workbench projection/canonical navigation，root orchestration 负责独占资源、执行顺序与 cleanup，final gate 只在固定候选上重验全部阶段；不得新建第二套 Workbench orchestration（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/e2e-infra-audit.md:31-50`）。A26 应留在既有 Auth real-stack/production owner 范围内调查。
2. 定向 `PARTSIGNAL_E2E_V2_SPEC=... deploy/scripts/e2e-local.sh` 是受支持的独立诊断入口：它复用同一隔离数据库、Redis、storage、process 与 production preview，只运行目标 V2 spec，但不能替代完整 `make e2e` 或 Phase Exit Gate（`.trellis/spec/infra/e2e-isolation.md:12-25`）。
3. 真实栈无论成功、失败或信号退出都必须 `wait` 本次进程，精确清理 Redis keys、端口、数据库与临时目录；对应可观察证明是 `status=dropped`、`status=removed`、`status=deleted`、`status=released`（`.trellis/spec/infra/e2e-isolation.md:24-35`）。Abstraction review 已观察到 A26 失败路径仍完成这些 cleanup（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:130`）。
4. 失败收集不能靠宽泛过滤变绿。Frontend quality spec 规定普通 API/route chunk 的真实失败必须使测试失败，仅允许排除已知主动 refresh/Back/Forward 或成功删除导航产生的 `net::ERR_ABORTED`（`.trellis/spec/frontend/quality-guidelines.md:130-147`）。因此仅有 method/pathname 不足以证明可忽略。
5. 安全输出边界要求 real-stack 关闭 trace；失败诊断不得回显完整 URL、headers、body 或凭据。Infra spec 对 failure output 的稳定模式是保留 method、pathname 与浏览器错误文本，同时避免 capability query（`.trellis/spec/infra/e2e-isolation.md:38-43,65-72`）。
6. Abstraction review 的 gate 顺序是：固定候选上分别跑九个安全独立阶段；全部通过后才运行一次 `make verify`。任一 required stage 非零、cleanup 不完整、敏感输出或 P0/P1 未关闭即为 `NOT_MET`（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/e2e-infra-audit.md:126-169`）。实际因 A25/A26 未满足前置条件，所以没有运行 `make verify`（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:136`）。

### 4. A25 已关闭且与 A26 正交

1. A25 的根因是 unit/strict fixture 主动进入 `/`，却仍使用 Workbench UI 交付前的测试输入合同：App Shell broad GET mock 返回错误 shape，Auth/Platforms strict allowlist 对 Workbench GET 返回 501；它不是 Workbench product/route/generated contract 缺陷（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/research/audit.md:1-7,29-88`）。
2. A25 的修改仅覆盖四个测试文件：App Shell 精确 endpoint dispatch、导出现有 typed `emptyAggregate`，以及 Auth/Platforms 对精确 `GET /api/v1/workbench` 的 handler；unexpected 501、runtime error、teardown 与 secret scan 均保留（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/research/audit.md:90-105`）。
3. A25 明确禁止修改 `auth-session-real-stack.spec.ts`、Auth/query lifecycle 或 `requestfailed` 过滤，且要求 A26 同形症状出现时停止扩围（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/prd.md:50-54`）。设计也明确 A26 不兼容处理、不忽略、不缓解，Gate 继续 `NOT_MET`（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/design.md:68-73`）。
4. A25 Required Validation 全绿：App Shell `1 file / 6 tests`、完整 V2 unit `81 files / 463 tests`、Auth fixture mobile/desktop `2 passed`、Prompt fixture mobile/desktop `8 passed`，typecheck/lint/diff/task validate 均通过（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/implement.md:149-169`）。这些是 fixture/production-artifact 证据，不是 A26 真实栈生命周期证据；A25 任务明确未运行真实栈 Auth、完整 `make e2e` 或 `make verify`（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/implement.md:171-175`）。
5. A25 归档 metadata 明确 `a25_status=closed`、`a26_status=out_of_scope_open`，并继续保持 `current_gate=NOT_MET`（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/task.json:35-45`）。

### 5. Phase 8 父任务对本 blocker 的约束

1. 父任务当前 metadata 已把本任务列为 child；notes/meta 明确前三个交付 child、abstraction review、A25 都已完成，`current_gate=NOT_MET`、`blocker_count=1`、`active_blocker=A26`（`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/task.json:21-27,56-71`）。
2. `MET` 必须同时满足 Phase 8 无未关闭 P0/P1、独立 gate stages 全绿、唯一一次 `make verify` 退出 0、文档/合同/实现一致；任一 required validation 非零或存在独立 blocker 即 `NOT_MET`（`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/prd.md:78-93`）。
3. 父任务要求只有全部 blocker 经独立 Task 关闭后，才规划纯验证 recheck；不能在 blocker 修复过程中进入“一 blocker、一重跑”循环（`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/implement.md:143-176`）。
4. 07/08 的 Phase 8 完成状态是 gate 派生结果；`NOT_MET` 只记录 Task evidence，不提前写完成态（`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/design.md:136-142`）。

### 6. 对当前 blocker 规划的硬约束（不含修复选择）

1. 第一决策依据必须是安全、定向、一次性的真实证据：phase label、method、pathname、`errorText`；不能从归档中的粗粒度“logout 后”措辞推导 owner。用户要求只运行 Auth real-stack spec，收集一次证据后停止并回报（`pasted-text.txt:97-108`）。
2. 在证据出现前，production Auth/query owner 与 real-stack collector owner都只是候选；不得预设修复侧（`pasted-text.txt:97-125`）。
3. 任一 test-side 识别都必须同时受 method + pathname + exact `errorText` + 已标记 phase 约束；不能忽略全部 `ERR_ABORTED` 或全部 Workbench GET（`pasted-text.txt:110-125`）。
4. 任一 production-side 修正都必须保留 logout 后清理上一身份业务缓存，不得以延迟清理交换测试通过；若触及 AuthProvider，必须增加对应 unit test并先验证本地 TanStack Query API/语义（`pasted-text.txt:117-121,163-181`）。
5. requestfailed/console/pageerror 审计、服务端 logout、cookie/CSRF、`/login` 跳转、secret scan 与独立资源 cleanup 都必须保留；真实网络失败、非预期 endpoint/phase/errorText 仍必须失败（`pasted-text.txt:82-95,127-138,163-181`）。
6. 当前 blocker 不处理 A25，不改 Workbench aggregate/UI/business contract/canonical href，不改 backend/OpenAPI/generated types/database/V1，不运行完整 `make e2e`/`make verify`，不把 Phase 8 更新为 `MET`（`pasted-text.txt:127-138`）。

## Code Patterns

- **严格失败收集**：归档 A26 collector 只证明捕获了 `GET /api/v1/workbench`，不证明取消类别；稳定项目规则要求普通 API failure 默认失败，仅允许证实来源的窄 `net::ERR_ABORTED` 排除（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:53`；`.trellis/spec/frontend/quality-guidelines.md:139-147`）。
- **定向真实栈而非第二编排**：使用 `PARTSIGNAL_E2E_V2_SPEC=tests/e2e/auth-session-real-stack.spec.ts deploy/scripts/e2e-local.sh` 复用 production preview 与真实隔离栈；定向入口只用于诊断/相关验证（`.trellis/spec/infra/e2e-isolation.md:12-25,74-82`）。
- **失败输出最小化**：记录 phase/method/pathname/errorText，不记录完整 URL 或请求秘密；与 infra 中“保留 pathname/error text、禁止 query capability 回显”的既有模式一致（`.trellis/spec/infra/e2e-isolation.md:43,65-72`）。
- **Gate 与 blocker 分离**：blocker Task 先关闭 P1；完整 `make e2e`/`make verify` 属于 blocker 全部关闭后的独立 recheck，不在本任务重复总门禁（`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/implement.md:160-176`）。

## External References

- 无。此归档主题未使用互联网资料，也没有从第三方文档推导 A26 结论。
- 当前 `@tanstack/react-query` 的锁定版本、local types/source 与 cancellation semantics 属于另一项当前代码/依赖研究；归档材料没有给出可引用结论，不能在本文件中补猜。

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md:121-157` — V2 production artifact、request failure、Auth fixture 与根质量入口。
- `.trellis/spec/infra/e2e-isolation.md:22-43,74-86` — 定向真实栈、隔离资源、cleanup、trace/secret 与 Auth flow owner。
- `.trellis/spec/infra/ci-execution.md:19-28,49-56` — 完整 `verify`/`make e2e` 属于根 gate/手动 CI，不由本 blocker 的定向诊断替代。
- `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/prd.md:78-93` — Phase 8 `MET`/`NOT_MET` 权威条件。

## Caveats / Not Found

- 未找到持久化的 A26 phase timestamp、`request.failure().errorText`、trace、HAR 或逐事件日志；归档只持久化了 method/pathname 级失败摘要。因此本文件不能判定最终 owner或修复位置。
- `implement.md` 的“logout 后在途 Workbench GET”与 `research/audit.md` 的“离开首页还是 logout 未确定”粒度不同；以更精确、显式列出证据缺口的 finding 为准，不能把前者升级为已证实时点。
- A25 fixture suite 全绿不能证明 A26 已修复，因为 A25 明确跳过真实栈 Auth/完整根 gate，并禁止触碰 A26 owner。
- Abstraction review 的 pre-A26 E2E infra audit 主要规划测试分层、安全输出和 gate 顺序；它本身没有复现 A26。A26 的实际失败结果只出现在该任务后续综合 audit/implement evidence 中。
- 本研究未运行测试、真实栈、浏览器或 Git 操作，也未读取/修改产品代码；只写入当前任务的本 research 文件。
