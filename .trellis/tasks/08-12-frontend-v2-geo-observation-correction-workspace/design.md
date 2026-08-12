# Frontend V2 GEO Observation Correction Workspace — 技术设计

## 1. 设计结论

采用一个更正专用读取上下文，加现有通用创建命令：

```text
GET /api/v1/geo-observations/{observation_id}/correction-context
  └─ detail: 复用 ManualGeoObservationDetail
  └─ correction_article_results: 当前候选 + 服务端合成的初始事实
  └─ query_topic_options: 仅历史 Topic 为空时提供

POST /api/v1/geo-observations
  └─ 复用 GeoObservationCreate
  └─ supersedes_id = context.detail.chain_tail_id
```

不增加 Correction POST、不修改现有 Detail 响应、不增加数据库字段，也不抽象通用 GEO 表单或 Workspace。现有 Detail 提供不可变历史，新增 GET 只补充“当前候选快照”和“历史 Topic 为空时的选择上下文”，是满足更正页面的最小新契约。

## 2. 审计依据

- `GET /geo-observations/{id}` 已能在一次 `REPEATABLE READ` 读取中返回 Manual 更正链、`chain_root_id`、`chain_tail_id`、历史结果、直接证据、聚合证据和服务端 `available_actions`。
- `geo_publication_candidates(...)` 是当前有效 Published Article 集合的权威读取；它与历史 Detail 的终态文章集合不是同一时间语义。
- `create_geo_observation(...)` 已锁定 Product/前节点，校验候选集合完全相等、冻结 Platform/Search Query/Product、Query Topic 继承规则、当前尾唯一性及证据不可复用。
- 现有 `POST /geo-observations` 已支持 `supersedes_id`，路由已限制 ADMIN/ENGINEER，且响应包含新 Observation ID。
- Frontend V2 New 页面已具备 React Hook Form、Zod、GEO 上传、同步防重、DirtyGuard、冲突不重放和显式候选刷新模式。
- V1 更正页可作为字段语义参考，但它直接使用历史文章结果作为候选，不能满足当前候选快照要求，因此不迁移其数据流。

## 3. 新读取契约

### 3.1 OpenAPI

新增：

```yaml
GET /api/v1/geo-observations/{observation_id}/correction-context
operationId: getGeoObservationCorrectionContext
response 200: GeoObservationCorrectionContext
```

新增 schema：

```yaml
GeoObservationCorrectionContext:
  type: object
  required:
    - detail
    - correction_article_results
    - query_topic_options
  properties:
    detail:
      $ref: '#/components/schemas/ManualGeoObservationDetail'
    correction_article_results:
      type: array
      items:
        $ref: '#/components/schemas/GeoArticleResult'
    query_topic_options:
      type: array
      items:
        $ref: '#/components/schemas/GeoObservationDetailQueryTopic'
```

沿用已有类型，避免复制 Manual Detail、文章元数据和 Query Topic DTO。该上下文不是第二套历史模型：`detail` 仍是现有 Detail 投影，只在同一服务端读取事务中组合更正所需的可变输入。

### 3.2 服务端生成规则

路由使用现有 `REPEATABLE READ` 数据库依赖，并限制 ADMIN/ENGINEER。服务层按以下顺序生成上下文：

1. 调用现有 Manual Detail 投影读取请求 ID 的完整链。
2. 从响应的 `chain_tail_id` 取得权威当前尾，确认其为 Manual 且对当前 actor 含 `CORRECT`；不满足时返回 403。Legacy 返回 `409 INVALID_STATE_TRANSITION`，缺失记录返回 404，损坏链沿用现有明确 409。
3. 在同一事务中调用现有 `geo_publication_candidates(...)` 读取当前候选。
4. 以 Published Article ID 将尾节点事实投影到当前候选：
   - 候选仍在尾节点中：继承 `discovered`、`mentioned`、`accuracy`；
   - 新候选：三个事实均为 `null`；
   - 已退出候选的历史文章：只保留在 `detail`，不进入 `correction_article_results`。
5. 尾节点 Query Topic 非空时返回空 `query_topic_options`；为空时返回当前 Query Topic 列表，供首次更正显式选择。

候选为空仍返回 200 和空数组，使页面能解释当前不可提交状态；写入端继续拒绝不合法候选集合。此行为不需要数据库变更。

### 3.3 历史 ID 与 canonical URL

上下文接受合法 Manual 链中的任一 ID。初次 route loader 读取上下文后比较 URL ID 与 `detail.chain_tail_id`：

- 相同：继续渲染；
- 不同：以 `replace` 跳转 `/geo/observations/{chain_tail_id}/correct`，由目标 URL 重新使用自己的查询键；
- 跳转依据只来自服务端字段，前端不从历史数组推断尾节点。

初次 canonical replace 发生在工作台挂载前，因此不会产生草稿。冲突后的 canonical 更新由已挂载页面执行，页面状态不得以 route 参数作为 React `key`，以保留草稿。

