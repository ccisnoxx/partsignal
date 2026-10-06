# ADR-002：为人工、API 和浏览器采集使用统一回答级运行模型

- 状态：Accepted
- 日期：2026-10-01
- 接受日期：2026-10-01
- 接受依据：用户在本会话明确接受本 ADR 及 GEO-002 评审修订。
- 适用范围：MANUAL、API、BROWSER 新回答级 Batch、Run、AnswerSnapshot、采样与尝试链；旧 GeoObservation 文章关系的模型、API 和统计口径保持独立。

## 背景

当前 `GeoObservation` 主要表示人工文章搜索及逐篇发布成果关系。新的监测需要批次、重复采样、运行状态、失败、重试、原始回答和多对象分析。

## 决策

新增 `GeoObservationBatch`、`GeoObservationRun` 和 `GeoAnswerSnapshot`。MANUAL、API、BROWSER 都创建同一 Run 类型，由 `CollectionProfile` 和 input snapshot 区分。

保留现有文章关系 GeoObservation，不原地改造或迁移。

## 原因

- 三种采集方式最终都产生“问题 + 环境 + 回答 + 引用”；
- 统一模型便于状态、指标、报告和复测；
- 原始证据和分析可以共享；
- 避免为每种采集方式建设不同指标管道。

## 后果

- MANUAL 也需要 Run 和正式提交状态；
- API/BROWSER 失败语义与人工待录入共用运行中心；
- 文章关系和回答级指标必须明确分开；
- 导航需要兼容两种观测类型。

## 不采用

- 把自动回答塞入旧 `GeoObservation.answer_summary`；
- 为 API、Browser、Manual 分别建三套业务表。

## GEO-002 评审修订（已接受）

- 接受结论：用户接受统一回答级运行模型及以下评审修订；具体计数、重试和状态合同须在后续对应合同任务中按这些约束对齐。
- 区分逻辑采样单元与执行尝试：冻结的问题变体、profile 和 repeat_index 构成采样单元；attempt_no 表示其执行尝试。重试不应扩大业务指标样本，requested_run_count、尝试计数、费用及成功率的统计单位必须分别定义。
- 建议同一批次保留失败采集的追加式尝试链，每个采样单元至多选取一个符合预定规则的结果；不得按答案好坏选择。需明确终态批次后的重试归属、批次是否允许重新投影，以及与“终态不可变”的关系。备选是独立重试批次并显式关联原采样单元。
- 已有 AnswerSnapshot 时，分析失败只创建新 AnalysisRevision，不重新采集；改变问题或环境则创建新批次。
- 旧 GeoObservation 的文章关系分母、API 和历史保持独立。不得把旧文章关系与新回答级样本合并统计。
- 完成、部分完成、失败和预算阻断需具有互斥、完整的投影规则；同一计划调度窗口的去重不能因配置 revision 改变而失效。
- 详细依据、冲突及备选方案见 [GEO-002 架构评审记录](./GEO-002-architecture-review.md)。
