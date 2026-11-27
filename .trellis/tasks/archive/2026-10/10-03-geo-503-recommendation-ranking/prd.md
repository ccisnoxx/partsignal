# GEO-503 Task Brief：推荐分类和可靠位置识别

## 1. 基本信息
GEO-503 / R4；实现与测试证据已于2026-10-03由本会话用户人工审查并接受；主代理；当前分支 geo/GEO-503；manifest状态 done，Trellis状态 completed；依赖 GEO-501、GEO-502 manifest=done，Trellis=completed并有2026-10-03人工接受记录；无Commit/PR。

## 2. 目标
从冻结回答与监测字典形成可追溯四态推荐、可靠1-based rank及原文依据。名称出现不自动等于推荐；无法证明顺序时rank=null并保留复核原因。

## 3. 关联需求
WBS GEO-503完整行；PRD §9.5.D、§11.4/11.5、AC-ANA；方法论§5/7；测试策略§6；Accepted ADR-002/003。

## 4. 必读文档
用户指定GEO README、路线图、WBS、执行指南、模板、manifest、PRD、领域模型、流程、方法论、技术01～07及ADR002/003。根/backend AGENTS、Trellis workflow/backend有效spec；501/502任务记录；OpenAPI Recommendation/Mention/Analysis完整相关组件、数据库Analysis合同、0054相关SQL/ORM/Schema、当前提及服务及共享/提及金标。仅读取与本任务有关的权威单位，不依任务标题猜测。

## 5. 当前行为
GEO-501已定义四态/rank/rationale/confidence及不可变表；GEO-502纯提及函数保留字典/原文span/否定/歧义。没有推荐算法，原13共享金标尚未被推荐分析执行；Worker/运行详情分析仍未接线。

## 6. 目标行为
纯确定性阶段区分推荐、候选/列举、明确不推荐、无法判定；作用域绑定对象及原文，保留冲突/歧义。可靠编号排序/明确首选才给rank；无序、普通编号、并列、重复、重置及冲突不按字符offset制造rank。

## 7. 范围内
推荐阶段及其文本规则所有者；独立推荐金标、共享13场景实际对照、格式/关系/隐私校验；必要文档、Task Brief、证据与manifest状态。

## 8. 范围外
GEO-504引用/505声明/506 Worker与revision生命周期/507复核命令/508页面；指标、Opportunity、Browser、真实AI、历史回填/自动重分析、依赖升级及无关重构。

## 9. 业务不变量
名称不推出推荐；否定不删提及；四态不得合并；rank须有可靠语义否则null；歧义不选subject；原始回答不修改；不执行答案指令；未知置信度null；业务状态继续PG权威。

## 10. 契约变化
复用现有GeoRecommendationKind/Out、Mention与SubjectSnapshot。无OpenAPI/数据库/ORM/Alembic/generated变更；无新HTTP错误或operation。内部证据span/rule/review codes仅属于本纯阶段，不另建持久化合同。

## 11. 后端实现
geo_analysis.py拥有冻结提及输入和最终推荐结果装配，geo_recommendation_rules.py拥有文本作用域/推荐线索/列表与排序判定；依赖为主阶段→文本规则，无I/O、Router、事务、锁、revision、pointer发布、队列或状态推进。506后续负责接线已有Run→Analysis→Fact锁/幂等合同。无效输入固定ValueError，不回显正文。

## 12. 前端实现
无路由/query key/URL/generated/页面变化；当前分析区仍NOT_IMPLEMENTED。

## 13. 测试计划
基线现有提及/分析合同/fixture定向unit、contract-check，隔离PG analysis/input。新增推荐金标：列举/否定/四态/有序与无序/多竞品/对象作用域/冲突/歧义/编号不等于偏好/首选/原文span/Unicode/稳定性/安全repr。最低五命令及contract/fixture实际执行，完整integration在专用Compose运行；不访问真实AI。

## 14. 验收标准
给定同回答多对象时推荐/否定分别归属；中性列举不推荐；无可靠顺序rank=null；明确推荐顺序产生正整数；歧义及冲突保留原文与复核原因；共享金标已明确推荐预期不改写。

## 15. 验证命令
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_fixtures.py
make contract-check；git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE=<本任务独占Compose>；make test-geo-fixtures。精确argv/exit/log保留evidence。

## 16. 数据和上线
无迁移/回填/生产前滚，head仍0054；仅测试隔离临时库前滚。未接入线上Worker；无开关、部署和外部平台批准变化。撤销本任务源码即可恢复，不触碰历史数据。

## 17. 风险与开放问题
主要风险是推荐线索串到其他对象、否定/条件/引语误判、编号误当优先级及未知rank伪确定。保守UNKNOWN/复核，不声称通用NLP。仅用户列明五类实质阻断标blocked；环境故障如实记录，不伪造通过。

## 18. 完成证据
evidence保存初始工作树/hash、基线/候选命令及增量diff；implement.md逐项报告。完成本地验证后manifest/Trellis=review，不自行done、提交、归档或发布。

## 19. 后续任务
504/505独立其他分析阶段；506接线Worker/原子revision写入并消费复核原因；507/508复核与页面；均不在本次实施。
