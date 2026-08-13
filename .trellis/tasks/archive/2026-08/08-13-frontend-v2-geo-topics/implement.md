# Frontend V2 GEO Topics — 实施计划

## 1. 执行前提与分支生命周期

- 当前只完成规划；审批前不运行 `task.py start`，不创建分支，不修改生产代码，不提交、不归档、不 push。
- 用户批准后先确认主工作目录仍在最新且干净的 `main`，再执行：

```bash
python3 ./.trellis/scripts/task.py start \
  .trellis/tasks/08-13-frontend-v2-geo-topics
git switch -c codex/frontend-v2-geo-topics
python3 ./.trellis/scripts/task.py set-branch \
  .trellis/tasks/08-13-frontend-v2-geo-topics \
  codex/frontend-v2-geo-topics
```

- 该临时分支只承载本 Task。验证完成后先给出 commit plan 并等待用户确认；提交和合并回 `main` 后删除本地分支，并检查/删除同名远端分支。没有单独授权不得 push。
- 若执行中发现需要数据库迁移、改变旧完整 Query Topic 列表语义、增加未规划页面或无法用现有模型表达需求，立即停止并请求确认。

## 2. 精确预计文件范围

### 契约与后端

- `contracts/openapi.yaml`
- `backend/app/audit_types.py`
- `backend/app/schemas/configuration.py`
- `backend/app/schemas/content.py`
- `backend/app/services/content_planning.py`
- `backend/app/services/content_task_queries.py`
- `backend/app/services/geo_observation.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/observation.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_security_and_publication.py`
- `backend/tests/integration/test_query_topic_list.py`（新增）
- `backend/tests/integration/test_content_task_list.py`
- `backend/tests/integration/test_geo_observation_list.py`

### 生成类型

- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`

### Frontend V2 route、navigation 与 Topic 页面

- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/domains/geo/geo.api.ts`
- `frontend-v2/src/domains/geo/geo.api.test.ts`
- `frontend-v2/src/domains/geo/query-topic-list.model.ts`（新增）
- `frontend-v2/src/domains/geo/query-topic-list.model.test.ts`（新增）
- `frontend-v2/src/domains/geo/query-topic-list-page.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/topics/route.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/topics/index.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）

### Handoff 与 resolve link 目标列表

- `frontend-v2/src/routes/_app/geo/observations/new.tsx`
- `frontend-v2/src/domains/geo/new-geo-observation.model.ts`
- `frontend-v2/src/domains/geo/new-geo-observation.model.test.ts`
- `frontend-v2/src/domains/geo/new-geo-observation-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-list.model.ts`
- `frontend-v2/src/domains/geo/geo-observation-list.model.test.ts`
- `frontend-v2/src/domains/geo/geo-observation-list-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-list-page.test.tsx`
- `frontend-v2/src/domains/content/content-task-list.model.ts`
- `frontend-v2/src/domains/content/content-task-list.model.test.ts`
- `frontend-v2/src/domains/content/content-task-list-page.tsx`
- `frontend-v2/src/domains/content/content-task-list-page.test.tsx`

### Strict fixture E2E

- `frontend-v2/tests/e2e/fixtures/geo-topics.fixture.ts`（新增）
- `frontend-v2/tests/e2e/geo-topics.spec.ts`（新增）
- `frontend-v2/tests/e2e/fixtures/new-geo.fixture.ts`
- `frontend-v2/tests/e2e/new-geo-observation.spec.ts`
- `frontend-v2/tests/e2e/fixtures/geo.fixture.ts`
- `frontend-v2/tests/e2e/geo-observations.spec.ts`
- `frontend-v2/tests/e2e/fixtures/content.fixture.ts`
- `frontend-v2/tests/e2e/content-task-list.spec.ts`

### 权威文档与稳定规范

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- `.trellis/spec/backend/available-actions-contract.md`

### 明确不修改

- `contracts/database.md`：无模型、约束或迁移变化。
- `docs/frontend-v2/02-information-architecture-and-routing.md`、`03-page-and-workflow-blueprint.md`、`04-design-system-and-interaction-spec.md`：现有 `/geo/topics` route、五列蓝图和交互规范已准确，本 Task 只落实，不重复事实。
- 旧 `frontend/` 业务组件：只重新生成 schema 类型并做兼容验证。
- Insights、Print、Optimization、Query Topic Detail/Workspace、通用 Table/Form/CRUD 框架文件。
- 若实现证明上述某个预计文件不需要改，直接省略；若必须增加未列生产文件，先说明必要性，不借机扩展范围。

## 3. 实施步骤

### Step 1：先扩展 OpenAPI

1. 新增 `/api/v1/query-topics/list-items`、`QueryTopicListSort`、`QueryTopicReferenceSummary`、`QueryTopicListItem`、`QueryTopicListPage`；不新增集合级资源 action token。
2. 给 Content Tasks 增加配对的 `query_topic_id/query_topic_reference` query params；给 GEO Observation list-items 增加 `query_topic_id`。
3. 收紧 `QueryTopicCreate/Update.variants.items` 的非空合同；不改现有完整列表与 mutation 路径/响应。

完成条件：AC2、AC3、AC6、AC8 的 API 形状明确，旧 `QueryTopicList` 仍为完整 `{items}`。

### Step 2：实现服务端 Query Topic owner

1. 在请求 schema 统一 canonical question/variants 的 trim、非空、trim 后精确去重与稳定顺序。
2. 在 `content_planning.py` 复用现有批量引用查询，形成 V2 page、所有角色引用摘要、ADMIN deletion 与准确 action projection。
3. 新增服务端 search/sort/count/page；查询以 ID 稳定收尾，不逐行查询。
4. 保持旧完整列表对 ADMIN/ENGINEER 的 `UPDATE` 投影及全量内容/顺序。
5. CREATE/UPDATE 与既有 DELETE 一样追加成功审计，并在同一事务 commit。

完成条件：AC2、AC3、AC5、AC6、AC8、AC10、AC11 的后端所有权有直接测试。

### Step 3：实现引用目标的精确筛选

1. Content Task query owner 校验两参数同时出现，分别过滤直接 task 或 `ContentTaskGeoSource`；保持现有全量/分页兼容模式。
2. GEO Observation V2 list query 增加精确 `query_topic_id` 条件，仍只投影当前链尾。
3. 集成测试对 count、类型、归档任务、优化来源和 Observation 更正链建立可复现证据。

完成条件：三类链接可在服务端精确解析真实对象，浏览器无需逐行补请求。

### Step 4：生成类型并验证兼容

1. 从同一 OpenAPI 重新生成 V1 与 V2 schema。
2. 再运行一遍生成命令，确认 generated files 不再变化。
3. 检查无 handwritten API DTO、cast、兼容字段或手工修改生成文件。

完成条件：OpenAPI 是唯一 API 类型 owner，V1 仍通过 typecheck，完整列表相关 generated shape 未被分页污染。

### Step 5：实现 URL model、API 与 route

1. 新 `query-topic-list.model.ts` 只承载 URL schema/canonical record、API params、sort mapping、intent label、variants 格式与 action href mapping。
2. `geo.api.ts` 增加 topic list keys/options 及三个 mutation；复用现有结构化 `GeoRequestError` 与 CSRF 机制。
3. 注册 `/geo/topics` parent/index route、GEO navigation 和 Breadcrumb；loader prefetch 新 list-items。

完成条件：AC1、AC2、AC3、AC7 的 routing/query 边界由 model/API/navigation tests 覆盖。

### Step 6：实现列表与短 Dialog

1. 使用现有 TableShell、FilterBar、RowActions、Pagination 和 manual TanStack Table 绘制固定五列。
2. 使用现有 Dialog/FormField/Input/Select 与 RHF `useFieldArray` 实现 create/edit；不增加表单框架。
3. Primary 只解析 `USE_FOR_OBSERVATION`；overflow 根据服务端 `available_actions/deletion/references` 显示编辑、删除或查看条件。
4. 实现 structured 422、PATCH/DELETE 409、显式 reload、草稿保留、末页删除回退、聚焦与 cache invalidation。

完成条件：AC4、AC5、AC8—AC14 的组件可观察行为有直接测试。

### Step 7：补齐 New Observation handoff

1. New route 增加严格 `queryTopicId` search schema并传给页面。
2. Topic options 成功后按 ID 初始化；不存在时明确失败，不选择默认 Topic、不改变其余字段。
3. 更新 model/E2E，覆盖 Topics 点击、direct URL、refresh 和无效/不存在 ID。

完成条件：AC7 的完整 URL→form handoff 可验证，未扩大 New Observation 的业务流程。

### Step 8：接入 resolve links

1. Topic 引用 Dialog 生成设计中固定的三类 canonical URLs。
2. Content/GEO list URL model 映射新增筛选到 generated API params，并纳入 canonical/filtered-empty/reset。
3. 目标列表用简短可清除提示显示当前 Topic 引用筛选；不加载 Topic dropdown 或新 detail data。

完成条件：AC6 在 model/component/backend 三层闭合，链接不指向未实现页面。

### Step 9：建立 strict Production Fixture

1. `geo-topics.fixture.ts` 使用 generated operation/schema types，声明 auth、list-items、完整 reload、POST/PATCH/DELETE 和必要目标请求；其他 API 返回失败并在 teardown 报告。
2. 覆盖 direct/refresh/Back/Forward、搜索/排序/分页、五列/variants、角色动作、create/edit/delete、409 不重放、引用 links、loading/empty/filtered-empty/error/retry。
3. 覆盖键盘、Dialog trigger 焦点返回和 375/768/1024/1440 页面根无横向溢出。
4. 更新 New/Observation/Content fixtures/specs，只覆盖新增 handoff 与精确 URL→API 筛选。

完成条件：AC1—AC15 的浏览器可观察部分有 strict fixture 证据，未声明 API 一律失败。

### Step 10：同步文档、验证与自审

1. `05` 记录 Topic list-items、引用 owner、动作、handoff、variants 与冲突；`07` 更新 Phase 5 状态；`08` 记录 required evidence；`09` 增加“保留完整列表 + 窄 V2 list-items” ADR。
2. 更新 backend available-actions spec：引用摘要对所有角色可见、deletion 仍 ADMIN-only、CREATE/UPDATE/DELETE 条件与批量查询 owner。
3. 按第 5 节运行 required validation；只修复与本 Task 有因果关系的问题。
4. 审查 diff：无旧 endpoint 语义漂移、无逐行请求、无本地资格推导、无自动重放、无第二归一化 owner、无新框架/依赖/无关改动。
5. 检查改动 Python 的中文 docstring、异常和开发者可见文本；不补机械注释。
6. 汇报验证、optional checks、残余风险；提交前另给 commit plan 并等待确认。

## 4. 验收与测试映射

| 验收项 | 主要验证 |
|---|---|
| AC1–AC3 | contract test；Query Topic integration；URL/model/API/navigation tests；Topics E2E |
| AC4–AC7 | workflow projection test；Topic model/page tests；handoff model/E2E；Topics E2E |
| AC8–AC12 | Query Topic integration/audit；Topic page mutation tests；409/fixture request counts；cache invalidation tests |
| AC6 | Content/Observation list integration；目标 list model/page tests；对应 E2E URL→API 断言 |
| AC13–AC14 | Topic page tests；strict fixture 状态、键盘、焦点、四档宽度 |
| AC15–AC16 | contract generation/check、双 typecheck、build、strict fixture teardown、diff/文档审查 |

## 5. 验证命令

### Required validation

这些检查直接覆盖本 Task 的公开合同、服务端 owner、页面状态和浏览器行为：

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_security_and_publication.py \
  backend/tests/unit/test_workflow_projections.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_query_topic_list.py \
  backend/tests/integration/test_content_task_list.py \
  backend/tests/integration/test_geo_observation_list.py -q

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/audit_types.py \
  backend/app/schemas/configuration.py \
  backend/app/schemas/content.py \
  backend/app/services/content_planning.py \
  backend/app/services/content_task_queries.py \
  backend/app/services/geo_observation.py \
  backend/app/routers/planning.py \
  backend/app/routers/observation.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_security_and_publication.py \
  backend/tests/integration/test_query_topic_list.py \
  backend/tests/integration/test_content_task_list.py \
  backend/tests/integration/test_geo_observation_list.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/geo/geo.api.test.ts \
  src/domains/geo/query-topic-list.model.test.ts \
  src/domains/geo/new-geo-observation.model.test.ts \
  src/domains/geo/geo-observation-list.model.test.ts \
  src/domains/geo/geo-observation-list-page.test.tsx \
  src/domains/content/content-task-list.model.test.ts \
  src/domains/content/content-task-list-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/geo-topics.spec.ts \
  tests/e2e/new-geo-observation.spec.ts \
  tests/e2e/geo-observations.spec.ts \
  tests/e2e/content-task-list.spec.ts

git diff --check
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-13-frontend-v2-geo-topics
```

