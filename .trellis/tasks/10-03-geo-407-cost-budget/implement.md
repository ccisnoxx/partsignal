# GEO-407 实施与验证证据

## 状态与边界

分支 `geo/GEO-407`；依赖 GEO-405、GEO-406 均为 done。开始实施时 manifest 与 Task Brief 进入 in_progress。实现及本地验证完成后，manifest、task.json 与 Task Brief 均更新为 review；未自行标记 done。未提交、推送、发布或运行生产迁移。GEO-408 保持 planned。

已按用户指定读取完整文档、适用 AGENTS/spec 和 405/406 记录；权威文档差异及实施前 preflight 见 prd.md/design.md 和 evidence/research-report.md。任务起点有大量先前 GEO 与无关未提交修改，本任务通过初始 SHA-256、before 原文和候选差分隔离自身变更。

## 实际行为

- API 采集把答案、规范化去重引用、首次元数据/occurrences、request ID、duration、独立 token usage、成对实际费用和 COLLECTED 在同一短事务提交。费用覆盖继续统计全部 attempt；未知费用与未报告 token 保留 NULL，不猜价、补零或推算 total。
- geo_collection_admission 是预算/限速唯一 owner。冻结 Batch 限额及全局 UTC 日预算分别检查实际已报告费用、未结预留与新估价；未知金额、未知已发送费用或混币均显式拒绝有上限的准入。金额等于上限可放行。无任何预算上限可采集未知费用。
- claim 原子领取唯一 run_id 预留；SENT 前重验预算与当前 UTC 日。跨日预算不足仍未发送，显式 FAILED/BUDGET_EXCEEDED 并释放预留。PENDING 预算拒绝为 BUDGET_BLOCKED；claim 限速保持 PENDING、无答案和外部调用。
- Profile 默认 max_concurrency=1、requests_per_minute=60；滚动 60 秒计已发送和未发送预留。429 保存 provider_status/Retry-After 并冷却同 Profile；同 attempt 不自动重发。未发送 lease 失效撤销 token 并释放；已发送未知保留账款但结束并发槽。
- 现有 Profile 表单新增两个配置字段且编辑保留已有值；generated OpenAPI 类型同步。路由、query key、URL 状态没有变化。没有实现自动 Run 页面、分析、指标、机会或 Browser Collector。

## 合同、迁移与恢复

OpenAPI 新增可选 API settings 限制字段，以及 Run/List 必含但可空的 provider_status/retry_after_seconds；没有新增端点。DB 新增错误元数据、geo_collection_reservations 及状态/费用/UTC 日期约束和触发器。

Alembic `0053_geo_collection_admission` → down_revision `0052_geo_profile_tests`。隔离 PostgreSQL 测试实际从 0052 前滚到 head，保留历史 Run、答案及冻结输入；旧 API 已领取/已发送归集账本，未知报价保持 NULL。历史 sent_at 无精确值时使用 finished_at/collected_at 或迁移时刻作为最晚可能发送上界，避免跨午夜漏账，并明确它是计账上界。新记录按真实 SENT 的 UTC 日期计账。

0053 禁止 downgrade（SQLSTATE 55000），保留预算与发送历史；关闭新采集、停 Worker/Beat、备份后前滚并统一重启配置。故障时安全停止、前向修复或恢复备份。没有破坏性历史数据修改。

## 事务、锁、revision 与幂等

锁序：Channel→Model→Surface→Profile(NO KEY UPDATE)→pg_advisory_xact_lock(407,1)→Batch→Run；结果、失败、恢复为 accounting→Batch→Run。全局锁覆盖不同配置图/不同 Profile 的日预算竞争；外部 I/O 位于事务外。Run/账本发送与结算、答案/引用/元数据/Batch 均各自原子提交。

状态/token/lease、发送事实和账本 run_id 主键防重复领取、发送及结算；过期 token 无法提交迟到结果。沿用既有 revision 和状态机。API RUNNING/已发送缺账本、账本归日与时间不一致、已采集费用改小、终止账本修改/删除均由 PG 最终守卫拒绝。错误沿用 BUDGET_EXCEEDED、PROVIDER_RATE_LIMITED 等安全固定映射；预算/限速失败没有部分采集结果。

## 安全边界

继续执行当前资格与批准、INTERNAL 外发禁令、凭据隔离、SSRF/TLS、权限与 CSRF。Redis 只传稳定 UUID。日志只含 ID/错误码/类型，不输出供应商错误正文、prompt、答案或凭据。所有外部采集验证使用本地 fake provider，隔离测试配置只含明确 fake 凭据。当前生产 adapter 无已批准报价，受限预算会明确阻断未知估价，不伪装真实生产调用。

## 实际验证

