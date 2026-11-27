# GEO-702 修改文件清单

按任务开始时的路径 SHA 和实际所有权核对，既有未提交工作未计入702；原始测试输出与审计在本任务 evidence 目录。

## 既有文件修改

- [.trellis/tasks/10-04-geo-702-opportunity-evaluation/prd.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/prd.md)
- [.trellis/tasks/10-04-geo-702-opportunity-evaluation/task.json](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/task.json)
- [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py)
- [backend/app/models/geo_runs.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_runs.py)
- [backend/app/services/geo_catalog_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_catalog_queries.py)
- [backend/app/services/identity.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/identity.py)
- [backend/tests/integration/test_geo_admission_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py)
- [backend/tests/integration/test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py)
- [backend/tests/integration/test_geo_run_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_run_migration.py)
- [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py)
- [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)
- [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml)
- [docs/geo-monitoring/03-technical/02-data-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/02-data-architecture.md)
- [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md)
- [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [docs/geo-monitoring/CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md)
- [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md)
- [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)
- [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts)

## 新增实现与测试

- [backend/alembic/sql/0059_geo_opportunities.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0059_geo_opportunities.sql)
- [backend/alembic/versions/0059_geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0059_geo_opportunities.py)
- [backend/app/models/geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_opportunities.py)
- [backend/app/schemas/geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_opportunities.py)
- [backend/app/services/geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunities.py)
- [backend/app/services/geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_policy.py)
- [backend/app/services/geo_opportunity_quality_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_quality_rules.py)
- [backend/app/services/geo_opportunity_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_rules.py)
- [backend/app/services/geo_opportunity_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_types.py)
- [backend/tests/integration/test_geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_opportunities.py)
- [backend/tests/integration/test_geo_opportunity_baseline.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_opportunity_baseline.py)
- [backend/tests/integration/test_geo_opportunity_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_opportunity_migration.py)
- [backend/tests/integration/test_geo_opportunity_migration_stop.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_opportunity_migration_stop.py)
- [backend/tests/unit/test_geo_opportunity_baseline.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_baseline.py)
- [backend/tests/unit/test_geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_policy.py)
- [backend/tests/unit/test_geo_opportunity_rules.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_rules.py)

## 新增设计与实施记录

- [.trellis/tasks/10-04-geo-702-opportunity-evaluation/design.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/design.md)
- [.trellis/tasks/10-04-geo-702-opportunity-evaluation/implement.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/implement.md)

## 验证证据

- [完整实施、命令结果和限制](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/implement.md)
- [最终范围与状态核对](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/evidence/final-audit.json)
- [独立复核](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/evidence/independent-review.md)
- [子代理执行摘要](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-702-opportunity-evaluation/evidence/SUBAGENT_EXECUTION_DIGEST.md)
