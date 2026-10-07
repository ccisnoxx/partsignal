# GEO-703 文件变更边界

已有文件以任务启动快照为比较基线；Git工作区中更早的未提交GEO变更不归属于703。任务本身的Brief、设计、实施与验证证据另存同目录。

| 文件 | 703变化 |
|---|---|
| [backend/app/audit_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/audit_types.py) | 相对任务启动快照修改 |
| [backend/app/main.py](/Users/sc/PycharmProjects/partsignal/backend/app/main.py) | 相对任务启动快照修改 |
| [backend/app/routers/geo_opportunities.py](/Users/sc/PycharmProjects/partsignal/backend/app/routers/geo_opportunities.py) | 新增 |
| [backend/app/schemas/geo_opportunity_workbench.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_opportunity_workbench.py) | 新增 |
| [backend/app/services/audit_logs.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/audit_logs.py) | 相对任务启动快照修改 |
| [backend/app/services/geo_analysis_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_analysis_queries.py) | 相对任务启动快照修改 |
| [backend/app/services/geo_answer_evidence.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_answer_evidence.py) | 新增 |
| [backend/app/services/geo_opportunity_commands.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_commands.py) | 新增 |
| [backend/app/services/geo_opportunity_evidence.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_evidence.py) | 新增 |
| [backend/app/services/geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_policy.py) | 相对任务启动快照修改 |
| [backend/app/services/geo_opportunity_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_opportunity_queries.py) | 新增 |
| [backend/app/services/geo_read_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_read_queries.py) | 相对任务启动快照修改 |
| [backend/tests/geo_opportunity_e2e_seed.py](/Users/sc/PycharmProjects/partsignal/backend/tests/geo_opportunity_e2e_seed.py) | 新增 |
| [backend/tests/integration/test_geo_opportunity_workbench.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_opportunity_workbench.py) | 新增 |
| [backend/tests/unit/test_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_contract.py) | 相对任务启动快照修改 |
| [backend/tests/unit/test_geo_opportunity_policy.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_policy.py) | 相对任务启动快照修改 |
| [backend/tests/unit/test_geo_opportunity_workbench.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_opportunity_workbench.py) | 新增 |
| [backend/tests/unit/test_runtime_response_metadata.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_runtime_response_metadata.py) | 相对任务启动快照修改 |
| [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md) | 相对任务启动快照修改 |
| [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml) | 相对任务启动快照修改 |
| [deploy/scripts/e2e-local.sh](/Users/sc/PycharmProjects/partsignal/deploy/scripts/e2e-local.sh) | 仅在默认E2E列表增加703 spec；其余Git差异已存在 |
| [docs/geo-monitoring/01-product/02-geo-core-prd.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/01-product/02-geo-core-prd.md) | 相对任务启动快照修改 |
| [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md) | 相对任务启动快照修改 |
| [docs/geo-monitoring/03-technical/04-frontend-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/04-frontend-architecture.md) | 相对任务启动快照修改 |
| [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml) | 相对任务启动快照修改 |
| [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md) | 相对任务启动快照修改 |
| [frontend/src/app/navigation.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.test.ts) | 相对任务启动快照修改 |
| [frontend/src/app/navigation.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.ts) | 相对任务启动快照修改 |
| [frontend/src/domains/audit/audit.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.test.ts) | 相对任务启动快照修改 |
| [frontend/src/domains/audit/audit.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.ts) | 相对任务启动快照修改 |
| [frontend/src/domains/geo-opportunities/opportunities-page.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities-page.test.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities-page.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities-page.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities.api.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.api.test.ts) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.api.ts) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.model.test.ts) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.model.ts) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunities.test-support.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunities.test-support.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-commands.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-commands.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-controls.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-controls.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-detail.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-detail.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-evidence.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-evidence.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-filters.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-filters.tsx) | 新增 |
| [frontend/src/domains/geo-opportunities/opportunity-list.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-opportunities/opportunity-list.tsx) | 新增 |
| [frontend/src/routeTree.gen.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/routeTree.gen.ts) | 相对任务启动快照修改 |
| [frontend/src/routes/_app/geo/opportunities.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/geo/opportunities.tsx) | 新增 |
| [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts) | 相对任务启动快照修改 |
| [frontend/tests/e2e/opportunities-real-stack.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/opportunities-real-stack.spec.ts) | 新增 |
