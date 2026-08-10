# Gap Analysis — Frontend V2 Content Version Detail

## 1. 结论

现有基础 `GET /api/v1/content-versions/{content_version_id}` **不足以**绘制目标页面；缺口既包含数据库/API 字段，也包含必须在同一 snapshot 中读取的审核与生成 lineage。复用 Content Review Context 也不合适：它返回 Review Workspace 专属的完整 Task、Fact Markdown、Diff 与动作，并仍缺少 `change_summary` 和版本更新时间。

因此需要新增专用 `GET /api/v1/content-versions/{content_version_id}/detail`。它只返回页面实际消费的 compact snapshot；基础 GET、Review Context 和 Editor Context 保持原职责。

## 2. 基础 GET 的真实调用链

- route：`backend/app/routers/production.py:373-384`，`getContentVersion` 只按 PK 读取 `ContentVersion`，不存在时 404，再调用 `content_version_out`。
- projection：`backend/app/services/projections.py:337-474`，`content_versions_out` 为 command/list canonical `ContentVersionOut` 计算 `workflow_stage`、`primary_task`、`available_actions`，不读取审核记录或 job snapshot。
- backend schema：`backend/app/schemas/content.py:396-446`。
- OpenAPI schema：`contracts/openapi.yaml:4938-4973`；GET path：`contracts/openapi.yaml:1721-1731`。

### 2.1 字段证据矩阵

| 页面字段 | 基础 GET | 证据 / 判断 |
|---|---|---|
| title / summary / body_markdown / tags | 足够 | `ContentVersion` 直接字段 |
| version / status / source_type | 足够 | typed schema 已包含六状态和 AI/HUMAN |
| task | 部分 | 仅 `task_id`，足以构造返回链接但没有 `is_current` |
| Fact Version | 不足 | 仅 `fact_version_id`；canonical Fact link 还需要 `product_id`，页面也需要版本摘要 |
| Prompt / model snapshot | 不足 | `source_job_id` 仅 UUID，不含 `input_snapshot` |
| generation / source lineage | 不足 | 仅 `source_job_id` / `based_on_id`，没有解析后的原始生成与自然化链 |
| content_hash | 足够 | 直接字段 |
| creator | 部分 | 仅 `created_by` UUID；现有 `ActorSummary` 可提供稳定显示 identity |
| change_summary | 不足 | ORM 有字段，`ContentVersionOut` / OpenAPI 未暴露 |
| review result / timeline | 不足 | 不查询 `ContentReviewRecord` |
| created_at | 足够 | 直接字段 |
| updated_at | 不足 | `content_versions` 表/ORM根本没有该列 |
| readonly | 不适合直接消费 | 基础响应包含动作投影，页面虽可忽略，但仍无法补齐上述快照 |

## 3. 数据库证据

- `backend/app/models/content.py:93-150` 的 `ContentVersion` 包含 `change_summary`、`created_at`，没有 `updated_at`。
- `backend/app/models/content.py:153-165` 的 `ContentReviewRecord` 是 append-only，含 action、comment、actor、created_at。
- `contracts/database.md:41-43,81,109,307,341-345,393,405` 共同约束：AI 内容及进入审核后的版本不可变；只有当前未审核 HUMAN DRAFT 可原地保存；`current_content_version_id` 是唯一主线；review/history 和 generation snapshot 保持可追溯。
- `backend/app/services/content_production.py:805-812` 当前 HUMAN DRAFT 保存会更新 payload/revision 并触碰 Task 时间，但没有 ContentVersion 自身更新时间。
- `backend/app/services/review.py:385-386` 审核转换会更新 version status/revision；旧 APPROVED 在新版本批准时也会改为 SUPERSEDED。

### 3.1 更新时间决策

新增可空 `content_versions.updated_at`：

- 新行由数据库写入创建时间；后续合法 payload/status/revision 更新由 ORM 更新真实时间。
- migration 不用执行时刻或 Task 时间回填旧行；legacy 行保持 `null`，因为旧 draft save 和 SUPERSEDED 时刻无法完整确定。
- detail contract 使用 nullable `updated_at`；页面对 `null` 显示“历史记录未记录”。

这比使用 Task `updated_at`、最大 review 时间或迁移时间更诚实，避免第二套猜测事实。

