# GEO 数据完整性与分析闭环设计

## 核心不变量

1. `GeoObservationPublication` 表示可能影响本次结果的发布，不是引用证据。
2. 每条 `GeoCitation` 都表示模型实际引用；绑定 `PublicationRecord` 时才执行发布一致性校验。
3. 所有关联发布在观测创建时必须属于同一产品且状态至少为 `PUBLISHED`。
4. 绑定发布的 Citation URL 必须与发布最终 URL 经过确定性规范化后相等。
5. 观测不可修改；更正创建新观测并通过 `supersedes_id` 形成单向链。
6. 默认列表、指标和近期错误只统计没有后继更正的当前有效记录。
7. 列表、指标和工作台计数复用同一筛选谓词。

## URL 一致性

使用一个服务端 URL 值对象执行确定性比较：

- scheme 和 IDNA host 小写。
- 移除默认端口。
- 保留规范化 path 和完整 query，不删除未知追踪参数。
- fragment 不参与页面资源身份比较。

不做域名相似、路径前缀、重定向跟随或模糊匹配。不一致时要求用户修正引用或发布记录。

## 创建观测事务

1. 锁定/读取产品、目标问题和所有关联发布。
2. 对“可能影响”发布校验同产品及 `PUBLISHED | VERIFIED`。
3. 对每个绑定发布的 Citation 额外校验 URL 一致性。
4. 更正时锁定被更正记录，校验同产品、同问题且尚无直接后继。
5. 写入 Observation、Citations、影响关系和附件并提交。

数据库增加 `supersedes_id` 唯一约束，消除并发创建两个直接后继的竞态。历史链不删除。

## 指标口径

先建立当前有效观测查询，再应用产品、问题、模型和 `tested_at` 日期过滤：

- `sample_count`：当前有效样本数。
- `mention_rate`：`mentioned=true` / 样本数。
- `recommendation_rate`：`RECOMMENDED` / 样本数。
- `citation_rate`：至少一条 `source_type in {OFFICIAL, EXTERNAL_COMPANY}` Citation 的样本数 / 样本数。
- `accuracy_rate`：`ACCURATE` / 非 `UNJUDGEABLE` 样本数；无可判断样本时为 `null`。

`OTHER` Citation 和“可能影响”发布不进入公司引用率。官网引用不要求存在 `PublicationRecord`。

## OpenAPI 设计

### 列表与历史

扩展 `GET /geo-observations`：

- `product_id`
- `query_topic_id`
- `model_name`
- `date_from` / `date_to`，按 `tested_at`
- `accuracy`
- `include_history=false`

默认只返回当前有效链尾。新增 `GET /geo-observations/{id}/history`，按根到链尾返回完整更正链。

### 发布候选

新增按 `product_id` 查询的 GEO 发布候选投影，只返回 `PUBLISHED | VERIFIED`，包含发布 ID、平台、最终 URL、标题和状态。前端不再拉取前 100 条全局发布后自行过滤。

### 创建与更正

保持 `publication_record_ids` 与 `citations[].publication_record_id` 分离。更正 UI 从行操作进入，产品、问题和 `supersedes_id` 只读；其余字段作为新的完整替代值提交。

## 前端设计

- `/observations` 的筛选完全来自 `useSearchParams`，规范化参数同时进入 query key。
- 工作台近期准确性错误链接到同一 URL 筛选语义。
- 更正入口固定使用 `/observations/:observationId/correct`，提交后保留原筛选。
- 默认表只显示当前有效记录，行内可查看历史；“包含历史”是显式筛选且不影响指标卡。
- 空样本显示无可判断样本，不把 `accuracy_rate=null` 显示为 0%。

## 历史完整性

只读检查只检查当前有效链尾，输出：

- 跨产品的影响或引用发布。
- 状态低于 `PUBLISHED` 的关联发布。
- 绑定发布但 Citation URL 不一致。

任何未处置记录阻断上线。用户通过追加式更正创建合法链尾，原观测和关系保留历史；不修改或删除原记录。

## 依赖与回滚

依赖发布子任务先冻结平台一致性、发布状态和异常语义。`0007` 已存在更正唯一约束，`0014_geo_integrity_indexes` 只补共享筛选和 Citation 查询所需索引；随后部署读取/写入逻辑，最后前端。

新更正记录不可通过回滚删除。若指标或列表口径出现问题，停止 GEO 写入并修复共享查询，不恢复前端本地过滤或持久化汇总。

## 最终确认的查询所有权

- 一个服务端链尾基础查询统一拥有“当前有效观测”定义；列表、指标、Dashboard 和历史 preflight 均复用，不得复制 `NOT EXISTS` 条件。
- 筛选参数在服务端统一规范化；前端 URL 和 query key 使用同一规范化结果。
- `accuracy` 支持组合值，Dashboard 近期错误深链使用 `PARTIAL` 与 `INCORRECT` 的同一筛选语义。
- 更正 UI 从观测行进入，产品、问题和来源记录不可编辑；服务端锁定来源并复核尚无后继。
- URL 值对象只执行 scheme/host/默认端口/path/query/fragment 的确定性规则，不访问网络。
