# Frontend V2 GEO Insights 审计记录

## 1. 结论摘要

- `GET /api/v1/geo-insights` 已经返回页面需要的周期、筛选选项、三组趋势、平台表现、内容排行、问题覆盖、Recommendations 与 Data Quality；页面读取不需要浏览器 join，也不需要第二个筛选 options 请求。
- 创建优化任务时可按需复用 `GET /api/v1/content-tasks/creation-options?requested_product_id=...`；该接口一次返回活动 Product、其非空 Approved Fact Version、活动 Platform Profile 和请求 Product 的资格，不需要拼装分页接口。
- GET 当前没有 `REPEATABLE READ` route dependency。筛选选项、当前/上一周期、历史排行与输出时间由多次 SQL 形成，在 PostgreSQL 默认 `READ COMMITTED` 下不保证同一快照。
- 当前 `primary_task` 只能表达页面主任务，不能同时表达 actor 权限和可直接合并进 POST 的异常 source。Declining、Long Unmentioned 与 Coverage 的前端若按所在 section/status 推断 `rule_code`，会违反“动作只消费服务端 projection”。
- Question Coverage 的 POST 复算漏传 Dialog 已选 `product_id/platform_profile_id` 到 `GeoInsightFilters`，可能在不同于目标任务的范围内复算异常。
- GEO 优化命令在获取 Content Task 的 advisory lock 之前先检查幂等记录，并且 replay 比较漏掉 Product、Platform Profile、Fact Version；同 key 并发或改选表单值时不能完整维持既有幂等合同。
- Insights 查询通过实时 `ContentTask.platform_profile_id -> PlatformProfile` 内连接获取内容平台。平台删除会把 ContentTask/PublicationWork 的实时 FK 置空，但保留已发布成果和 GEO 引用；这些历史关系会从 Insights 和筛选选项中静默消失。现有冻结字段只有平台名称，没有平台 UUID，无法从当前数据库模型精确恢复。要满足已批准的历史追溯合同，需要单独批准数据库迁移。
- 当前图表只有三个按自然日的单指标折线，现有 V1 已用局部 SVG 实现；V2 可以使用局部 SVG、原生 `<details>/<table>` 替代数据和原生日期输入，不需要 ECharts 或通用 Chart framework。

## 2. 合同与服务端证据

### 2.1 单一 read model 与七个筛选参数

- `contracts/openapi.yaml:3091` 定义 GET `/api/v1/geo-insights`，参数为 `date_from/date_to/product_id/content_platform_id/geo_platform/published_article_id/query_topic_id`。
- `contracts/openapi.yaml:7669` 的 `GeoInsights` 一次返回 `period/filter_options/trends/platform_performance/content_rankings/question_coverage/recommendations/data_quality`。
- `backend/app/routers/observation.py:144` 统一校验并 trim 七个 API filter；`backend/app/services/geo_observation.py:get_geo_insights` 把同一个 `GeoInsightFilters` 传入当前、上一与历史范围读取。
- `_geo_insight_period` 默认使用 UTC 当日结束的 30 个自然日，并计算紧邻的等长上一周期。页面 canonical URL 应显式冻结服务端同口径的 `from/to`，避免无日期 URL 跨 UTC 日期刷新后改变含义。

### 2.2 分析单位、分母与不完整数据

- OpenAPI 固定 `analysis_unit=MANUAL_OBSERVATION_PUBLICATION_RELATION`。
- `_geo_insight_rows` 只选更正链当前 tail 的 `MANUAL_ARTICLE_SEARCH`；`_complete_geo_insight_scope` 先按整次 Observation 检查全部关系，再应用 Content Platform/Article 筛选，避免筛选隐藏同次观测中的缺失事实。
- Discovery/Mention 以完整关系为分母；Accuracy 只以可判断 accuracy 为分母。`_rate_value` 在分母为零时返回 `value=null`，不是 `0`。
- `_relative_change` 在当前/上一值为空或上一值为零时返回 `null`。UI 必须继续依据 numerator/denominator 区分“上一周期无样本”和“上一周期真实为 0%，相对变化不可计算”。
- `data_quality` 只统计当前周期被排除的不完整 Observation/关系；`unavailable_sections` 已区分当前无完整观测、上一周期无完整观测、无 GEO 平台、周期不足 30 日。

