# 设计

运行详情仍由现有一致读服务拥有；新增 geo_run_quality 投影，复用 geo_overview_queries.load_evidence_inputs 的 current 事实转换，旧尝试明确设置 superseded_attempt。资格由 geo_metrics.metric_eligibility 裁决，通用资格复用 Overview 公共 generic_exclusion_reasons；不创建第二套 evidence 或 review 判断。

协议包含通用资格/原因、当前有效分析与复核状态、证据/费用/版本覆盖，以及按冻结对象分组的现有指标资格。可纳入样本不代表分母非零、达到样本门槛或已生成机会；页面明确说明。

导航为独立只读字段：最新尝试带运行创建日 UTC 的冻结问题与配置洞察筛选；机会根据 GeoOpportunitySource；复测根据实际 baseline_batch_id / request.batch_id。入口均沿用 EngineerUser 读权限，页面不按角色推断。GET 不创建机会/复测/分析或修改状态。

无持久化变化；恢复方式是回退本次局部源码与合同变更，已有历史不受影响。公共响应替换旧占位字段，所有仓内调用者、fixture 和生成消费者同时迁移。
