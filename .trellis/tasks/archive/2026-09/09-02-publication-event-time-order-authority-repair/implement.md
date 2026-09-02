# Publication 事件时间顺序 Authority 修复实施计划

> 当前阶段：`in_progress`。用户已批准并已运行 `task.py start`；候选实现、required validation 与额外批准的最终只读 re-review 均已通过，当前等待独立提交计划确认。

## Scope

一个可 review 目标：把 `PublicationWorkEvent.created_at` 的候选时钟统一到 Work 锁后的 PostgreSQL 实时时钟，并用现有真实双 Session sentinel 冻结严格顺序。产品/测试/稳定规范 touch set 精确为 3 个文件：

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

## Step 1：启动与基线复核

- [x] 用户批准本规划后，只对本 Task 运行 `task.py start`；确认 Wave 3 仍为 `in_progress`。
- [x] 运行 `trellis-before-dev`，重新完整读取本 Task 三份文档、manifests、research 与相关 backend specs。
- [x] 确认 `main` 与启动 HEAD；记录完整 `git status`。
- [x] 确认三个目标文件无任务外重叠修改。
- [x] 重新核对受保护基线：543 个 staged artifact deletions、`.gitignore`、`configuration.py`、Wave 3 四个候选文件/Task 目录和并行 Task 均不动。
- [x] 用只读 SQLAlchemy probe 确认 `clock_timestamp()` 返回 timezone-aware `datetime`；不写数据。

## Step 2：先冻结测试意图

- [x] 保留现有失败 sentinel 的事务起点比较，不删除、不放宽、不以 HTTP-only 断言替代。
- [x] 在同一 test 中增加 `CONTENT_VERSION_CHANGED.created_at > RESULT_REGISTERED.created_at` 的直接断言。
- [x] 修正前只运行该 targeted sentinel 一次，确认仍在既有时间断言失败；失败位置与 Wave 3 记录一致。

## Step 3：修正唯一 writer

- [x] 在 `_work_event` 的 `latest_created_at` 查询后从当前 PostgreSQL Session 读取 `clock_timestamp()`。
- [x] 保留 `latest_created_at + timedelta(microseconds=1)` 下限。
- [x] 不修改 helper signature、调用者、Work 锁、flush/commit、model default 或 reader 排序。
- [x] 不增加 Python/`now()` fallback、第二 helper、sequence、migration 或兼容逻辑。
- [x] 完成 touched-scope 中文文档检查；只更新解释时钟 authority 的非显然注释/docstring。

## Step 4：Targeted re-check

- [x] 目标双 Session + HTTP sentinel 通过，并补充禁止应用时钟访问的确定性 guard。
- [x] 检查时间链严格为 `switch transaction start < RESULT_REGISTERED < CONTENT_VERSION_CHANGED`。
- [x] 检查 HTTP 仍为既有 `409 INVALID_STATE_TRANSITION`，并且拒绝路径零副作用。
- [x] 首轮 Review 后完成唯一一次定向 repair 与 targeted re-check；定向 re-review 发现新的 `MEDIUM` 后按规则停止。

## Step 5：稳定规范与正式门禁

- [x] 在 publication spec 最小记录数据库时钟 authority；不重复业务状态机文本。
- [x] 目标 sentinel 通过后，正式完整 Publication workflow gate只运行一次：当时为 `19 passed`；后续新增 lower-bound sentinel 后按一次性 formal gate规则未重跑全文件。
- [x] Workbench latest-action sentinel、ruff、生产 service mypy、diff hygiene、合同无 diff 与 Trellis validate 通过。
- [x] 独立只读 Review 通过：首轮问题、定向 re-review 的 `+1s` 慢 CI 窗口均已在用户额外批准的一轮中关闭，最终 affected-path re-review 无 `MEDIUM+`。
- [x] Review 预算严格执行；额外轮次仅把 future-history 窗口改为 `+1 day`，没有扩大生产或测试 scope。

## Required Validation

开发期 targeted：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_publication_verification_final_authority_rejects_awaiting_switch_over_http
```

候选完成后的正式 gate：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_workbench.py::test_workbench_projects_counts_rates_current_tails_and_safe_attention

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/publication.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/services/publication.py

git diff --check

git diff --exit-code -- \
  contracts/openapi.yaml \
  contracts/database.md \
  frontend/src/shared/api/generated/schema.d.ts \
  backend/alembic

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-02-publication-event-time-order-authority-repair
```

## Optional Full-suite Validation

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests
```

完整 backend suite 在 required Publication/Workbench gates 已覆盖共享 writer 与关键 reader 后仍为 optional；若 required 失败证据指向跨模块影响，再回到规划决定是否升级。

## Wave 3 恢复验证（不属于本 Task 实施 gate）

本 Task 完成并归档后，返回 `09-02-runtime-response-metadata-wave-3`，重新运行其既定 required validation，至少包括原 4 个 PostgreSQL sentinels、Wave 1/2/3 comparator 投影与无 filter 全局 response report。只有 Wave 3 自己的门禁通过后，才可完成 Wave 3；本 Task 不替它提交或归档。

## Independent Review Checklist

- `_work_event` 仍是唯一生产 writer，所有后续事件调用者均在 Work 锁序列内。
- 候选时钟只来自锁后的 `clock_timestamp()`；无事务级 `now()`、应用时钟或 fallback。
- `+1µs` 下限仍保证严格单调，reader 排序未改变。
- 测试同时冻结跨事务起点和直接 event-to-event 顺序，没有 sleep 驱动或断言弱化。
- 权限、状态、revision、事务、error mapping、HTTP 合同和拒绝零副作用保持。
- diff 仅包含批准的 service、integration test、spec 和本 Task artifacts。

## Commit / Archive Boundary

正式 commit 前另行向用户呈现精确 commit plan 并取得确认。批准后使用 `git commit --only -- <精确路径>`，只包含：

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `.trellis/spec/backend/publication-workbench-guidelines.md`
- `.trellis/tasks/09-02-publication-event-time-order-authority-repair/`

不得使用宽泛 `git add .` 或普通 `git commit -a`。已有 543 个 staged artifact deletions 保持 staged 但不进入本 Task commit；Wave 3 四个候选文件与其 Task 目录不得进入本 Task commit。完成后再按 Trellis finish/archive 流程产生独立 bookkeeping commit；如需 journal，则单独 commit。全部不 push。

## Rollback Boundary

回滚只撤销 `_work_event` 的局部时间源、该 test 的直接顺序断言和 spec authority 说明。无需 migration、数据回填或生产数据写入。若需改变 schema、reader 排序、状态机或公共合同，停止当前 Task 并重新规划。
