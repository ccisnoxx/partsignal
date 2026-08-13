# Frontend V2 GEO Topics — 技术设计

## 1. 设计结论

采用“保留完整选项列表 + 新增窄 V2 列表”的最小双读取面：

```text
GET /api/v1/query-topics
  └─ 保持 QueryTopicList 全量语义
  └─ 继续供 V1 与 New/Correction Observation 选项使用

GET /api/v1/query-topics/list-items
  └─ 仅供 /geo/topics
  └─ 服务端 search/sort/page
  └─ QueryTopic + 三类引用摘要 + actor-aware actions
```

写入继续复用现有 POST/PATCH/DELETE，不增加第二套命令，不改数据库。引用引导复用已有 Content Tasks 与 GEO Observations 列表，只增加精确筛选；不增加 Query Topic Detail、引用详情 endpoint 或 Optimization 页面。

## 2. 审计证据与缺口

### 2.1 列表合同

- 当前 `GET /api/v1/query-topics` 只接受认证用户，无 query params，返回 `{items}`；后端按 `created_at` 读取全表。
- V1 `GeoTopicsPage`、V1 Observation 页面以及 V2 New Observation 都依赖完整列表；把现有 endpoint 改成默认分页会破坏真实消费者。
- 现有 V2 Table 已形成稳定模式：TanStack Router canonical search → generated API params → TanStack Query → manual TanStack Table → TableShell/FilterBar/RowActions/Pagination。

结论：完整列表不足以满足 V2 Table；新增 `/list-items` 比给旧 endpoint 增加有条件双模式更清楚，且与 GEO Observation 的 ADR-030 窄列表模式一致。

### 2.2 引用与动作

- `_query_topic_reference_counts` 已在 `content_planning.py` 用一个 `UNION ALL + GROUP BY` 批量统计：
  - `ContentTask.query_topic_id` → `CONTENT_TASK`；
  - `ContentTaskGeoSource.query_topic_id` → `GEO_OPTIMIZATION_SOURCE`；
  - `GeoObservation.query_topic_id` → `GEO_OBSERVATION`。
- 当前仅 `can_delete=True` 时调用该批量查询，因此非管理员的 `deletion=null` 同时意味着完全没有引用计数。
- 当前账号类型只有 ADMIN/ENGINEER，PATCH 对两者开放，因此现有 `UPDATE` 投影正确。
- DELETE 已按 `expected_revision` 锁行、复核相同三类引用、返回 `QUERY_TOPIC_IN_USE` 并写 `query_topic.deleted` 审计；CREATE/UPDATE 还没有对应审计。

结论：批量统计 owner 已存在，应由它为所有角色形成独立引用摘要；`deletion` 继续只属于 ADMIN，不能被滥用为通用业务引用列。现有 UPDATE 投影保持不变。

### 2.3 variants 与 handoff

- `QueryTopicCreate` 目前只保证数组至少一项及原字符串精确唯一；service 只 trim canonical question，直接存储 variants。
- PostgreSQL ARRAY 保留请求顺序，因此稳定顺序已有载体，但 trim、空值、trim 后唯一性没有权威规则。
- 当前 `/geo/observations/new` route 没有 `validateSearch/useSearch`，页面默认 `query_topic_id=''`；代码中不存在 `queryTopicId` handoff。

结论：归一化必须在 Pydantic 请求边界一次完成并由 OpenAPI表达，数据库无需变化；New 页面只补一个严格 inbound handoff，不改其余创建流程。

## 3. OpenAPI 设计

### 3.1 新 V2 list-items

新增：

```yaml
GET /api/v1/query-topics/list-items
operationId: listQueryTopicItems
query:
  q: string | null          # maxLength 200
  sort: QueryTopicListSort  # default QUESTION_ASC
  page: integer             # >= 1, default 1
  page_size: 10 | 20 | 50   # default 20
response 200: QueryTopicListPage
```

新增 schema：

```yaml
QueryTopicListSort:
  enum: [QUESTION_ASC, QUESTION_DESC, INTENT_ASC, INTENT_DESC]

QueryTopicReferenceSummary:
  required: [content_task_count, geo_optimization_count, observation_count]
  # 三个字段均为 integer >= 0

QueryTopicListItem:
  allOf:
    - $ref: '#/components/schemas/QueryTopic'
    - required: [references]
      properties:
        references: {$ref: '#/components/schemas/QueryTopicReferenceSummary'}

QueryTopicListPage:
  required: [items, page, page_size, total]
```

