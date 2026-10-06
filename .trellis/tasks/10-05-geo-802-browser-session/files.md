# GEO-802 修改文件

本表相对进入任务时的 baseline-sha256.json；不把既有未提交 GEO 文件当作本任务新增。Task Brief/设计/实现/证据另保存在当前 Trellis task 目录。

| 类型 | 文件 |
|---|---|
| 修改 | [.env.example](/Users/sc/PycharmProjects/partsignal/.env.example) |
| 修改 | [.env.production.example](/Users/sc/PycharmProjects/partsignal/.env.production.example) |
| 新增 | [backend/alembic/sql/0063_geo_browser_sessions.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0063_geo_browser_sessions.sql) |
| 新增 | [backend/alembic/versions/0063_geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0063_geo_browser_sessions.py) |
| 修改 | [backend/app/audit_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/audit_types.py) |
| 修改 | [backend/app/collectors/registry.py](/Users/sc/PycharmProjects/partsignal/backend/app/collectors/registry.py) |
| 修改 | [backend/app/config.py](/Users/sc/PycharmProjects/partsignal/backend/app/config.py) |
| 修改 | [backend/app/main.py](/Users/sc/PycharmProjects/partsignal/backend/app/main.py) |
| 修改 | [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py) |
| 新增 | [backend/app/models/geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_browser_sessions.py) |
| 修改 | [backend/app/models/geo_surfaces.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_surfaces.py) |
| 新增 | [backend/app/routers/geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/app/routers/geo_browser_sessions.py) |
| 新增 | [backend/app/schemas/geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_browser_sessions.py) |
| 新增 | [backend/app/services/geo_browser_session_vault.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_browser_session_vault.py) |
| 新增 | [backend/app/services/geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_browser_sessions.py) |
| 新增 | [backend/app/services/geo_browser_storage_state.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_browser_storage_state.py) |
| 修改 | [backend/app/services/geo_surface_commands.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_commands.py) |
| 修改 | [backend/app/services/geo_surface_projections.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_projections.py) |
| 修改 | [backend/app/services/geo_surface_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_queries.py) |
| 修改 | [backend/app/services/identity.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/identity.py) |
| 修改 | [backend/tests/integration/test_geo_admission_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_admission_migration.py) |
| 修改 | [backend/tests/integration/test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py) |
| 新增 | [backend/tests/integration/test_geo_browser_session_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_browser_session_migration.py) |
| 新增 | [backend/tests/integration/test_geo_browser_sessions.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_browser_sessions.py) |
| 修改 | [backend/tests/integration/test_geo_decision_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_decision_migration.py) |
| 修改 | [backend/tests/integration/test_geo_monitoring_plans.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_monitoring_plans.py) |
| 修改 | [backend/tests/integration/test_geo_profile_test_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_profile_test_migration.py) |
| 修改 | [backend/tests/integration/test_geo_surfaces_profiles.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_surfaces_profiles.py) |
| 修改 | [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py) |
| 修改 | [backend/tests/unit/test_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_contract.py) |
| 新增 | [backend/tests/unit/test_geo_browser_session_vault.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_browser_session_vault.py) |
| 新增 | [backend/tests/unit/test_geo_browser_storage_state.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_browser_storage_state.py) |
| 修改 | [backend/tests/unit/test_geo_collector_registry.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_collector_registry.py) |
| 修改 | [backend/tests/unit/test_runtime_response_metadata.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_runtime_response_metadata.py) |
| 新增 | [browser-collector/src/session.mjs](/Users/sc/PycharmProjects/partsignal/browser-collector/src/session.mjs) |
| 新增 | [browser-collector/tests/session.test.mjs](/Users/sc/PycharmProjects/partsignal/browser-collector/tests/session.test.mjs) |
| 修改 | [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md) |
| 修改 | [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml) |
| 新增 | [deploy/compose.geo-browser-sessions.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.geo-browser-sessions.yaml) |
| 修改 | [deploy/scripts/e2e-local.sh](/Users/sc/PycharmProjects/partsignal/deploy/scripts/e2e-local.sh) |
| 修改 | [docs/geo-monitoring/03-technical/06-security-and-compliance.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/06-security-and-compliance.md) |
| 修改 | [docs/geo-monitoring/03-technical/08-deployment-and-operations.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/08-deployment-and-operations.md) |
| 修改 | [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml) |
| 修改 | [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS) |
| 修改 | [frontend/src/domains/audit/audit.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.ts) |
| 新增 | [frontend/src/domains/geo-catalog/browser-session-panel.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/browser-session-panel.tsx) |
| 新增 | [frontend/src/domains/geo-catalog/browser-session.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/browser-session.api.ts) |
| 新增 | [frontend/src/domains/geo-catalog/browser-session.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/browser-session.test.tsx) |
| 修改 | [frontend/src/domains/geo-catalog/surfaces-detail.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/surfaces-detail.tsx) |
| 修改 | [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts) |
| 新增 | [frontend/tests/e2e/browser-session-real-stack.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/browser-session-real-stack.spec.ts) |
