# 设计

保留报告现有GeoOverviewFilters协议：映射为GeoOpportunityFilters.source_scope且open_only=true，直接复用CORE-02摘要同selector。新增GET /api/v1/geo/opportunities/export.csv接受既有GeoOpportunityFilters，保留筛选/排序、忽略分页；路由须在/{opportunity_id}前注册。所有接口ADMIN/ENGINEER与no-store，错误空集409；原报告机会501从对应operation删除，不改其他三种CSV合同。

机会查询owner提取原列表的排序列，列表和有界迭代共用，keyset按SQL实际排序值及最终id比较；不在导出另维护优先级等级或筛选。新机会CSV模块仅映射既有ListItem到固定低敏列。原CsvStream/GeoCsvResponse继续拥有编码、安全单元格、首条预取、锁/取消释放及RR会话生命周期；prepare层增加实际两种过滤输入与row factory，共用独立开始审计，不建立第二套流或重试框架。

报告预览机会export capability=true，是否有数据由下载新快照裁决；无合格运行指标仍可导出已保存的待处理机会。工作台以受限query serializer建立下载URL，排除详情、分页和自由字段，保持source_scope微秒/原时区。原生链接在新标签下载，沿既有流式导出交互，不把全部CSV缓冲到JS或显示虚假完成。

无schema迁移/外部写入/线上配置。回退本轮源码及新GET合同即可；已落地审计仍保留。
