# A25 Workbench Root Fixture Convergence 审计

## 1. 结论

A25 是一个测试合同收敛问题，不是 Workbench 产品、route loader 或 generated contract 缺陷。三个失败 owner 都主动进入 `/`，真实调用链都会执行 `routes/_app/index.tsx` 的 Workbench loader；测试仍保留 Workbench UI 交付前的 fixture 合同，因此分别返回错误 shape 或 strict 501。

最小修复为：App Shell unit 对两个真实 GET 精确分流；Auth 与 Platforms strict fixture 对精确 Workbench GET 返回现有 Playwright `emptyAggregate`。Prompt fixture 已继承 Platforms owner，无需另加 handler；产品代码和 A26 均不修改。

## 2. 前置核验

| 检查 | 证据 | 结论 |
| --- | --- | --- |
| 主工作区 | `git status --short --branch`：`main...origin/main [ahead 273]`，创建 Task 前 clean | 通过；未 pull。 |
| abstraction review | `5ef6ecff chore(task): archive 08-23-frontend-v2-workbench-abstraction-review` 已在当前 `main` 历史 | 已合入并归档。 |
| 遗留分支 | `git branch --list codex/frontend-v2-workbench-abstraction-review` 无输出 | 无本地遗留分支。 |
| worktree | `git worktree list --porcelain` 只有 `/Users/sc/PycharmProjects/partsignal` 的 `main` | 无遗留 worktree。 |
| 当前 Task | `08-24-frontend-v2-workbench-root-fixture-convergence-blocker`，parent 为 Phase 8 planning Task，status=`planning` | 父子关系正确；未 start/建分支。 |

## 3. 权威合同与数据来源

- `frontend-v2/src/shared/api/generated/schema.d.ts:1983-1997`：`GET /api/v1/workbench` 的唯一 operation 为 `getWorkbench`。
- `frontend-v2/src/shared/api/generated/schema.d.ts:5218-5283`：`WorkbenchAggregate` 的 required shape 为 generated_at、六类 actionable counts、四域 workflow health、三项 rate 与 recent attention items。
- `frontend-v2/src/shared/api/generated/schema.d.ts:9703-9722`：200 response 是 `WorkbenchAggregate`，无 query/body。
- `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts:65-82`：既有 `emptyAggregate` 已由 `satisfies components['schemas']['WorkbenchAggregate']` 约束，counts 为 0、recent items 为空、rate 为 `0/0/null`，是 Playwright 内稳定且最小的数据来源。
- `frontend-v2/src/domains/workbench/workbench.model.ts:58-98`：页面会完整读取 counts、health、GEO rate；错误 shape 必须显式失败，不能用兼容默认值掩盖。

决定：Playwright owner 复用 `emptyAggregate`；Vitest 在 App Shell test 文件内声明自己的最小 typed aggregate。后者不导入 Playwright fixture，避免 test runner、alias/config 和 fixture lifecycle 发生错误耦合。

## 4. 三个失败 owner 的实际请求路径

### A25-U1 — App Shell unit

```text
app-shell.test.tsx:160 测试
  -> renderRoute('/')
  -> routes/_app/index.tsx:8-12 loader
  -> workbenchQueryOptions()
  -> api.GET('/api/v1/workbench')
  -> app-shell.test.tsx:161-164 broad mock 返回 ProductList shape
  -> WorkbenchPage / resolveWorkbenchCounts 读取 actionable_counts.fact_reviews
  -> 响应结构错误，unit failure

随后用户点击“产品”
  -> /products route loader
  -> api.GET('/api/v1/products', { params: { query } })
  -> 同一个 broad mock 返回 ProductList shape
  -> 产品列表与 pathname focus 断言继续
```

Root cause：同一 broad mock 偶然适合 Products，却污染先发生的 Workbench root GET。最小 owner 是该 test 本身；按 endpoint 返回 `WorkbenchAggregate` / ProductList，并对第三种 GET 显式抛错。

### A25-E1 — Auth strict fixture

```text
auth-session.spec.ts
  -> POST /api/v1/auth/login
  -> POST /api/v1/auth/change-password
  -> routes/account/security.tsx:14-22 在刷新后的 user 不再 must_change_password 时 navigate('/')
  -> _app auth boundary
  -> routes/_app/index.tsx loader
  -> GET /api/v1/workbench
  -> auth-session.spec.ts:38-96 catch-all 未命中 Auth allowlist
  -> unexpectedRequests 记录 GET /api/v1/workbench + 501

自助改密完成后相同 navigate('/') 再发生一次。
```

测试在 `auth-session.spec.ts:134-145` 明确验证两次 `/`，并在首次验证 Workbench heading；进入根路由是受保护用户行为，不能删除。精确 handler 应位于 Auth fixture 的既有 catch-all 内，teardown `unexpectedRequests === []` 保留。