| 命令 | 结果 | 原始证据 |
|---|---|---|
| 基线目标 unit | exit 0 | evidence/baseline-unit.log；精确命令在 prd.md |
| 基线 Worker/at-most-once/read models integration | exit 0 | evidence/baseline-integration.log；精确命令在 prd.md |
| git diff --check | exit 0 | evidence/diff-check.log |
| make lint | exit 0；Ruff + ESLint | evidence/lint-candidate.log |
| make typecheck | exit 0；mypy 158 源文件 + tsc | evidence/typecheck-candidate.log |
| make test-unit | exit 0；backend 2999、frontend 1125/120 文件 | evidence/unit-second.log |
| make contract-generate；make contract-check | exit 0；权威合同/generated 无漂移 | evidence/contract-generate-final.log、contract-check-final.log |
| 目标 PG integration（精确命令如下） | exit 0；101 项 | evidence/target-final.log |
| make test-integration（隔离 Compose） | exit 0；884 passed / 20 warnings | evidence/integration-final.log |

目标测试命令：
```sh
docker --context colima compose -p partsignal-geo407 -f .trellis/tasks/10-03-geo-407-cost-budget/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_runs.py tests/integration/test_geo_collection_admission.py tests/integration/test_geo_admission_migration.py tests/integration/test_geo_read_models.py tests/integration/test_geo_worker.py tests/integration/test_geo_at_most_once.py -q
```
完整门禁命令：
```sh
make test-integration COMPOSE='docker --context colima compose -p partsignal-geo407 -f .trellis/tasks/10-03-geo-407-cost-budget/evidence/validation-compose.yaml'
```

预算并发包含共享及完全独立配置图；还覆盖未知估价/实际费用、已知零、混币、实际超估、UTC 跨日发送、429/冷却、Profile 隔离、并发/分钟窗口、未发送释放与已发送未知、迟到结果，以及引用/usage/cost 原子回滚和直接 SQL 反例。迁移验证包括保留历史、metadata 对齐、旧 settings、新限制非法值和不可降级。

首次 full integration：878 passed / 2 failed，均为旧 0048 测试夹具用当前公共 Schema/默认 API settings；已保留旧迁移并修正历史投影/输入。该事实留存 integration-first.log，没有改写为通过。首次 unit 的公共 Schema 必含/可空漂移及 typecheck 的现有调用方类型缺口均已修正并重跑通过。

完整集成最终为 884 passed / 20 warnings（393.73 秒）。现有 SQLAlchemy metadata 比较提示其他内容域循环 FK 和 dialect_options 告警；GEO ORM/迁移 metadata 比较通过，没有因此扩大到无关重构。未运行 Playwright 自动 API 纵向 E2E/浏览器矩阵（GEO-408），未调用真实 AI、未执行生产迁移或发布。

## 独立复核与审计

critical_reviewer 独立只读确认并促成四项修复：缺账本仍可发送、历史跨午夜漏账、COLLECTED 费用可改小、budget_day 可与 SENT 分离。最终源码复核未确认剩余阻断缺陷；其两个验证缺口（历史第三行数量、独立配置图全局竞争）已由主代理修正测试并取得 101 项通过证据。完整原始复核报告保留其当时的验证状态，没有伪写成最终门禁报告。

Audit Bundle `20261003T114539Z-geo-407-b80a27dc`，summary/digest/finalize/verify 均 exit 0。两个只读子代理的全部工具输入已检查，未观察到写入。见 evidence/SUBAGENT_EXECUTION_DIGEST.md、audit-validation.log、research/review-tool-evidence.json 及 write-evidence.json。主代理自行实现和测试，不计作独立复核。

## 限制与后续

预留保证准入时已知消费与估价额度，供应商实际费用可能超过报价；真实报告仍保存，并阻断后续。历史费用或发送时刻未知不能变成精确事实；不提供人工清未知账款/换汇能力。全局 accounting 锁是当前单租户短事务串行化点，不声称性能提升。

完整修改文件列表、任务起点与候选差分见 evidence/changed-files.md、baseline-sha256.json、before/、baseline-reconstruction.json、candidate.diff。GEO-408 自动观测 UI/纵向验收和后续生产 Collector/费用洞察仍为后续任务，没有实施。


隔离项目 partsignal-geo407 已 `down -v`（exit 0），仅清理本任务创建的测试容器、网络和 volume；没有停止 Colima 或共享环境。最终 115 项 GEO 文档 SHA-256 全部一致。结构化逐项结果见 evidence/validation-results.json。

## 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-407 的实现与测试证据。”据此将 manifest 中 GEO-407 从 review 更新为 done；Trellis task 从 review 更新为 completed，记录完成日期、验收人、验收范围和依据，Task Brief 同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施 GEO-408 或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步 manifest 对应 SHA-256 条目。
