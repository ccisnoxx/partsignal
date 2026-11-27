# GEO-706 修改文件清单

仅列出相对于本任务开始时hash的维护源码、测试、根合同和稳定文档差异；任务记录与命令日志另列。初始其他GEO脏修改不归入706。

## 后端

- [backend/alembic/sql/0062_geo_opportunity_decisions.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0062_geo_opportunity_decisions.sql)
- [backend/alembic/versions/0062_geo_opportunity_decisions.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0062_geo_opportunity_decisions.py)
- [backend/app/audit_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/audit_types.py)
- [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py)
- [backend/app/models/geo_opportunity_decisions.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_opportunity_decisions.py)
- [backend/app/routers/geo_retests.py](/Users/sc/PycharmProjects/partsignal/backend/app/routers/geo_retests.py)
- [backend/app/schemas/geo_opportunity_workbench.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_opportunity_workbench.py)
- [backend/app/schemas/geo_retest_comparisons.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_retest_comparisons.py)
- [backend/app/services/geo_claim_signatures.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_claim_signatures.py)
- [backend/app/services/geo_opportunity_decisions.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_decisions.py)
- [backend/app/services/geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_policy.py)
- [backend/app/services/geo_opportunity_rules.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_rules.py)
- [backend/app/services/geo_overview_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_overview_queries.py)
- [backend/app/services/geo_retest_comparison_inputs.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_retest_comparison_inputs.py)
- [backend/app/services/geo_retest_comparison_metrics.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_retest_comparison_metrics.py)
- [backend/app/services/geo_retest_comparisons.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_retest_comparisons.py)
- [backend/app/services/geo_retest_recovery.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_retest_recovery.py)
- [backend/app/services/identity.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/identity.py)
- [backend/tests/integration/geo_comparisons_support.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/geo_comparisons_support.py)
- [backend/tests/integration/test_geo_admission_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py)
- [backend/tests/integration/test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py)
- [backend/tests/integration/test_geo_decision_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_decision_migration.py)
- [backend/tests/integration/test_geo_retest_comparisons.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_retest_comparisons.py)
- [backend/tests/integration/test_geo_retest_history.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_retest_history.py)
- [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py)
- [backend/tests/unit/test_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_contract.py)
- [backend/tests/unit/test_geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_policy.py)
- [backend/tests/unit/test_geo_opportunity_workbench.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_workbench.py)
- [backend/tests/unit/test_geo_retest_recovery.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_retest_recovery.py)
- [backend/tests/unit/test_runtime_response_metadata.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_runtime_response_metadata.py)

## 根合同

- [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)
- [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml)

## 前端

- [frontend/src/domains/audit/audit.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.test.ts)
- [frontend/src/domains/audit/audit.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.ts)
- [frontend/src/domains/geo-opportunities/comparison.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/comparison.model.ts)
- [frontend/src/domains/geo-opportunities/opportunities-page.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities-page.test.tsx)
- [frontend/src/domains/geo-opportunities/opportunities-page.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities-page.tsx)
- [frontend/src/domains/geo-opportunities/opportunities.api.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.api.test.ts)
- [frontend/src/domains/geo-opportunities/opportunities.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.api.ts)
- [frontend/src/domains/geo-opportunities/opportunities.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.model.test.ts)
- [frontend/src/domains/geo-opportunities/opportunities.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.model.ts)
- [frontend/src/domains/geo-opportunities/opportunities.test-support.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.test-support.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-commands.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-commands.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-comparison.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-comparison.test.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-comparison.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-comparison.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-decisions.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-decisions.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-detail.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-detail.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-filters.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-filters.tsx)
- [frontend/src/domains/geo-opportunities/opportunity-list.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-list.tsx)
- [frontend/src/routes/_app/geo/opportunities.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/geo/opportunities.tsx)
- [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts)
- [frontend/tests/e2e/geo-comparison-real-stack.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/geo-comparison-real-stack.spec.ts)

## 稳定文档

- [docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md)
- [docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md)
- [docs/geo-monitoring/03-technical/02-data-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/02-data-architecture.md)
- [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md)
- [docs/geo-monitoring/03-technical/04-frontend-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/04-frontend-architecture.md)
- [docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md)
- [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [docs/geo-monitoring/CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md)
- [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md)

- [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)

## Trellis与证据

- [prd.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/prd.md)
- [design.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/design.md)
- [implement.md](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/implement.md)
- [task.json](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/task.json)
- [implement.jsonl](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/implement.jsonl)
- [check.jsonl](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/check.jsonl)

- [实际命令和日志](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/evidence)
- [真实页面截图](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/evidence/geo706-history.png)
- [校验通过的子代理执行摘要](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/evidence/SUBAGENT_EXECUTION_DIGEST.md)

SHA256SUMS仅重算本任务涉及的9项GEO文档；其余索引项保持。核心PRD既有checksum差异及范围验证结果见 [documentation-sha-scope.json](/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-04-geo-706-retest-comparison/evidence/documentation-sha-scope.json)。
