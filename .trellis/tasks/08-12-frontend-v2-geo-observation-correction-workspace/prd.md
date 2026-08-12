# Frontend V2 GEO Observation Correction Workspace

## 目标

在 Frontend V2 交付 `/geo/observations/$observationId/correct` 更正工作台，使有权限的用户能够基于当前 Manual GEO Observation 尾节点追加一条 Correction，并在提交成功后进入新 Observation 的 canonical Detail。

本 Task 只交付页面级更正闭环。Correction 必须追加新记录，不得原地修改或删除任何历史 Observation、GEO 结果或历史证据。

## 已确认业务约束

- PostgreSQL 中的 GEO Observation 及更正链保持不可变；更正通过新 Observation 的 `supersedes_id` 指向提交时的权威尾节点。
- 只有当前 Manual Observation 且服务端授予 `CORRECT` 动作时才允许进入和提交；Legacy Observation 不可更正。
- Product、Search Platform、Search Query 始终继承且冻结。
- 非空 Query Topic 始终继承且冻结；历史 Query Topic 为空时，首次更正必须选择真实 Query Topic，之后冻结。
- 更正时必须使用当前仍有效的 Published Article 集合；历史结果只读，不能作为当前候选集合的替代来源。
- 历史证据只读；本次提交只能关联新上传且未在当前更正链中使用过的证据。
- AI 输出和客户端状态都不具有业务裁决权；权限、尾节点、候选文章集合、字段冻结和证据复用由服务端最终校验。

## 范围

### 包含

1. 新增 canonical route `/geo/observations/$observationId/correct`，支持直接访问、刷新、浏览器前进/后退和从 List/Detail 的服务端动作链接进入。
2. 读取一个服务端更正上下文快照，包含：
   - 完整只读 Manual Observation Detail/更正历史；
   - 服务端解析的当前链尾；
   - 当前 Published Article 候选及其更正初始事实；
   - 仅在历史 Query Topic 为空时需要的 Query Topic 选项。
3. 左侧只读呈现 Original 与当前尾节点，清楚区分不可变历史和本次新 Correction。
4. 右侧编辑本次 `tested_at`、当前文章事实、新证据以及“更正原因 / Notes”。
5. 延用现有 GEO 证据上传流程和 `POST /api/v1/geo-observations`，以服务端上下文中的 `chain_tail_id` 作为 `supersedes_id`。
6. 处理 loading、404、403、409、422、网络错误、重试、提交中防重复、DirtyGuard、键盘操作、焦点恢复和基础无障碍。
7. 对 `GEO_PUBLICATIONS_CHANGED` 与 `REVISION_CONFLICT` 禁止自动重放；保留草稿及已上传文件，并仅允许用户显式重新加载最新上下文。
8. 成功后使用 POST 响应中的新 Observation ID 跳转新 canonical Detail，并使相关查询缓存失效。
9. 增加严格、类型化、未声明请求即失败的 Production Fixture Playwright 覆盖，以及相应契约、后端集成、Frontend V2 单元/组件测试。
10. 更新本 Task 影响的 OpenAPI 与 Frontend V2 权威设计/迁移/测试文档。

### 不包含

- 历史 Observation、历史结果或历史证据的原地更新、删除或重排。
- Legacy GEO Observation 更正。
- Topics、Insights、Print、Optimization、V1 UI 或通用表单/工作台框架。
- 新的 Correction 写入端点、新的幂等命令协议、自动冲突重放或客户端推断 `CORRECT` 权限。
- 数据库迁移或数据模型调整；若实现审计发现不可避免，必须先停止并另行确认。
- 完整真实服务 GEO E2E 编排与抽象复审；它们属于后续独立 Task。

## 功能需求

### R1：入口与 canonical 行为

- 路由必须使用 `/geo/observations/$observationId/correct`。
- 对同一合法 Manual 更正链中的历史 ID，服务端必须返回明确的当前尾 ID；前端在工作台挂载前使用 `replace` 进入当前尾的 canonical URL。
- 不存在的 ID 显示 404；Legacy、损坏链或无法形成合法上下文显示明确错误；不得退化为 New 页面或猜测替代记录。
- 仅 ADMIN/ENGINEER 且服务端当前授予 `CORRECT` 时可加载工作台。页面不得仅靠隐藏按钮实现权限控制。

### R2：只读历史与编辑区

- 页面必须明确告知用户“这是追加 Correction，不是编辑历史 Observation”。
- Original 和当前尾节点展示 Product、Query Topic、Platform、Search Query、测试时间、文章事实、Notes、记录人及历史证据；所有内容只读。
- Product、Platform、Search Query 不得成为可编辑表单字段。
- 尾节点 Query Topic 非空时只读冻结；为空时显示必填 Query Topic 选择器，未选择不得提交。
- 本次 `tested_at` 默认为当前本地时间，不复制历史值；“更正原因 / Notes”默认为空，不复制历史 Notes。

### R3：当前文章事实

- 可编辑文章集合必须来自服务端同一更正上下文中的当前 Published Article 快照。
- 当前候选若存在于尾节点结果中，初始事实继承尾节点；新出现的候选以及历史为 `null` 的事实保持 `null`，要求用户明确选择，禁止推断为 `false`。
- 已退出当前候选集合的历史文章仅在左侧历史中显示，不进入本次 POST。
- 提交必须包含完整且仅包含当前候选文章集合；服务端继续执行最终集合校验。