`q` 对 canonical question 与数组 variants 做字面量、大小写不敏感匹配；不把 intent enum 文案塞进自由文本搜索。四种排序都以 `QueryTopic.id ASC` 作稳定尾序，默认 `QUESTION_ASC`。集合级创建按稳定动作规范不进入资源 `available_actions`；当前两种账号都能创建。

### 3.2 保持既有 endpoint

`GET /api/v1/query-topics` 仍无分页参数并返回完整 `QueryTopicList`；保留既有 `created_at` 排序。只修正其 `available_actions` 为 actor-aware，不改变响应 shape、完整性或选项语义。

POST/PATCH/DELETE 路径与 payload 保持不变：

- POST `QueryTopicCreate` → `QueryTopic`；
- PATCH `QueryTopicUpdate.expected_revision` → `QueryTopic`；
- DELETE query `expected_revision` → 204。

### 3.3 输入归一化

`canonical_question` 和每个 variant 通过同一个服务端文本归一化函数：

1. `strip()`；
2. 结果为空则 422；
3. variants 按归一化后的字符串判重；
4. 保留请求中的首次出现顺序，不排序、不做模糊或大小写折叠去重。

OpenAPI 为 variant item 增加 `minLength: 1`，但空白检查仍由服务端 validator 最终执行。前端 Zod 镜像同一规则只为即时反馈，不成为第二权威。

## 4. 后端读取与投影

### 4.1 查询流程

`list_query_topic_items` 在 `content_planning.py` 中完成：

1. 构造 QueryTopic 基础 query，应用 `q`；
2. 用相同条件形成 `COUNT(*)`；
3. 应用稳定排序、offset、limit；
4. 对当前页 Topic IDs 调用一次现有 `_query_topic_reference_counts`；
5. 用同一 counts map 同时形成所有角色可见的 `references` 与 ADMIN-only `deletion`；
6. 按 actor 形成 `CREATE/UPDATE/DELETE` 和 `USE_FOR_OBSERVATION`。

查询次数不随行数增加。完整选项 endpoint 仍只在 ADMIN 需要删除投影时计算引用，避免让 New Observation 每次加载承担无用引用查询。

### 4.2 动作所有权

| 能力 | 服务端条件 | 前端行为 |
|---|---|---|
| `CREATE` | actor 为 ADMIN/ENGINEER | 显示页级“新建 Query Topic” |
| `USE_FOR_OBSERVATION` | 当前 Query Topic 服务端主任务 | 显示唯一行级 Primary |
| `UPDATE` | actor 为 ADMIN/ENGINEER | overflow 显示编辑 |
| `DELETE` | actor 为 ADMIN 且三类引用均为 0 | overflow 显示删除 |
| 查看引用/条件 | 服务端 `references`/`deletion` 已返回 | overflow 打开只读 Dialog |

DELETE 命令仍重新授权、锁行、检查 revision、重新批量统计一条 Topic 的引用，并让数据库约束作为最终门禁；read model token 不是命令授权替代品。

### 4.3 审计

在现有事务内追加：

- `query_topic.created`；
- `query_topic.updated`；
- 保留 `query_topic.deleted`。

审计只记录安全、稳定的事实（至少 revision），不复制 variants 或维护第二份可编辑内容。对应 action 加入 retained whitelist；成功业务写与审计同一 commit。

## 5. 引用 resolve links

不新增“引用详情” read model。三个 blocker 已有 canonical 业务页面，给现有列表增加两个窄筛选合同即可。

### 5.1 Content Task / GEO Optimization

扩展 `GET /api/v1/content-tasks`：

```text
query_topic_id: UUID | null
query_topic_reference: CONTENT_TASK | GEO_OPTIMIZATION_SOURCE | null
```

两者必须同时提供或同时省略：

- `CONTENT_TASK` 精确筛选 `ContentTask.query_topic_id`；
- `GEO_OPTIMIZATION_SOURCE` join `ContentTaskGeoSource` 并精确筛选其 `query_topic_id`。

resolve URL 强制 `archiveStatus=ALL`，因为删除 blocker 统计包含已归档任务。现有分页与行 canonical Detail 链接继续使用，不增加 Optimization 页面。

### 5.2 Observation

扩展 V2 `GET /api/v1/geo-observations/list-items` 的 `GeoObservationListFilters`：

```text
query_topic_id: UUID | null
```

