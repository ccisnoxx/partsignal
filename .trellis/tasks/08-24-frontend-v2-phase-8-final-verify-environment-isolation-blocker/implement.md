# A27 执行计划

## Phase 0 — 批准与冻结

- 等待 recheck evidence 提交/合入，回到 clean `main`。
- 冻结 `HEAD`，确认父 `blocker_count=2`、A27/A28 open。
- 用户批准后才运行 `task.py start`；分支策略另按用户授权执行。

## Phase 1 — 构造最小环境

- 用 backend 已安装的 `dotenv_values()` 只读取 `.env` 两条连接值。
- 在内存中映射宿主地址；动态选择空闲、非 0、独占 Redis DB。
- 子进程环境删除其他 `.env` 键，只保留 `DATABASE_URL`/`REDIS_URL`。
- 只记录键名交集、DB 编号和 `PASS/FAIL`，不得打印值。

## Phase 2 — Preflight

运行现有：

```bash
backend/.venv/bin/python deploy/scripts/e2e-environment.py preflight \
  --redis-url "$REDIS_URL" \
  --storage-port "${PARTSIGNAL_E2E_STORAGE_PORT:-19009}"
```

失败即停止；不选择已占用 DB、不终止外部进程、不创建资源。

## Phase 3 — Required validation

在同一显式两键子进程环境中各运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py::test_production_rejects_development_session_secret
make test-unit
```

记录起止、耗时、exit 和实际 suite 计数。不得运行 `make e2e` 或 `make verify`。

## Phase 4 — Cleanup 与关闭

- 确认 Redis 仍为空、六个固定端口 released；本 Task 不应创建 database/storage/services。
- 更新当前 Task result 和父 A27 metadata；A28 保持 open、Phase 8 保持 `NOT_MET`。
- 运行 `git diff --check`、Task validate、`git status --short --branch`。
- 报告 commit plan，等待用户批准；不自动 commit/push/PR/archive。

## Stop Conditions

- 不是 clean frozen `main`，或存在未识别 dirty 文件。
- 环境交集多于两键、URL/credential 回显、Redis/端口有未知 owner。
- 任一 validation 非零且没有相关环境变化支持重跑。
- 需要修改仓库脚本、配置、代码或测试。

## 建议 Commit 范围

`docs(trellis): close phase 8 final verify environment blocker`

- 当前 A27 Task artifacts
- Phase 8 父 Task A27 metadata
- 不含产品/测试/config/runner、A28 或 `07/08`
