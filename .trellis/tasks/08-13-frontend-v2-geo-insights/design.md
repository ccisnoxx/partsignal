# Frontend V2 GEO Insights — 技术设计

## 1. 设计结论

采用一个页面 read model、一个按需命令 options read model、一个既有写命令的最小闭环：

```text
/geo/insights canonical URL
  └─ GET /api/v1/geo-insights                    # 页面唯一 Insights 数据源
       ├─ filter_options + period
       ├─ trends / platform / content / coverage
       ├─ recommendations / data_quality
       └─ actor-aware optimization_action

创建优化任务 Dialog（仅打开时）
  ├─ GET /api/v1/content-tasks/creation-options  # 复用既有窄选项读取
  └─ POST /api/v1/geo-insights/optimization-content-tasks
       ├─ 服务端按 source + 所选目标重新计算异常
       ├─ 同 key 串行化与完整 payload replay 校验
       └─ ContentTask + immutable GEO source 同事务写入
```

不安装 ECharts；三个单指标日趋势使用页面局部 SVG，真实数据表作为键盘/屏幕阅读器替代。不增加通用 Analytics/Chart/DataTable/workflow framework，不注册 Print route。

已批准并实现最小数据库迁移：在 `PublicationWork` 冻结无外键的平台 UUID，与已有平台名称快照共同承载历史身份。没有该列，平台删除后无法精确表达仍被 GEO 引用的历史发布成果。

## 2. Contract-first 变更

### 2.1 actor-aware 优化动作 source

新增窄 schema：

```yaml
GeoInsightOptimizationAction:
  required:
    - rule_code
    - date_from
    - date_to
    - published_article_id
    - query_topic_id
    - geo_platform
  properties:
    rule_code: CONTENT_DECLINE | LONG_UNMENTIONED | QUESTION_COVERAGE_GAP
    date_from: date
    date_to: date
    published_article_id: UUID | null
    query_topic_id: UUID | null
    geo_platform: string | null
```

`GeoInsightContentPerformance` 与 `GeoInsightCoverageItem` 增加 required nullable `optimization_action`。它只包含 POST 已有的异常 source 字段，不复制指标、目标 Product/Platform/Fact，也不引入 href：

- Best、Stable、Insufficient Data 始终为 `null`；
- Declining、Long Unmentioned、Occasional、Uncovered 只有在 actor 为 ADMIN/ENGINEER 且当前异常支持命令时非空；
- action 非空时 `primary_task=CREATE_OPTIMIZATION_TASK`；否则使用该行已有的精确查看/补样本任务；
- POST schema 保持同一路径和字段，只收紧 source identity validator：内容规则不得携带 Topic/GEO Platform，Coverage 规则不得携带 Article。

这样页面只执行 `optimization_action + RHF target fields`，不依据数组名称、status、rate 或 Recommendation rule 推断命令。

GET 增加真实 `401` response；POST 增加真实 `401/403` responses。OpenAPI 更新后重新生成 V1/V2 类型；不手写 DTO。

### 2.2 历史平台 UUID migration（已批准）

在下一 Alembic revision 增加：

```text
publication_works.platform_profile_id_snapshot UUID NULL
```

它没有外键，原因是实时 `PlatformProfile` 允许删除，而历史 PublishedArticle/GEO 引用必须保留原稳定 UUID。迁移规则：

1. 对仍有实时平台的 work 以 `platform_profile_id` 回填 snapshot。
2. 在设定新写规则前预检所有 `PublishedArticle`；若其 snapshot 无法由实时 ID 回填，以 PostgreSQL `55000` 中止，不按名称猜 UUID。
3. 新建 PublicationWork 时同时冻结 ID 与已有 name snapshot；历史 guard 禁止修改 snapshot。
4. Insights 从 `PublicationWork.platform_profile_id_snapshot/platform_profile_name_snapshot` 读取 Content Platform identity，不再依赖可删除的实时 `ContentTask -> PlatformProfile` 内连接。
5. downgrade 只有在没有任何 work 已失去实时平台 ID 时才允许；否则以 `55000` 拒绝，避免丢失已成为唯一 owner 的冻结身份。

列保持 nullable 是为了不伪造无法恢复的非 PublishedArticle 历史 work；PublishedArticle 的非空性由迁移预检、新写 service 和数据库历史 guard 共同保证。本 Task 不清洗、猜测或合并历史平台。

