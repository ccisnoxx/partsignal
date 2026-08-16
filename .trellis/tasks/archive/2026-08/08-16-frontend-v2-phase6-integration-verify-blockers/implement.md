# Frontend V2 Phase 6 integration verify blocker 实施计划

## Status

`in_progress`。用户已批准规划；Task 已在唯一授权分支 `codex/frontend-v2-phase6-integration-verify-blockers` 启动。

## 0. Start gate after approval

1. 重新确认 `main`、Task、branch/worktree 和 dirty state；不因 ahead `origin/main` pull 或 push。
2. 创建并切换到唯一临时分支 `codex/frontend-v2-phase6-integration-verify-blockers`，不创建额外 worktree。
3. 使用 `trellis-before-dev` 复核本 Task 三份规划与 backend database/quality specs。
4. 运行 `task.py start`，Task 从 `planning` 进入 `in_progress`。

## 1. Minimum implementation

### 1.1 GEO fixture

- [x] 在 `test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count` 的 coverage item 中加入完整 `optimization_action`。
- [x] 字段和值与 production action、item 和外层 source 一致。
- [x] 保留当前 compact Detail response 断言；不修改 production/schema/API。

### 1.2 Migration head expectations

- [x] 把 fresh migration test 在升级成功后的 current-head 期望改为 `0043_geo_platform_identity`。
- [x] 把同一 test 在受保护 downgrade 失败后的 current-head 期望同步改为 `0043_geo_platform_identity`。
- [x] 保留其它显式 `0042 -> 0043 -> 0042` migration 边界测试；不动态计算期望，不修改 migration。

## 2. Required validation

### Layer 1 — exact target tests

两个节点分别运行并记录 exit、passed/failed/skipped 与耗时：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_content_task_detail.py::test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent
```

并确认：

```bash
backend/.venv/bin/alembic -c backend/alembic.ini heads
```

必须精确只有 `0043_geo_platform_identity (head)`。

### Layer 2 — complete backend integration

```bash
make test-integration
```

上述两个 blocker 必须关闭，完整 integration 无失败后才能继续。

### Layer 3 — static, contract and diff checks

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
make contract-check
git diff --check
```

随后更新 `07`、`08` 为前置验证的实际事实；在最终门禁成功前 Gate 仍保持 `NOT_MET`。

### Layer 4 — one final-candidate gate

先只读确认本机 PostgreSQL source 可以隔离创建/删除临时数据库，Redis 使用独占非 0 logical DB 14 且为空，固定 E2E 端口和 storage owner 通过既有 preflight。不得回显 credential，也不从 `.env` 批量导出其它变量。

全部前置检查通过后，仅对最终候选运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

记录总退出码/耗时，以及 contract、lint/typecheck、backend/V1/V2 unit、integration、build、real-stack、V1/V2 E2E、Compose config 的实际 passed/failed/skipped 数量。门禁后记录 PostgreSQL temporary database、Redis keys/queue/unacked/DBSIZE、storage、process/container 和固定端口 cleanup。

完整门禁之后只允许把实际结果写入本 Task、`07`、`08` 并再运行 `git diff --check`；该证据更新不改变已验证代码候选。失败时不自动第二次运行。

## 3. Optional validation

无。计划不修改 production、frontend、migration、deploy 或 E2E owner；Required Layer 2 和最终 `make verify` 已覆盖需要的完整面。

## 3.1 Validation progress before final candidate gate

- Layer 1：Content Task Detail `1 passed / 1.60s`；fresh migration `1 passed / 2.39s`；Alembic 唯一 head 为 `0043_geo_platform_identity`。
- Layer 2：完整 backend integration `116 passed / 0 failed / 141.68s`。
- Layer 3：Ruff、mypy、contract-check、`git diff --check` 全部退出 `0`。
- integration cleanup：相关 one-off containers `0`，`partsignal_*` 临时数据库 `0`；Redis DB 14、storage 与 E2E processes 尚未使用。
- 两个 P2 已关闭，最终候选 `make verify` 尚未运行，Phase 6 Exit Gate 仍为 `NOT_MET`。

## 3.2 Final candidate result

- 唯一一次 `make verify`：`2026-08-16 12:52:51 +0800` 至 `12:57:37 +0800`，退出码 `2`，约 `286s`。
- 通过：合同、lint/typecheck、backend unit `193`、V1 unit `205`、visual contract `24`。
- 停止：V2 unit `72 passed / 1 failed files`、`426 passed / 1 failed tests / 13.56s`；integration/build/E2E/Compose config 未运行。
- 新 P2 B-03 位于本 Task 零 diff 的 `fact-workspace-page.test.tsx:197`，是 revision conflict 用例对 CodeMirror rendered DOM `textContent` 的时序断言漂移；只归因，不重跑、不扩围修复。
- cleanup：Redis DB 14 `0` keys，临时 Redis/container/database/storage/process 均为 `0`，六个固定端口和 16379 全部释放。
- 最终 open P0/P1/P2 为 `0/0/1`，Phase 6 Exit Gate 保持 `NOT_MET`。

## 4. Gate decision

- 目标测试、完整 integration、静态/合同检查和唯一最终候选门禁全部通过，cleanup 完整，open P0/P1/P2 为 `0/0/0`：更新 Engineering 和 Phase 6 Exit Gate 为 `MET`。
- 任一条件不满足：保持 `NOT_MET`，记录失败 owner 和剩余风险。

## 5. Stop conditions

- 必须修改 production、API、database schema/migration、权限、部署、依赖或 E2E orchestration 才能继续时，停止并请求新批准。
- 出现未识别 dirty file、目标 branch/worktree 冲突、PostgreSQL 不能隔离建库、Redis DB 14 非独占/非空、固定端口被外部进程占用时，不启动最终门禁。
- 最终 `make verify` 出现与本 Task 两个 owner 无因果关系的新 blocker 时，只归因和记录，不扩围、不自动重跑。

## 6. Commit and lifecycle plan

实施与 Required validation 完成后，先报告精确 diff、测试计数/耗时、cleanup 和 Gate 结论，并给出 commit plan；未经用户确认不提交。

候选收尾顺序：

1. 工作提交：`test(backend): close phase 6 integration verify blockers`，只包含两个测试修复、`07/08` 和当前 Task evidence/lifecycle metadata。
2. 说明 `task.py archive` 会移动 Task artifacts 并产生 Trellis bookkeeping diff；获得用户收尾授权后归档并用独立 `chore(task): archive frontend-v2-phase6-integration-verify-blockers` 提交。
3. 若 `trellis-finish-work` 要求 journal 更新，先说明其 bookkeeping 影响，再独立提交。
4. 不 push、不创建 PR。切回 `main` 后只执行 `git merge --ff-only codex/frontend-v2-phase6-integration-verify-blockers`。
5. 确认工作和归档提交均在 `main` 后，删除本地临时分支；remote branch 本来不存在，不执行 remote 删除。

## 7. Spec update decision

- 不修改 `.trellis/spec/`：严格 GEO source snapshot、Content Task Detail compact projection、Alembic 唯一迁移入口和 fresh database 升级到 head 已由现有 database spec 覆盖。
- B-03 尚未在独立 Task 中复现和确认最终 owner，不把未验证结论写成稳定开发规范。
- 用户已确认工作 commit plan，并授权提交、归档、fast-forward 合入 `main` 和删除临时分支；全程不 push、不创建 PR。