resolve URL 为 `/geo/observations?queryTopicId={id}&page=1&pageSize=20`。现有列表只显示当前更正链尾；Query Topic 一旦非空便由更正规则冻结，因此当前尾仍能解析相关 canonical Detail。业务引用列的 Observation 数量保持直接数据库行计数，Dialog 明确说明它可能包含同一不可变更正链的多个历史节点。

两个目标页面把 deep-link 筛选纳入既有 URL schema/API params/filtered-empty/reset，并显示不可编辑的“Query Topic 引用筛选”提示；不增加下拉选项或重复拉取 Topic 名称。

## 6. Frontend V2 列表与路由

### 6.1 route 与 navigation

新增 parent route `/geo/topics` 与 index route：

- parent 声明 `navId='geo-topics'` 与 Breadcrumb；
- index `validateSearch` 严格归一化 `q/sort/page/pageSize`；
- loader 预取 `queryTopicListQueryOptions(search)`；
- 非 canonical search 使用 `replace`，不维护 alias。

GEO 导航在“观测记录”旁新增“问题主题”。不创建 `$queryTopicId` 子路由。

### 6.2 页面组合

页面复用：

- `TableShell`：局部横向滚动、loading/error/empty；
- `FilterBar`：一个搜索框和重置；
- TanStack Table manual filtering/sorting/pagination；
- `RowActions`：Primary link + overflow commands；
- `TablePagination`；
- 现有 Dialog/FormField/Input/Select/Button；variants 用 RHF `useFieldArray` 组合现有 Input。

不抽出通用 CRUD hook、Topic form framework 或新 DataTable。Topic 页面本身持有三个 mutation 及 Dialog 状态，纯 URL/格式/action mapping 放在一个 `query-topic-list.model.ts` 中。

### 6.3 固定列

| 列 | 呈现 |
|---|---|
| 标准问题 | canonical question，正常换行，不用隐藏详情链接 |
| 意图 | generated enum → 既有中文 registry/Badge |
| 变体 | 前两项；其余显示 `+N`，完整内容可在编辑或引用 Dialog 中读取 |
| 业务引用 | 三类带标签计数；非零项是 canonical resolve link |
| 操作 | 最多一个“开始观测”；其余在 overflow |

## 7. Dialog、mutation 与冲突

### 7.1 创建/编辑

一个短 Form Dialog 以 `mode: create | edit` 区分命令，不建立 Workspace：

- create 初始 variants 一项空输入；
- edit 从当前行复制字段与 revision；
- submit 时 Zod 完成与服务端相同的 trim/非空/精确去重；
- edit payload 注入打开时 revision；
- 普通 422 映射字段，跨字段/网络错误进入聚焦摘要；
- 成功后 reset/关闭/焦点回触发元素并失效查询。

### 7.2 PATCH 409

收到 `REVISION_CONFLICT`：

1. 保留 RHF values、Dialog 和失败 request ID；
2. 禁止再次提交旧 revision；
3. 不自动 invalidate/refetch/重放；
4. 用户点击“重新加载服务端版本”后，显式强制读取现有完整 `queryTopicsQueryOptions()`；
5. 按 ID 找到实体后 reset 字段与 revision，并明确提示本地草稿已被服务端版本替换；实体不存在则保留草稿、报告已删除并禁用提交。

复用完整列表避免新增只为 reload 服务的 Query Topic Detail endpoint。

### 7.3 DELETE 与引用 Dialog

- 有 `DELETE` token：Dialog 显示空 blocker projection、revision 与不可逆说明，确认后只发一次 DELETE。
- 无 `DELETE`：不提供确认按钮；只展示三类服务端 counts 和 resolve links。
- DELETE 返回 `REVISION_CONFLICT` 或 `QUERY_TOPIC_IN_USE` 时保持 Dialog，显示结构化错误；用户只能显式 reload list-items，不能自动再次删除。
- 删除当前页最后一项后，若 `page>1` 则 route replace 到前一页；服务端 total 仍是最终依据。

RowActions 把实际 overflow trigger 传给 Dialog `finalFocus`；页级 create 按钮同样保留自身 trigger ref。

## 8. New Observation canonical handoff

`/geo/observations/new` route 增加唯一 search param：

```text
queryTopicId: UUID | undefined
```

页面在完整 Query Topic options 成功加载后处理：

- 无 param：保持现有空白表单；
- ID 存在：只初始化 `query_topic_id`，其余字段保持 New 页面默认值；
- ID 不存在：显示明确 handoff 错误，Topic 保持空，不选第一项；
- direct URL、refresh 与从 Topics 点击使用相同代码路径。