### 2.3 数据库文档

`contracts/database.md` 记录新 revision、冻结 ID/name 的 ownership、upgrade preflight、immutability 与 downgrade guard。OpenAPI 的 `content_platform_id` 继续是 required UUID，不增加 nullable compatibility shape。

## 3. 服务端 read model 与同一快照

`GET /api/v1/geo-insights` 复用 `_geo_observation_read_snapshot`，让以下读取处在同一个 PostgreSQL `REPEATABLE READ` 请求事务：

1. normalized current/previous period；
2. filter options；
3. previous-to-current scoped rows；
4. long-unmentioned 所需历史 rows；
5. 最终所有 section 与 actor-aware action。

`GeoInsightFilters`、`analysis_unit=MANUAL_OBSERVATION_PUBLICATION_RELATION` 和 UTC period 在请求内只计算一次。浏览器不请求 Facts/Products/Platforms/Observations 来补 Dashboard 数据。

读取仍先按整次当前 correction-chain tail Observation 排除不完整关系，再应用 Content Platform/Article 筛选。迁移后的查询保留已删除平台的历史关系；不改变 Discovery、Mention、Accuracy、排行、Coverage 或 Recommendation 阈值。

## 4. URL state 与 API 映射

canonical URL 固定使用 V2 既有 camelCase 约定：

| URL | API |
| --- | --- |
| `from` | `date_from` |
| `to` | `date_to` |
| `productId` | `product_id` |
| `contentPlatformId` | `content_platform_id` |
| `geoPlatform` | `geo_platform` |
| `publishedArticleId` | `published_article_id` |
| `queryTopicId` | `query_topic_id` |

`from/to` 是一个业务日期范围，但映射为两个 API 参数，因此是六类业务筛选、七个 query 参数。canonical 规则：

- 缺少日期时，以 UTC 当日为 `to`、向前 29 日为 `from`，并 `replace` 到显式 URL；这样 direct URL、refresh 与浏览器历史不会在跨日后含义漂移。
- 其他空筛选不写 URL；合法文本 trim 后写入。
- 非法日期、UUID、超长/空白文本和未知 key 被 search parser 移除并 `replace`。
- `from>to` 与格式合法但不在服务端选项中的 ID 不静默重置：分别让后端 422/404 显式失败，页面保留 URL，并提供 retry 与“重置筛选”。
- Filter 变化通过 Router navigation 写历史；reset 回到当日显式 30 日范围；Back/Forward 只由 URL 恢复 query，不维护第二份 filter state。

## 5. 页面组合与数据呈现

页面按现有 V2 primitives 组合，不建立页面框架：

1. 标题、周期与 `generated_at`；不显示 Print/Export。
2. `FilterBar`：两个原生 `Input type="date"` 与五个 Select；options 全来自同一 Insights response。
3. 三张 KPI/趋势卡：Discovery、Mention、Accuracy。
4. GEO Platform Performance 表。
5. Content Performance 的 Best、Declining、Long Unmentioned 三个明确分区。
6. Question Coverage 状态计数与矩阵。
7. Recommendations 卡片列表。
8. Data Quality 摘要与 unavailable messages。

在 1024/1440 使用多列 Card grid；375/768 线性堆叠。宽矩阵只在既有 `TableShell`/局部 region 内滚动，页面根不横向溢出。

### 5.1 空、部分与不可用状态

| 服务端事实 | 页面文案/行为 |
| --- | --- |
| `denominator=0,value=null` | “暂无数据”，显示 `0 个可评估关系`，绝不显示 `0%` |
| previous denominator=0 | “上一周期暂无样本”，变化为“不可比较” |
| previous denominator>0,value=0,change=null | “上一周期 0%，相对变化不可计算” |
| `change=0` | 显示真实 `0%` 变化 |
| eligible=0 | 使用 `NO_COMPLETE_OBSERVATIONS` 服务端 message，section 为明确 empty/unavailable |
| eligible>0 且 excluded>0 | 页面保留结果并显示 partial-data warning 与排除计数 |
| 排行数组空但 section 可用 | “暂无符合当前阈值的内容” |
| `unavailable_sections` | 按 code/message 归属到上一周期、Coverage、Long Unmentioned 或全局 Data Quality，不重新推断原因 |
| 首次失败 | Error state + retry + reset；URL 不改 |
| 后台刷新失败且已有数据 | 保留旧数据，显示刷新失败与 retry |

