# Frontend V2 Published Content Issues — Implementation Plan

> 当前状态：实施中。用户已批准，Task 已激活并在规定的临时分支实施。

## 1. 有序实施清单

### 1.1 Contract 与 backend read model

1. 在 `backend/app/schemas/publication.py` 增加 `PublishedContentIssueWorkspaceContext`，只复用既有 Issue/Article/ContentTask schemas。
2. 在 `contracts/openapi.yaml` 增加 workspace-context GET，并补齐 issue list/detail/repair-context/open/repair/resolve 的实际 401/403/404/409/422 responses。
3. 在 `backend/app/services/publication_queries.py`：
   - 修正 `CANCELLED` repair task 投影；
   - 增加单次装配的 workspace context；
   - 保持 list 批量投影与固定查询边界；
   - 校验 issue/article/repair source identity，未知上下文明示 409。
4. 在 `backend/app/routers/publication.py` 注册 workspace route，并为 issue list/detail/workspace/repair-context 增加现有 repeatable-read dependency。
5. 增加 unit/integration tests：五种 issue/repair 状态矩阵、list/context snapshot identity、固定查询数、权限/errors、open→repair→resolve 独立性与数据库不可变历史。
6. 生成 V1/V2 OpenAPI schema 并运行 contract check；不得手改 generated types。

### 1.2 Frontend model、API 与 Article handoff

1. 扩展 `publicationKeys` 与 API owner：issue lists、workspace contexts、repair contexts、open/repair/resolve functions；复用同一 error/CSRF boundary。
2. 新建 issue model：canonical search/hash、status/stage labels、primary/overflow exhaustive resolver、payload schemas/formatters；不从 raw status/role 推导 eligibility。
3. 在 Published Article detail 增加 Issue lifecycle 的最小交接：
   - `OPEN_ISSUE` token → kind/description Dialog；
   - `HANDLE_CONTENT_ISSUE + open_issue_id` → canonical Issue link；
   - Article source/result remains readonly。

### 1.3 List、Workspace 与 routes

1. 组合现有 Table Kit 交付固定六列 Issues List、status filter、loading/empty/filtered-empty/stale/error/pagination。
2. 组合现有 WorkspaceShell/DetailSection/MarkdownPreview/Timeline 交付单 Context Workspace 与五个 canonical hash。
3. 使用一个 domain-local actions component 组合 create-repair/resolve Dialog、按需 options、409 保留/显式 reload、pending 与 focus return。
4. 注册 thin routes、navigation/navId、breadcrumb 和 generated route tree。
5. 成功命令精准失效 issue/article/publication summary/content task projections；不做局部猜测性 context patch。

### 1.4 Tests、文档与自审

1. 扩展 generated-type publication fixture；任何未声明 API 返回 501 并使 teardown 失败。
2. 新增 issue production-artifact spec，覆盖 URL、动作矩阵、Article open handoff、repair/resolve、errors、keyboard/focus 和 responsive。
3. 更新 `03/05/07/08/09` 与 backend/frontend stable specs；`contracts/database.md` 不改，因为持久化 invariant 未变化。
4. 检查 route → publication domain → design-system/shared 依赖、network request 数、无 status/role eligibility、无 issue evidence placeholder、无下一 Task 内容。

## 2. Required validation

### Contract/generated types

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
```

`frontend/src/shared/api/schema.d.ts` 仅是根合同要求的机械生成文件；不得修改 V1 runtime/page/test。

### Backend unit/integration

先用精确节点证明动作矩阵与 Issue read model；实施时按实际新增 test node 名替换下面占位名：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_published_content_issue_list_and_workspace_context_are_consistent_and_bounded \
  backend/tests/integration/test_publication_workflow.py::test_published_content_issue_open_repair_and_resolve_remain_independent \
  -q
```

必需证明：

- no-task/OPEN/COMPLETED/CANCELLED/RESOLVED 精确 stage/primary/actions；
- list/context/repair-context 的 snapshot identity 与查询次数不随页行/history 增长；
- 401/403/404/409/422 runtime 与 OpenAPI 一致；
- create repair 不解决 issue，resolve 不修改 repair task；
- stale revision、candidate 过期、重复 repair task 和非法状态显式失败；
- issue payload/history 与 repair source 不可原地修改或直接删除。

### Frontend V2 targeted unit/component

```bash
npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/published-article-detail-page.test.tsx \
  src/domains/publication/published-content-issue.model.test.ts \
  src/domains/publication/published-content-issue-list-page.test.tsx \
  src/domains/publication/published-content-issue-workspace-page.test.tsx
```

必需断言：canonical search/hash、单 list/context GET、四种 primary 映射、unknown/missing contract fail-fast、Article open payload/CSRF/handoff、repair options 按需、resolve payload、cache invalidation、409 本地保留/显式 reload、initial/stale errors、不可变展示与无 evidence uploader。

