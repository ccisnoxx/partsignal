# GEO-701 修改文件清单

相对本任务开始的工作树前像比较，未将前序 GEO dirty/untracked 文件计为本次新增。完整diff仍含前序未提交工作；SHA-256用于范围定位，行为验证另见implement.md。

## 后端与迁移

- modified [backend/app/audit_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/audit_types.py)
- modified [backend/app/main.py](/Users/sc/PycharmProjects/partsignal/backend/app/main.py)
- new [backend/app/routers/geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/routers/geo_rules.py)
- modified [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py)
- new [backend/app/models/geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_rules.py)
- new [backend/app/schemas/geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_rules.py)
- modified [backend/app/schemas/geo_runs.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_runs.py)
- modified [backend/app/services/geo_batches.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_batches.py)
- new [backend/app/services/geo_rule_policy.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_rule_policy.py)
- new [backend/app/services/geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_rules.py)
- modified [backend/app/services/identity.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/identity.py)
- new [backend/alembic/versions/0058_geo_rule_configuration.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0058_geo_rule_configuration.py)
- new [backend/alembic/sql/0058_geo_rule_configuration.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0058_geo_rule_configuration.sql)

## 测试

- new [backend/tests/unit/test_geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_rules.py)
- modified [backend/tests/unit/test_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_contract.py)
- modified [backend/tests/unit/test_runtime_response_metadata.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_runtime_response_metadata.py)
- new [backend/tests/integration/test_geo_rules.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_rules.py)
- new [backend/tests/integration/test_geo_rule_snapshots.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_rule_snapshots.py)
- modified [backend/tests/integration/test_geo_admission_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py)
- modified [backend/tests/integration/test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py)
- modified [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py)
- modified [backend/tests/integration/test_geo_insight_indexes.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_insight_indexes.py)
- new [frontend/tests/e2e/rules-real-stack.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/rules-real-stack.spec.ts)

## 前端

- modified [frontend/src/routeTree.gen.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/routeTree.gen.ts)
- modified [frontend/src/app/navigation.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.test.ts)
- modified [frontend/src/app/navigation.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.ts)
- new [frontend/src/domains/geo-rules/geo-rules-fields.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules-fields.tsx)
- new [frontend/src/domains/geo-rules/geo-rules.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules.api.ts)
- new [frontend/src/domains/geo-rules/geo-rules.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules.model.ts)
- new [frontend/src/domains/geo-rules/geo-rules.test-support.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules.test-support.tsx)
- new [frontend/src/domains/geo-rules/geo-rules.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules.model.test.ts)
- new [frontend/src/domains/geo-rules/geo-rules-preview.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules-preview.tsx)
- new [frontend/src/domains/geo-rules/geo-rules-page.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules-page.tsx)
- new [frontend/src/domains/geo-rules/geo-rules-page.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-rules/geo-rules-page.test.tsx)
- modified [frontend/src/domains/audit/audit.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.test.ts)
- modified [frontend/src/domains/audit/audit.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.ts)
- modified [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts)
- new [frontend/src/routes/_app/configuration/geo-rules.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/configuration/geo-rules.tsx)

## 合同与权威文档

- modified [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml)
- modified [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)
- modified [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)
- modified [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- modified [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md)
- modified [docs/geo-monitoring/01-product/02-geo-core-prd.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/01-product/02-geo-core-prd.md)
- modified [docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md)

## Trellis 与证据

- 本任务 Task Brief、design.md、implement.md、task.json、implement.jsonl、check.jsonl。
- evidence/ 保存基线、失败诊断、最终命令退出码/日志、迁移与定向反例、真实浏览器截图、范围审计及独立复核审计引用。
