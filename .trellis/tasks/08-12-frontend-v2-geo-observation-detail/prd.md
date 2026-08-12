# Frontend V2 GEO Observation Detail

## 状态

- 阶段：实施与 required validation 已完成，等待 commit plan 审批
- Task：`frontend-v2-geo-observation-detail`
- 目标路由：`/geo/observations/$observationId`
- 实施分支：`codex/frontend-v2-geo-observation-detail`

## Goal

交付只读的 canonical GEO Observation Detail，让用户从 Observation List 或创建成功交接进入，也可通过 direct URL、refresh、Back 和 Forward 稳定恢复。页面一次读取完整、服务端权威的 Legacy 或 Manual 观测详情，展示完整结果、关联成果、证据和更正历史，不在浏览器跨接口拼装，也不允许原地修改任何历史记录。

## 背景与已确认事实

- Observation List 已使用 `/geo/observations/{id}` 与 `/geo/observations/{id}/correct` canonical href；Detail 与 Correction route 尚未注册。
- New Observation 的 POST 已返回 canonical `GeoObservation.id`，但当前成功回调丢弃响应并返回 List。
- 既有 `GET /api/v1/geo-observations/{observation_id}` 返回单条 `GeoObservation` union，供 V1 Drawer 使用；它不是完整的 V2 Detail snapshot。
- 当前单条响应只有 `query_topic_id`、继承后的 `attachment_file_ids` 与 `supersedes_id`，没有 Query Topic 标准问题、证据元数据/短期访问地址、证据所属更正节点或完整 correction chain。
- Manual 的 `article_results` 已带 Published Article 标题、平台和 URL；Legacy 只有 `published_article_ids`，V1 Drawer 因而逐篇请求 Article Detail。
- Legacy 才真实拥有 observation-level `recommendation` 与 `citations`；Manual 当前合同只拥有逐篇 `discovered`、`mentioned` 和可空 `accuracy`。不得给 Manual 补造 recommendation/citation。
- PostgreSQL 已表达 append-only correction：`supersedes_id` 指向前一节点、后继唯一、历史不可 UPDATE；无需数据库迁移。
- 服务端已投影 Manual 当前链尾的 `CORRECT|DELETE`，历史节点无命令；但当前不完整记录的 `primary_task=CORRECT_OBSERVATION` 尚未按 actor 的实际 `CORRECT` 资格收窄。
- 现有证据读取只返回 ID，V1 Drawer 会逐文件请求 metadata 和 download URL；这不满足 V2 单次 Detail read model。

## Source Documents

- `AGENTS.md`
- `frontend-v2/AGENTS.md`
- `.trellis/workflow.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/02-information-architecture-and-routing.md` 的 GEO 路由
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 6.3
- `docs/frontend-v2/04-design-system-and-interaction-spec.md` 的 Detail、状态、操作、反馈、响应式和 accessibility 规范
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 的动作与 GEO read model
- `docs/frontend-v2/08-testing-quality-and-acceptance.md` 的 GEO、Router、responsive、action 和 production artifact 验收
- `docs/frontend-v2/09-architecture-decisions.md` 的 ADR-011、014、015、016、020、028、030
- `contracts/openapi.yaml`、`contracts/database.md`
- `.trellis/spec/backend/available-actions-contract.md`、`.trellis/spec/backend/error-handling.md`
- `.trellis/spec/frontend/visual-system.md`、`.trellis/spec/frontend/state-management.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`、`.trellis/spec/guides/code-reuse-thinking-guide.md`

## In Scope

- 注册 `/geo/observations/$observationId` canonical readonly Detail route。
- 从 Observation List 主链接进入 Detail；保留既有 canonical Correction href。
- New Observation 成功后直接使用 POST 响应 ID 进入 Detail，不搜索 List。
- 新增 V2 专用的单请求 Detail read model，同时保持 V1 既有单条 GET、完整列表与 POST response 合同可用。
- Legacy 与 Manual 使用 generated discriminated union 明确建模。
- 展示完整问题/搜索词、Query Topic、Product、GEO platform、tested/observed time、recorder、created time、notes 和只读标识。
- 展示合同真实存在的结果事实：Manual 的逐篇 discovered/mentioned/accuracy；Legacy 的 mentioned/recommendation/citations/accuracy 与 answer summary。
- 展示关联 Published Articles 与 evidence 文件；所有首屏 metadata 和短期访问地址由 Detail 一次批量返回。
- Manual 展示从原记录到当前链尾的完整 correction history，并明确标识 original、selected、historical correction 和 current tail。
- 服务端计算 correction chain 顺序、完整性、selected node、root、tail、证据归属、actor-aware `primary_task` 和 `available_actions`。
- `CORRECT` 只进入 `/geo/observations/{chainTailId}/correct`；`DELETE` 只在当前链尾服务端返回 token 时出现，复用既有 delete command 与确认模式。
- loading、404、403、409、普通错误、cached refresh error 和 retry。
- 375/768/1024/1440、键盘、可见焦点、Dialog focus return、状态非纯颜色和基础 accessibility。
- generated-type strict fixture Playwright E2E，以及直接覆盖合同和聚合读取的 backend/frontend tests。
- 更新直接受影响的 OpenAPI、数据库读取说明、V2 路线/API/验收/ADR 文档与两套 generated schema。