## 4. 写入与字段所有权

不新增命令。更正页面继续调用：

```text
POST /api/v1/geo-observations
Content-Type: application/json
Body: GeoObservationCreate
```

字段来源如下：

| 字段 | 来源 | 页面行为 |
|---|---|---|
| `product_id` | `context.detail.product.id` | 冻结，不进入可编辑表单 |
| `query_topic_id` | 尾节点 Topic；仅为空时取用户选择 | 非空冻结；空时必选 |
| `search_platform` | 当前尾节点 | 冻结，不进入可编辑表单 |
| `search_query` | 当前尾节点 | 冻结，不进入可编辑表单 |
| `tested_at` | 新表单，默认当前本地时间 | 必填、可编辑，不复制历史值 |
| `article_results` | `correction_article_results` | 完整当前候选集合；`null` 必须显式完成 |
| `attachment_file_ids` | 本次上传完成后的新文件 ID | 不包含历史证据 |
| `notes` | 新表单“更正原因 / Notes” | 默认为空，不复制历史 Notes |
| `supersedes_id` | `context.detail.chain_tail_id` | 提交时注入，不接受用户输入 |

服务端现有创建逻辑继续作为最终权威：客户端冻结字段只改善交互，不替代权限、状态、集合、Topic 或证据校验。

## 5. Frontend V2 页面设计

### 5.1 文件与职责

- `geo.api.ts`：增加 correction-context query key、query options 和 fetcher；创建/上传 API 保持不变。
- `geo-observation-correction.model.ts`：只定义 Correction 表单 schema、初始化、上下文断言、payload 映射及 Correction 错误映射。
- `geo-observation-correction-page.tsx`：组合现有 Workspace、表单、上传、DirtyGuard 与 mutation；不承载服务端业务推断。
- `$observationId_.correct.tsx`：route loader、canonical replace、错误边界和页面挂载。

可直接复用 `new-geo-observation.model.ts` 已导出的 accuracy 值/标签、本地时间工具和通用显示格式；复用 `GeoEvidenceUpload`、`WorkspaceShell`、`StickyActionBar`、`DirtyGuard`、`FormField`。不拆出通用 GEO Form，也不为了复用少量展示代码改造 Detail 页面。

### 5.2 布局

使用现有 `WorkspaceShell`：

- Context：只读 Original 与当前 Tail。单节点链只显示一次并标记 Original/Current；多节点链分别显示 Original 与 Current Tail。中间链和全部历史直接证据通过紧凑历史区可访问，不把任何历史字段放入 form controls。
- Main：本次测试时间、Query Topic 例外选择、当前文章事实。
- Reference：本次新证据及“更正原因 / Notes”。
- StickyActionBar：取消/返回 Detail、提交 Correction；提交状态和上下文失效状态可见。

窄屏完全使用 `WorkspaceShell` 现有 tabs/堆叠，不增加 JavaScript 断点方案。

### 5.3 表单与验证

Correction form 只持有真正可编辑的值：

```text
query_topic_id（仅历史值为空时有效）
tested_at
article_results
attachment_file_ids
notes
```

Zod 在客户端校验测试时间、必选 Topic 条件、候选集合与 `discovered`/`mentioned` 明确布尔值；`accuracy` 延用现有可空业务语义。Payload builder 从上下文注入所有冻结字段和 `supersedes_id`，避免隐藏 input 成为第二数据源。

## 6. 异步状态、冲突与草稿

### 6.1 普通加载和提交

- loader 首屏使用 TanStack Query 的 correction-context query options。
- 有缓存数据时的后台 refetch 失败不卸载表单；显示可重试错误并保留 DirtyGuard。
- 提交同时使用同步 `pendingRef` 和 mutation pending 状态，防止同一事件循环内重复 POST。
- 普通 422 将可编辑字段错误映射到表单；冻结字段、`supersedes_id`、权限和跨字段错误进入页面错误摘要。失败不 reset。
- 上传延用现有 initiate/PUT/complete/retry；只有 complete 成功的本次文件 ID 进入表单。

### 6.2 两类 409

`GEO_PUBLICATIONS_CHANGED` 或 `REVISION_CONFLICT` 时：

1. 标记当前上下文过期，禁用再次提交；
2. 显示服务端错误及“重新加载最新上下文”；
3. 不自动 refetch、导航或重放 POST；
4. 保留表单值、已完成上传 ID 和失败 request ID。

用户显式刷新后，将新上下文按 Published Article ID 与当前草稿合并：

- 仍是候选的文章保留用户已填事实；
- 新候选使用服务端的 `null` 初值，要求显式填写；
- 已退出候选从新请求集合移除，但仍可在刷新后的只读历史看到；
- `tested_at`、Notes、上传 ID 保留；
- 尾 Topic 仍为空且旧选择仍在 options 中时保留选择，否则清空；若新尾已补齐 Topic，改为服务端冻结值；
- 新 `chain_tail_id` 成为下一次 POST 的 `supersedes_id`，并以 `replace` 更新 canonical URL。

