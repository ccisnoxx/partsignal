# Frontend V2 Published Content Issues — Design

## 1. 根问题与最小设计

现有 list item 足够绘制 Issues 表，但当前 detail 不能独立支撑 Workspace，`repair-context` 又把当前 Fact 候选与多个完整跨域对象塞进载荷。最小可维护设计是：保留现有 list 和 repair options endpoint，新增一个只服务首屏的窄 Workspace Context。

```text
GET /api/v1/published-content-issues
  ?status=OPEN&page=1&page_size=20

GET /api/v1/published-content-issues/{issue_id}/workspace-context
  -> issue: PublishedContentIssueOut
  -> article: PublishedArticleOut
  -> repair_task: ContentTaskOut | null

GET /api/v1/published-content-issues/{issue_id}/repair-context
  -> 仅 CREATE_REPAIR_TASK Dialog 按需读取候选
```

不新增数据库表、issue event/evidence 模型、通用 workspace builder 或客户端 join。

## 2. Canonical 所有权

| Surface | Canonical owner | 不拥有 |
|---|---|---|
| `/publishing/articles/$articleId` | 不可变 Article artifact；`OPEN_ISSUE` 短入口与已有 issue handoff | issue repair/resolution Workspace |
| `/publishing/issues` | issue 扫描、status filter、pagination、row actions | Article/Task 客户端 join |
| `/publishing/issues/$issueId` | issue detail、repair/resolution、不可变历史与关联上下文 | Article 编辑、Content Task 编辑器 |
| `/content/tasks/$taskId` | repair task 的实际内容生产生命周期 | issue resolution |

Article detail 增加问题登记命令不改变 Article payload 的不可变性；命令只创建独立 `PublishedContentIssue` 并立即交接到 Issue Workspace。

## 3. Backend read model 与 snapshot

### 3.1 List

沿用现有 `PublishedContentIssueListItem`。router 在进入 service 前建立 `REPEATABLE READ`，使：

```text
count
→ current page issues
→ frozen article display/health
→ repair task id/status
→ workflow_stage/primary_task/available_actions
```

来自同一 snapshot。查询必须继续批量化，不能逐行调用 detail presenter。

### 3.2 Workspace Context

新增 `PublishedContentIssueWorkspaceContext`，只复用已有 contract types：

```python
class PublishedContentIssueWorkspaceContext(ContractModel):
    issue: PublishedContentIssueOut
    article: PublishedArticleOut
    repair_task: ContentTaskOut | None
```

Service 只装配一次 Article detail，并用同一个 Article projection 构造 issue nested Article summary，避免当前 `repair-context` 中重复调用 `published_article_out()`。repair task 必须满足 `source_published_content_issue_id == issue.id`；不一致或关联缺失时返回 `PUBLICATION_CONTEXT_INCOMPLETE`。

Context 固定使用 Article 的 PASSED verification 和来源 ContentVersion snapshot；不得读取 ContentTask current pointer替代发布时内容。Article/Work/verification/source ID/hash invariant 继续复用 Published Articles 已有服务端校验。

### 3.3 Repair Context

现有 `PublishedContentRepairContext` 保持响应兼容，并加同请求 `REPEATABLE READ`。它是 action-time options：

- 只在 `CREATE_REPAIR_TASK` Dialog 打开时读取；
- 候选只来自同产品、非空、当前 `APPROVED FactVersion`；
- response 可与较早的 Workspace snapshot 不同，这是按需选项的预期语义；
- POST 仍锁 issue/fact/platform 并重新验证 `expected_issue_revision` 与资格，因此 options 不是授权。

## 4. 动作投影与 Registry

### 4.1 服务端矩阵

| Issue | Repair task | Stage | Primary task | Available actions |
|---|---|---|---|---|
| OPEN | none | OPEN | HANDLE_CONTENT_ISSUE | CREATE_REPAIR_TASK, RESOLVE |
| OPEN | OPEN | REPAIRING | CONTINUE_REPAIR | RESOLVE |
| OPEN | COMPLETED | AWAITING_RESOLUTION | CONFIRM_RESOLUTION | RESOLVE |
| OPEN | CANCELLED | AWAITING_RESOLUTION | CONFIRM_RESOLUTION | RESOLVE |
| RESOLVED | any/none | RESOLVED | VIEW_RESOLUTION | empty |

