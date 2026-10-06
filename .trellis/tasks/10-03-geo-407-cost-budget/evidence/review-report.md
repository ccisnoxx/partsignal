已核验修订后的候选。本轮确认的 4 项数据与预算风险已在源码中闭合；当前未确认剩余的发布阻断源码缺陷。验证仍有未完成项，不能据此认定 GEO-407 的全部门禁已通过。

- **P1，缺少账本仍可领取或发送：已修复。** 原反例是 API Run 单独推进到 RUNNING/SENT，预算、并发及分钟查询因缺少 Reservation 而漏计。[0053_geo_collection_admission.sql:121](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0053_geo_collection_admission.sql:121) 现在拒绝 API RUNNING 或任何已发送事实缺少账本的提交；[直接 SQL 回滚反例:393](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_collection_admission.py:393) 覆盖领取缺预留。
- **P1，跨午夜历史发送漏记当天费用：源码已修复，迁移验证待完成。** 原反例是前一日 claim、次日发送，历史回填却按 started_at 归日前一天。[迁移回填:65](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0053_geo_collection_admission.sql:65) 现在以 finished_at/collected_at 或迁移时点作为最晚可能发送上界，保守归集迁移当天账款，未改写原 Run、答案或快照。
- **P1，COLLECTED 后可调低真实费用并释放预算：已修复。** 原反例是 SETTLED 账本保持不变，但其引用的 COLLECTED Run.cost_amount 被直接 SQL 改为 0。[采集事实守卫:20](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0053_geo_collection_admission.sql:20) 现在冻结已采集的费用、独立 usage、供应商元数据、发送状态及采集时间；[成本改写反例:410](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_collection_admission.py:410) 验证拒绝并保留原金额。
- **P2，账本发送时间与 UTC 归日可分离：已修复。** 原反例是 sent_at 为今日、budget_day 为昨日，随后日预算漏账。[UTC 日期约束:55](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0053_geo_collection_admission.sql:55) 与 ORM 已同步，强制 budget_day 等于 COALESCE(sent_at,reserved_at) 的 UTC 日期；[错误归日反例:422](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_collection_admission.py:422) 覆盖事务回滚。

实际审查覆盖了任务基线、预算与限速唯一 owner、配置→accounting→Batch→Run 锁序、结果及恢复锁序、网络事务边界、未知费用与混币拒绝、真实成本结算、SENT 日界重验、未发送释放、已发送未知保留、旧 token、429 冷却、引用首次元数据及 occurrences，以及答案、引用、usage、费用、COLLECTED 与结算的原子提交。费用覆盖按全部 attempt、状态按最新 cell 的读模型保持一致。

已读取主代理的原始验证日志：修订后的预算和元数据定向测试 **22 例通过**。同次迁移测试失败于 [test_geo_admission_migration.py:108](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py:108)：新增第三条历史 SENT 后，未知报价行数仍断言为 2。该失败不证明回填算法错误，但后面的跨日、metadata 对齐和安全降级断言尚未完成验证；修正数量后需取得该测试的完整通过证据。

另有一项覆盖缺口：现有日预算并发用例的两个 Run 共享 Profile、Channel、Model 和 Surface，配置锁已将其串行化，不能独立证明不同配置图之间的全局 accounting 竞争。源码中的共享 advisory 事务锁方向正确；不同配置图争用同一日额度的定向 PostgreSQL 反例可以补足这项证据。

本次审查全程只读，未修改文件、执行 Git 操作、启动其他代理或重复运行完整测试。