## Requirements

### R1 — Canonical route 与导航

- Detail URL 固定为 `/geo/observations/$observationId`；URL 参数必须是 UUID，非法值显式失败，不发送猜测请求。
- List 主链接、direct URL、refresh、Back 和 Forward 均恢复同一资源。
- 页面提供返回 canonical Observation List 的原生链接，不把 List search 当作 Detail 身份来源。
- New Observation 使用成功 POST 返回的 `id` 导航 Detail；不得搜索列表、猜最新记录或创建兼容 fallback。

### R2 — 单一权威 Detail read

- V2 Detail 首屏只调用一个专用 Detail GET；不得调用旧单条 GET、Product、Query Topic、Published Article Detail、FileRecord 或逐文件 download-url 来补装。
- 响应必须一次包含页面需要的完整 union、关联文章、证据 metadata/访问地址与 correction history。
- 读取在同一个 PostgreSQL consistent snapshot 中形成，批量查询次数不得随 correction node、article 或 evidence 数量线性增长。
- 关联缺失、链不完整或不可绘制的必需事实必须返回稳定 409，不以空字符串、零、猜测字段或旧 endpoint fallback 掩盖。

### R3 — Generated union 与事实边界

- `LEGACY_MODEL_RESULT` 与 `MANUAL_ARTICLE_SEARCH` 必须通过 OpenAPI discriminator 和 generated types 穷尽分支；前端不手写第二套 API DTO。
- Legacy 显示完整 prompt、model/version、web search、answer summary、mentioned、recommendation、citations、accuracy、关联成果和证据。
- Manual 显示完整 search query/platform、逐篇 discovered/mentioned/accuracy、关联成果和证据。
- 不适用字段不渲染：Legacy 不显示 discovered；Manual 不显示 recommendation/citation；可空历史事实明确显示“历史未采集/未评估”，不得按否或零推断。

### R4 — Query Topic、Product 与 Published Article

- Query Topic 至少返回 `{id, canonical_question}`；历史 Manual 的真实空关联保持 `null`。
- Product 至少返回 `{id,label}`，label 沿用服务端 brand + part number 规则。
- 关联成果由服务端批量投影 Published Article identity、标题、冻结平台文本、canonical Detail href 所需 ID 和 final URL；Legacy 不再逐篇补请求。
- Manual 每个 correction node 的 article facts 与成果 metadata 在同一节点内对应，浏览器不得跨接口 join。

### R5 — Evidence 与文件归属

- evidence 只能从当前 Observation 或其 correction chain 的 `geo_observation_attachments` 关系批量读取；不得接受浏览器提交的任意 File ID 作为读取范围。
- 每项返回 `FileRecord` metadata 与同次响应生成的短期访问地址；只允许真实 `VERIFIED` 文件。新建/更正仍只接受 `OPERATION_SCREENSHOT`，Detail 同时保留历史 Legacy `EVIDENCE` 的只读可见性；异常上下文显式 409。
- Manual correction history 必须能指出每个文件由哪个节点首次追加；历史关系不复制、不改写。
- 页面显示文件名、类型、大小、状态、追加节点与打开/下载入口；无证据时显示真实空态。

### R6 — Correction history

- Manual correction history 由服务端按 root → tail 排序，包含每个节点的完整结果事实、notes、recorder、tested time、created time、当次新增 evidence 和服务端动作投影。
- 响应显式给出 requested/selected observation、root 和 current tail，并对节点标识 original、selected 与 current；前端不得通过 `supersedes_id` 重建链、排序或推断链尾。
- Legacy 没有人工 correction history 分支，不返回伪造空节点或兼容链。
- 所有节点始终 readonly；页面没有输入、保存、原地编辑或修改历史的命令。

### R7 — 服务端动作投影

- 交互资格只消费当前链尾的 `primary_task` 与 `available_actions`；不得从 `is_current`、raw status、角色或 `supersedes_id` 推导。
- `VIEW_ANALYSIS` 只定位本页结果事实，`VIEW_CORRECTION_HISTORY`/`VIEW_HISTORICAL_RECORD` 只定位只读 section；本 Task 不实现 Insights。
- `CORRECT_OBSERVATION` 只有同时存在 `CORRECT` token 时才成为 primary correction link；否则不显示不可执行命令。
- 当前不完整 Manual 对无 `CORRECT` 资格的 actor 不得投影 `CORRECT_OBSERVATION`；使用既有查看类 primary token，不新增 token。
- `DELETE` 只由服务端 token 控制，确认文案明确永久删除完整人工更正链且不可恢复；失败不自动重放。

