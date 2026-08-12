# Frontend V2 GEO Observation List

## Goal

交付 `/geo/observations` 的 GEO Observation List vertical slice，使已认证用户能够通过 canonical URL 直接访问、搜索、筛选、排序和分页浏览当前观测记录，并只根据服务端 `available_actions` 看见更正或删除入口。

本 Task 只实现列表，不实现新建、详情、Correction Workspace、Topics、Insights、Print View 或 Workbench。

## 用户价值

- GEO 观测首次进入 Frontend V2 canonical 信息架构，支持复制 URL、刷新、Back/Forward 和服务端列表状态恢复。
- 每一行一次返回查询、Product、平台、compact 结果指标、关联成果、证据、记录人与观测时间，不再让浏览器从 Detail DTO 或其他接口拼装列表。
- 行主链接稳定指向未来 Observation Detail canonical URL；未实现的 Detail 不阻塞当前列表，也不引入占位业务页。
- 更正与删除资格由当前操作者的服务端投影决定，前端不按 raw status、角色或观测类型推导动作。

## 权威来源与现状审计

### 已确认事实

- `docs/frontend-v2/02-information-architecture-and-routing.md` 与 GEO 蓝图已把 `/geo/observations` 定义为 canonical Observation List；列为查询/Product、GEO 平台、发现/提及/准确指标、关联成果、证据、记录人、观测时间和 overflow actions。
- 现有 `GET /api/v1/geo-observations` 返回 `GeoObservationList.items: GeoObservation[]`。每项是完整 `LegacyGeoObservation | ManualGeoObservation`，包含 notes、citation、article title/final URL、attachment IDs 与 workflow 字段，属于 Detail 级响应。
- Backend list 通过 `geo_observation_query()` 完成服务端筛选和分页，再由 `geo_observations_out()` 批量装载完整文章关系、内容标题/URL、引用、附件祖先链与动作投影；列表和详情共用同一个完整 projector。
- 当前列表默认只返回 correction chain tails；稳定排序是 `tested_at ASC|DESC` 加 `id ASC`。读取权限为已认证用户；创建/更正要求 `ADMIN|ENGINEER`，删除要求 `ADMIN`，命令端会重新校验。
- 当前 `search` 只查 raw prompt/search query；`search_platform` 只作用于人工观测。V2 需要统一的 GEO platform filter 和可直接显示的 Product/query compact projection。
- 现有 V1 `GeoObservationsPage` 直接消费完整列表 DTO 来绘制结果、证据与抽屉，并调用当前 collection endpoint。直接把该 endpoint 改成 compact DTO 会破坏 V1 runtime；本 Task 又明确禁止修改 V1 页面。
- Frontend V2 已有 `FilterBar`、`TableShell`、`ColumnHeader`、`Pagination`、`RowActions`、loading skeleton、empty/error feedback、TanStack Router URL normalization、TanStack Query server state 与 TanStack Table server sorting pattern，可直接组合。
- 现有 table CSS 已把横向滚动限制在 Table region，并通过 `primary/status/metadata/numeric/date/actions` role 在窄屏裁剪次要列；无需新 DataTable 或新全局响应式框架。
- 现有 fixture E2E 在 production artifact 上严格声明页面 API，未声明请求返回 501 并使 teardown 失败；真实栈 E2E 由 `deploy/scripts/e2e-local.sh` 独占数据库、Redis、对象存储与 V2 preview。
- 当前没有 GEO Observation list 的 backend integration test 或 V2 fixture/real-stack spec。

### 冲突判断

**存在冲突。** 当前 `GeoObservationList` 是 Detail DTO 的分页容器，不是蓝图要求的 compact `GeoObservationListItem`。继续复用会保留不必要的文章 URL、引用、备注和附件 ID 装载，也会让列表 UI 依赖 detail shape。

**最小兼容方案是新增一个独立 list read-model endpoint，而不是替换旧 endpoint 或增加模式参数。**

