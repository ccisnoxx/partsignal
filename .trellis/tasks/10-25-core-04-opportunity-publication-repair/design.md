# 设计

原三个publication-repair POST协议与发布领域命令不变。新增分页GET /api/v1/geo/opportunities/{id}/publication-repair-options，mode、page/page_size和可选selected_issue_id；ADMIN/ENGINEER、RR/no-autoflush、no-store。复用保存来源产品范围，发布领域列表仅增加内部product_ids筛选（默认不变），继续由其投影拥有健康成果/问题动作。候选统一为窄只读投影，available和原因由服务端给出；不把整个发布工作区拼到浏览器。

CREATE_REPAIR选定问题后，同一GET/RR通过原get_published_content_repair_context返回修复上下文，重新检查产品在保存范围；不客户端join跨快照的Issue/Article/Product/Facts。选择目标时保存issue revision，背景变化暂停；显式刷新机会/选项才采用新revision。修复事实选择复用该上下文的fact_candidates及CREATE_REPAIR_TASK动作，命令仍裁决平台/产品/唯一修复任务等最终边界。

前端局部域组件独立拥有三种mode表单，共用当前机会请求签名、错误分类和主体取消边界；不抽象通用命令框架。回执核对机会/revision、article/issue/fact和目标身份与相对导航；成功先保留回执，再取消旧读取并失效机会、发布、内容和CORE-02摘要。明确原问题流程不会因登记/修复而自动解决。

问题/内容任务路由仅规范化source_opportunity_id并提供返回链接，问题hash canonical redirect保留来源参数。无迁移/外部调用/配置变化。回退本轮源码与GET合同即可，已保存历史行动保留。
