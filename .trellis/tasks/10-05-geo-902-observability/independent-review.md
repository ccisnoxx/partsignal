# GEO-902 独立只读复核及修正

复核对象是 evidence/candidate.diff 和 candidate-files.json 的初始候选，保留原文件供追溯。critical_reviewer 无文件写入，检查迁移/ORM、独立事务与并发、日志/Celery 异常边界、真实本机 health、只读聚合和告警。不是对整仓既有 dirty tree 的审查。

| 严重度 / 触发条件 | 影响与修正 | 证据 |
|---|---|---|
| P1：logging handler 的 emit 抛 OSError | 旧候选 geo_event 可覆盖已提交成功回执；新增固定 stderr LOGGING_UNAVAILABLE，禁止递归日志，保留原业务结果/拒绝。连接释放异常也不覆盖记录结果。 | test_geo_ops_runtime.py 两个失败通道回归；log-sink-fix.log、ops-unit-final.log |
| P1：Beat producer 在 apply_entry 前 ensure_connection 失败 | Celery 继承回调打印 Broker 异常；覆盖实际 _ensure_connected 回调，保留既有重试参数，tick 边界使用固定失败并去除异常链。 | test_geo_ops_health.py 使用已安装 Celery 实际边界的 canary 回归；ops-unit-final.log |
| P2：operation 已观察但从未成功，success timestamp 为 NaN | NaN 比较不报警；heartbeat/recovery 规则显式检查 success_total=0，不伪造 timestamp。 | promtool alerts.test.yaml 的 observed=1 / 首次失败 fixtures，alert-test.log |
| P2：新人工回答等待分析时以 Run.created_at 算 age | 多天人工待录入被误判为分析积压；未装配 COLLECTED 改为 collected_at，已装配仍用 revision.created_at。 | analysis-age-before.log 旧算法失败 259200<600，analysis-age-fix.log 新算法通过 |

这些问题由主代理修正，定向测试、实际 Worker/Beat 故障演练及 lint/typecheck 验证通过。没有第二轮独立复核；最终修正的验证不能描述为独立复核。生产监控接入、Grafana 实际导入、真实 provider/Browser、容量和恢复均不在本次实测覆盖内。

审计 Bundle 20261005T151007Z-geo-902-7d2c097d 已关闭，summary/digest/audit-verify passed。复核交付物 accepted 表示按合同完成只读检查，不表示初始候选无缺陷。