说明：第二次 generation 后必须不再出现新变化。后端 integration 使用项目既有 PostgreSQL 测试实例；若实例未启动，先按仓库既有测试环境启动，环境失败不得伪装成测试通过。Topics E2E 必须实际覆盖四档宽度；目标列表 E2E 只验证新增精确筛选，不扩成完整 GEO E2E。

### Optional full-suite validation

以下检查覆盖面更大，不是本 Task 完成条件，也不会自动运行；required failure 指向共享回归或用户另行授权时再执行：

```bash
npm --prefix frontend-v2 run test
make test-unit
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

`npm --prefix frontend-v2 run e2e` 与 `make verify` 会扩展到本 Task 明确排除的真实栈/完整套件，必须单独确认后才运行。required validation 已用 targeted strict fixture 替代该覆盖。

## 6. 残余风险与止损点

- 新筛选使 Content Task/Observation 已有列表多一个 deep-link 状态；required tests 必须证明无该参数时旧 canonical URL 和 API 请求完全不变。
- Observation blocker count 与当前链行数粒度不同；只通过明确说明处理，不新增历史列表模式或第二统计口径。
- PATCH 显式 reload 复用完整 Topic 列表；若未来 Topic 数量大到该 reload 不可接受，再以实测为依据考虑窄 Detail GET，本 Task 不预建。
- 如果真实持久化数据存在空白或 trim 后重复 variants，当前批准范围没有数据清洗授权；停止并提交证据，不自动迁移或改写历史。
- strict fixture 证明前端状态机和请求边界，不替代完整真实数据库/权限/GEO 链编排；后者仍是明确排除项。

## 7. 回滚

回滚时删除新 `/geo/topics` route/page、list-items endpoint/schema、三类列表筛选和对应测试，恢复动作/审计/输入归一化改动，重新生成两套类型并恢复四份 Frontend V2 文档与一份 spec。数据库无迁移；已成功创建或修改的 Query Topic 是合法业务数据，不作为代码回滚对象。