`CANCELLED` 不能继续编辑且唯一 repair source 阻止创建第二个任务，所以最小诚实投影是等待用户显式决定 resolution；它不等价于修复成功。

### 4.2 前端映射

Issue domain registry 把 token 映射到 presentation，不计算 eligibility：

```text
HANDLE_CONTENT_ISSUE + CREATE_REPAIR_TASK -> open repair dialog
CONTINUE_REPAIR + repair_task_id          -> /content/tasks/$taskId
CONFIRM_RESOLUTION + RESOLVE              -> open resolution dialog
VIEW_RESOLUTION                           -> issue Workspace #resolution
remaining RESOLVE                         -> overflow
```

缺少所需 token 或 ID 是 contract violation，必须抛出开发者可见中文错误；不得退回到 status 映射或隐藏不一致。

## 5. URL 与页面结构

### 5.1 List

```text
/publishing/issues?status=OPEN&page=1&pageSize=20
```

- `status`: `OPEN | RESOLVED | ALL`，默认 OPEN 且始终显式；ALL 映射 API `status=undefined`。
- `page/pageSize` 始终显式；V2 pageSize 只接受 10/20/50。
- 不增加 q/sort/kind/platform/date；当前后端与 V1 都没有该需求。
- 过滤和 pageSize 变化回 page 1。

列固定为：问题、平台、状态、打开时间、修复任务、操作。问题标题链接 Workspace；final URL 不在表内重复，可在 Workspace 打开。

### 5.2 Workspace

默认 URL：`/publishing/issues/$issueId#issue`。

```text
PublishedContentIssueWorkspacePage
├── Header: article title + issue status/stage
├── WorkspaceShell
│   ├── Context
│   │   ├── issue kind/status/revision/opened_at
│   │   └── section navigation
│   ├── Main
│   │   ├── #issue: description + immutable notice
│   │   ├── #article: final URL/platform/source Markdown/PASSED verification
│   │   ├── #repair: task status/link or no-task state
│   │   └── #resolution: outcome/comment/actor/time or pending state
│   └── Reference
│       └── #history: issue milestones + Publication events
└── StickyActionBar
    ├── create repair task
    └── resolve issue
```

`issue` main artifact 始终可用。`WorkspaceShell` 继续在 `<1280px` 使用 tabs、`>=1280px` 三栏；不新增 Issue-specific responsive framework。

当前“证据”落在 issue description、final URL、不可变来源 Markdown、PASSED verification 与 Publication event context；页面明确没有 issue-specific 附件，不渲染上传占位。

## 6. Mutation 与 cache

### 6.1 Open issue

```text
PublishedArticle.available_actions includes OPEN_ISSUE
→ Dialog(kind, description)
→ POST /published-articles/{article_id}/issues + CSRF
→ response PublishedContentIssueOut
→ invalidate Article list/detail + issue list + summary
→ navigate /publishing/issues/{issue.id}#issue
```

若 Article `primary_task=HANDLE_CONTENT_ISSUE`，使用 `open_issue_id` 直接交接；缺 ID 显式失败。

### 6.2 Create repair task

```text
open Dialog
→ fetch repair-context
→ choose server fact_candidate
→ POST fact_version_id + context.issue.revision + CSRF
→ response ContentTaskOut
→ invalidate issue workspace/list + Article projections + Content projections + summary
→ refetch Workspace; do not patch ContentTaskOut into Context
```

创建成功不增加 issue revision，也不改变 issue status。Workspace 通过 refetch 获得 repair task 和新的 primary task。

### 6.3 Resolve

```text
POST outcome + nonblank comment + context.issue.revision + CSRF
→ canonical issue response
→ invalidate/refetch whole Workspace and related projections
→ stay on #resolution
```

即使 repair task OPEN/CANCELLED/COMPLETED，resolve 都不修改它。

### 6.4 Conflict

- mutation pending 防双提交；
- 409 保留 RHF values 与 Dialog；
- 标记 Context stale，禁用旧动作，显示 server message/request ID；
- 只有显式 reload 才重读 Context；
- reload 后 token/ID 不再有效则关闭 Dialog，不自动重放。

