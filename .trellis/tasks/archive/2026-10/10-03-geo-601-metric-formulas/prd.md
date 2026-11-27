# GEO-601 Task Brief：MetricEligibility、样本等级和公式库

## 1. 基本信息

GEO-601 / R5；2026-10-03 本会话用户已人工审查并接受实现与测试证据，manifest=done、Trellis=completed；初次preflight阻断已由用户裁决解除。当前主代理负责，无子代理。进入时分支已经是geo/GEO-601，无提交/PR/发布。依赖GEO-507：manifest=done、Trellis=completed，2026-10-03人工接受记录已核对。

## 2. 目标

建立回答级GEO的服务端指标资格、可比维度、样本等级及公式唯一所有者，使visibility/recommendation/SOV/citation/accuracy/stability具有透明分子、分母和排除原因，可按金标复算。

## 3. 关联需求

CAP-GEO-11；REQ-GEO-METRIC-001～009；AC-METRIC-01～04、06；AC-STABLE-01。WBS完整任务行位于02-work-breakdown-structure.md:93。下钻API、数据质量洞察和报告由后续任务负责。

## 4. 必读依据

用户指定README、路线图、WBS、执行指南、任务模板、manifest；PRD、页面规格、领域模型、状态机、指标方法；技术/数据/API/前端架构及测试策略；Accepted ADR-003/004和GEO-002 F09。根AGENTS、backend/AGENTS、Trellis workflow/backend spec已核对。

实现依据为根OpenAPI的GeoRunDataQuality、GeoAnalysisSelection及分析/复核组件；数据库合同GEO-501/506/507章节；geo_analysis_queries.py、geo_review_projection.py、相关schemas、0056迁移及SQL；分析/推荐/引用/声明/复核/fixture相关unit。前序GEO-507任务记录及GEO-005 fixture README亦已核对。

## 5. 当前行为

原始Answer/Citation、机器Analysis和追加Review在PG保存。Run显式pointer选择当前成功analysis，该analysis内created_at DESC,id DESC选择最新Review；有效修正不累计旧记录。详情使用同一RR快照批量读取。必要复核未完成为metric_eligible=false/GEO_REVIEW_REQUIRED，其他情况仍null/METRIC_ELIGIBILITY_NOT_IMPLEMENTED。geo_metrics.py及回答级完整公式金标尚不存在；旧文章关系指标独立。

## 6. 目标行为

通用资格要求完成运行、非空原始答案、当前成功分析、必要有效复核、无阻断数据错误、满足指标和筛选维度且未明确排除。失败不算未提及；模式、点名、问题/profile/环境等不可比维度默认分开。可靠排序、引用结论、可判断声明及同批次同cell至少两个重复各有指标特定资格。

所有比率返回value/numerator/denominator/sample_level、合格与排除数及原因；无分母null。NONE/OBSERVED/REPORTABLE/STABLE按方法文档初始样本门槛，不声称统计显著性，不生成统一总分。

## 7. 范围内

- [x] MetricEligibility通用及特定资格。
- [x] 可比维度、比率结构、样本等级。
- [x] visibility/recommendation/SOV/citation/accuracy/stability公式。
- [x] 完整独立公式金标及必要合同/文档同步。

资格、维度、样本和18项公式已实现；125项完整金标/边界/转换定向测试通过，完整验证已完成并通过，交付review，未标done。

## 8. 范围外

GEO-602 Overview API/读模型；603前周期、趋势及矩阵；604引用/事实风险洞察与明细；701管理员规则配置。Opportunity行动闭环、Browser、真实外部AI、生产启用/迁移、无关重构和依赖升级均不实施。

## 9. 业务不变量

PG唯一业务来源，不持久化可编辑指标。原始回答、机器行和旧Review不改写；当前选择复用服务端权威。无事实UNJUDGEABLE；无可靠顺序不补rank；无分母null；失败不算未提及；模式和点名默认分离；前端不拥有公式或样本等级。

## 10. 契约变化

OpenAPI、数据库合同、ORM和Alembic均无变化。当前实现纯库，不接入公共资格投影；GeoRunDataQuality原占位留602接线。只同步PRD/方法字典/ADR两个分母裁决，未实现后续接口。

## 11. 后端实现

geo_metrics.py拥有纯资格及公式；geo_metric_types.py拥有不可变内部模型；geo_metric_inputs.py显式转换一致快照并建立scope。消费一致快照、既有current reviewed结果；不能自行选择历史最佳analysis。纯计算无写事务、锁、revision、状态转换、审计、幂等键或Worker派发。未知完整性明确排除/失败，不猜值。

## 12. 前端实现

无新路由、query key、URL状态或页面。公共类型如有必要变化只从根OpenAPI生成；当前没有前端修改。

## 13. 测试计划

当前先执行相关分析/复核unit基线和用户指定六项检查，另执行make contract-check。实际argv/退出码/完整日志保存在evidence。隔离PG16、Redis及fake-OSS不访问真实平台。

公式金标已覆盖零分母、失败/证据/必要复核排除、模式及点名分离、推荐四态与可靠排序、运行级SOV/冻结对象集、引用事件去重和运行覆盖、声明四态、样本边界、重复稳定性和人工有效结果。前周期与洞察明细留603/604。

## 14. 验收标准

金标与人工复算一致；零分母null；失败不进入业务分母；人工/其他模式默认分离；BRANDED不进入自然可见/default SOV；比率结构完整。两个分母已获产品裁决，唯一formula_version为geo-answer-v1；完整门禁完成，已交付review，不能自行done。

## 15. 验证命令

git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker compose -p partsignal-geo601-validation -f .trellis/tasks/10-03-geo-601-metric-formulas/evidence/validation-compose.yaml'；make contract-check。精确命令和结果在evidence各同名JSON/log；不能把运行中或未执行项写成通过。

## 16. 数据与上线

无新Alembic、回填、生产迁移或开关变化。源码head为0056；既有integration迁移测试仅检查当前head，不代表本任务新增前滚。测试Compose无宿主端口，仅本任务资源，挂载当前源码/合同，复用现有测试镜像；结束按项目精确清理，不影响其他会话。

## 17. 阻断、风险与恢复

首次preflight发现PRD与方法的两个分母冲突而blocked。用户在本会话明确裁决“两个都采用指标方法口径”，现已解除：首位推荐率仅可靠排序的推荐适用运行；严重错误运行率仅有可判断目标声明运行。ADR-004/PRD/方法字典同步，证据在evidence/denominator-decision.json，原始阻断证据保留供审计。

当前没有未决业务冲突。运行成功率/分析成功率F09其他争议留后续任务。调用方必须提供一致快照、latest attempt、完整性、事先适用对象、实质描述和无引用可观察事实；不得猜测。库守卫重复active sample，失败不得因旧成功而选入。

停止条件仍为任务用户指定的不可消解冲突、未经批准破坏迁移/规则改变、必需输入授权缺失或实际依赖未完成。本次人工验收授权仅将GEO-601记录为done；没有授权提交、推送、生产迁移或发布。

## 18. 当前证据

evidence/baseline-files.json、git-status-before.txt保存起始工作区；before/保存manifest/SHA256SUMS前像。implement.md记录真实测试和范围审计。新增纯计算与测试，无公共/持久化/权限/并发保证变更；采用主代理自查和独立手算金标，没有委派或独立代码复核，不把自查称独立复核。

## 19. 后续任务

GEO-602/603/604/701保持planned，不实施、不修改其状态。本任务已于2026-10-03人工接受，manifest=done、Trellis=completed；既有review证据作为验收时历史记录保留。