### 5.2 图表与可访问性

每个趋势只画当前周期的单折线：

- 局部 SVG 使用 viewBox 与 CSS，自身 `aria-hidden="true"`；分母为零的点形成缺口，不补零。
- 卡片可见文本显示当前值、分子/分母、上一周期值/不可比较原因。
- `<details>` 的 summary 可由键盘操作，内部真实表格逐日列出日期、numerator、denominator 与 value，作为屏幕阅读器和无需颜色的等价表示。
- 线、点、标签与数值共同表达，不用颜色作为唯一状态编码。

现有合同没有多轴、缩放、brush、复杂 tooltip 或大数据量需求；ECharts 会增加依赖、bundle 和测试面而没有明确收益，因此不安装。

## 6. Drill-down 决策

前端只对服务端 token/path 做穷尽映射，未知 token 显式失败或不呈现：

| 区块 | projection | canonical target |
| --- | --- | --- |
| Platform Performance | `VIEW_OBSERVATION_DETAILS` | `/geo/observations?geoPlatform&from&to&page=1&pageSize=20` |
| Content Best/无命令行 | `VIEW_CONTENT_PERFORMANCE` | `/publishing/articles/$articleId` |
| Coverage 查看 | `VIEW_OBSERVATION_DETAILS` | Observation List 的 `queryTopicId+geoPlatform+from+to` |
| Coverage 补样本 | `ADD_OBSERVATION` | `/geo/observations/new?queryTopicId&geoPlatform` |
| 可优化异常 | `CREATE_OPTIMIZATION_TASK` + non-null action | 本页 Dialog |

New Observation 只增加 strict `geoPlatform` search param，并在 options/context 已加载后预填 `search_platform`；不存在/非法值明确报错，不改 Product、Topic、文章事实或其它创建流程。

Recommendation 当前 `detail_path` 要么为旧 V1 `/publications/{id}`，要么为 `null`。V2 不把旧路径改写成 Article route，也不根据 identity 数组制造链接；本 Task 的 Recommendation 仅展示。未来服务端若要提供 V2 链接，应先给出可由合同校验的 canonical path，而不是前端猜测。

## 7. 优化 Dialog 与服务端最终资格

Dialog 使用 RHF + Zod，只包含 Product、Platform Profile、Approved Fact Version：

- 打开时复用 `contentTaskCreationOptionsQueryOptions(requestedProductId)`；Content anomaly 用 row Product 作为 requested product 并预选 row Product/Platform，Coverage 不猜目标。
- Product 变化只从同一 options response 切换 Approved Fact 列表；不请求分页 Products/Facts/Platforms。
- source fields 全部来自 `optimization_action`；表单只负责 target fields。
- POST 对 Content anomaly 重新按 Article/period 计算，并验证选中 Product/Platform 与来源文章一致。
- POST 对 Coverage 按 period/Topic/GEO Platform 和选中 `product_id/content_platform_id=platform_profile_id` 重新计算；所选 Product/Platform 可以让候选变 stale，返回 409 是正常最终门禁。
- Approved Fact、活动 Product/Platform 和权限继续由既有 Content Task command 锁内复核。

`GEO_INSIGHT_STALE`、`IDEMPOTENCY_CONFLICT`、其它 409 或资格变化都不自动 replay。页面保留 Dialog values 和 request ID，禁用旧上下文再次提交；用户显式“重新加载最新 Insights”后 refetch Insights 与 creation options，并只保留仍存在的已选 ID，否则给字段错误，不选择第一项。

## 8. Idempotency-Key 生命周期

沿用 New Content Task 的最小 `{signature,key}` ref，不抽公共 hook：

1. 首次提交对完整 POST body `JSON.stringify` 形成 signature 并生成 `crypto.randomUUID()`。
2. 同一 body 的用户显式 retry 使用同一 key；网络错误不自动发第二次请求。
3. 任一 source/target 字段变化产生新 signature 和新 key。
4. stale/409 后不允许原上下文重试；显式 reload 完成后清除旧 key，下一次提交生成新 key。
5. Dialog cancel/close、成功、打开另一异常都清除 key。
6. 成功响应直接使用 `ContentTask.id` 导航，不通过列表发现 ID。