## 7. Error 与权限

| Boundary | 401 | 403 | 404 | 409 | 422 |
|---|---|---|---|---|---|
| Issue list | session | restricted session | — | broken projection | query validation |
| Issue detail/context | session | restricted session | issue missing | broken lineage/source | UUID validation |
| Repair context | session | restricted session | issue/resource missing | context incomplete | UUID validation |
| Open/repair/resolve | session | account type/CSRF | target missing | stale/invalid state/qualification | payload validation |

所有错误继续使用 `ErrorEnvelope`。Frontend 复用 `PublicationRequestError/mapPublicationError`，不创建第二个 error parser。

## 8. 预计文件与依赖

### Contract/backend

```text
contracts/openapi.yaml
backend/app/schemas/publication.py
backend/app/services/publication_queries.py
backend/app/routers/publication.py
backend/tests/unit/test_security_and_publication.py
backend/tests/integration/test_publication_workflow.py
frontend/src/shared/api/schema.d.ts                    # generated only
frontend-v2/src/shared/api/generated/schema.d.ts       # generated only
```

`backend/app/services/publication.py` 预计不改：现有三个命令锁、revision、权限与资格守卫已经满足。若实施发现命令语义必须改变，先回到规划，不顺手扩展。

### Frontend runtime

```text
frontend-v2/src/app/navigation.ts
frontend-v2/src/app/navigation.test.ts
frontend-v2/src/routeTree.gen.ts                        # generated
frontend-v2/src/routes/_app/publishing/issues/route.tsx
frontend-v2/src/routes/_app/publishing/issues/index.tsx
frontend-v2/src/routes/_app/publishing/issues/$issueId.tsx
frontend-v2/src/domains/publication/publication.api.ts
frontend-v2/src/domains/publication/published-article-detail-page.tsx
frontend-v2/src/domains/publication/published-content-issue.model.ts
frontend-v2/src/domains/publication/published-content-issue-list-page.tsx
frontend-v2/src/domains/publication/published-content-issue-workspace-page.tsx
frontend-v2/src/domains/publication/published-content-issue-workspace-actions.tsx
```

`published-content-issue-workspace-actions.tsx` 有真实 RHF/Dialog/mutation/conflict/focus 责任；不再拆每个 action 的 thin wrapper。

### Tests/fixtures/docs

```text
frontend-v2/src/domains/publication/publication.api.test.ts
frontend-v2/src/domains/publication/published-article-detail-page.test.tsx
frontend-v2/src/domains/publication/published-content-issue.model.test.ts
frontend-v2/src/domains/publication/published-content-issue-list-page.test.tsx
frontend-v2/src/domains/publication/published-content-issue-workspace-page.test.tsx
frontend-v2/src/domains/publication/published-content-issue.test-fixtures.ts
frontend-v2/tests/e2e/fixtures/publication.fixture.ts
frontend-v2/tests/e2e/published-content-issues.spec.ts
docs/frontend-v2/03-page-and-workflow-blueprint.md
docs/frontend-v2/05-business-actions-state-and-api-contract.md
docs/frontend-v2/07-migration-plan.md
docs/frontend-v2/08-testing-quality-and-acceptance.md
docs/frontend-v2/09-architecture-decisions.md
.trellis/spec/backend/publication-workbench-guidelines.md
.trellis/spec/frontend/state-management.md
```

若 complex fixture 只被一个 component suite 消费，则省略 `published-content-issue.test-fixtures.ts` 并保持测试内联；不得为了目录对称创建空 wrapper。

## 9. 拆分结论与回滚

**结论：不拆。** List + Workspace + Article handoff 仍是一个可 review 目标：一个 Issue lifecycle canonical surface。现有 list/commands 可复用，唯一新增后端行为是窄 read model、snapshot dependency 与 cancelled projection 修正；没有数据库、GEO、evidence upload、真实栈完整 E2E 或新框架。

预计约 20 个主要 runtime/contract 文件，测试、generated 与文档另计，处于 `07` 推荐范围上限。若实施证明确实需要数据库 evidence/history、repair task 重建或跨域公共抽象，必须停止并拆出后续 Task，不扩大当前 diff。

回滚整个 Task commit 即可；无 migration、数据回填、双写或外部状态清理。
