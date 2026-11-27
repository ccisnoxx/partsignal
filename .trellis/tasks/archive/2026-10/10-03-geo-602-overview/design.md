# GEO-602 设计与合同

## 读模型边界
Router只绑定EngineerUser、闭合query Schema和认证前read_snapshot；应用服务负责筛选、组成样本和响应组装。query模块在同一REPEATABLE READ事务中固定12次SELECT（加现有认证查询共13次），禁止autoflush，不commit、行锁、刷新heartbeat、派发或外部I/O。仅选择Run必要列，批量读取current Analysis及其latest Review、Answer/Citation、文件状态和Batch时间；数据源不增权威聚合表。

## 筛选与可比维度
Run.created_at使用UTC半开窗口，先全局后继反连接剔除旧attempt，再匹配冻结prompt/profile、模式、语言、区域、登录态、intent和mention。subject/product必须命中同一冻结binding；review_policy在current有效review判断后统一筛选所有区块。分析字典可重分析，因此有效current analysis的subject_versions来自其input_snapshot；身份/产品适用性继续由采集binding决定。

按601完整MetricDimensions、目标subject、冻结SOV集合哈希分栏；不对模式、点名、未知版本或不同规则/字典/事实版本静默平均。业务公式只调用601 calculate_metric和metric_eligibility，每运行贡献使用相同公式，可跨页加总复现分子/分母。事件分母与运行计数分别公开，UNJUDGEABLE单列；失败、待复核、证据缺失不伪装为零业务结果。

## 公共合同
GET /api/v1/geo/overview返回as_of、规范filters、质量总览卡片、完整metric_cells、OWN_PRODUCT重点产品、严重错误风险、最近5个筛选内Batch、明确不可用机会占位和7项数据质量。业务卡片包括回答覆盖、自然可见、产品提及、推荐、首位推荐、自有来源覆盖、声明准确性、严重错误运行率；未有实质描述事实的branded_answer不制造结果。

GET /api/v1/geo/overview/runs接受同一filter、metric_code、cell_key、cohort、batch_id、page/page_size；返回稳定Run/current analysis/latest review身份、每运行贡献和排除理由。业务cell未知/消失为404；完整性错误沿用409 GEO_READ_MODEL_INCOMPLETE；非法filter422，未认证401，权限/强制改密403，request ID400由现有中间件提供。每次请求独立一致快照，无跨请求历史冻结承诺；as_of显式，重分析造成cell变化后应刷新Overview。

## 用户裁决与未知值
2026-10-03用户裁决：COMPLETED /（COMPLETED、FAILED、CANCELLED），BUDGET_BLOCKED只进入独立status计数；成功current analysis的已采集Run / 全部已采集Run。质量还含有效运行比例、待复核、证据完整率、费用覆盖率、模型版本覆盖率。费用只验证金额/币种覆盖，不将未知补零或跨币种求平均。没有可观察无引用字段时不把空citation表当作无引用结论。

## 数据、安全和前端
数据库仅追加只读合同，无Alembic revision、表、列、索引或回填。既有0056保持head。响应不含回答正文、声明摘录、审查评论、原始payload、lease或凭据，Cache-Control no-store。生产开关、SSRF/TLS/CSRF/授权/不可变守卫不变；测试只用fake及本地环境。前端只更新OpenAPI生成schema.d.ts，页面和query/URL状态属于GEO-605。

## 验证边界
真实HTTP/PG验证筛选一致、卡片与样本加总、current/review、RR交错、固定查询数、证据及改密门禁、latest attempt及跨页。共享转换器回归覆盖部分repeat重分析的字典分栏。规定完整门禁及精确日志记录implement.md。不执行603/604/605、Browser、生产或607容量性能门禁。
