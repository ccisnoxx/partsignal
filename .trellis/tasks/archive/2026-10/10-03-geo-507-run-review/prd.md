# GEO-507 人工复核策略、API 和当前结果选择

## 1. 基本信息

Task ID GEO-507，R4；主代理负责，分支 geo/GEO-507。依赖 GEO-506：manifest=done、Trellis=completed，2026-10-03 用户人工接受。初始 planned；实现与本地验证后交付 review。2026-10-03 本会话用户人工审查并接受实现与测试证据，manifest=done、Trellis=completed。无提交、PR 或发布操作。

## 2. 目标

ADMIN/ENGINEER 可以确认或结构化修正当前成功分析。每次复核追加历史并拒绝 stale revision；详情在一致快照内同时返回原机器结果、历史复核和当前有效修正，未完成必要复核明确阻断业务指标使用。

## 3. 关联需求

AC-ANA-02/03/04/05/06/07，AC-SEC-02，AC-AUDIT-01/02；ADR-002/003。MetricEligibility 全部公式属于 GEO-601。

## 4. 必读文档

已读取根/后端 AGENTS、frontend AGENTS（仅 generated/fixture 范围）、Trellis workflow/backend spec，以及用户指定的 README、roadmap、WBS 完整507行、执行指南、模板、manifest、PRD、领域/状态/方法指标、技术/数据/API/前端/Worker/安全/测试架构和 Accepted ADR-002/003 中适用完整章节。已核对 contracts/openapi.yaml/database.md、0054/0055 与当前分析、读取、权限、事务、审计代码和测试；506 的 prd/design/implement/task.json 已读取。

## 5. 当前行为

0054 已有追加式 Review 和四栏闭合 correction、当前成功 pointer；0055 已有确定性分析 Worker、内部管理员 reanalyze 与不可变引用分类。公共详情没有分析/复核字段，data_quality 明确 NOT_IMPLEMENTED；needs_review 仅过滤初次 Run 状态。无 review HTTP/应用命令；终态 Run 不允许单独递增 revision。

## 6. 目标行为

复核只绑定当前 COMPLETED analysis，expected_run_revision 必填；旧分析优先 GEO_REVIEW_STALE_ANALYSIS，旧 Run revision 为 REVISION_CONFLICT。CONFIRMED 无 corrections；CORRECTED 有说明与至少一项四栏修正。每次成功追加 Review、递增 Run revision、受控审计同事务；首轮 NEEDS_REVIEW→COMPLETED，其余采集终态只推进复核 revision。新的成功 pointer 自动令旧 review 失效，不删除旧记录；新失败保留旧选择。

## 7. 范围内

- review 请求/回执、Router、应用事务与权限、schema/归属校验。
- 详情机器/历史/当前有效结果与 Review gate、列表 needs_review 派生筛选。
- 受控 review revision 发布守卫、新迁移、真实 PostgreSQL 并发/保留/错误/前滚测试。
- 根合同、generated 类型与必需 fixture、文档和证据。

## 8. 范围外

GEO-508 页面/交互/R4金标整体验收，GEO-601 指标资格/公式/汇总；Opportunity、Browser Collector、真实外部 AI、重分析公共 HTTP、全量批量重分析、其他任务或无关重构。

## 9. 业务不变量

PostgreSQL 权威、Router 不写 ORM/事务。Answer/Citation/机器结果/旧 Review 不改删；有效 review 只在 current pointer 内按 created_at DESC,id DESC 选择；新 review 不累计此前 correction，latest CONFIRMED 恢复机器投影。需复核但无当前 review 的 analysis gate=false，metric_eligible=false；通过 review gate 仍不能宣称尚未实现的全指标资格为 true。

## 10. 契约变化

OpenAPI 新 POST /api/v1/geo/observation-runs/{run_id}/review；GeoRunReviewRequest/Created、分析结果与当前 reviewed read model、GeoRunDetail.analysis。复用既有 correction/Review/Analysis 组件。数据库新0056，仅限定同事务新增review后的Run revision发布与首轮完成；不加表、不回填历史、不修改旧迁移。

## 11. 后端实现

User→Batch→Run→Analysis，READ COMMITTED 锁后重验。复用 geo_plan_locks.command 的最新 active/改密/ADMIN或ENGINEER 校验及heartbeat舍弃。Service 对 correction scope 权威裁决；精确23514+constraint映射，其余错误保持未知失败并全回滚。读取复用原RR快照，固定批量查询；有效结果独立投影，不写第二份状态。

## 12. 前端实现

只重生成 OpenAPI types 并补受影响的测试 fixture；无新路由/query key/URL状态或页面。分析可由现有详情API读取，页面交付留508。

## 13. 测试计划

基线：相关schema/规则/Run策略unit和既有分析/并发/Worker/读取PG。候选：correction四栏、权限/CSRF/当前账号、stale run/analysis、并发同revision、publication与review竞争、current supersede、latest不累计、失败rollback/审计安全、直接SQL终态字段防线、旧0055非空前滚及metadata。按用户要求执行六项最低检查。无外部AI；fresh只读独立复核并发/持久化与公共合同。

## 14. 验收标准

NEEDS_REVIEW且无当前review的业务使用门禁=false。confirm/correct成功后追加Review并保留机器行；同revision并发只有一个成功；新成功analysis使旧Review只作历史。缺事实的claim不能修成可判定，外来Subject/Claim/Citation全部拒绝。失败不得产生Review/成功audit或revision副作用。

## 15. 验证命令

`git diff --check`；`make contract-check`；`make lint`；`make typecheck`；`make test-unit`；`make test-integration COMPOSE=<本任务隔离Compose>`。精确argv/退出码/日志保存evidence，不把未运行命令写成通过。

## 16. 数据和上线

0056先迁移再部署新API；历史不回填。迁移只替换guard函数，保持旧pointer/采集防线；新增review记录长期保留。关闭复核写入口并前向修复，downgrade明确55000安全停止；不操作生产数据库。

## 17. 风险与开放问题

重点：COMPLETED可追加复核但不能重写采集、同revision串行化、当前选择读取一致性、旧review不累计、无事实不可判定。仅用户指定的文档冲突/破坏性迁移/指标状态安全改变/必要授权缺失/依赖不完成五类情况blocked；环境检查失败记录和诊断，不伪造通过。

## 18. 完成证据

起始源码与哈希：evidence/before、baseline-files.json；真实检查：evidence/run_check.py生成JSON/log。实现、迁移、独立复核及未执行项记录implement.md。全部最低检查与独立只读复核/审计已通过，并已由本会话用户人工接受，manifest=done、Trellis=completed；精确命令、迁移、初次失败与覆盖限制在implement.md。

## 19. 后续任务

GEO-508 分析/复核前端和R4整体验收；GEO-601 MetricEligibility/公式。不实施。
