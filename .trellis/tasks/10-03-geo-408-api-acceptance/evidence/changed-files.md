# GEO-408 本任务修改文件

按任务开始时的 SHA-256 快照比较，保留前序未提交变更。Task Brief 和证据另列；本列表不将整个 Git working tree 归属本任务。

## 修改既有文件

- `.trellis/spec/infra/e2e-isolation.md`
- `Makefile`
- `deploy/scripts/e2e-environment.py`
- `deploy/scripts/e2e-local.sh`
- `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
- `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
- `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
- `docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/CHANGELOG.md`
- `docs/geo-monitoring/README.md`
- `docs/geo-monitoring/SHA256SUMS`
- `frontend/src/domains/geo-runs/batch-create.tsx`
- `frontend/src/domains/geo-runs/run-detail.test.tsx`
- `frontend/src/domains/geo-runs/run-detail.tsx`
- `frontend/src/domains/geo-runs/runs-page.test.tsx`
- `frontend/src/domains/geo-runs/runs-page.tsx`
- `frontend/src/domains/geo-runs/runs.api.test.ts`
- `frontend/src/domains/geo-runs/runs.api.ts`
- `frontend/src/domains/geo-runs/runs.model.ts`
- `frontend/tests/e2e/geo-real-stack.spec.ts`

## 新增文件

- `backend/tests/geo_e2e_environment.py`
- `backend/tests/geo_e2e_fixture.py`
- `backend/tests/geo_e2e_provider.py`
- `backend/tests/geo_e2e_runtime.py`
- `backend/tests/unit/test_geo_e2e_runtime.py`
- `deploy/scripts/e2e-geo.sh`
- `docs/geo-monitoring/04-delivery/08-r3-api-acceptance.md`
- `frontend/src/domains/geo-runs/run-retry-command.ts`
- `frontend/src/domains/geo-runs/run-retry.test.tsx`
- `frontend/src/domains/geo-runs/run-retry.tsx`
- `frontend/tests/e2e/geo-api-real-stack.spec.ts`
- `frontend/tests/e2e/geo-api-support.ts`

## Trellis 任务记录

- `.trellis/tasks/10-03-geo-408-api-acceptance/task.json`
- `.trellis/tasks/10-03-geo-408-api-acceptance/prd.md`
- `.trellis/tasks/10-03-geo-408-api-acceptance/design.md`
- `.trellis/tasks/10-03-geo-408-api-acceptance/implement.md`
- `.trellis/tasks/10-03-geo-408-api-acceptance/implement.jsonl`
- `.trellis/tasks/10-03-geo-408-api-acceptance/check.jsonl`
- `.trellis/tasks/10-03-geo-408-api-acceptance/evidence/`：开始快照、候选增量、实际命令日志、隔离栈、截图及 validated 子代理审计。
