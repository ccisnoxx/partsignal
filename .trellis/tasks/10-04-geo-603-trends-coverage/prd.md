# GEO-603 Task Brief：趋势、竞品 SOV 与问题/平台覆盖

## 1. 基本信息
GEO-603 / R5；主代理负责；分支已为 geo/GEO-603，无提交/PR。manifest 起始 planned，唯一依赖 GEO-601=done；前序 Trellis completed 与人工接受记录已核实。已按 planned → in_progress → review 交付；2026-10-04用户人工接受后为done，Trellis为completed。

## 2. 目标
按完整可比维度返回紧邻等长前周期与变化、产品平台矩阵、变体和主题覆盖、平台表现及运行对象事件级 Mention/Recommendation SOV。不可比或样本不足显式不可用，保留原始比例和来源。

## 3. 关联需求
CAP-GEO-11；REQ-GEO-METRIC-001～009；AC-METRIC-01～07；WBS GEO-603 完整行（前周期、产品矩阵、问题覆盖、平台表现、两种SOV；competitor set变化、样本不足、点名排除）。

## 4. 必读文档
按用户指定 README、路线图、WBS、执行指南、模板、manifest；PRD、页面规格、领域模型、状态机、指标方法；技术/数据/API/前端架构、测试策略；Accepted ADR-003/004；根 AGENTS、backend AGENTS、Trellis workflow/backend spec；GEO-601/602 记录。根 OpenAPI/数据库回答级及旧洞察合同、0054～0056、现有公式/输入/Overview/测试为当前实现依据。

## 5. 当前行为
PG 保存冻结输入、Answer、current analysis 及追加 Review。601 单 cell 公式和样本等级；602 Overview RR固定查询及组成样本。旧 /geo-insights 为文章关系级。尚无前周期、覆盖矩阵或竞品趋势。

## 6. 目标行为
新回答级洞察以独立 GET 合同输出统一筛选、as_of、当前/等长前期、完整分层 cell、可比性原因、版本标记、覆盖阈值与每变体结果；组成运行可下钻。默认自然可见和SOV只用非点名。失败不能当零；空分母null。

## 7. 范围内
前周期与趋势门禁；产品平台矩阵；问题变体覆盖及主题正向覆盖；平台表现；实际冻结集合及两类 SOV；必要 GET/样本合同、真实PG测试、生成类型、稳定说明。

## 8. 范围外
GEO-604引用/事实风险/数据质量洞察明细；GEO-605前端页面/query key/路由；GEO-702机会评估/行动；Browser、生产启用、报告导出、管理员规则配置、性能索引任务、无关重构或依赖升级。

## 9. 业务不变量
PG唯一来源；current/latest review与latest attempt；不改证据历史；不混合不同问题/profile/模式/语言地区登录态/规则/字典/事实版本或集合。采集模型版本可比较但标记变化/未知。不计算统一总分、不归因、不生成机会。

## 10. 契约变化
新增回答级洞察 /api/v1/geo/insights 和 /runs 两个 GET，不覆盖旧 /api/v1/geo-insights 的 getGeoInsights；根OpenAPI新增11个闭合schema，前端仅生成。数据库追加只读合同；无表/列/索引、Alembic或回填。

## 11. 后端实现
纯计算库拥有变化/覆盖语义；应用读服务统一筛选与投影；复用批量输入，一次RR覆盖两窗口，禁止autoflush。Router只HTTP/认证/响应。无写事务、锁、revision、状态转换、幂等键或Worker影响。内部不合格返回显式不可用；坏输入失败；HTTP既有认证/校验/读完整性错误。

## 12. 前端实现
只更新 generated OpenAPI 类型，页面及URL/query key属于605。本任务无浏览器旅程。

## 13. 测试计划
基线601公式/转换/Overview单元及PG；新增独立金标覆盖前周期、竞争集合变化、最低样本、BRANDED排除、版本变化、完整分层、覆盖所有变体；PG/HTTP验证统一筛选、current review、RR、固定查询数、来源加总、无敏感字段。运行用户规定五命令及contract-check。

## 14. 验收
不可比时变化null并明确原因；自然可见/SOV无点名污染；事件与运行计数分别显示；零分母null；每个变体保留，不以最佳变体替代主题详情；前期零时相对变化null。

## 15. 验证命令
uv run --project backend pytest backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_metric_inputs.py backend/tests/unit/test_geo_overview.py；隔离PG当前Overview集成；git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker compose -p partsignal-geo603-validation -f .trellis/tasks/10-04-geo-603-trends-coverage/evidence/validation-compose.yaml'；make contract-check。精确argv/退出码在evidence。

## 16. 数据与上线
无迁移或回填，不启用生产/自动能力；0056仍head。测试使用独占Compose PG16/Redis/fake-OSS，无真实平台。源码回退即可停止新增只读接口，无数据撤销。

## 17. 风险与停止条件
主要风险：集合改变被错误配对、低样本伪趋势、点名污染、不同cell聚合、review快照漂移。按用户五类停止条件遇到不可消解冲突/未经批准破坏迁移/改变指标或安全/必要输入授权缺失/实际依赖未完才blocked。问题分类文档未覆盖的高比例3–4样本保持分类null、说明稳定样本不足，不发明分类。计划应监测主题总量属于计划执行质量；本任务只提供实际监测主题的目标结果覆盖，不从当前可变计划猜历史应执行窗口。

## 18. 完成证据
evidence/before与baseline-files、基线及候选日志、task-only.diff、独立审查及SUBAGENT_EXECUTION_DIGEST。完整单元3508后端/1170前端、完整集成986通过；两项初审P2修正后最终439定向单元/15定向集成、lint/typecheck/contract/diff通过。精确命令和失败修正记录见implement.md；不自行done/提交/归档。

## 19. 后续任务
GEO-604、GEO-605、GEO-702，及后续报告/性能验收；本任务不实施。

## 20. 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-603 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-04；既有review证据与验证限制保留为验收前历史。本次仅收尾GEO-603，不修改其他任务状态、不实施后续任务、不提交或归档。
