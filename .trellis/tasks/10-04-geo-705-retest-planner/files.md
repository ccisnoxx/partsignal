# GEO-705 修改文件
依据实际写入与起点备份登记；既有GEO大工作树保持，未提交/未创建PR。
## 本任务新增
- `backend/app/schemas/geo_retests.py`
- `backend/app/models/geo_retests.py`
- `backend/app/services/geo_retest_baselines.py`
- `backend/app/services/geo_retest_comparability.py`
- `backend/app/services/geo_retests.py`
- `backend/app/routers/geo_retests.py`
- `backend/alembic/versions/0061_geo_retests.py`
- `backend/alembic/sql/0061_geo_retests.sql`
- `backend/tests/integration/geo_retests_support.py`
- `backend/tests/integration/test_geo_retests.py`
- `backend/tests/integration/test_geo_retest_migration.py`

## 集成与合同修改
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `backend/app/audit_types.py`
- `backend/app/services/identity.py`
- `backend/app/services/geo_plan_locks.py`
- `backend/app/services/geo_surface_locks.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `backend/tests/unit/test_geo_opportunity_policy.py`
- `backend/tests/integration/test_migrations.py`
- `backend/tests/integration/test_geo_admission_migration.py`
- `backend/tests/integration/test_geo_answer_migration.py`
- `backend/tests/integration/test_geo_opportunity_action_migration.py`
- `contracts/openapi.yaml`
- `contracts/database.md`
- `frontend/src/shared/api/generated/schema.d.ts`
- `docs/geo-monitoring/README.md`
- `docs/geo-monitoring/CHANGELOG.md`
- `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
- `docs/geo-monitoring/03-technical/02-data-architecture.md`
- `docs/geo-monitoring/03-technical/03-api-contract-design.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/SHA256SUMS`

## Trellis
本任务prd/design/implement/task.json与evidence；当前Trellis会话指针在.trellis/.runtime/sessions/下，由task.py current --json确认指向本任务，状态review。未使用旧版全局.current-task。
