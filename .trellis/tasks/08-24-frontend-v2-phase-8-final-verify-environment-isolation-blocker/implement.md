# A27 执行计划

## Phase 0 — 批准与冻结

- [x] recheck evidence 已提交，工作区回到 clean `main`。
- [x] 冻结 `HEAD=9514775eea6f916bfc4d3c04512c241b72ca30fd`，确认父 `blocker_count=2`、A27/A28 open。
- [x] 用户批准后启动 Task；未创建分支。

## Phase 1 — 构造最小环境

- [x] 用 backend 已安装的 `dotenv_values()` 读取 `.env`，只传递两条连接值。
- [x] 在内存中映射宿主地址；动态选择空闲、非 0、独占 Redis DB 7。
- [x] 子进程环境删除其他 `.env` 键，只保留 `DATABASE_URL`/`REDIS_URL`。
- [x] 只记录键名交集、DB 编号和结果，未打印 URL 或 credential。

## Phase 2 — Preflight

运行现有：

```bash
backend/.venv/bin/python deploy/scripts/e2e-environment.py preflight \
  --redis-url "$REDIS_URL" \
  --storage-port "${PARTSIGNAL_E2E_STORAGE_PORT:-19009}"
```

失败即停止；不选择已占用 DB、不终止外部进程、不创建资源。

- [x] `2026-08-24 11:47:05 +08:00` 运行一次，耗时 `<1s`，exit `0`。

## Phase 3 — Required validation

在同一显式两键子进程环境中各运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py::test_production_rejects_development_session_secret
make test-unit
```

记录起止、耗时、exit 和实际 suite 计数。不得运行 `make e2e` 或 `make verify`。

- [x] 定向 Settings unit：`11:47:05`—`11:47:06 +08:00`，耗时 `1s`，`1 passed`，exit `0`。
- [x] 根 `make test-unit`：`11:47:06`—`11:51:29 +08:00`，耗时 `262s`，exit `0`。
  - backend：`201 passed`。
  - V1 Vitest：`28 files / 205 tests passed`。
  - V1 visual contract：`24 passed`。
  - V2 Vitest：`81 files / 463 tests passed`。
  - 合计：`893 passed`。V1 的 jsdom CSS/navigation 诊断未导致失败。

## Phase 4 — Cleanup 与关闭

- [x] Redis DB 7 仍为 `dbsize=0` 且无外部客户端；六个固定端口 released。
- [x] 未创建 database/storage/services，未删除其他 owner 的资源。
- [x] 更新当前 Task result 和父 A27 metadata；A28 保持 open、Phase 8 保持 `NOT_MET`。
- [x] 运行 `git diff --check`、Task validate、`git status --short --branch`。
- [x] 报告 commit plan，等待用户批准；不自动 commit/push/PR/archive。

## 执行结论

A27=`CLOSED`。两键环境消除了 recheck shell 的 `.env` 批量导出污染；本结论只关闭环境 owner，不代表 Phase 8 Exit Gate 已重跑或满足。

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