### R8 — 状态、错误与缓存

- loading 保留 Detail 页面结构；initial error 区分 404、403、409 和普通错误并提供 retry；错误显示结构化 message/request ID。
- cached refresh 失败保留已显示的 readonly snapshot，并提供显式重试。
- 409 不使用旧响应、列表行或部分请求拼出假成功页面。
- 删除成功后先 replace 导航到 canonical List，再无重取地失效链中 Detail cache、刷新 GEO List 与受影响 Product Detail。

### R9 — Responsive 与 accessibility

- Detail 复用现有 `DetailSection`、`Timeline`、`Badge`、Dialog、RouteError/query error pattern 和文本展示，不创建万能 Detail framework。
- 375/768/1024/1440 页面根无横向溢出；长问题、URL、文件名、notes 和 article title 可换行或局部滚动。
- 原生 link、primary/overflow actions、retry 和 Dialog 均可键盘操作；Dialog 取消/失败后焦点返回触发器。
- heading、section、timeline、status、current/historical/original/selected 与只读语义有可访问名称，且不只依赖颜色。

### R10 — 兼容、文档与交付边界

- Contract-first：先更新 `contracts/openapi.yaml`，再改 backend schema/router/service，最后生成 V1/V2 types 并实现 V2。
- 旧 `GET /api/v1/geo-observations/{observation_id}`、`GET /api/v1/geo-observations` 与 POST canonical response 保持形状和 V1 行为；V2 使用 additive 专用 Detail operation。
- `frontend/src/shared/api/schema.d.ts` 只允许机械生成，不修改旧 `frontend/` 业务 UI。
- 不新增数据库表、列、索引或迁移；`contracts/database.md` 只记录读取快照与现有链 invariant。
- 实施、required validation 与自审完成后先展示 commit plan；未经确认不 commit，不 push。

## Out of Scope

- `/geo/observations/$observationId/correct` 的表单、提交或占位实现。
- Observation 或 Correction 原地编辑、历史数据修改、兼容写入或回填。
- Topics、Insights 页面、Print、GEO Optimization。
- 完整 `new → detail → correction` 真实栈闭环；本 Task 只验证 New POST ID → fixture Detail handoff。
- GEO vertical slice 抽象回顾。
- 修改旧 `frontend/` 业务 UI。
- 新万能 Detail、History、Evidence、Action 或 DTO framework。
- 浏览器跨接口 join、逐文件/逐成果补请求、根据 raw state 推导资格。
- 数据库 migration。

## Acceptance Criteria

- [x] `/geo/observations/$observationId` 已注册，List → Detail、direct、refresh、Back 和 Forward 均可用；非法 UUID 显式失败。
- [x] V2 Detail 首屏只调用一个 generated Detail operation；strict fixture 对任何 Product、Topic、旧单条 GET、Article Detail、FileRecord 或 download-url 补请求返回失败。
- [x] Legacy 与 Manual generated union 分支分别显示全部且仅显示合同真实存在的事实；unknown 保持 unknown。
- [x] Query Topic、Product、GEO platform、tested/created time、recorder、notes、关联 Published Articles 和 evidence 均可直接绘制。
- [x] Manual 任意链节点 URL 都返回同一完整 root→tail history，并明确 original、selected、historical correction、current tail 与每项新增 evidence。
- [x] 链排序、完整性、tail、selected、article/file batches 和 actor actions 由服务端权威计算，backend integration 证明查询次数固定。
- [x] 当前链尾动作只来自服务端：`CORRECT` 指向 canonical Correction URL，`DELETE` 复用现有 command/Dialog；历史节点无原地修改。
- [x] 当前真实账号类型 Admin/Engineer 的动作投影均有测试；共享 primary owner 保证没有 `CORRECT` token 时不返回可执行 correction primary，不新增不存在的 viewer 角色。
- [x] loading、404、403、409、普通错误、cached refresh error 和 retry 有可观察覆盖，request ID 可见。
- [x] New Observation 成功后使用 POST 响应 ID 进入 Detail，未请求或搜索 Observation List 来发现 ID。
- [x] 375/768/1024/1440、长内容、键盘、焦点与基础 accessibility 通过 production-artifact fixture E2E。
- [x] OpenAPI、runtime schemas/router/service、backend tests、V1/V2 generated types、V2 页面/tests 与 05/07/08/09/数据库读取说明一致。
- [x] 没有数据库 migration、新依赖、旧 frontend 业务 UI 修改、万能抽象或排除页面。
- [x] 规划获批后才创建分支和修改生产代码；当前尚未提交、归档或 push。

## Planning Approval Gate

- Blocking product questions：0。用户已明确页面字段、只读语义、动作来源、错误/响应式/测试要求与排除范围。
- 当前只完成规划文档；`task.py start`、临时分支和生产代码修改必须等待用户对最新规划的明确批准。