### 2.3 同一快照缺口

- `_geo_insight_filter_options`、当前/上一周期 rows、全历史 rows 是多次 SQL。
- `backend/app/routers/observation.py:84` 已有 `_geo_observation_read_snapshot`，Detail 与 Correction Context 已复用；`backend/app/routers/observation.py:351` 的 Insights GET 当前没有该 dependency。
- 最小修复是在 GET route 复用既有 dependency，不增加新事务 helper。

### 2.4 动作 projection 与命令复算缺口

- `GeoInsightContentPerformance.primary_task` 只有 `VIEW_CONTENT_PERFORMANCE | CREATE_OPTIMIZATION_TASK`；`GeoInsightCoverageItem.primary_task` 只有查看、创建、追加观测。它们没有 actor-aware 的 source payload。
- Declining、Long Unmentioned 和 Coverage 分别需要 POST `rule_code=CONTENT_DECLINE/LONG_UNMENTIONED/QUESTION_COVERAGE_GAP`；当前客户端只能根据所在数组或 coverage status 推断。
- GET router 接收 `CurrentUser` 但 service 不接收 actor；ANALYST 也会收到 `CREATE_OPTIMIZATION_TASK`，POST 才在 router 以 ADMIN/ENGINEER 拒绝。
- 推荐的最小 additive contract 是 `GeoInsightOptimizationAction | null`：由服务端返回 `rule_code/date_from/date_to/published_article_id/query_topic_id/geo_platform`；`primary_task` 与它保持一致。页面只把 Dialog 选择的 `product_id/platform_profile_id/fact_version_id` 合并进 POST。
- `create_geo_optimization_content_task` 当前复算 filter 漏掉 `product_id` 与 `content_platform_id=platform_profile_id`。Coverage 命令应以用户选择的目标 Product/Platform 作为最终服务端复算范围；卡片只是打开命令的候选，不是最终资格。

### 2.5 幂等与不可变来源

- 普通 `create_content_task` 已用 `pg_advisory_xact_lock(hashtextextended(...))` 串行化同 key，并比较 Product/Fact/Platform。
- GEO 命令在调用它之前自行查询 existing task，未先获取相同 advisory lock；并发请求可能都越过 source 检查。replay 比较只覆盖 GEO source，不覆盖 existing task 的 Product/Fact/Platform。
- 最小修复是在 GEO 命令入口先取得相同 key 的事务 advisory lock，并同时比较 task target 与 `ContentTaskGeoSource` source；随后继续复用 `create_content_task(commit=False)` 和同事务 source insert，不建立第二套幂等框架。
- `content_task_geo_sources` 已保存 rule、周期、文章/Topic/GEO 平台与 `basis_snapshot`，来源不可变；不需要新来源表。

### 2.6 历史平台身份与迁移必要性

- `contracts/database.md:189` 要求曾真实发布且仍被历史 GEO 观测引用的发布记录继续可筛选追溯。
- `PublicationWork` 只有 `platform_profile_name_snapshot`；其 `platform_profile_id` 在平台删除时 `SET NULL`。`ContentTask.platform_profile_id` 同样 `SET NULL`。
- Insights 目前通过实时平台内连接形成 option 和 row，平台删除后整行静默丢失；用名称反推 UUID、伪造 UUID 或把空值当另一个平台都会制造第二身份系统。
- 推荐迁移在 `PublicationWork` 增加无外键、不可变的 `platform_profile_id_snapshot`，以当前实时 ID 回填，并在新建 work 时冻结。升级必须预检所有 PublishedArticle：若已有成果的实时平台 ID 已丢失，则以 PostgreSQL `55000` 停止，因为现有数据无法可靠推断。
- Insights 随后只从 PublicationWork 的 ID/name snapshots 读取内容平台身份；实时平台是否仍可用于新 Content Task 仍由 creation-options 与 POST 锁内校验决定。

## 3. Frontend V2 证据

### 3.1 URL、route 与导航