- 新增 `GET /api/v1/geo-observations/list-items`，返回权威 `GeoObservationListPage`。
- 保留 `GET /api/v1/geo-observations`、`GeoObservationList` 与完整 `GeoObservation` 行为不变，供 V1 和既有消费者继续使用。
- 不增加 `compact=true`、`view=v2`、兼容别名或根据 query 改变同一 operation 的响应类型。
- V2 只消费新 endpoint；列表行不再读取 Detail DTO。

## In Scope

- 注册 `/geo/observations`、GEO 导航和 route metadata。
- URL search params：`q`、`productId`、`geoPlatform`、`accuracy`、`from`、`to`、`sort`、`page`、`pageSize`。
- 服务端搜索、Product/GEO platform/accuracy/date 筛选、观测时间排序、count 和分页。
- 新的 compact list read model、backend query/projector、OpenAPI 与 generated types。
- 八列 Observation List、主列 canonical Detail link、overflow 更正 link 与删除 Dialog。
- loading、initial empty、filtered empty、error、retry、pagination。
- 375/768/1024/1440、页面根无横向溢出、键盘、可见焦点、Dialog focus return 与基础可访问性。
- 第一张 GEO 业务页的 production-artifact fixture Playwright E2E。
- 直接受影响的 V2 文档、contract test、backend integration test 与 frontend unit/component tests。

## Out of Scope

- `/geo/observations/new`、Observation Detail 页面、Correction Workspace、Topics、Insights、Print View、Workbench。
- `$observationId` 或 `$observationId/correct` 的占位 route、假详情、抽屉详情或复制 Detail 能力。
- V1 runtime/page/test 的业务修改；不改变旧 `/api/v1/geo-observations` 的参数、响应或行为。
- 客户端跨接口 join、逐行补请求、本地过滤/排序服务端分页结果或从当前页生成 filter options。
- Product selector/options 新 endpoint；本 slice 使用明确标注的 Product UUID 输入，普通文本查找可通过 `q` 搜索 Product brand/part number。
- 根据 raw status、角色或 `primary_task` 推导更正/删除。
- 新万能 DataTable、GEO framework、通用 action framework、全局 store、运行时依赖或预测性 Design System 抽象。
- 数据库 schema/migration、观测写入合同、correction/delete 业务规则重做。
- GEO 真实栈完整业务 flow；该闭环留到 New/Detail/Correction 都具备 canonical surface 后建立。

## Requirements

### R1 — Canonical route 与导航

- `/geo/observations` 是本 Task 唯一新增的业务页面。
- 默认 canonical URL 是 `/geo/observations?page=1&pageSize=20`；未知 key、非法 enum、非法 UUID/date/page/pageSize 和空白值在 loader 前 replace 到 canonical search。
- direct、refresh、Back/Forward 保留同一 server state；改变任一搜索、筛选、排序或 pageSize 时 page 回到 1。
- GEO 导航只增加已实现的“观测记录”；不得增加 New/Topics/Insights/Detail/Correction 占位入口。

### R2 — Compact list contract

- `GeoObservationListPage` 只包含 `items/page/page_size/total`；items 使用 `GeoObservationListItem`，不得复用完整 `GeoObservation`。
- 每个 item 必填：`id`、`observation_kind`、`query_text`、`product`、`geo_platform`、`outcomes`、`related_achievement_count`、`evidence_count`、`recorder`、`observed_at`、`available_actions`。
- `query_text` 由服务端选择：存在 QueryTopic 时使用 `canonical_question`，否则使用该观测已存的 raw prompt/search query；浏览器不得再查 QueryTopic。
- Product 只返回 `{id,label}`；label 使用现有 Product brand/part number 规则。
- `outcomes.discovered/mentioned/accuracy` 使用服务端 compact count，保留 unknown/unassessed 与 not-applicable 语义，不用 0 猜测未知事实。
- `related_achievement_count` 是 legacy 关联成果或 manual article result 的权威数量；`evidence_count` 是当前 correction chain 可见的 distinct evidence attachment 数量。
- list item 不返回 notes、citations、article title/final URL、attachment IDs、workflow stage、primary task 或 detail payload。
- `available_actions` 只允许 typed `CORRECT|DELETE`；没有资格时返回空数组。

