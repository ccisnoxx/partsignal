# GEO-208 命令与读边界

配置归属为内部单租户共享Plan，User仅追溯。DISABLED/PAUSED允许保存结构完整且存在的选择，不把运行资格作为可修复配置保存门禁；ACTIVE修改及activate/resume复用207 Builder/204当前资格。copy保持完整配置但强制新DISABLED/revision0、服务器creator，不改源。ARCHIVED只读/copy；DELETE仅DISABLED（当前无Batch引用表，不伪造历史计数）。状态转换严格，重复转换失败；no-op配置保留版本/时间/审计。ACTIVE archive在一个事务内pause→archive，合计一次版本和归档审计，无可见中间态。

锁协议：User FOR NO KEY UPDATE→Channel UUID→Model UUID→Product UUID→品牌Subject UUID→非品牌Subject UUID→QueryTopic UUID→Variant UUID→Surface UUID→Profile UUID→Plan。集合取旧/新配置并集；锁后重验Subject父身份、Profile绑定和Plan初读配置/revision，漂移明确REVISION_CONFLICT，不扩大锁集重试。非敏感列查询；资格依赖的所有当前行持锁到提交。查询RR；写命令RC不使用RR旧快照，复用207事实Loader与Builder组成锁内结果。

列表count+页+三关系+三事实共8次应用查询，空页只2次，不按Plan行数重复预览SQL。详情完整配置、preview、typed stage/primary/actions、deletion与run_entry，不伪造last_batch/成功率/下次执行时间。投影读取和命令响应共用同一规则。run_entry固定NOT_IMPLEMENTED；不投影RUN_NOW；/run需要revision和Idempotency-Key，锁后ARCHIVED/stale优先拒绝，随后501，无写/审计/dispatch/幂等存储。

无新持久化迁移或结构。仅映射23514精确Plan完整性/归档、23503精确membership资源FK；业务flush和SET CONSTRAINTS相关Plan完整性IMMEDIATE先于audit flush，未知错误整体回滚且不冒充业务错误。输入Cron/Decimal沿206。审计CONFIGURATION登记geo_monitoring_plan动作与相关对象，只存status/revision，无名称/description/文本/settings/秘密。

根OpenAPI新增12operation、读模型/列表/copy/typed错误，保留206 Out组件作为完整配置基类；前端仅生成类型。203/205当前配置不写历史first_reference。后续303必须冻结配置副本，本任务只改Plan与其关系。
