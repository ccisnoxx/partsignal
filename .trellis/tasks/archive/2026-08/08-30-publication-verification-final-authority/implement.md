# 发布核验最终权威实施计划

## Scope

只修正发布工作动作投影与verification command最终守卫，并补定向测试和稳定规范。一个可review目标：换版后未经重新登记不能核验。

## Step 1：实施前重读

- [x] 完整读取 `backend/app/services/publication_queries.py` 中动作投影、Work presenter和latest event排序。
- [x] 完整读取 `backend/app/services/publication.py` 中 `_work_event`、`_lock_work`、switch、register-result、verify及提交边界。
- [x] 读取现有unit/integration测试的fixture、CSRF与temporary PostgreSQL模式。
- [x] 确认开始实施时目标文件没有未识别用户改动；如有重叠，停止并报告。

## Step 2：修正read projection owner

- [x] 在 `publication_work_actions` 的既有事件分支同时覆盖 `AWAITING_VERIFICATION` 与 `ACTION_REQUIRED`。
- [x] 保留其他status/event的完整动作集合和primary task。
- [x] 扩展unit matrix，先证明修正前失败、修正后通过。

## Step 3：增加command最终守卫

- [x] `_work_event` 在 Work 锁顺序内维持严格单调 `created_at`，不再让事务起始时间决定最新事件。
- [x] `verify_publication_work` 在 `_lock_work` 后按现有排序读取最新event。
- [x] 缺event返回 `PUBLICATION_CONTEXT_INCOMPLETE`。
- [x] 复用 `publication_work_actions` 判断 `VERIFY`；不含时返回 `INVALID_STATE_TRANSITION`，且发生在任何业务写入前。
- [x] 不清空结果字段、不修改switch/register-result合同、不新增helper层或兼容逻辑。

## Step 4：PostgreSQL与HTTP回归

- [x] 在现有ACTION_REQUIRED换版闭环中插入直接核验负向断言及零副作用快照，然后继续重新登记/成功核验。
- [x] 增加AWAITING_VERIFICATION换版场景，覆盖read projection与service command拒绝。
- [x] 用双 Session 覆盖“换版事务先开始、结果登记先提交”，证明最新事件仍为 `CONTENT_VERSION_CHANGED`。
- [x] 至少一个场景经TestClient、真实route、CSRF和temporary PostgreSQL返回409 ErrorEnvelope。
- [x] 回归RESULT_REGISTERED恢复VERIFY、VERIFICATION_FAILED允许继续复核、PASSED原子完成。

## Step 5：稳定规范

- [x] 最小更新 `.trellis/spec/backend/publication-workbench-guidelines.md`，明确两种换版前状态共享barrier。
- [x] 不修改OpenAPI、database contract、generated client或migration；若实现证明公共合同必须变化，退回规划。

## Required Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_workflow.py \
  -k 'failed_verification or verification_final_authority'

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/publication.py \
  backend/app/services/publication_queries.py \
  backend/tests/unit/test_security_and_publication.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

make contract-check

git diff --exit-code -- \
  contracts/openapi.yaml \
  contracts/database.md \
  frontend/src/shared/api/generated/schema.d.ts \
  backend/alembic
```

## Optional Validation

- Backend完整Publication integration文件：已因共享 `_work_event` 修正提升为必需回归并通过。
- Frontend Vitest/Playwright：本 Task不修改前端合同或代码，现有typed action消费无需作为必需门禁；若read projection改动导致现有frontend test失败，再按失败归因决定是否回到规划。

## Review / Rollback Gate

- [x] diff只包含两个Publication service owner、两个定向测试文件、稳定spec和Task文档。
- [x] 检查没有第二套event/status eligibility、silent fallback、自动重放、结果字段清空或无关重构。
- [x] PostgreSQL测试证明拒绝零副作用，HTTP测试证明前端无法绕过。
- [x] 所有Required Validation通过后才进入commit计划；提交前按项目规则向用户呈现commit范围并等待确认。
- [x] 未发生需回退的实现失败；现有无关工作区内容保持未动。