- `frontend-v2/src/domains/geo/geo-observation-list.model.ts` 已建立 camelCase URL → snake_case API 显式映射、无效 primitive 归一化、canonical replace 与 reset 模式。
- `/publishing/articles/$articleId`、`/geo/observations`、`/geo/observations/new` 已实现；GEO navigation 当前只有 Topics 与 Observations。
- New Observation 当前只接受 `queryTopicId` handoff；为 Coverage `ADD_OBSERVATION` 精确交接，还需新增 `geoPlatform` 并只预填 `search_platform`。这是本 Task 唯一必要的 Observation 页面改动。

推荐 canonical URL：

```text
from                  -> date_from
to                    -> date_to
productId             -> product_id
contentPlatformId     -> content_platform_id
geoPlatform           -> geo_platform
publishedArticleId    -> published_article_id
queryTopicId           -> query_topic_id
```

`from/to` 始终出现在 canonical URL；其余空筛选省略。非法日期/UUID/空白字符串被移除并 replace；合法但不存在的 ID 和 `from>to` 由服务端 404/422 显式失败，页面保留 URL、提供 retry/reset，不猜默认对象。

### 3.2 精确 drill-down

| 来源 | 服务端 token/path | 可执行 V2 目标 | 结论 |
| --- | --- | --- | --- |
| Platform Performance | `VIEW_OBSERVATION_DETAILS` | `/geo/observations?geoPlatform&from&to&page=1&pageSize=20` | 已存在且精确 |
| Content Performance | `VIEW_CONTENT_PERFORMANCE` + Article ID | `/publishing/articles/$articleId` | 已存在且精确 |
| Coverage 查看 | `VIEW_OBSERVATION_DETAILS` + Topic/GEO Platform | Observation List 的 `queryTopicId+geoPlatform+from+to` | 已存在且精确 |
| Coverage 补样本 | `ADD_OBSERVATION` + Topic/GEO Platform | New Observation 增加 `queryTopicId+geoPlatform` handoff | 需最小补参 |
| Optimization | `CREATE_OPTIMIZATION_TASK` + 新 server action | 本页短 Dialog | 需最小 additive projection |
| Recommendation | `detail_path` | 当前 content path 是旧 V1 `/publications/{id}`，其余为 `null` | V2 不渲染链接，不改写、不猜测 |

### 3.3 创建选项、表单与 cache

- `contentTaskCreationOptionsQueryOptions(requestedProductId)` 已是窄、单请求、`REPEATABLE READ` read model；可直接复用其 query key 和 generated types。
- `new-content-task-page.tsx` 已有 `{signature,key}` ref：相同 payload 的显式 retry 保留 key，payload 变化生成新 key，成功/冲突清理。Insights Dialog 应复用同一生命周期，不抽通用 hook。
- 成功后真实受影响缓存为 `geoKeys.insights()`、`contentKeys.lists()`、目标 `productsKeys.detail(productId)`；Coverage source 还会改变 Query Topic 引用摘要，因此条件性失效 `geoKeys.topicLists()`。不存在的新 task detail 不需要失效，creation options 未变化。

## 4. 图表与状态呈现结论

- 不安装 ECharts。三个单指标日趋势不需要缩放、brush、多轴或复杂 tooltip；局部 SVG 足够。
- SVG 只作为视觉层并 `aria-hidden`；每张 KPI/趋势卡显示当前数值、分子/分母和上一周期文案；`<details>` 内提供真实每日数据表作为键盘与屏幕阅读器替代。
- 分母 0 显示“暂无数据”；上一周期分母 0 显示“上一周期暂无样本”；上一周期值为真实 0 但 change 为 null 时显示“上一周期 0%，相对变化不可计算”；真实 `change=0` 才显示 `0%` 变化。
- 有 eligible 且有 excluded 是 partial data；无 eligible 使用 server unavailable message；排行数组为空但 section 可用时显示“暂无符合阈值的内容”，不能伪装成加载失败。
- Platform、Content、Coverage 使用既有 Card/TableShell/Badge/FilterBar primitives；不新增 Analytics、Chart、DataTable 或 workflow framework。

## 5. 明确不做

- 不注册 `/geo/insights/print`，不显示导出入口。
- 不修改旧 `frontend/` UI；只在 OpenAPI 变化后重新生成其 schema 并验证兼容。
- 不做完整 GEO real-stack E2E，不做 Workbench 或 GEO vertical slice 抽象回顾。
- 不在浏览器重新计算 rate、阈值、排行、Recommendation 或动作资格。
