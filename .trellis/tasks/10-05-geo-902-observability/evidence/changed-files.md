# GEO-902 实际变更清单

维护源码 47 个文件；仅相对任务开始前的 before 快照统计。已有 GEO 工作树修改未归因到本任务。

| 文件 | 类型 | 新增 / 删除行 |
|---|---|---:|
| [backend/alembic/versions/0065_geo_observability.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0065_geo_observability.py) | added | +43 / -0 |
| [backend/app/geo_observability.py](/Users/sc/PycharmProjects/partsignal/backend/app/geo_observability.py) | added | +50 / -0 |
| [backend/app/geo_ops_health.py](/Users/sc/PycharmProjects/partsignal/backend/app/geo_ops_health.py) | added | +198 / -0 |
| [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py) | modified | +1 / -0 |
| [backend/app/models/geo_observability.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_observability.py) | added | +56 / -0 |
| [backend/app/services/file_records.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/file_records.py) | modified | +2 / -0 |
| [backend/app/services/geo_analysis_dispatch.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_analysis_dispatch.py) | modified | +10 / -10 |
| [backend/app/services/geo_analysis_runs.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_analysis_runs.py) | modified | +14 / -14 |
| [backend/app/services/geo_batches.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_batches.py) | modified | +3 / -0 |
| [backend/app/services/geo_dispatch.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_dispatch.py) | modified | +10 / -10 |
| [backend/app/services/geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunities.py) | modified | +2 / -0 |
| [backend/app/services/geo_ops_logging.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_ops_logging.py) | added | +144 / -0 |
| [backend/app/services/geo_ops_metrics.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_ops_metrics.py) | added | +131 / -0 |
| [backend/app/services/geo_ops_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_ops_queries.py) | added | +288 / -0 |
| [backend/app/services/geo_ops_runtime.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_ops_runtime.py) | added | +139 / -0 |
| [backend/app/services/geo_reanalysis.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_reanalysis.py) | modified | +5 / -7 |
| [backend/app/services/geo_retention.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_retention.py) | modified | +5 / -3 |
| [backend/app/services/geo_runs.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_runs.py) | modified | +23 / -8 |
| [backend/app/worker.py](/Users/sc/PycharmProjects/partsignal/backend/app/worker.py) | modified | +12 / -0 |
| [backend/tests/integration/test_geo_admission_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py) | modified | +2 / -2 |
| [backend/tests/integration/test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py) | modified | +3 / -3 |
| [backend/tests/integration/test_geo_browser_session_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_browser_session_migration.py) | modified | +3 / -3 |
| [backend/tests/integration/test_geo_decision_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_decision_migration.py) | modified | +3 / -3 |
| [backend/tests/integration/test_geo_manual_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_manual_migration.py) | modified | +2 / -2 |
| [backend/tests/integration/test_geo_ops_queries.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_ops_queries.py) | added | +436 / -0 |
| [backend/tests/integration/test_geo_ops_runtime.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_ops_runtime.py) | added | +78 / -0 |
| [backend/tests/integration/test_geo_retention.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_retention.py) | modified | +1 / -1 |
| [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py) | modified | +3 / -3 |
| [backend/tests/unit/test_geo_ops_export.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_ops_export.py) | added | +39 / -0 |
| [backend/tests/unit/test_geo_ops_health.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_ops_health.py) | added | +104 / -0 |
| [backend/tests/unit/test_geo_ops_metrics.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_ops_metrics.py) | added | +94 / -0 |
| [backend/tests/unit/test_geo_ops_runtime.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_ops_runtime.py) | added | +154 / -0 |
| [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md) | modified | +18 / -0 |
| [deploy/compose.dev.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.dev.yaml) | modified | +10 / -8 |
| [deploy/compose.prod.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.prod.yaml) | modified | +10 / -8 |
| [deploy/compose.staging.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.staging.yaml) | modified | +10 / -8 |
| [deploy/observability/geo/README.md](/Users/sc/PycharmProjects/partsignal/deploy/observability/geo/README.md) | added | +104 / -0 |
| [deploy/observability/geo/alerts.test.yaml](/Users/sc/PycharmProjects/partsignal/deploy/observability/geo/alerts.test.yaml) | added | +335 / -0 |
| [deploy/observability/geo/alerts.yaml](/Users/sc/PycharmProjects/partsignal/deploy/observability/geo/alerts.yaml) | added | +130 / -0 |
| [deploy/observability/geo/dashboard.json](/Users/sc/PycharmProjects/partsignal/deploy/observability/geo/dashboard.json) | added | +740 / -0 |
| [deploy/scripts/export-geo-metrics.py](/Users/sc/PycharmProjects/partsignal/deploy/scripts/export-geo-metrics.py) | added | +48 / -0 |
| [docs/geo-monitoring/03-technical/07-testing-and-quality.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/07-testing-and-quality.md) | modified | +11 / -0 |
| [docs/geo-monitoring/03-technical/08-deployment-and-operations.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/08-deployment-and-operations.md) | modified | +22 / -2 |
| [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml) | modified | +3 / -1 |
| [docs/geo-monitoring/CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md) | modified | +9 / -0 |
| [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md) | modified | +8 / -0 |
| [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS) | modified | +5 / -5 |

另新增/更新 `.trellis/tasks/10-05-geo-902-observability/` Task Brief、design、research、implement、independent-review、context jsonl、task metadata及证据；审计Bundle在用户级audits目录。
task.json已启动并转为review，会话级active-task指向902（task.py current确认）；未创建全局.current-task标记或更改其他任务内容。
