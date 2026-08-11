# Frontend V2 Content Task Detail 历史平台 fixture — Implementation Plan

## 1. 任务分类与启动门

这是轻量、单一 backend integration fixture 修复；没有 production behavior、共享合同、数据库结构或模块边界变化，因此按用户授权不创建 `design.md`。

用户确认本规划后才执行：

1. 再次确认基线仍为 `main` commit `d6d17296395204907b0662e17a4fd1ef449253bc` 或审阅其后的相关变更，且除本 Task 规划产物外没有未知改动。
2. 运行 `python3 ./.trellis/scripts/task.py start 08-11-frontend-v2-content-task-detail-platform-fixture`。
3. 从已确认的干净 `main` 基线创建临时分支 `codex/frontend-v2-content-task-detail-platform-fixture`；不创建第二条长期开发线。
4. 读取本 Task `prd.md`、本文件、`research/failure-reproduction.md` 和相关 backend specs，再开始编辑。

## 2. 最小实施方案

仅修改 `backend/tests/integration/test_content_task_detail.py`：

1. 复用 graph 中的 `PlatformProfile`，并导入现有 `RevisionRequest`、`cancel_content_task`、`set_platform_profile_enabled`、`delete_platform_profile`。
2. 保留 repair task 来源投影断言；断言后通过 `cancel_content_task` 把该 `OPEN` 任务合法转为 `CANCELLED`，解除平台删除的真实活动任务阻断。
3. 通过 `set_platform_profile_enabled(..., enabled=False)` 停用平台，再调用 `delete_platform_profile(...)`。
4. 使 Session 重新读取数据库状态，明确断言目标 ContentTask 的 `platform_profile_id is None`，再保留原有三个 `historical_platform` snapshot fallback 断言。
5. 不提取 helper，不复制平台删除查询、审计或 Logo 生命周期，不触碰 production read model。

## 3. 预计修改文件

### 测试与条件文档

1. `backend/tests/integration/test_content_task_detail.py`
2. `docs/frontend-v2/07-migration-plan.md`（仅全部 required validation 通过后）

### Trellis 任务产物

- `.trellis/tasks/08-11-frontend-v2-content-task-detail-platform-fixture/task.json`
- `.trellis/tasks/08-11-frontend-v2-content-task-detail-platform-fixture/prd.md`
- `.trellis/tasks/08-11-frontend-v2-content-task-detail-platform-fixture/implement.md`
- `.trellis/tasks/08-11-frontend-v2-content-task-detail-platform-fixture/research/failure-reproduction.md`

若需要修改 production、合同、schema、migration、frontend、V1、Publishing、依赖或第三个代码/权威文档文件，立即停止并重新请求范围批准。

## 4. Required Validation

严格按顺序运行；integration test 使用 Docker PostgreSQL 环境，避免本机缺少 `PARTSIGNAL_TEST_DATABASE_URL` 时被跳过：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_content_task_detail.py::test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count -q

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_content_task_detail.py -q

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_workflow.py::test_platform_prompt_platform_profile_and_platform_account_deletion_lifecycle -q

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check backend
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

