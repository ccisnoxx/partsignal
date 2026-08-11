# Frontend V2 Published Articles — Implementation Plan

## 0. Approval gate

- 用户已批准实施，并批准 OpenAPI 机械更新 `frontend/src/shared/api/schema.d.ts`；除该 generated artifact 外不修改 `frontend/`。
- Task 已进入 `in_progress`，实现与提交均使用仓库单分支 `main` 工作流。

## 1. Ordered implementation checklist

1. **Contract/model**
   - 在 backend schema 增 `PublishedArticleSort`，并 additive 扩展 `PublishedArticleOut.source_content/events`。
   - 更新 OpenAPI list query、detail response 与真实 error responses。
   - 重新生成 V2 schema；若获明确例外授权，同时机械生成 V1 schema，不手改生成文件。
2. **Backend query/router**
   - list/count 共用 search predicate，加入六种稳定排序。
   - detail 在 Article 固定 verification/content identity 上复用 `ContentVersionDetail`，加载 events 并校验 ID/hash/PASSED invariant。
   - list/detail 使用 `REPEATABLE READ`，终态显示只读取 Work snapshot。
   - 保持权限、默认分页、V1 默认调用和现有 action/deletion response 不变。
3. **Backend validation**
   - 补 list/search/sort/pagination、snapshot identity、detail lineage/timeline、error/permission 与固定查询数 integration coverage。
   - 先运行 targeted backend + contract gate；未通过前不进入 UI 实现。
4. **Frontend model/API**
   - 新建 Article 专用 search/sort/status/domain/time model 与测试。
   - 扩展现有 publication query keys/options；复用 `PublicationRequestError`，不创建新 client。
5. **List page/route/navigation**
   - 注册 parent/index route、canonical search/prefetch/head/nav metadata。
   - 使用现有 Table Kit 组合五列、搜索、排序、分页、loading/empty/error/mobile list；无 action column。
   - Publishing navigation 只增加已实现的 Articles，不创建 Issues 占位。
6. **Detail page/route**
   - 注册 UUID detail route、head/prefetch。
   - 组合 PageHeader、DetailSection、MarkdownPreview、Timeline 展示 result/content/verification/lineage/events/health。
   - 校验 URL/article/source identity；无表单、命令、删除、重新核验、issue/GEO action。
7. **Handoff regression**
   - 证明 Workspace `COMPLETED`、Content Task Detail、Product Detail 的现有 href 能进入同 ID Article Detail；不重写这些页面。
8. **Production-artifact tests**
   - 扩展现有 publication fixture 的严格 GET handlers/counters。
   - 新增单一 `published-articles.spec.ts` 覆盖列表、详情、URL/error/responsive/accessibility/readonly。
9. **Independent real-stack**
   - 在现有 publication real-stack spec 添加独立 GET-only Article list/detail 用例，复用唯一 `e2e-local.sh` 生命周期。
10. **Docs/self-review**
    - 更新 03/05/07/08/09，确认 OpenAPI、runtime、generated types、测试与文档一致。
    - 检查无 client join、local filtering/status action inference、new dependency/global store/generic framework、V1 runtime diff 或未批准 scope。
    - 运行 required validation、Visual QA、`trellis-check` 与最终 diff review；提交前另行展示 commit plan 并等待确认。

## 2. Required validation

### Contract generation/check

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate   # 仅在用户批准 generated V1 例外后
make contract-check
```

### Backend PostgreSQL integration

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py -q
```

### Frontend V2 targeted unit/component

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/published-article.model.test.ts \
  src/domains/publication/published-article-list-page.test.tsx \
  src/domains/publication/published-article-detail-page.test.tsx
```

### Frontend V2 static/build

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

### Production-artifact fixture Playwright

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/published-articles.spec.ts
```

### Independent real stack

```bash
deploy/scripts/e2e-local.sh
```

该脚本是现有唯一隔离 PostgreSQL/Redis/FastAPI/object storage/V2 production preview owner；不得创建第二套 orchestration。Article 独立用例只新增 GET-only read acceptance，不重复完整 Publishing checkpoint。

