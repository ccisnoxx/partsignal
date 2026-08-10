# Frontend V2 Content Version Detail — Design

## 1. Architecture Decision

新增独立 read model：

```text
GET /api/v1/content-versions/{content_version_id}/detail
  -> ContentVersionDetail
```

不扩张基础 `ContentVersion`，不复用 `ContentReviewContext`。原因：基础 GET 是 command/list canonical projection 并包含动作语义；Review Context 是 Workspace snapshot。目标页需要不同且更窄的数据边界。

请求在 PostgreSQL `REPEATABLE READ` 中形成一致快照，复用现有 AI lineage resolver 和 review-history 查询规则，不持久化第二套 projection、不增加缓存或 aggregate framework。

## 2. Compact Read Model

概念结构如下；最终字段名以更新后的 OpenAPI 为权威：

```text
ContentVersionDetail
├── content
│   ├── id / task_id / fact_version_id
│   ├── based_on_id / source_job_id
│   ├── version / source_type / status / is_current
│   ├── title / summary / body_markdown / tags / content_hash
│   ├── change_summary
│   ├── creator: ActorSummary
│   └── created_at / updated_at|null
├── task: { id }
├── fact_version: { id, product_id, version, status, classification }
├── generation_lineage|null
│   ├── original_generation|null
│   └── humanizations[]
├── review_result: ReviewRecord|null
└── review_timeline: ReviewRecord[]
```

每个 lineage step 只包含页面消费的：job ID、job type、source content version ID、contract version、冻结 channel/model object，以及冻结 Prompt metadata/final system-user Prompt。它不返回 Job status/retry/action/token usage/error、完整 approved facts、task requirements 或无关 GenerationJob。

`review_result` 从目标版本自身实际最后一条 review record 取得，不从 `status` 推导。`review_timeline` 沿用 Content Review 已批准的同任务、版本号不超过目标版本的累计顺序；它只返回审核记录，不返回版本列表。

Fact summary 只提供详情展示与 canonical Fact Version link 所需的 identity；不返回 Fact Markdown、删除投影或动作。

## 3. Updated Time Contract

新增 nullable `content_versions.updated_at`：

- migration 先增加 nullable column，再只为未来 INSERT 设置数据库 default；不把 migration 执行时间写入旧业务行。
- ORM 使用 `server_default=now()` 与 `onupdate=now()`；当前 HUMAN DRAFT 保存、审核状态/revision 更新和旧批准版本转 SUPERSEDED 都会写入真实时间。
- legacy rows 保持 `null`，页面显示“历史记录未记录”。
- downgrade 删除该列；不会丢失原有业务状态，但升级后产生的版本更新时间不可保留。

`contracts/database.md` 记录该字段只描述 ContentVersion 自身合法更新，不替代 ContentTask 最近活动投影，不改变 payload 不可变规则。

## 4. Backend Boundaries

### 4.1 Query / Projection

- 新建 focused service `content_version_detail.py`，按 exact version ID 读取目标版本、task、fact、creator、审核记录和 AI lineage。
- 不调用 `content_version_out`，避免计算或泄漏 `primary_task` / `available_actions`。
- 把现有 Content review history 查询暴露为单一复用 helper；Review Context 与 Detail 共用排序/actor projection，禁止复制第二套历史规则。
- 复用 `resolve_content_ai_lineage`；纯人工链返回 `null`，快照缺失/结构非法继续显式 409，不降级为猜测。
- 查询次数对版本历史/审核记录/lineage 数量保持固定，不在 serializer 循环内逐项请求。

### 4.2 Permission and Errors

- 与基础 GET 一致：authenticated `CurrentUser` 可读；不新增 ADMIN/ENGINEER 分叉。
- 401：无有效会话；403：公共身份策略拒绝（如必须改密）；404：version 不存在；409：task/fact/creator/lineage snapshot 不完整；422：非法 UUID。
- OpenAPI 明确 200/401/403/404/409/422 ErrorResponse。

### 4.3 Compatibility

- 保留基础 GET、版本列表、Editor Context、task/version Review Context 和所有 mutation 的路径/响应语义。
- 新 DTO 不进入 command response、list item 或 Publication contract。
- 不修改 V1 runtime/UI；仅因合同单一来源更新 V1 generated schema 文件，前提是用户在实施批准时明确授权。

## 5. Frontend V2 Design

### 5.1 Ownership and Data Flow

```text
thin route
  -> contentVersionDetailQueryOptions(versionId)
    -> one detail GET
      -> ContentVersionDetailPage
        -> existing design-system primitives/patterns
```

- `content.api.ts` 增加 Content-owned query key/factory，`retry:false`；route loader 与 page 共用 query options。
- route 只读取 `versionId`、prefetch、metadata 和 unexpected-error reset。
- page 不创建 form/local workflow state，只持有 query loading/error/refetch 状态。
- 已有缓存 snapshot 的后台刷新失败显示 alert 并保留正文。

### 5.2 Page Composition

```text
Detail Header
  title / vN / source / status / current-or-history / readonly badge
  canonical Content Task return link
DetailSection: summary + tags
DetailSection: canonical Markdown (MarkdownPreview)
DetailSection: version metadata / Fact link / hash / creator / change summary / times
DetailSection: Prompt + model + generation/source lineage
DetailSection: review result
DetailSection: review timeline (Timeline)
```