合并只发生在用户明确动作之后。它不自动提交，也不保留已不属于服务端当前集合的文章，因此不会形成模糊兼容逻辑。

## 7. 成功交接与缓存

POST 成功后：

1. 使用响应 `id` 作为新 Observation ID；
2. 标记表单已成功提交，解除 DirtyGuard；
3. 失效：
   - `geoKeys.lists()`；
   - `geoKeys.details()` 或上下文历史中所有旧 Detail key；
   - 新 ID 的 Detail key；
   - `geoKeys.correctionContexts()`；
   - `productsKeys.detail(product_id)`；
4. 导航 `/geo/observations/{response.id}`。

不读取 List 查找“最新”记录，不做客户端乐观插入，不保留旧上下文为成功来源。

## 8. 错误、焦点与无障碍

- 404/403/409 使用 route/page 明确状态，不降级为 New。
- 表单错误摘要使用可聚焦容器和 `aria-live`；提交失败聚焦摘要，纯字段错误优先聚焦首个无效字段。
- 冲突提示说明草稿仍保留，显式刷新按钮可用键盘操作；刷新后焦点回到提示或首个新必填项。
- 所有冻结值以文本/定义列表呈现，不使用 disabled input 模拟只读业务数据。
- StickyActionBar 不遮挡 375/768/1024/1440 px 下最后一个字段和错误提示。

## 9. 测试边界

### 9.1 后端与契约

- OpenAPI 单元契约覆盖新 path、operationId、响应 schema 与生成类型。
- 新集成测试覆盖：权限、Legacy/历史 ID/current tail、Topic 空值例外、候选新增/退出投影、非尾冲突、候选变化、冻结字段、证据复用、原链不可变、成功响应 ID。
- 上下文查询数量对链长度保持固定阶，防止逐节点/逐文件 N+1。

### 9.2 Frontend V2

- model/API tests：上下文严格断言、初值、`null` 阻断、冻结字段来源、权威 `supersedes_id`、只提交新证据、错误映射、合并规则。
- page tests：canonical、loading/404/403/409、只读历史、Topic 例外、提交防重、DirtyGuard、失败保留、显式刷新、缓存失效和响应 ID 交接。
- Production Fixture Playwright：使用严格类型 fixture，任何未声明 API 立即失败；覆盖直接访问、刷新、历史 ID replace、Detail 动作入口、成功 Correction、两类 409 不重放、上传失败/重试、权限变化、焦点/键盘与四档宽度。

真实服务全链 GEO E2E 不在本 Task。完成后页面/API 边界已经支持后续 New → Detail → Correction → 新 Detail 编排，后续 Task 只增加真实栈隔离数据与编排验证。

## 10. 文档与兼容性

- 更新 `contracts/openapi.yaml`；两套前端生成类型必须由同一契约重新生成。
- 更新 Frontend V2 的业务动作/状态机、迁移计划、测试策略和 ADR；新增 ADR 记录“专用读取上下文 + 通用 append POST”的决定。
- `contracts/database.md` 无需修改：本设计不改变持久化模型、不可变规则或链约束。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 现有“Original vs Correction、追加而非编辑”仍准确；具体数据/冲突契约由 `05` 承载，不重复维护。
- Frontend V1 不修改；OpenAPI 仅增加读取 endpoint/schema，现有客户端兼容。

## 11. 十项规划焦点结论

1. **Detail 还是 correction context**：Detail 是历史权威但缺当前候选；新增一个组合既有 Detail 的 correction-context GET，不改变 Detail endpoint。
2. **当前 candidates snapshot**：服务端在同一 `REPEATABLE READ` 上下文中读取并完成尾事实投影，浏览器不并行拼接。
3. **POST 还是新 command**：继续使用 `POST /geo-observations` 和 `GeoObservationCreate.supersedes_id`，不新增命令。
4. **历史 ID canonical**：服务端返回明确 `chain_tail_id`，route 在挂载前 replace；Legacy/非法链明确失败。
5. **冻结与可编辑字段**：Product/Platform/Query/非空 Topic/历史全只读；仅新 tested_at、当前文章事实、新证据、Notes，以及空 Topic 例外可编辑。
6. **null Query Topic**：首次更正必须从服务端 options 显式选择；无 option 或未选择时不可提交；新节点写入后冻结。
7. **冲突行为**：两类 409 均不重放；保留草稿/上传；仅显式刷新并按文章 ID 合并，URL 依服务端尾更新。
8. **New 表单复用边界**：复用已导出常量/时间工具、上传和页面基础组件；Correction 自有 schema/payload，不造通用 GEO Form。
9. **后续真实栈准备度**：本 Task 闭合页面级接口与路由；真实栈数据编排和全链 E2E 留给独立 Task。
10. **文件、验收、验证**：见 `implement.md` 的精确清单、AC 映射和 required/optional 命令。