## 4. 现有 Context 审计

### 4.1 Content Review Context

- exact version route：`backend/app/routers/production.py:452-464`。
- assembler：`backend/app/services/review.py:188-259`。
- schema：`backend/app/schemas/content.py:535-543`。
- 它能返回 content、完整 task、完整 fact、diff、generation trace、humanization traces、available actions、累计 review history。
- lineage owner：`backend/app/services/content_lineage.py:45-136`，沿目标版本 `based_on_id` / `source_job_id` 解析相关原始生成与自然化作业，纯人工链返回空；无效快照显式 409。

判断：数据来源可复用，响应不能复用。它携带 Detail 不消费的 Fact Markdown、Diff、动作和完整 Task，同时缺少 change summary / updated_at；直接让详情页请求 Review Context 会把 Review Workspace 合同错误扩散到 readonly Detail。

### 4.2 Content Editor Context

Editor Context 由 task route 和 `current_content_version_id` 定位当前主线，返回完整当前 ContentVersion、比较基线、Diff 和 compact lineage；它不能按任意历史 `versionId` 读取，且携带 Editor 首屏语义。目标页不得先请求它再寻找版本。

## 5. 前端入口与 owner

- Content API owner 与 query keys：`frontend-v2/src/domains/content/content.api.ts:1-71,642-677`；当前没有 Content Version detail key/query。
- 当前 route tree 只有 Content Task List/New/Detail/Editor/Review，没有 `/content/versions/$versionId`。
- Task Detail 当前版本链接：`frontend-v2/src/domains/content/content-task-detail-page.tsx:209-225`。
- Task Detail Activity 的 `CONTENT_VERSION` 链接：`frontend-v2/src/domains/content/content-task-detail-page.tsx:331-347,497-505`；因此已有当前与历史入口，只缺目标 route。
- Editor 使用当前 ContentVersion 承担 mutation，没有 version-detail link；Review 也只显示当前版本信息。本任务不修改两个 Workspace，仅实现它们之外的 readonly route。

## 6. 可复用 UI 与禁止复用

可直接复用：

- `MarkdownPreview`：`frontend-v2/src/design-system/editor/markdown-editor.tsx:15-59`，提供 sanitized、focusable、可滚动 Markdown 阅读区。
- `DetailSection`：`frontend-v2/src/design-system/workspace/detail-section.tsx:5-29`。
- `Timeline`：`frontend-v2/src/design-system/workspace/timeline.tsx:5-40`。
- `Badge` 与现有 Content status presentation。
- Fact Version Detail 的 query/loading/404/403/generic retry/stale refresh/readonly/metadata/导航纯 UI Pattern：`frontend-v2/src/domains/product/fact-version-detail-page.tsx:28-279`。

不得复用 Product 的 status registry、错误类型、URL boundary、timeline factory、time formatter 或 metadata 业务映射。Content status、snapshot、review result、canonical link 和 error classifier 留在 Content domain；不创建通用 Version Detail framework。

## 7. 测试基础设施

- generated-type Content fixture：`frontend-v2/tests/e2e/fixtures/content.fixture.ts`；当前只处理 Task/Editor/Review，未声明请求会失败并已具备 console/pageerror/requestfailed 审计。
- 最接近的页面矩阵：`frontend-v2/tests/e2e/fact-version-detail.spec.ts`。
- Content production-artifact suites：`content-task-detail.spec.ts`、`content-editor.spec.ts`、`content-review.spec.ts`。
- real-stack orchestration：`deploy/scripts/e2e-local.sh:70-128`，启动进程唯一 PostgreSQL、FastAPI、Redis/Celery/fake AI 与 V2 production preview；目标页尚无独立 real-stack read spec。

## 8. Contract / Permission 缺口

- 基础 GET 只依赖 `CurrentUser`；不存在为 404，无额外账号类型限制。匿名为 401；必须改密会话由公共依赖返回 403。
- 新 detail GET 应保持同一 read permission，不引入页面级隐藏权限或新的资源 ACL。
- OpenAPI 变化必须同步两份 generated types；`make contract-check` 会同时检查 `frontend` 与 `frontend-v2`。因此实施需要用户批准仅更新 `frontend/src/shared/api/schema.d.ts` 的生成文件例外，不能绕过 contract-check。
