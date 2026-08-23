# Research: Workbench 前端实施候选只读自审

- Query: 复核当前 `workbench.api.ts` / `workbench.model.ts` 候选的 query ownership、公开表面、依赖方向和错误语义，并归因 `make test-unit` / strict fixture 失败是否由本次候选引入。
- Scope: internal
- Date: 2026-08-24

## Findings

### 候选代码 findings

**无 finding。** 当前两处删除式简化符合已批准设计，没有发现行为回归或新增抽象：

1. `workbenchQueryOptions` 仍是唯一 TanStack Query owner：`frontend-v2/src/domains/workbench/workbench.api.ts:8-20` 只有一个 query options、一个固定 key `['workbench', 'aggregate']` 和一个 `GET /api/v1/workbench`；route 与 page 继续消费同一导出（`frontend-v2/src/routes/_app/index.tsx:3-14`、`frontend-v2/src/domains/workbench/workbench-page.tsx:7,22-36`）。没有第二 endpoint、hook、store 或 cache/source。
2. 公开表面已正确收窄：`workbench.api.ts:45` 只导出 `workbenchQueryOptions`；全仓手写源码/测试搜索未发现已删除 `WorkbenchRequestError` 或 `workbenchKeys` 的引用。`workbench.model.ts:104-112` 不再导出 `workbenchCountLabels`，map 仍由同文件 `resolveWorkbenchCounts` 使用（`:15-22,58-89`），不是死代码。
3. 错误语义保持：结构化 `ErrorEnvelope` 仍由 local guard 检查（`workbench.api.ts:22-43`）；已知错误仍输出 `${message}（请求 ID：${request_id}）`（`:23-26`），未知错误仍输出 HTTP status（`:27`）。页面仍按标准 `Error.message` 展示并由同一 query `refetch`（`workbench-page.tsx:26-32,162-164`）。删除 custom error 的未消费 `status/detail` 没有可观察消费者。
4. 依赖方向保持 `route -> workbench domain -> design-system/shared`：API 仅导入 TanStack Query、shared client 和 generated types（`workbench.api.ts:1-4`）；model 仅导入 generated types（`workbench.model.ts:1`）；手写 Design System/shared 搜索仍无 domain/route import。没有把 Workbench DTO、category、权限或状态提升到 shared。
5. 本候选没有改变 Workbench endpoint、query key 值、route loader/page 挂载行为或 strict fixture；早期静态基线已经记录同一 endpoint/key/loader-page ownership（`research/frontend-audit.md:49-56,65-70`）。

### Blocker A — UNIT-FIXTURE-01 / P1 / Out-of-scope blocker requiring independent Task

`make test-unit` 的 Frontend V2 App Shell 导航测试用单一 ProductList shape 响应所有 GET，未声明 Workbench aggregate：

- 实际唯一失败是 `frontend-v2/src/app/layout/app-shell.test.tsx:160-170` 的“pathname 导航聚焦主内容，search-only 更新不抢焦点”。
- `app-shell.test.tsx:161-164` 的 broad `api.GET` mock 对 Workbench 与 Product route 都返回 `{ items, page, page_size, total }`；根 route 通过 `routes/_app/index.tsx:8-12` 读取 `GET /api/v1/workbench` 时缺少 `actionable_counts.fact_reviews`，因此 model 显式失败。
- 当前候选未修改 route/page/test，也未增加请求；删除 custom Error/query registry 不改变根 loader 行为。

**归因**：既有 AppProviders unit harness 未随 Workbench 根 route 补齐 aggregate response，不是本次候选 diff。它使 required `make test-unit` 非零，故在独立修复并重新验证前 Phase 8 必须 `NOT_MET`。

### Blocker B — STRICT-FIXTURE-01 / P1 / Out-of-scope blocker requiring independent Task

`make e2e` 的两组 production strict fixtures 都进入真实 `/` Workbench route，但各自 allowlist 未声明 `GET /api/v1/workbench`：

1. **Auth fixture**
   - `frontend-v2/tests/e2e/auth-session.spec.ts:131-145` 在强制改密和自助改密后两次进入 `/`，并在 `:135` 明确断言“工作台”。
   - fixture 只允许 Auth endpoints（`:38-90`），其余请求在 `:91-100` 记为 unexpected 并返回 501。
   - 持久化失败证据明确记录 `GET /api/v1/workbench` 与 501 console error：`frontend-v2/.cache/playwright-results/auth-session-...-foundation-desktop/error-context.md:9-39`；mobile 同形失败。

2. **Prompt/Platforms fixture**
   - `frontend-v2/tests/e2e/prompt-workspace.spec.ts:14-24` 显式 `page.goto('/')` 后通过主导航进入 Prompt Workspace。
   - `prompt-workspace.fixture.ts:2,159-161` 扩展 `platforms.fixture`；Platform fixture 的 API router 只声明 Auth/CSRF/platform profiles/commands，并在 `frontend-v2/tests/e2e/fixtures/platforms.fixture.ts:165-230` 将其他请求记为 unexpected 501。
   - 持久化失败证据明确记录 unexpected `GET /api/v1/workbench`：`frontend-v2/.cache/playwright-results/prompt-workspace-...-foundation-desktop/error-context.md:9-25`；mobile 同形失败。

**归因**：两个既有 strict harness 都主动进入 Workbench 根 route，却仍保留 Workbench UI 交付前的 API allowlist。当前候选未修改 route/page/spec/fixtures，也未增加请求；失败不是公开表面删除或普通 `Error` 引入。它使 required `make e2e` 非零，故在独立修复并重新验证前 Phase 8 必须 `NOT_MET`。

### Blocker grouping

| Blocker | Severity | Owner | 当前任务归因 | Gate impact |
| --- | --- | --- | --- | --- |
| `UNIT-FIXTURE-01` | P1 | `frontend-v2/src/app/layout/app-shell.test.tsx` 的 App Shell test harness | broad GET mock 未按 endpoint 返回根 Workbench response；非本次 diff | `make test-unit` required stage 非零，Phase 8 `NOT_MET` |
| `STRICT-FIXTURE-01` | P1 | Auth strict fixture + Prompt/Platforms strict fixture | 既有 allowlist 缺少根 Workbench GET；非本次 diff | `make e2e` required stage 非零，Phase 8 `NOT_MET` |

两组 blocker 的共同根因是“已有测试进入 `/`，但测试 owner 未声明 Workbench root loader 的 aggregate dependency”。建议作为一个独立 fixture-convergence Task 批量修复 unit + 两个 strict owners；不得在当前 abstraction-review 候选中放宽 unexpected API 审计或吞掉 501。

## Caveats / Not Found

1. 没有发现当前 `workbench.api.ts` / `workbench.model.ts` 的 P0/P1/P2 code finding。
2. Playwright 的四个失败有持久化 `.cache/playwright-results` 证据；本 research 没有重跑未变化的失败阶段。
3. 主会话实际输出记录 V2 `462 passed, 1 failed`；unit 归因由该唯一失败、broad mock shape 与根 loader 调用链共同确认。
4. 未执行 Git 操作，未比较历史 diff；“非本次候选引入”由当前精确 change design、未变 route/page/fixtures、归档定向范围和同一 endpoint/query behavior 共同证明。
