# GEO-508 分析/复核前端与 R4 金标验收

## 1. 基本信息
Task ID GEO-508，Release R4，分支 geo/GEO-508。依赖 GEO-507 manifest=done，人工接受记录已核对。planned→in_progress→review；2026-10-03 本会话用户人工审查并接受实现与测试证据，manifest=done、Trellis=completed。未提交或发布。

## 2. 目标
运行详情可追溯原文→机器分析→人工复核→历史 revision。严重错误需显式逐条人工核对和非空说明，不能无操作默认确认。

## 3. 关联需求
CAP-GEO-07/08/09/10；AC-ANA-02～07、AC-SEC-02、AC-AUDIT-01/02；Accepted ADR-002/003。

## 4. 必读资料
用户指定 docs/geo-monitoring README、roadmap、WBS完整508行、guide、template、manifest、PRD、领域/流程/方法与指标、技术/数据/API/前端/Worker/安全/测试以及ADR-002/003。根/前后端AGENTS、Trellis workflow及适用spec；507 prd/design/implement、根contracts、0054～0056迁移、当前服务/Schema/前端/测试。文档只读分析使用独立analyst隔离上下文，结论保存evidence。

## 5. 当前行为
507已有POST review、current pointer与有效投影、四段机器结果、完整revision/review历史。前端仍显示分析未实现且无review表单。部分307/408 E2E仍冻结COLLECTED/NOT_IMPLEMENTED。284后端定向unit与70前端baseline通过；PG基线与精确输出见evidence。E2E初次缺DATABASE_URL已记录后创建隔离服务。

## 6. 目标行为
单detail响应绘制原文/证据、提及与推荐、引用分类、声明FactVersion/依据/严重度、机器和effective结果、当前及旧revision/history。CONFIRMED显式确认，CORRECTED四栏结构化修正。严重声明未核对/无说明不发POST。

## 7. 范围内
详情分析、声明表、四栏修正、只读历史、分析阶段轮询、Vitest和真实Playwright、全部分析金标与R4质量报告、任务状态与证据文档；将新真实流程注册到 deploy/scripts/e2e-local.sh，保持独占资源与清理合同。

## 8. 范围外
601指标资格/公式/汇总，Opportunity、Browser Collector、公共reanalyze、真实AI、其他任务、无关重构、依赖升级。

## 9. 不变量
PostgreSQL与服务端current/actions权威；generated DTO唯一；不重算状态机/公式；原Answer/Citation/机器/Review不改删；无事实只能UNJUDGEABLE。严重错误可以人工确认机器判断，不能默认跳过。

## 10. 契约
不新增OpenAPI/数据库/Alembic；当前head0056_geo_run_review。既有请求、revision与selection原样消费，不创造第二套DTO。

## 11. 后端
不改运行时服务。507 RC User→Batch→Run→Analysis；插入Review、revision+1、必要状态转换、Batch与审计原子。stale analysis优先409 GEO_REVIEW_STALE_ANALYSIS；旧revision409 REVISION_CONFLICT；422 scope/schema；未知错误保持失败。无自动命令重放。

## 12. 前端
沿用/geo/runs、run_id和geo/runs query keys。表单RHF，草稿只内存。动作来自analysis.available_actions。单detail不跨API join。冲突保留草稿/冻结提交，显式读取；unknown写结果只读历史核对。principal epoch防迟到命令污染。成功cancel旧读并invalidate root。loading/empty/error/权限/pending/dirty/键盘/响应式。

## 13. 验证
基线分析/review unit、geo-runs Vitest、PG复核。候选四栏payload、严重错误门禁、409 no replay、unknown/late/权限、dirty与历史；全部502/503/504/505金标及pipeline门禁。真实栈用隔离PG16/Redis和本地模拟，不放宽安全。

## 14. 验收
原文和机器声明依据可见；修正后机器行不变、effective来自服务端；历史旧分析和复核可展开且不提供写入口；严重INCORRECT HIGH/CRITICAL必须逐条核对并说明；stale拒绝不丢草稿、不自动POST。

## 15. 必须命令
git diff --check；make lint；make typecheck；make test-unit；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；make verify。按需contract-check、定向gold/PG/真实E2E。evidence/run_check.py保存argv/exit/log，不把未运行写通过。

## 16. 数据和上线
无迁移/回填/生产操作。复用当前0056 head。前端部署须配套已接受507 API。回滚本任务前端可隐藏review入口，历史保留。测试栈独立项目与DB，精确清理。

## 17. 风险与停止
严重默认确认、current/superseded混淆、异步覆盖草稿、写未知结果重放、旧E2E冻结行为。只按用户五类条件blocked；测试/环境问题诊断并保留真实证据，不扩展授权。

## 18. 完成证据
evidence/baseline-files.json与before保存任务前像；baseline/各候选检查JSON/log/XML；task-only.diff与changed-files；R4 acceptance报告；独立fresh reviewer与SUBAGENT_EXECUTION_DIGEST。状态review等待人工。

## 19. 后续
GEO-601指标、602～607洞察、701以后机会、801以后Browser；均不实施。