“开始观测”不需要服务端携带 href：`primary_task` 决定资格，行 `id` 是 canonical identity，前端的穷尽 action mapping 固定生成 `/geo/observations/new?queryTopicId={id}`。这不是按业务字段推导资格。

## 9. 查询键失效

CREATE/UPDATE/DELETE 成功后，统一在 Topic mutation success helper 中失效这些真实消费者：

```text
geoKeys.topics()              # 同一前缀覆盖新 list-items 与完整选项：New/Correction
geoKeys.lists()               # Observation list 显示 canonical question
geoKeys.details()             # Observation detail/history 显示 Topic
geoKeys.correctionContexts()  # history/options 显示 Topic
contentKeys.details()         # Content Task Detail 显示 Topic
contentKeys.editorContexts()  # Editor source 显示 Topic
```

不失效 Publication keys：当前 V2 Publication 页面没有渲染 Query Topic。也不使用无边界的全局 invalidation。Content Task list 不显示 Topic，且可删除 Topic 不可能仍有引用，因此不因 mutation 额外失效；它自己的引用筛选仍由 URL/query key 驱动。

## 10. 状态、响应式与可访问性

- 首次 loading 使用 TableShell skeleton；后台 refetch 保留行并显示状态。
- `total=0 && 无筛选` 是 empty；`total=0 && 有 q` 是 filtered-empty；请求错误保留 URL 并提供 retry。
- 表格保持五列，在窄屏由 TableShell 自身局部滚动；页面 header、FilterBar、Pagination 与 Dialog 在 375 px 内换行，页面根 `scrollWidth<=clientWidth`。
- 搜索有显式 label；sortable header 提供当前方向；RowActions、variants add/remove、Dialog submit/cancel/reload 全部可键盘操作。
- 提交错误聚焦摘要或首个字段；关闭、成功和取消都返回准确 trigger；异步错误使用可感知 live region。

## 11. 十一个规划焦点结论

1. **完整 QueryTopicList 是否足够**：不够；无服务端 search/sort/page 和分页元数据，不能满足 V2 Table。
2. **ADMIN-only deletion 是否足够画引用列**：不够；新增独立 `references` summary 向所有角色投影，`deletion` 继续只给 ADMIN。
3. **扩展旧 endpoint 还是新窄 endpoint**：新增 additive `/query-topics/list-items`；旧 endpoint 保持 V1/New/Correction 的完整列表语义。
4. **引用统计 owner**：继续由 `backend/app/services/content_planning.py` 的批量统计 owner 一次形成，read model 和 delete recheck 共用；浏览器零逐行请求。
5. **primary_task handoff**：无需把 URL 塞入 DTO；服务端 token 决定资格，canonical row ID 由穷尽前端映射生成固定 handoff。
6. **创建/编辑形态**：三个短字段使用同一个短 Dialog；不创建 Workspace。
7. **variants 规则 owner**：服务端 Pydantic 边界统一 trim、非空、trim 后精确去重并保留输入顺序；前端仅镜像即时反馈。
8. **revision conflict**：PATCH 保留草稿，显式强制读取完整列表并按 ID reset canonical revision；DELETE 保留 Dialog，显式 reload list；均不重放。
9. **resolve links**：直接 Content Task 与 GEO Optimization Source 都进入 `/content/tasks` 的类型化 Topic 筛选，Observation 进入 `/geo/observations` Topic 筛选；不链接 Insights/Optimization。
10. **mutation invalidation**：Topic list/options、GEO list/detail/correction context、Content detail/editor context；不做全局或无真实消费者的失效。
11. **文件、验收、验证**：精确范围、AC 映射及 required/optional 命令见 `implement.md`。

## 12. 兼容性与残余风险

- 新 endpoint/schema 和列表筛选均为 additive；现有 QueryTopic CRUD、完整列表响应和数据库模型不变。
- 修正只读角色错误 `UPDATE` token 会收紧前端可见动作，但与既有 PATCH 权限一致，不是兼容分支。
- Observation blocker count 是直接不可变记录数，resolve list 是当前链数；Dialog 必须解释两者粒度，不能让用户误认为数据丢失。
- 当前数据库是否存在历史空白/trim 后重复 variants 未被本次静态代码审计证明；不做猜测性数据清洗或迁移。若实现测试或真实数据检查发现冲突，停止并单独确认迁移策略。