### R4：证据与提交

- 历史证据聚合显示但不可删除、覆盖或随本次请求再次提交。
- 本次上传延用现有 initiate → object storage PUT → complete 流程；上传失败或 complete 失败时保留用户意图并提供现有重试能力。
- POST 只携带本次新证据 ID；服务端拒绝当前更正链中已使用的证据。
- `supersedes_id` 必须来自最近一次成功加载的服务端 `chain_tail_id`，不得来自 URL 推导、List 缓存或用户输入。
- 提交按钮和同步保护必须保证一次用户提交最多产生一个在途 POST。

### R5：冲突、错误与草稿

- `GEO_PUBLICATIONS_CHANGED` 与 `REVISION_CONFLICT` 到达后，不得自动修改请求并重放。
- 冲突状态必须保留 `tested_at`、Notes、仍匹配文章的用户事实、Query Topic 选择、本次上传文件 ID 和请求错误上下文，并阻止再次提交旧上下文。
- 用户点击“重新加载最新上下文”后：按 Published Article ID 合并仍有效的用户事实，新增候选保留 `null`，移除失效候选；其余草稿和上传 ID 保留。
- 若重新加载得到新尾 ID，URL 依据服务端字段以 `replace` 更新，且不得因 canonical 更新清空草稿。
- 422/权限变化/网络错误必须明确呈现并保留可恢复输入；修正后允许重试，禁止静默成功或重置表单。

### R6：成功交接与缓存

- POST 成功后先解除 DirtyGuard，再使用响应 `id` 导航 `/geo/observations/{id}`；不得通过重新查询 List 猜测新记录。
- 至少失效 GEO List、原链各 Detail、新 Detail、更正上下文以及对应 Product Detail 查询。
- 成功前离开有未保存内容的页面必须触发现有 DirtyGuard；成功跳转不得出现误拦截。

### R7：布局与无障碍

- 使用现有 `WorkspaceShell`、`StickyActionBar`、表单与证据上传组件，不创建通用 GEO Workspace/Form 框架。
- 在 375、768、1024、1440 px 下信息和提交动作可用；窄屏遵循现有 Workspace tabs/堆叠行为。
- 错误摘要、字段错误、冲突提示和重试动作具备可感知标签；提交失败后焦点进入错误摘要或首个无效字段；全部关键操作可用键盘完成。

## 验收标准

- [ ] AC1：ADMIN/ENGINEER 可从当前 Manual Detail 的服务端 `CORRECT` 链接进入 canonical 更正页；无权限用户得到 403，Legacy 或损坏链得到明确错误，缺失记录得到 404。
- [ ] AC2：历史 ID 直达时先根据服务端 `chain_tail_id` replace 到当前尾 URL，再渲染工作台；刷新、前进和后退不会把用户带到可编辑的历史节点。
- [ ] AC3：Original/当前尾和全部历史证据只读；页面明确说明追加语义；Product、Platform、Search Query 以及非空 Query Topic 不可编辑。
- [ ] AC4：历史 Query Topic 为空时必须显式选择真实 Topic；未选择时客户端和服务端都拒绝提交，选定后新节点保存该 Topic，后续更正冻结。
- [ ] AC5：当前候选快照由服务端提供；保留仍存在文章的尾节点事实，新文章和未知事实保持 `null`，退出候选的历史文章不进入 POST。
- [ ] AC6：本次 `tested_at` 默认当前本地时间、Notes 为空；改变一个文章事实不会丢失其余表单值。
- [ ] AC7：POST 使用上下文的权威 `chain_tail_id`，只提交新证据；成功创建新节点且原链内容不变，响应 ID 直接交接新 Detail。
- [ ] AC8：快速重复提交、回车和点击组合只产生一个在途 POST；POST 不发送 `Idempotency-Key`。
- [ ] AC9：`GEO_PUBLICATIONS_CHANGED`、`REVISION_CONFLICT` 不自动重放；显式刷新前后草稿和上传 ID 保留，候选按 ID 合并，URL 只根据服务端尾 ID 更新。
- [ ] AC10：服务端拒绝非尾 `supersedes_id`、冻结字段变更、错误候选集合、历史证据复用和不具备权限的提交，且不产生半成品记录。
- [ ] AC11：提交失败、权限变化、上传失败/重试、DirtyGuard、焦点恢复、键盘操作在 Production Fixture 中可验证。
- [ ] AC12：375、768、1024、1440 px 下无横向溢出、内容遮挡或不可达主动作；Production Fixture 拒绝所有未声明 API。
- [ ] AC13：List、旧/新 Detail、Product Detail 与更正上下文缓存按成功结果失效；页面不依赖 List 再查询完成跳转。
- [ ] AC14：OpenAPI、生成类型、代码、测试和 Frontend V2 权威文档一致；无数据库迁移、无新依赖、无 Correction 专用写入协议。
- [ ] AC15：页面级 New → Detail → Correction → 新 Detail 的接口与路由已闭合，后续真实服务 GEO E2E 只需编排现有表面，不需重写本 Task 的页面业务流程。

## 来源文档

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/frontend-v2/02-information-architecture-and-routing.md`
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- `.trellis/spec/backend/available-actions-contract.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/quality-guidelines.md`
