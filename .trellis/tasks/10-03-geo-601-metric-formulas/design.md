# GEO-601 纯计算设计

2026-10-03 用户明确裁决两个分母均采用指标方法口径，解除首次 preflight 阻断。版本 geo-answer-v1 的唯一指标字典在指标方法 §18；PRD 的两个冲突分母及引用/意图当前合同已对齐，ADR-004 补裁决记录。运行/分析成功率争议仍留后续数据质量任务。

## 职责与数据流

服务端一致读快照（冻结 Run 输入、Answer/Citation、current Analysis/current Review）→ geo_metric_inputs.py 显式转换 → geo_metric_types.py 不可变内部模型 → geo_metrics.py 资格/公式 → MetricResult。无 ORM、网络、事务或全局可变业务状态。GEO-507 reviewed_results 拥有人工结果投影；本库复用其语义而不维护第二套 review 状态机。

三模块是实际边界：快照到领域转换、内部计算合同、资格与公式。都少于500行，未引入通用插件或指标引擎，未引入依赖。调用方必须提供适用 binding、实质描述、无引用可观察证据、完整性及 latest attempt；库没有 HTTP 入口，不接入现有详情的 metric_eligible 占位。

## 主要不变量

- COMPLETED、非空 Answer、匹配回答哈希的 current 成功分析、必要有效 current Review；不回退旧分析和旧修正。
- 维度不同按明确原因排除。结果携带 cell、scope/SOV 集合；比较由后续读模型负责，不静默混合。
- 所有比率空分母 null，样本等级按运行数而不是声明/引用事件。排除数按运行去重，原因可以重叠。
- 两个用户裁决分母分别为可靠排序运行、可判断声明运行。推荐 four-state 只有 RECOMMENDED 是推荐；可靠 rank 必须为正且属于 RECOMMENDED。
- SOV 运行—对象 presence；引用按每回答规范 URL 去重，冲突事实显式 ValueError。
- 只有 current/latest 的重复样本。多 active attempt 即使最新失败也拒绝；稳定性同一 batch/cell 至少两个重复，不挑最佳运行。

## 验证及边界

独立人工复算 GOLD 覆盖18项字典；125项定向验证（含 current pointer、旧Review、失败/复核/证据排除、可比维度、样本门槛、事件单位、两项裁决、重试守卫）。用户指定完整静态/单元/集成门禁在 implement.md/evidence 记录。

没有公共 operation/schema、数据库合同、ORM、Alembic revision、生产前滚或回填。没有权限/CSRF/SSRF/TLS/凭据边界变化。内部无效输入用 ValueError，未新增 HTTP 错误映射；无写入、锁、revision、幂等键或队列影响。纯库要求调用方提供已授权且同快照的事实，不能据客户端状态提供凭据或权限。

GEO-602 接线 Overview 与资格投影；GEO-603 负责趋势/window和矩阵，GEO-604 负责引用/事实洞察明细，GEO-701 负责配置。均未实现。