### Final diff hygiene

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
```

- 完整 V2 suites 与 `make verify` 默认 optional：本 Task 有 targeted backend、fixture production artifact 和独立真实栈直接证据，且不改变数据库、权限规则或 mutation 状态机。
- 若实现中实际修改共享 contract guard、公共 error parser、Table/Detail primitive、发布状态机或数据库 invariant，则把受影响的完整 gate 升级为 required，并先回到规划更新本文件。
- optional failure 仅在证据指向本 Task diff 时进入修复范围。

## 4. Visual QA scope

- List：375/768/1024/1440；长 actual title、长 URL/domain、长平台/账号、10/20/50 rows、loading、initial empty、filtered empty、error、pagination、sort indicator。
- Detail：375/768/1024/1440；长 Markdown/URL/tag/comment、无 generation lineage、AI + humanization lineage、多 event timeline、health summary。
- Navigation：direct、refresh、Back、Forward、new tab、breadcrumb、两个 Publishing nav active state、Workspace `COMPLETED` handoff。
- Accessibility：keyboard-only、visible focus、semantic table headers、link accessible names、external-link indication、status 不只靠颜色、retry focus、无 form/contenteditable/mutation control。
- Layout：document 无横向溢出；窄屏使用既有 mobile list/detail stack，不压缩成不可读宽表。
- 使用现有 Playwright Test Runner；只有自动断言无法解释的视觉问题才临时使用独立命名 `playwright-cli` session，并在 final 前关闭。

## 5. Review and rollback checks

- 核对 `PublishedArticle.id == PublicationWork.id`、fixed PASSED verification、source content ID/hash、event order 和 snapshot identity。
- 核对 browser network：list 一次 GET、detail 一次 GET；无 PublicationWork/ContentVersion/Verification join，无 POST/PATCH/PUT/DELETE/preview。
- 核对 route → publication domain → design-system/shared 依赖方向。
- 核对没有更改 `contracts/database.md`、migration、V1 runtime/page/test、运行时依赖或未来 Issues/GEO route。
- 回滚整个 Task commit 即可；无数据修复、迁移 downgrade 或双写清理。

## 6. Pre-start checklist

- [x] `prd.md`、`design.md`、`implement.md` 已由用户审核。
- [x] 用户已明确批准 V1 generated schema 例外。
- [x] Blocking open questions 为零。
- [x] 用户在最新 planning summary 之后明确批准实施。
- [x] Task 已在 `main` 进入实施阶段。

## 7. Final validation results（2026-08-12）

工作实现提交：`791b9f3 feat: add published article read-only views`。

### Required validation

| 范围 | 实际命令 | 结果 |
| --- | --- | --- |
| OpenAPI 双端生成 | `npm --prefix frontend-v2 run api:generate`；`npm --prefix frontend run api:generate` | 通过；两端 generated schema 可复现，生成后工作区无差异。 |
| 合同一致性 | `make contract-check` | 通过；FastAPI、`contracts/openapi.yaml`、V1/V2 generated types 一致。 |
| Backend publication integration | `PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q` | 通过；16 个测试全部通过。 |
| Published Articles component/model | `npm --prefix frontend-v2 run test -- src/domains/publication/publication.api.test.ts src/domains/publication/published-article.model.test.ts src/domains/publication/published-article-list-page.test.tsx src/domains/publication/published-article-detail-page.test.tsx` | 通过；4 个文件、18 个测试全部通过，耗时 812 ms。 |
| Frontend V2 static/build | `npm --prefix frontend-v2 run lint`；`npm --prefix frontend-v2 run typecheck`；`npm --prefix frontend-v2 run build` | 全部通过；build 仅报告既有大 chunk 非阻断 warning。 |
| Fixture Playwright | `npm --prefix frontend-v2 run e2e -- tests/e2e/published-articles.spec.ts` | 通过；mobile/desktop 共 6 个测试，覆盖 canonical URL、单请求边界、错误、键盘、375/768/1024/1440 与根页面无横向溢出，耗时 8.3 s。 |
| Independent real stack | `DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal REDIS_URL=redis://127.0.0.1:56379/0 deploy/scripts/e2e-local.sh`（加载本地 `.env`） | Published Article 独立用例通过（446 ms）：真实 PostgreSQL/FastAPI/V2 production preview 下由完成成果进入列表和详情，浏览器 Article 请求严格为两个 GET。脚本整体 9 passed / 1 failed；失败是未被本提交修改的 `content-ai-real-stack.spec.ts`，Celery 报 28800 秒时钟漂移后 AI 标题保持空值并超时。按失败归因规则未重跑、未越界修复。隔离数据库与临时存储均成功清理。 |
| Diff hygiene | `git diff --check`；`git status --short` | 通过；写回本节前工作区干净，无生成漂移。 |

### Trellis check / acceptance review

- `trellis-check` 已核对 contract → backend schema/router/query → generated types → Publication domain/route → component/fixture/real-stack 的读取链；未发现客户端 join、本地分页过滤、status 动作推导、mutation UI、新依赖或通用框架。
- `frontend/` 的唯一变更仍是用户批准的 generated `src/shared/api/schema.d.ts`；V1 runtime、页面和测试没有改动。
- PublishedArticle 与 PublicationWork 同 ID、固定 PASSED verification、来源 ContentVersion ID/hash、冻结平台/账号 snapshot、事件顺序及结构化错误边界与代码、OpenAPI、测试和文档一致。
- Visual QA 由 production-artifact Playwright 在 375/768/1024/1440、键盘焦点、表格语义、外链标签和页面级溢出上提供自动证据；本 Task 未创建或更新需人工批准的视觉基线。
- `contracts/database.md` 未更新：本 Task 没有 migration 或持久化 invariant 变化，仅消费既有不可变约束并扩展 read model。

### Optional validation

- 未运行完整 V2 unit/E2E、`make test-integration` 或 `make verify`；required targeted backend、component、production-artifact fixture 和独立真实栈已经直接覆盖本 Task。唯一观察到的跨任务失败已在上表归因，不扩大当前 Task。
