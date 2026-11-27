# GEO-602 Task Brief：Overview 读模型和 API

## 1. 基本信息
GEO-602 / R5，状态 done（Trellis completed），主代理负责，分支已为 geo/GEO-602，base main。GEO-601 manifest done、Trellis completed及2026-10-03人工接受记录已核对。无提交、PR或发布授权。

## 2. 目标
提供透明、可追溯的回答级 Overview：卡片、重点产品、风险、最近批次、开放机会占位和数据质量。所有卡片含分子/分母及携带同一筛选的组成样本下钻。

## 3. 关联需求
CAP-GEO-11；PRD §9.1/12、页面规格 §3/14、WBS GEO-602完整任务行（94行）。趋势、SOV、矩阵和洞察明细属于603/604。

## 4. 必读依据
根及backend AGENTS；Trellis workflow/backend spec；用户列出的README、路线图、WBS、执行指南、任务模板、manifest、PRD、页面规格、状态机、指标方法、领域模型、技术/数据/API/前端架构、测试策略、Accepted ADR-003/004。当前根合同、0054～0056迁移、current analysis/review读投影、601指标库与测试。依赖任务prd/design/implement/接受记录已核对。

## 5. 当前行为
PG保存冻结Batch/Run/Answer/current Analysis及追加Review；RR详情单请求批量读取。601纯公式与资格已完成，未有回答级Overview/HTTP指标。旧文章关系GeoInsights独立；不替换旧API。

## 6. 目标行为
GET overview返回as_of、规范筛选、按完整冻结cell分栏的指标及重点产品、严重错误风险、最近批次、占位和质量。组成样本GET重新计算同一筛选与cell，分页返回稳定run/analysis/review身份与每运行分子分母；不把事件分母误当运行数。

## 7. 范围内
- [x] Overview及必要组成样本API、公共Schema/生成类型。
- [x] 复用601资格公式，固定批量查询、RR、统一筛选。
- [x] 透明质量计数/费用及版本覆盖、机会明确未实施占位。
- [x] 定向测试、规定检查、任务及稳定文档同步。

## 8. 范围外
603趋势/前期/SOV/覆盖矩阵，604洞察引用/声明明细，605前端，606报告/CSV，607大容量性能门禁，701规则配置，机会行动闭环、Browser、真实AI、生产启用、无关重构/依赖升级。

## 9. 不变量
PG唯一业务状态；current pointer及其latest Review，不选历史最佳；latest attempt不择优；失败不算未提及；空分母null；模式/点名/版本完整分栏；公式由601拥有；冻结binding确定产品适用性；不推断无引用事实。

## 10. 契约变化
新增GET /api/v1/geo/overview及/overview/runs，重复数组query、半开created_at窗口、闭合枚举。无写入/幂等/revision。数据库合同仅说明只读来源、固定查询、RR和重算，无表/列/索引/Alembic/回填。

## 11. 后端设计
Router沿用EngineerUser与认证前read_snapshot。查询模块固定批量加载最小Run列、Answer/Citation、current Analysis及四类子结果、最新Review、文件状态及Batch身份。Service负责显式输入转换、按维度分组、601公式、质量及响应。只读、不锁、不commit、不刷新heartbeat、不派发。未知完整性失败使用既有GEO_READ_MODEL_INCOMPLETE安全409，不暴露正文。

## 12. 前端
只从OpenAPI生成schema.d.ts；无页面、query key、路由或URL状态实现。未来605消费规范filter/drilldown，不计算公式。

## 13. 测试计划
单元验证筛选/空分母、事件与运行区别、维度和质量公式。真实PG验证current review/旧分析、latest attempt、固定查询数、RR交错、筛选与样本一致、权限/改密/未知输入。新API真实HTTP测试为本任务纵向边界；无UI旅程，不运行Browser/E2E矩阵。

## 14. 验收
六类deliverables均可观察；卡片透明且可下钻；同筛选所有区块一致；空数据不假成功；固定查询数无N+1；RR不混合并发新旧事实；不实现后续任务。

## 15. 命令
git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker compose -p partsignal-geo602-validation -f .trellis/tasks/10-03-geo-602-overview/evidence/validation-compose.yaml'；make contract-check；定向Overview/指标/读取测试。实际日志/退出状态保留evidence。

## 16. 数据和上线
无新revision，当前0056；无生产前滚、回填或功能开关变化。独占PG16/Redis/fake OSS验证，结束清理本任务容器/网络。

## 17. 风险和裁决
2026-10-03本会话用户明确选择：运行成功率COMPLETED/终态运行（COMPLETED、FAILED、CANCELLED）；运行级分析覆盖率具有成功current analysis的已采集Run/全部已采集Run。BUDGET_BLOCKED同为已批准四终态之一，需单独记录其处理；不能自行放入与用户选项不一致的成功率分母。业务冲突、破坏迁移、改变已批准规则/安全、必需授权缺失、依赖未完成才停止blocked。

## 18. 证据
evidence/baseline-files.json和before保存前像/起始工作区。baseline-unit退出0，152 passed；baseline-integration退出0，7 passed。候选结果及独立只读复核在implement.md；不把运行中或未运行检查写成通过。

## 19. 后续
603/604/605/606/607及R6任务，均不实施。完成本地验证仅review，不能自行done/归档/提交/发布。

## 20. 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-602 的实现与测试证据。”据此记录manifest=done、Trellis=completed；既有review证据与验证限制保留为历史记录。本次仅收尾GEO-602，不修改其他任务状态、不实施后续任务、不提交或归档。
