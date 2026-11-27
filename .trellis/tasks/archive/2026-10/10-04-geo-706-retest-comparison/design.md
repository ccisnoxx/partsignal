# GEO-706 设计

比较与恢复政策归GEO应用服务；读取只依赖保存的Answer、分析和Review，复用601/603公式。基线固定首次trigger的analysis/review身份，复测选择当前有效版本。恢复要求来自冻结v2规则；缺失值不回填现行配置。参考历史窗口和本次干预baseline明确标注，不将下降规则的当前异常值误当恢复参考。

比较read model携带完整环境、模型、模式、样本和排除说明以及内容摘要指纹。命令锁定会改变比较输入的Batch/Run，机会锁最后，锁内重算指纹；CAS与指纹分别保护机会状态和样本证据。人工解决与复测恢复是两个明确选择；continue追加证据保持IN_PROGRESS。新增不可变decision表保存选中的服务端快照，无原始回答或凭据审计。

公共DTO和operation先于服务实现确定并同步根OpenAPI，前端只消费generated。后端/前端文件所有权分离，根合同和文档由主代理维护；独立只读复核公共合同、持久化、并发风险。

恢复样本数量同时满足 recovery.minimum_runs、指标 SamplePolicy 和规则 sample_gate，取三者最大值；UNSTABLE_RESULT 的 unstable_minimum_repeats 独立于 stable_minimum，不能相互覆盖。人工/无比较处理的comparison_snapshot必须保存SQL NULL而非JSON null，以符合数据库“没有比较”的身份守卫。


## 权威上下文入口

- contracts/openapi.yaml：新增706三个operation及GeoOpportunity/GeoRetestComparison组件；文件很大，按组件与operation读取，不以注入截断替代合同。
- contracts/database.md：GEO-701～706完整段落；最新0062处理约束在末尾。
- docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md：§18～20及706恢复裁决；固定指标、样本资格、历史参考与非因果语义。
- .trellis/spec/frontend/state-management.md：当前URL/query key、草稿基线和409显式重读场景。

phase context只注入尺寸内的任务设计与相关规范；上述authority须按相关完整单元显式读取，避免32KiB注入限额截去706所需合同。
