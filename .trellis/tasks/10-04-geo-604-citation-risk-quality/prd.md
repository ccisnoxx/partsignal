# GEO-604 Task Brief：引用、事实风险和数据质量洞察

## 1. 基本信息

GEO-604 / R5，主代理负责实现与根合同；只读文档核对和独立复核按审计Bundle记录。当前分支geo/GEO-604。依赖GEO-601/504/505的manifest均done。开始时planned，准备后in_progress，本地验证完成只交付review。WBS完整任务行在02-work-breakdown-structure.md:96。无Commit/PR。

## 2. 目标

提供域名/URL、来源类别、声明结论/严重度，以及资格排除、共享域名、复核积压、费用与版本覆盖；摘要可用相同筛选和资格复现明细。

## 3. 关联需求

CAP-GEO-08/09/11；REQ-GEO-METRIC-010/011；PRD§9.6/12，方法§9/10/12/16/18/19，透明分母与可追溯验收。

## 4. 必读文档

用户列出的18份文档由主代理与只读核对代理完整分工阅读；根/后端/前端AGENTS，Trellis workflow/backend spec；601/504/505/603任务记录；根OpenAPI和database GEO-304/501/506/507/602/603，0054–0056及相关SQL。代码包含metrics、metric_inputs/types、overview_queries、answer_insights、review_projection、citation_rules、analysis/answer schemas及相关测试。详细路径沿用户任务请求及docs/geo-monitoring/README索引。

## 5. 当前行为

PG保存不可变Answer/Citation、版本化分析及追加Review；current pointer内latest Review是有效结果唯一来源。601已有引用/准确性公式，602已有质量卡与组成样本，603已有趋势/矩阵/覆盖/SOV，但引用/风险/质量明细不可用。查询固定12 application SELECT、加身份13SQL，RR/禁autoflush。当前无共享域名和费用/分析版本明细汇总。

## 6. 目标行为

扩展getGeoAnswerInsights当前窗口的引用/风险/质量区块；新增citations、claims、quality/runs只读下钻。业务按完整cell和目标分层，质量明确操作汇总。引用事件每回答规范URL一次，原occurrences保留；域名精确hostname分组。UNJUDGEABLE独立计数，不进入正确/错误分母；HIGH/CRITICAL INCORRECT才计严重错误。共享候选来自current analysis冻结字典，人工消歧后仍保留质量上下文。

## 7. 范围内

域名/URL排行、覆盖运行/问题/平台、来源类别；自有引用/准确性/严重错误601公式；声明类型/严重度计数与证据；去重排除及原因；review backlog、共享域名、费用覆盖/分币小计和均价、采集及分析版本分布；公共/数据库只读合同、生成类型、测试与文档。

## 8. 范围外

GEO-605页面与URL/query key，606报告/CSV，607性能阶段验收，701/702规则/机会闭环；Browser、真实AI、生产启用、外部请求、已发布文章匹配/来源变化分析、无关重构和依赖升级。

## 9. 业务不变量

同一load_inputs/601资格/current review服务摘要与明细；失败不进入业务分母；原始引用/机器/Review/事实不改写；费用和版本未知不猜值；完整cell分开，无统一总分。质量保留业务排除的积压，REVIEWED_ONLY仍作用全部区块。

## 10. 契约变化

OpenAPI：getGeoAnswerInsights增加citation_insights/fact_risks/data_quality；新增listGeoInsightCitations/listGeoInsightClaims/listGeoInsightQualityRuns，关闭筛选Schema及10/20/50分页。数据库合同新增只读语义，无表/列/索引/ORM/Alembic或回填。Opportunity仍明确不可用。

## 11. 后端实现

已有13SQL内显式转为frozen证据：原始引用、有效分类/声明、采集/分析版本。组装当前完整cell，摘要/明细共享选择器；质量复用602唯一公式。Router仅参数/EngineerUser/响应，沿用read_snapshot。无commit/行锁/revision/状态/审计/队列/幂等键/外部I/O；失效cell404、非法筛选422、损坏历史409 GEO_READ_MODEL_INCOMPLETE。

## 12. 前端实现

只从authority重生成schema.d.ts，无页面/路由/query key/URL state实现，留605。

## 13. 测试计划

金标：引用去重、共享域名/子域、类别、四态/严重度/仅未知声明、费用未知/零/混币、版本未知、积压与重叠排除。PG/HTTP：摘要/分页明细一致、人工修正、新pointer旧review失效、同筛选、RR、固定查询数、权限/改密/非法筛选、静态与运行时实例。全部虚构，无真实provider。

## 14. 验收标准

未变化数据下摘要分子分母和所有明细贡献一致；重复URL不膨胀，共享/积压可下钻；UNJUDGEABLE可复现且不算对错；混币不合并金额、未知不补零。验证通过或精确记录限制，仅review。

## 15. 验证命令

git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker compose -p partsignal-geo604-validation -f .trellis/tasks/10-04-geo-604-citation-risk-quality/evidence/validation-compose.yaml'；make contract-check；定向pytest精确路径见evidence/*.json。

## 16. 数据与上线

无迁移/回填/生产写入/开关变化，head仍0056。GET实时重算，跨请求as_of可变化，失效cell404。测试使用专用PG16/Redis/fake OSS无宿主端口；最后精确清理本任务容器网络。

## 17. 风险与停止条件

风险：资格漂移、事件/运行混淆、旧字典/Review污染、未知补零和共享域名遗漏。用共同选择器、独立金标和PG验证。仅不可消解业务/ADR冲突、未批准破坏迁移、改变已批准公式/状态/安全、必需输入/授权缺失、依赖实际未完成才blocked。

## 18. 完成证据

基线279unit/23PG通过；当前3518后端/1170前端单元、994完整集成及最终7项604 PG/HTTP通过。lint/typecheck/contract/diff通过，fresh独立只读复核无确认缺陷，审计digest校验通过。manifest及Trellis仅review，等待人工接受。argv/退出码/失败修正轨迹见evidence/*.json/log；baseline-files.json、before/和起始工作树保护前序成果。implement.md记录验证、覆盖缺口及范围审计。

## 19. 后续任务

605消费服务端读模型；702后续机会评估，仅列出不实施、不修改状态。
