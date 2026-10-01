# ADR-002：为人工、API 和浏览器采集使用统一回答级运行模型

- 状态：Accepted
- 日期：2026-10-01

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
