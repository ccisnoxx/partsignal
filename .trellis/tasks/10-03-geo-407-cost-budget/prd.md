# GEO-407 Task Brief

## 1. 基本信息
GEO-407；R3；状态 done（Trellis completed，2026-10-03 本会话用户人工验收）；负责人777；分支geo/GEO-407；依赖GEO-405、GEO-406均done；无PR/Commit。

## 2. 目标
保存原始引用与采集元数据，提供数据库权威的批次/日预算、并发预留及每Profile限速，费用未知不补零，失败无部分业务结果。

## 3. 关联需求
CAP-GEO-05/06/16；AC-PLAN-05；Worker架构15节与9.2；WBS GEO-407。

## 4. 必读文档
用户指定README、roadmap、WBS、execution guide、task-template、manifest、PRD、domain/state、technical/data/API/worker/security/testing/operations及ADR-001/002/003/005；根合同；0046/0048/0050/0052迁移；GEO-405/406记录与适用spec。文档只读研究另由analyst完整校准并返回精确来源。

## 5. 当前行为
Worker只提交正文，非空引用拒绝；Run费用/usage/provider ID/duration列存在但未写；带budget_limit明确配置失败。费用覆盖读模型已存在；无执行预算、并发预留或Profile rate limit。

## 6. 目标行为
答案、去重引用与provider元数据原子保存；claim/SENT受PG预算最终防线约束；未知预算不可放行；Profile并发/滚动60秒限速与429冷却；未发送恢复释放预留，发送后未知保守保留。

## 7. 范围内
- 引用/usage/cost/request ID/duration保存及现有费用覆盖。
- batch/day预算、并发预留、Profile限速和429。
- 相应合同、迁移、测试及文档。

## 8. 范围外
GEO-408 UI/自动纵向E2E；分析/指标/机会/Browser；生产平台批准、真实AI、生产迁移/发布、无关重构。

## 9. 业务不变量
PG业务权威；Redis仅run ID；Router无事务；未知金额NULL且不换汇；原始证据/终态不可变；一个attempt最多一次发送；发送后不自动retry；失败无半答案/引用/元数据。

## 10. 契约变化
OpenAPI：GeoApiSettings可选max_concurrency(默认1)/requests_per_minute(默认60)，Run可空provider_status/retry_after_seconds；generated类型同步，无新端点。Database：0053 admission账本与错误元数据，加法变更；冻结旧migration。旧settings省略新键合法；只新增账本归集历史API发送事实，不回写历史Run。

## 11. 后端实现
配置锁→accounting PG advisory事务锁→Batch→Run；结果/失败/恢复accounting→Batch→Run；网络不持DB锁。账本与状态同事务。预算未知/超限PENDING→BUDGET_BLOCKED；限速PENDING不变。成功只COLLECTED，不分析。幂等由状态/token及run账本PK；RR读模型沿用。

## 12. 前端实现
generated类型同步；实际现有Profile表单调用方新增并保留两个限速字段，复用控件和认证/CSRF/revision流程；路由/query key/URL不变。

## 13. 测试计划
单元配置/合同；PG预算并发、未知费用、币种、actual超预估、release/unknown/retry、UTC日界、Profile隔离、限速、429、引用/usage、rollback；迁移前滚/metadata/直接SQL反例；指定make门禁；fresh critical_reviewer。

## 14. 验收标准
未知费用不是0；服务端且PG并发最终裁决预算；限速/预算拒绝不调用provider且无业务结果；已发送失败不重发；完整采集元数据可从既有详情/费用覆盖读取。

## 15. 验证命令
基线unit：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_openai_response.py backend/tests/unit/test_geo_plan_preview_contract.py -q（exit0）。
基线integration：docker --context colima compose -p partsignal-geo407 -f .trellis/tasks/10-03-geo-407-cost-budget/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_worker.py tests/integration/test_geo_at_most_once.py tests/integration/test_geo_read_models.py -q（exit0）。
最终：git diff --check；make lint；make typecheck；make test-unit；make test-integration(上述隔离Compose)；contract-check；目标pytest。

## 16. 数据和上线
全局GEO_DAILY_BUDGET_LIMIT可选/币种默认USD，UTC日；API/Worker/Scheduler一致重载。无生产报价，受限且未知估价明确阻断。关闭采集开关、停Worker后前滚0053并统一部署；不可安全降级，前向修复/备份恢复。保留批准、开关、INTERNAL边界。

## 17. 风险与开放问题
预估不是供应商费用上界；实际超估记录真实费用且阻断后续。未知已发送费用不释放为0；日界在发送边界重验。锁序/恢复通过PG反例与独立复核。仅用户指定五类真实条件blocked。

## 18. 完成证据
evidence/baseline-*和before保存任务起点；最终结果写implement.md。实现及本地验证完成；2026-10-03 本会话用户人工审查并接受实现与测试证据，manifest=done、Trellis=completed。

## 19. 后续任务
GEO-408、GEO-506以及后续R5费用洞察；不实施。