服务端在 GEO command 开头取得与普通 Content Task create 相同的 transaction advisory lock；replay 同时比较 ContentTask 的 Product/Platform/Fact 与 GEO source 的 rule/period/Article/Topic/GEO Platform。相同 payload 返回同一任务，不同 payload 返回 `IDEMPOTENCY_CONFLICT`，并发不会重复插入 source。

## 9. Query keys 与成功导航

成功后按真实消费者精确失效：

```text
geoKeys.insights()                 # 需求明确要求重新读取动作/状态
contentKeys.lists()                # 新 Content Task 出现在列表
productsKeys.detail(productId)     # Product Detail 的内容任务摘要变化
geoKeys.topicLists()               # 仅 Coverage source：Topic 引用摘要变化
```

不失效 creation options（业务候选未变化）、不存在的新 task detail 或无关 Publication queries。完成失效后使用 response `task.id` 进入 `/content/tasks/$taskId`，Detail 自己加载 canonical read model。

## 10. 错误、loading 与响应式

- route loader 只 prefetch，不 await；页面 `useQuery` 因此可以局部表达 loading/error/retry，不把合法 404/422 变成无法恢复的全局 route error。
- stale/409 作为 Dialog 内可恢复状态，保留输入并聚焦 error summary；reload 是唯一恢复动作。
- 403/资格变化明确说明当前账号或所选目标不可创建，不伪装成功、不关闭 Dialog。
- Filter controls、`details` summary、Table region、Dialog trigger/final focus 和 error live region 使用现有可访问 primitives。
- strict fixture 对 375/768/1024/1440 测量 document 根，无横向溢出；矩阵的局部 overflow 是允许边界。

## 11. 十一个规划问题的直接回答

1. **GET 是否是单一权威 read model**：是。它已有页面全部 section 与 filter options；页面零 join、零额外 filter options 请求。只有命令 Dialog 按需复用 Content Task creation-options。
2. **canonical URL 名称**：`from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId`，按第 4 节一一映射七个 API 参数。
3. **同一范围、单位、快照**：同一个 normalized `GeoInsightFilters`、固定 analysis unit 和一次 period 计算；GET route 增加既有 `REPEATABLE READ` dependency，所有查询在同一 snapshot。
4. **无数据差异**：依据 numerator/denominator/value/change 和 server unavailable codes，严格区分当前无样本、单指标空分母、上一周期无样本、上一值真实为零、历史不完整与 section 无命中；不补 `0%`。
5. **drill-down target**：Platform、Content、Coverage 查看已有精确 canonical target；Coverage ADD 只需给 New Observation 补 `geoPlatform`；Recommendation 当前没有 V2-safe `detail_path`，所以无链接。
6. **可创建优化任务的行**：Declining、Long Unmentioned、Occasional、Uncovered 只有 non-null actor-aware `optimization_action` 时可创建；Recommendations 与 Platform Performance 不创建。需要 additive server projection，不能按 section/status 推断。
7. **创建候选**：复用单个 `content-tasks/creation-options`，不浏览器拼装分页接口。
8. **Idempotency-Key**：按完整 payload signature 在同一 Dialog/同一显式 retry 内稳定；字段变化、关闭、成功、显式 stale reload 后重建；服务端先锁 key 并比较 source+target。
9. **ECharts**：不新增。局部 SVG + 原生 details/table 已满足复杂度、响应式和可访问性；不建 Chart framework。
10. **Print**：不注册 route、不显示入口、不写打印 CSS/PDF。
11. **文件与验证**：见 `implement.md` 的精确预计文件、AC 映射、required 与 optional commands。

## 12. 兼容性与残余风险

- `optimization_action` 是 additive response field，但设为 required nullable 需要同时更新后端 schema、生成类型与 V1 编译；旧 V1 页面不读取该字段，不改其 UI。
- 新平台 snapshot migration 不改变现有外键删除语义，只补历史 identity owner。若数据库已经存在实时平台 ID 丢失的 PublishedArticle，upgrade 会显式失败；需要独立数据恢复决策，不能在本 Task 猜测。
- strict fixture 验证 production artifact 页面状态机和请求边界，不替代完整 GEO real-stack E2E；后者仍明确排除。
- 本 Task 已按批准实施 migration；若生产数据无法通过确定性预检，部署必须停止并单独制定有证据的数据恢复方案。
