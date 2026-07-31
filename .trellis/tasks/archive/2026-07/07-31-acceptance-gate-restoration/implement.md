# 验收门禁恢复：执行计划

## 1. 实施顺序

- [x] 更新生成可靠性 Prompt 夹具，运行 7 个原失败用例。
- [x] 修正迁移旧模型与 head 断言，运行 2 个原失败用例。
- [x] 运行完整 `make test-integration`。
- [x] 修复 24 表特殊 Modal 的关闭与等待条件，定向运行该用例。
- [x] 将 Trusted Types 用例迁移到无 Vite preamble 的生产构建壳层，运行三浏览器项目。
- [x] 更新 Prompt DELETE 路径和错误结构断言。
- [x] 同步管理员 403 预期。
- [x] 核对并更新 Prompt 视觉基线。
- [x] 将 GEO E2E 断言同步为发现率、提及率、准确率 3 项。
- [x] 修改 `docs/GEO多平台内容运营系统方案设计.md` 中当前洞察指标、工作台、排行和运营验证的旧 5 项描述，同时保留原始推荐/引用事实与 `legacy_*` 历史边界。
- [x] 收敛 E2E run 对象所有权、teardown 和清理失败报告。
- [x] 执行相关 E2E 组合，确认只剩独立产品修复任务拥有的真实失败。

## 2. 必需验证

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest -q tests/integration/test_generation_reliability.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest -q tests/integration/test_migrations.py

make test-integration

npm --prefix frontend run e2e -- \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  tests/e2e/trusted-types.spec.ts \
  tests/e2e/mvp-flow.spec.ts \
  tests/e2e/ai-channel-management.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts

make lint
make typecheck
```

E2E 需要按项目脚本提供真实 PostgreSQL、Redis、API、对象存储和浏览器；仅启动服务不算通过。

## 3. 可选完整验证

产品修复任务尚未完成时，完整 `make e2e` 允许继续在打印/200% zoom 已知产品缺陷处失败，但不得再出现本任务负责的假失败。两个修复任务都完成后再要求：

```bash
make e2e
make build
```

## 4. 重点文件

- `backend/tests/integration/test_generation_reliability.py`
- `backend/tests/integration/test_migrations.py`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- `frontend/tests/e2e/trusted-types.spec.ts`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `frontend/tests/e2e/ai-channel-management.spec.ts`
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`
- `frontend/tests/e2e/shared-data.setup.ts`
- Prompt 视觉基线
- `docs/GEO多平台内容运营系统方案设计.md`
- `contracts/openapi.yaml`、`backend/app/schemas/geo_files.py`、`backend/app/services/geo_observation.py`（只作为 3 项口径核对依据，非默认修改目标）

## 5. 退出门禁

- [x] 所有测试修改都能指向父任务中的确认根因。
- [x] 没有跳过、放宽断言、固定成功或新增旧字段兼容。
- [x] 没有产品业务代码改动；如有，已返回规划重新评审。
- [x] 清理只作用于本次 run 拥有的对象。
- [x] `git diff --check` 通过。
- [x] 先展示验证结果和提交计划，得到用户确认后再提交；不自动推送。