### R3 — Server-side query contract

- 新 endpoint 参数严格为：`search`、`product_id`、`geo_platform`、`accuracy`、`date_from`、`date_to`、`sort`、`page`、`page_size`；不接受兼容别名。
- `GeoObservationListSort` 只允许 `OBSERVED_DESC|OBSERVED_ASC`，默认 `OBSERVED_DESC`；两种排序均追加 `id ASC`。
- `search` trim 后 1–200 字符，覆盖 canonical/raw query 与 Product brand/part number。
- `geo_platform` 对 legacy `model_name` 与 manual `search_platform` 使用同一大小写不敏感精确匹配语义。
- `accuracy` 对 legacy 匹配观测 accuracy，对 manual 匹配任一 article result accuracy；不在客户端重算筛选。
- date range 沿用 backend 现有 inclusive calendar-date 语义；`from > to` 在边界返回结构化 422。
- 新 endpoint 仍只返回 correction chain tails，不开放 `include_history`、`only_mine` 或旧高级筛选参数。
- count、filter、stable sort 与 page 都由 PostgreSQL 完成；projector 查询数不得随行数增长。

### R4 — URL 到 API 的唯一映射

| URL search | API query | 规则 |
| --- | --- | --- |
| `q` | `search` | trim；空值移除 |
| `productId` | `product_id` | UUID |
| `geoPlatform` | `geo_platform` | trim；空值移除 |
| `accuracy` | `accuracy` | `ACCURATE|PARTIAL|INCORRECT|UNJUDGEABLE` |
| `from` | `date_from` | `YYYY-MM-DD` |
| `to` | `date_to` | `YYYY-MM-DD` |
| `sort` | `sort` | `OBSERVED_DESC|OBSERVED_ASC` |
| `page` | `page` | positive integer |
| `pageSize` | `page_size` | `10|20|50` |

不得新增 snake_case URL key、旧参数 alias 或多来源 fallback。

### R5 — Table 与状态

- 固定八列：查询/Product、GEO 平台、发现/提及/准确 compact indicators、关联成果数量、证据 indicator、记录人、观测时间、overflow actions。
- Query 是唯一主链接；第二行显示 Product label。不得出现“查看详情”动作或额外 detail 按钮。
- 主链接使用原生 anchor 指向 `/geo/observations/{id}`；由于 Detail route 尚未实现，本 Task 不注册该 route，也不在 fixture E2E 中导航到目标页。
- compact indicators 同时使用文字、数值与图形/图标语义，不只依赖颜色；未知与不可适用必须可区分。
- 初始空与 filtered empty 使用不同说明；error 显示可用的 `request_id` 并提供 retry；background refresh 失败不得用假数据覆盖已显示行。
- 页面不得进行本地搜索、筛选、排序或分页截取。

### R6 — Actions、Dialog 与权限

- 前端只读取 `available_actions`：`CORRECT` 映射 `/geo/observations/{id}/correct`，`DELETE` 映射已有 delete command。
- Correction Workspace 未实现，因此更正也只输出 canonical anchor，不注册占位 route。
- 删除使用现有 `RowActions` confirmation Dialog、会话 CSRF 与 TanStack Query invalidation；成功后刷新 server list。
- 403/404/409/422 显示结构化错误与 request ID；失败不自动重放 mutation。
- Dialog 取消、成功或失败后的焦点按既有 pattern 返回触发器；没有动作的行不显示 overflow trigger。
- command endpoint 继续是最终权限权威；UI action projection 不是授权检查。

### R7 — Responsive 与 accessibility