### Frontend V2 static/build

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

### Production-artifact fixture Playwright

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/published-content-issues.spec.ts
```

覆盖：

- default/invalid canonical URL、OPEN/RESOLVED/ALL、pagination、direct/refresh/Back/Forward；
- Article `OPEN_ISSUE` Dialog → returned ID Workspace；已有 issue handoff；
- list → Workspace、五个 hashes、single Context GET、repair-context 只在点击后出现；
- create repair 后 issue 仍 OPEN、task link/continue、cancelled task 不显示继续修复；
- resolve 后只读 outcome/comment，repair task 不被前端命令修改；
- 403/404/409/422/request ID、409 no replay、Dialog focus return；
- 375/768/1024/1280/1440、keyboard、table semantics、status 不只靠颜色、document 无横向溢出；
- console/pageerror/requestfailed 与未声明 API 均失败。

### Diff hygiene

```bash
git diff --check
git status --short
```

## 3. Optional validation

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
make verify
deploy/scripts/e2e-local.sh
```

- 完整 V2 suites、完整 backend integration、`make verify` 与真实栈 Publishing flow 默认 optional：targeted PostgreSQL、component 与 production-artifact fixture 已直接证明当前 Task；用户明确排除了 Publishing 完整 E2E。
- 下一 Phase 4 Publishing E2E Task 必须在现有唯一隔离 orchestration 中连续验证 Article → open issue → repair task → resolve；不得为当前 Task 新建第二套脚本。
- optional failure 只有在证据指向本 Task diff 时进入修复范围。
- 若实施改变数据库、权限规则、共享 error parser、Workspace/Table primitives 或其他领域 action contract，先回到规划并把相应 broader gate 升为 required。

## 4. Visual QA 与 accessibility

- List：长标题/description/platform、无 repair task、OPEN/RESOLVED、loading/empty/filtered-empty/error、10/20/50 pagination。
- Workspace：长 Markdown/final URL/comment、多 Publication events、无 repair task、OPEN/COMPLETED/CANCELLED repair、RESOLVED。
- 宽度：List 375/768/1024/1440；Workspace 额外 1280，确保 Main artifact 可用、tabs/三栏切换正确、StickyActionBar 不遮正文。
- 键盘：primary link、overflow menu、Dialog trap/close、return focus、显式 reload、external link label、visible focus。
- 使用现有 Playwright Test Runner；只有自动断言无法解释的视觉问题才使用独立命名 `playwright-cli` session，并在 final 前关闭。

## 5. Review、rollback 与停止条件

- 核对 browser network：列表一个 GET、Workspace 首屏一个 Context GET；repair-context 仅 action-time；无 Article/Task/Fact list join。
- 核对 `primary_task/available_actions/repair_task_id` invariant，尤其 CANCELLED repair task。
- 核对命令均携带 CSRF/revision（open endpoint 现有合同无 revision）且成功后重读 canonical context；409 不重放。
- 核对 issue/Article/history 均无原地编辑、删除、证据上传或 GEO capability。
- 核对 docs、OpenAPI、backend、generated schemas、frontend tests 一致；`contracts/database.md` 无需更新的原因写入 closeout。
- 回滚整个 Task commit；无 migration/data cleanup。
- 若需要 issue-specific evidence schema、repair task recreation、RESOLVED reopen、公共 workflow framework 或超过本规划的跨域修改，立即停止实施并返回 Phase 1 拆分。

## 6. Pre-start gate

- [x] `prd.md`、`design.md`、`implement.md` 已完成初稿与收敛 pass。
- [x] Blocking open questions 为零。
- [x] 用户已审核最新 planning summary 并显式批准实施。
- [x] 批准后才运行 `task.py start`。
- [x] 批准后才按 Frontend V2 例外创建 `codex/frontend-v2-published-content-issues` 临时分支。

## 7. 实施与验证结果

- 已交付 Issues List、单 Context Workspace、Article open/handoff、repair/resolve Dialog、cancelled repair 投影、repeatable-read 读边界、OpenAPI/generated types、fixture E2E 与权威文档同步。
- `make contract-check`：通过，FastAPI、OpenAPI 与 V1/V2 generated types 一致。
- Backend unit：13 tests passed；PostgreSQL `test_failed_verification_remains_pending_then_completes_and_opens_issue`：passed。
- Frontend targeted component：6 files / 22 tests passed；`lint`、`typecheck`、production `build` 均通过。
- Production-artifact Playwright：Issues mobile/desktop 6 tests passed；直接受影响的 Published Articles mobile/desktop 6 tests passed。
- `git diff --check`：通过。完整 V2 suite、完整 backend integration、`make verify` 与 Publishing 真实栈完整 E2E 仍按计划保持 optional/out of scope。

当前必须停在此处等待批准。
