# Workbench Aggregate Read Model — Implement Plan

## 0. Change boundary

- Gap：当前只有 V1 五整数 DashboardSummary，无法提供 Phase 8 六类 action、health、manual GEO rate、attention identity 与 canonical href。
- Owner：新 `backend/app/services/workbench.py`；router/schema 只承担 HTTP/contract 边界。
- 必要文件：新 router/schema/service/integration test、`main.py` 注册、OpenAPI/generated types、05/ADR-046、Task evidence。
- 明确不做：V1、数据库、权限/状态机、V2 UI/E2E、缓存或通用 framework。
- 局部复用：只复用已存在的稳定 GEO tail predicate与 publication action pure helper；用 integration test 证明行为和固定 query count。

## 1. 实施顺序

1. 完整读取将修改的 backend modules、相关 models/pure action helpers、OpenAPI 当前 schema/error convention 与 integration fixture。
2. 先在 OpenAPI 和 backend schema 中定义最小 Workbench contract；不添加兼容字段/default。
3. 实现 service：冻结时间、固定 count/rate/candidate queries、批量 metadata、稳定 merge/sort、canonical href。
4. 新 router 复用现有 route dependency 的 `REPEATABLE READ` snapshot 模式与 `CurrentUser`，在 `main.py` 注册。
5. 新增 PostgreSQL integration：empty/partial/full、角色、状态边界、current tail、30 日、null rate、top 10、href、敏感 allowlist、固定 query count。
6. 生成 V1/V2 types，更新 05 与 ADR-046。
7. 按 Required Validation 顺序执行，失败先归因，不扩大范围或重复相同失败命令。
8. 全量 diff 自审；运行 Trellis check agent。完成后不自动 commit，先向用户报告结果与 commit plan。

## 2. Required Validation

```sh
make contract-check
uv run --project backend ruff check \
  backend/app/main.py \
  backend/app/routers/workbench.py \
  backend/app/schemas/workbench.py \
  backend/app/services/workbench.py \
  backend/tests/integration/test_workbench.py
uv run --project backend mypy --config-file backend/pyproject.toml backend/app
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_workbench.py
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-aggregate-read-model
git status --short --branch
```

不运行完整 unit/integration/E2E、build 或 `make verify`；该 Task 是合同/backend slice，最终仓库 gate 由 Phase 8 abstraction review 独立执行。

## 3. Optional Validation

只有定向失败指向共享 backend owner 时运行：

```sh
uv run --project backend pytest backend/tests/unit
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test
```

## 4. Stop conditions

- 需要 migration、permission contract、既有状态机或旧 Dashboard/V1 页面修改。
- 需要客户端或内部 HTTP join、Redis/cache、per-item query、通用聚合 framework。
- GEO legacy/manual 合并粒度无法从现有合同确定。
- 定向检查暴露不归因本 Task 的 P0/P1；完成安全独立诊断后批量报告。

## 5. Rollback

验证失败时保留 diff 供审查，使用 `apply_patch` 反向撤销本 Task 确切 hunks；不 reset-hard、checkout、历史改写、宽泛删除或通过放宽断言制造通过。

## 6. Validation Evidence

2026-08-23 实施与独立 check 均完成，最终候选结果：

- `make contract-check`：通过，包含 V1/V2 `api:check`。
- 定向 Ruff：通过。
- `mypy backend/app`：通过，80 个 source files。
- PostgreSQL `tests/integration/test_workbench.py`：3 passed；稀疏与密集候选均固定 7 条查询。
- `git diff --check` 与批准范围新增文件 whitespace 扫描：通过。
- `task.py validate frontend-v2-workbench-aggregate-read-model`：通过，9 条 implement context、8 条 check context。
- 完整套件、E2E、build 与 `make verify` 按本 Task 边界未运行，留给后续 UI/E2E 与 Phase 8 Exit Gate。