make verify
git diff --check
```

判据：

- targeted test 与整个 Detail 文件通过，且没有 skip。
- 既有平台删除生命周期 test 通过，证明复用服务仍满足原合同。
- backend lint/typecheck 通过。
- `make verify` 全部 targets 零失败；这是 Phase 3 gate 改判的必要条件。
- `git diff --check` 通过，最终 diff 只含批准范围。
- 任何失败先归因；同一失败只有代码、配置或环境发生预期相关变化后才重跑。

## 5. Phase 3 Gate 重判规则

### `MET`

仅当第 4 节全部命令通过：

- 在 `docs/frontend-v2/07-migration-plan.md` 的 Phase 3 当前状态中追加本 Task 的 fixture 修复和实际验证证据；
- 追加当前 Phase 3 exit gate 为 `MET`；
- 保留 `frontend-v2-content-abstraction-review` 及后续历史 Task 当时的 `NOT_MET` 原文，不改写归档结论。

### 保持 `NOT_MET`

若 `make verify` 或任一 required validation 未通过，不修改迁移文档的当前 gate。对新出现且无法归因于本 Task 的全仓失败，记录命令、失败测试和范围归因后停止，不追逐范围外修复。

## 6. 回滚点

- Git 基线：`d6d17296395204907b0662e17a4fd1ef449253bc`。
- 测试回滚：撤销 Detail test 新增的服务 imports 与取消/停用/删除调用，恢复原测试文件；不使用 `git reset --hard` 或历史改写。
- 文档回滚：若证据不再满足 `MET`，只移除本 Task 新增的当前 gate 段落，保留全部历史记录。
- 数据影响：每个 integration test 使用临时 PostgreSQL database，测试结束强制删除；无共享环境数据迁移或 production 副作用。

## 7. 停止与提交门

- 需要扩大到 production read model、数据库守卫、合同、schema、migration、frontend、V1、Publishing 或依赖时停止。
- `make verify` 出现范围外失败时记录证据并停止。
- 工作树出现未知改动时停止，不纳入本 Task。
- 完成验证后先展示 commit plan、文件清单、验证结果和 dirty 状态，等待用户确认；不 push。

## 8. 执行与验证结果

### 已实施

- Task 已启动并记录分支 `codex/frontend-v2-content-task-detail-platform-fixture`。
- `test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count` 不再直接 UPDATE `platform_profile_id`。
- repair source 断言后通过 `cancel_content_task` 合法终止 `OPEN` repair task，再通过平台停用服务和 `delete_platform_profile` 删除平台。
- 数据库真实产生目标任务 `platform_profile_id=NULL`；PlatformProfile 不存在，原 snapshot fallback 断言保持不变。
- 未修改 production、数据库守卫、合同、migration、frontend、V1、Publishing 或依赖；未新增 helper/framework。
- touched-scope 文档检查：未新增或修改注释、docstring、日志、异常或开发者可见输出；现有中文测试模块与测试 docstring 仍准确。

### Required validation 实际结果

| 检查 | 结果 |
| --- | --- |
| targeted Detail integration | `1 passed`，无 skip |
| 整个 `test_content_task_detail.py` | `2 passed` |
| 既有平台删除生命周期 integration | `1 passed` |
| backend Ruff | 通过 |
| backend mypy | 通过，`77 source files` |
| `make verify` contract / lint / typecheck | 通过 |
| `make verify` backend unit | `176 passed` |
| `make verify` V1 unit / visual contract | `203 passed` / `24 passed` |
| `make verify` V2 unit/component | `35 files / 233 tests passed` |
| `make verify` backend integration | `87 passed`，原 Detail blocker 已关闭 |
| `make verify` backend/V1/V2 build | 通过 |
| `make verify` E2E | `49 passed / 3 failed`，命令最终退出 `2` |
| `git diff --check` | 通过（记录最终停止状态后再次检查） |

### 范围外 E2E 失败与 gate 结论

用户授权使用本地 Docker PostgreSQL/Redis 后，仅导出指向 `127.0.0.1:55432` 和 `127.0.0.1:56379/15` 的 `DATABASE_URL`、`REDIS_URL` 重新执行 `make verify`。E2E 已真实启动、迁移与 seed 成功，临时数据库和对象存储也在退出时清理；最终失败为：

```text
tests/e2e/ai-channel-management.spec.ts:130
  期望审计事件 ai_model.tested 可见，5 秒内未找到
tests/e2e/cross-page-visual-convergence.spec.ts:604
  源码清单仍登记 label="AI 作业列表"，实际 ContentTasksPage 使用 label="AI 生成记录列表"
tests/e2e/mvp-flow.spec.ts:284
  删除不存在资源的状态码期望 404，实际收到 422
49 passed / 3 failed
```

三项失败均位于未改动的 frontend E2E，且分别涉及 AI 渠道审计可见性、全站表格源码清单和 MVP DELETE 行为；与唯一代码 diff `backend/tests/integration/test_content_task_detail.py` 的历史平台 fixture 无调用或数据路径关联。按任务停止规则，不重跑同一失败，不修改 frontend 或 production，不扩大范围追修。

此前两次未进入有效完整验证的尝试保留为环境诊断历史：首次未导出 `DATABASE_URL`；随后 `set -a` 误把 `.env` 的 `AI_ALLOW_LOCAL_HTTP=true` 一并导出并污染 backend Settings 单测。最终运行只导出数据库和 Redis 连接，已排除这两项环境问题。

- Phase 3 exit gate 保持 **`NOT_MET`**，因为 required `make verify` 未全绿。
- `docs/frontend-v2/07-migration-plan.md` 保持不变。
- 现有 `.trellis/spec/` 已明确规定历史平台 snapshot、服务删除路径和 Content Task Detail 覆盖要求，无需重复更新稳定规范。