- Snapshot object 使用原生 `<details>/<summary>` 与 `<pre>` 展示，不新增 viewer 组件或依赖。
- 长 Prompt/model JSON 在局部容器滚动，不制造页面级横向滚动。
- HUMAN / legacy 无 snapshot 时显示明确空态。
- Content status presentation 在 Content domain 收敛为一个 enum-exhaustive registry，供 Review / Task Detail / Version Detail 共享；Design System 仍只消费 label/tone。
- canonical Fact Version link 使用 read model 的 `product_id + fact_version.id`，不额外请求 Product 或 Fact。

### 5.3 Navigation Scope

- 保留 Content Task Detail 已有当前版本和 Activity 历史版本链接；目标 route 落地即可关闭其 dead-link gap。
- 本任务不向 Editor / Review Workspace 新增导航或复制 Detail 内容；二者继续只承担当前主线的编辑/审核职责。
- 详情页返回链接固定为 `/content/tasks/{task_id}`，不依赖 referrer/history 猜返回地址。

## 6. Test Design

### 6.1 Contract / Backend

- contract test：冻结新 path、required/nullable 字段、错误响应、compact DTO 边界，并断言基础 `ContentVersion` schema 未被扩张。
- migration test：旧行 `updated_at=null`、新行有创建时间、draft save / review transition / supersede 更新真实时间、downgrade 删除列。
- focused integration：HUMAN/AI、六状态、current/history、Fact summary、change summary、creator、review result/timeline、generation + humanization lineage、snapshot absent、404/403/409、repeatable read、固定查询次数。
- 断言 detail GET 不修改 version/task/review/job，不暴露 action fields。

### 6.2 Frontend Component

- 单请求 query、loading、404、403、generic retry、stale refresh 保留快照。
- HUMAN/AI、六状态、current/history、snapshot present/absent、Markdown sanitization、长正文/tags/change summary、review result/timeline。
- 无 textbox/contenteditable/CodeMirror/业务 command；canonical Task/Fact link 正确。

### 6.3 Fixture Playwright

- 扩展现有 generated-type `content.fixture.ts`，不新建 mock server；只允许 exact detail GET。
- 覆盖 Task Detail 入口、direct/refresh/Back/Forward、HUMAN/AI、六状态、snapshot 有无、只读、404/403/loading/error/retry、四档宽度、keyboard/focus 及 runtime audit。
- 任何 Review Context、Editor Context、GenerationJob、FactVersion、Task Detail join 或 mutation 请求均使 fixture 失败（从 Task Detail 点击进入的场景只额外允许既有 Task Detail 请求）。

### 6.4 Independent Real Stack

- 新 spec 自建唯一 Product/Fact/ContentTask/ContentVersion 前置数据，登录 V2 production preview 后直接打开 detail route。
- 页面只执行读取；前置编排可通过真实 API，因为目标功能没有 mutation。
- 不导入 fixture、不使用 `page.route`/`route.fulfill`，不依赖其他 real-stack spec 的数据。
- 断言 canonical task link、readonly DOM、真实字段和 single detail endpoint；响应式/错误矩阵不在 real stack 重复。

## 7. Documentation

- `contracts/openapi.yaml`：新 endpoint/read model/errors。
- `contracts/database.md`：nullable ContentVersion updated_at、detail snapshot 与 immutable boundary。
- `docs/frontend-v2/03`：把 Content Version Detail 从一句蓝图收敛为真实字段/单请求/readonly 边界。
- `docs/frontend-v2/05`：登记 ContentVersionDetail read model ownership。
- `docs/frontend-v2/07`：实施完成后记录 Phase 3 本 Task 状态，不提前宣布完成。
- `docs/frontend-v2/08`：登记 fixture 与 independent real-stack acceptance。
- `docs/frontend-v2/09`：追加 Content Version Detail compact read-model ADR。

## 8. Minimality Decisions

- 新增一个 endpoint、一个 DTO family、一个 backend projection owner、一个 domain page 和一个 route；不建通用 Version framework。
- 复用已有 lineage/history owners 和纯 UI Pattern；不复制 Review Workspace 或 Editor Context。
- 不新增依赖、store、cache、Diff、History list、Publication projection 或 action mapping。
- `updated_at` 允许 legacy `null`，避免为了填满 UI 伪造旧时间。

## 9. Risks and Rollback

- **legacy 时间未知**：nullable + 明确 UI 空态；不使用 migration time。回滚删除列/字段。
- **snapshot 体积/敏感性**：只映射 Prompt/model/channel 与 lineage identity，不返回凭据、完整 fact/task requirements。回滚新 endpoint 不影响原 Job snapshot。
- **lineage 不完整**：显式 409，禁止静默降级；回滚 Detail 不改变原 Review/Editor 行为。
- **动作泄漏**：新 DTO 无 action fields，页面无 mutation import；服务端权限仍是最终边界。
- **V1 generated drift**：若用户不批准 generated-only 例外，则不能实施 OpenAPI 变化；不得绕过 contract-check。
- **迁移回滚**：downgrade 仅删除新增时间列；代码/合同回滚必须与 migration 同步，已记录的更新时间会丢失但业务 payload/history 不受影响。
- **前端回滚**：移除 query/page/route/tests 和生成 route tree；现有 Task Detail 链接恢复为尚未实现目标，但无既有业务状态受损。
