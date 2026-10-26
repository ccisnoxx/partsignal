# 设计与边界

## 唯一读模型

机会所有者 geo_opportunity_queries 提取现有列表 selector，并增加 source_scope / open_only。聚合与列表共用它，只聚合当前已存储机会，不调用 evaluator。pending 集合复用 OPEN_STATUSES。SQL EXISTS 避免来源重复导致计数重复；不加载全部机会或页面集合后在前端计算。

GeoOverview 的 open_opportunities 替换旧 placeholder；GeoReportPreview 增加同一个 GeoOpportunitySummary。包含 as_of、待处理总数、状态/优先级分组及服务端 drilldown，全部在现有 REPEATABLE READ/no-autoflush 中读取。查询失败由现有请求错误路径暴露，不生成成功形态的零。无迁移、调度或生产配置修改。

## 时间与筛选

source_scope 为已有 GeoOverviewFilters 的 JSON 查询参数，由 Pydantic Json 在边界解析。日期按来源 Run.created_at 半开窗口；复用 candidate_query 的全部冻结输入筛选，但显式包含历史 attempts，以免重试/重分析抹掉已有机会的历史来源。REVIEWED_ONLY 检查保存的 GeoOpportunitySource.review_id。来源包括 TRIGGER/SUPPORTING/BASELINE/RETEST。

对象/产品及主维度继续沿用机会工作台的归属筛选，不能因同一来源 Run 包含多个对象而把另一个对象的机会混入。机会创建时间 created_from/to 保留原语义，与来源运行日期独立。open_only 复用共享活跃状态集合；分组 status/priority 进一步收窄，不在浏览器补算。

列表 URL 使用 Router JSON search 对象保留 source_scope 和 open_only，并显示来源范围说明；用户可显式清除该范围。前端来源日期保留原时区与微秒，由服务端裁决有效窗口；API JSON 参数采用标准 Json 校验，validation schema 公开为 application/json string（现有 contract checker 不支持 contentSchema 元数据），实际内部值为经过既有模型校验的 GeoOverviewFilters。

## 前端与恢复

shared 的只读机会摘要组件消费服务端计数与 drilldown，供总览/报告复用，不拥有机会业务状态。机会页复用已有基础筛选 URL schema 校验来源 JSON，非法范围明确失败，不默默放宽为全量列表。报告无合格业务指标时仍显示机会及质量摘要，保留原打印可用性政策。

回退本轮源码/合同/生成类型即可；既有已存储机会、来源、行动和报告审计不改写。所有仓内旧占位消费者同时迁移。