### A25-E2 — Prompt / Platforms strict fixture

```text
prompt-workspace.spec.ts:14-24
  -> page.goto('/')
  -> _app auth boundary（Platforms fixture 提供 ADMIN auth/me + csrf）
  -> routes/_app/index.tsx loader
  -> GET /api/v1/workbench
  -> prompt-workspace.fixture.ts:2,159-161 继承 platforms.fixture.ts
  -> platforms.fixture.ts:165-230 catch-all 未命中 allowlist
  -> unexpectedRequests 记录 GET /api/v1/workbench + 501

Workbench 渲染后
  -> App Shell 主导航“Prompt 管理”
  -> /settings/prompts
  -> Prompt Workspace 自有 platform-prompts/content routes
```

实际 API allowlist owner 是 `platforms.fixture.ts`，不是 `prompt-workspace.fixture.ts`。因此只在 Platforms catch-all 增加精确 Workbench GET；Prompt fixture/spec 无需修改，仍完整证明 fixture 继承与真实导航。

## 5. 精确修改矩阵

| 文件 | 最小修改 | 保留边界 |
| --- | --- | --- |
| `frontend-v2/src/app/layout/app-shell.test.tsx` | 增加本地 typed 最小 Workbench aggregate 与 ProductList；broad GET mock 改为精确 endpoint 分支，未知 GET 抛错 | pathname/search focus、真实 router/App Shell、其他测试不变 |
| `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts` | 将现有 `emptyAggregate` 加入 export | 数据和值不变，不改变 Workbench fixture handler/audit |
| `frontend-v2/tests/e2e/auth-session.spec.ts` | 导入 `emptyAggregate`；在 Auth catch-all 中精确处理 `GET /api/v1/workbench` | Auth 501、teardown、真实 `/`、改密/403/logout/secret scan 不变 |
| `frontend-v2/tests/e2e/fixtures/platforms.fixture.ts` | 导入 `emptyAggregate`；在 Platforms catch-all 中精确处理 `GET /api/v1/workbench` | 其他 endpoint allowlist、501、runtime/teardown audit 不变 |

明确不修改 `prompt-workspace.spec.ts` 与 `prompt-workspace.fixture.ts`：前者保留真实 `/`/导航行为，后者已通过 `base` 继承修正后的 Platforms allowlist。新增第二 handler 只会重复 owner。

## 6. Strict audit 保持方式

- 两个 handler 都匹配 `method === 'GET' && pathname === '/api/v1/workbench'`；不使用 `**/workbench*`、method wildcard、fallback success 或 unknown-response default。
- Auth 的 `unexpectedRequests` 与 Platforms 的 `unexpectedRequests`、`runtimeErrors` 保持原样；所有其他未声明 `/api/v1/**` 仍进入 501 分支并在 teardown 失败。
- 不修改 Playwright `requestfailed` 过滤逻辑；A26 不会借本任务被忽略。

## 7. 验证边界

Required Validation 只覆盖 A25 owner 及直接交叉影响：App Shell 定向 unit、完整 V2 unit、Auth 两 project、Prompt 两 project、typecheck、lint、diff 与 Task artifacts。

不运行 `make verify`、完整 `make e2e`、Workbench 专属 E2E 或真实栈 Auth。Workbench 专属 fixture 已在归档 UI Task 证明 aggregate UI；本任务只收敛消费者 fixture。真实栈 logout race 属于 A26；Phase 8 最终 gate 属于所有 blocker 关闭后的独立 recheck。

## 8. A26 隔离

A26 的 owner 是 `auth-session-real-stack.spec.ts` 与 Auth/query lifecycle；其症状是 logout/导航期间在途 `GET /api/v1/workbench` 的 `requestfailed`，不是 strict fixture 的 501。当前任务不得修改 real-stack spec、production query cancellation、logout 或 error collector。若 A25 定向命令暴露该症状，停止并记录，不增加笼统 `ERR_ABORTED`/Workbench GET 忽略分支。

## 9. 风险与停止条件

- 若现有 `emptyAggregate` 无法独立导入，先确认模块循环或 Playwright fixture side effect；不得直接创建 framework。只有证据证明导入不可用时，才以一个纯数据模块作为最小替代并重新提交规划差异审核。
- 若精确 handlers 后仍有 501，记录实际 method/path 并停止；不得扩大 pattern。
- 若完整 unit/E2E 出现不属于四个精确文件的新 owner failure，完成仍安全的独立检查后批量报告，不扩修。

本规划阶段未运行任何测试、typecheck、lint、build 或 gate；执行结果必须在实施后真实记录。