- 复用现有 table column role：query=`primary`、platform/证据/记录人=`metadata`、outcomes=`status`、关联成果=`numeric`、观测时间=`date`、动作=`actions`。
- Table region 可局部横向滚动，但 375/768/1024/1440 的 document root 不得横向溢出。
- 搜索、筛选、排序、分页、主链接、overflow menu、Dialog 与 retry 可由键盘操作，具有可见焦点和明确 accessible name。
- 表头、排序状态、空态、错误 alert、loading rowgroup 与 indicators 保留语义；reduced motion 下仍可用。

### R8 — Contract、兼容性与文档

- Contract-first：先更新 `contracts/openapi.yaml`，再实现 backend schema/router/service，最后重新生成 types。
- 新 operation 是 additive；V1 原 endpoint、runtime、页面与测试行为为零变化。
- 因 `make contract-check` 同时校验两套 generated schema，实施计划把 `frontend/src/shared/api/schema.d.ts` 的机械再生成作为“不得修改旧 frontend/”的唯一例外；不手改该文件，不改其他 `frontend/` 文件。批准本计划即批准该机械例外。
- V2 生成 `frontend-v2/src/shared/api/generated/schema.d.ts` 并直接消费新 operation/type。
- 更新 05/07/08/09 文档；`contracts/database.md` 不变，因为没有持久化 invariant 或 schema 变化。

## Acceptance Criteria

- [x] `/geo/observations?page=1&pageSize=20` 可 direct/refresh/Back/Forward；非法或额外 search canonical replace 后才读取数据。
- [x] q、Product ID、GEO platform、accuracy、from/to、observed sort、page/pageSize 严格按 R4 一一映射，浏览器没有 alias、本地筛选或跨接口 join。
- [x] 新 list operation 返回 compact `GeoObservationListItem`；旧 list operation 与 V1 runtime 保持原样。
- [x] Backend integration 证明 legacy/manual projection、canonical/raw query、Product label、统一 platform、三类 indicator count、关联成果、evidence ancestor count、recorder、tail-only、stable sort、filter/count/page 与 actor-specific actions。
- [x] 列表严格显示八列；Query 主链接 href 是 canonical Detail URL，第二行 Product；不存在“查看详情”。
- [x] 只有 `available_actions` 含 `CORRECT` 或 `DELETE` 时才出现对应 action；无动作行无 trigger；不读取 `primary_task` 或 raw status。
- [x] 更正与 Detail 仅提供 canonical anchor，route tree 中不存在 `$observationId`、`correct` 占位页面。
- [x] 删除 Dialog 使用 CSRF，结构化失败不重放，焦点返回 trigger，成功后重新读取服务端列表。
- [x] loading、empty、filtered empty、error/request ID、retry、pagination 与 cached-data refresh failure 有可观察测试。
- [x] production-artifact fixture Playwright 拒绝未声明 API，并覆盖 URL、server query、action gating、Dialog、keyboard、375/768/1024/1440 与页面根无横向溢出。
- [x] OpenAPI、runtime schema/router、backend tests、V1/V2 generated types、V2 runtime/tests 与 05/07/08/09 文档一致。
- [x] 没有数据库 migration、新依赖、通用 DataTable、客户端 join、V1 业务文件修改或超出本 Task 的 GEO 页面。
- [x] 实施、自测和自审完成后先展示 commit plan；未经确认不 commit、不 push。
- [ ] 完成并合并回 `main` 后删除本地和远程 `codex/frontend-v2-geo-observation-list`；若远端从未创建则记录为“不存在，无需删除”。

## Planning Approval Gate

- 用户已批准计划与关键技术决定：新增 `/api/v1/geo-observations/list-items`、保留 V1 原接口，并允许机械更新 V1 generated schema。
- Task 已进入 `in_progress`，实现和 required validation 均在授权临时分支进行。
- Blocking product questions：0；仍未提交、未 push，提交前必须展示 commit plan 并等待确认。
