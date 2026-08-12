# Implement — Publication Work Reference Filter Unit Contract Correction

> 当前状态：批准的 test-only 修复与 required validation 已完成；Task 保持 `in_progress`，尚未提交、合并、push、归档或重跑 Phase 4 完整门禁。

## Phase 0 — Approval and baseline

- [x] 用户批准当前 `prd.md` / `implement.md` 并明确授权激活实施。
- [x] 确认本地最新 `main` 为 `9d6a73d3e90394a2faf0a167ebba144571eb88a5`，相对 `origin/main` behind 0；除当前 Task artifacts 外没有未识别改动。
- [x] 按用户明确要求从该基线创建并绑定 `codex/frontend-v2-publication-work-reference-filter-unit-contract-correction`，随后运行 `task.py start`。
- [x] 重新读取当前 Task 文档、backend publication workbench spec、目标测试与两个生产查询函数。

## Phase 1 — Single test correction

- [x] 只修改 `backend/tests/unit/test_workflow_projections.py`：导入 SQLAlchemy `Select`、`PublicationWork` 与现有 `NONTERMINAL_WORK_STATUSES`。
- [x] 保留 `QueryCaptureSession`、platform reference 调用、default 调用及 row statement 索引 1，不改成 count statement。
- [x] 将 reference 完整 SELECT 字符串断言替换为：取得公开 `whereclause`、断言非空、结构精确等于 `PublicationWork.platform_account_id == account_id`。
- [x] 将 default 完整 SELECT 字符串断言替换为：取得公开 `whereclause`、断言非空、结构精确等于 `PublicationWork.status.in_(NONTERMINAL_WORK_STATUSES)`。
- [x] 未新增 helper、参数化框架、SQL 编译/解析、正则或 snapshot；未重复增加 `content_task_id` 单元分支。
- [x] 结构比较证明生产 WHERE 符合 PRD，未修改 `backend/app/services/publication_queries.py`。

## Phase 2 — Required validation

按顺序运行；同一失败只有在代码或环境发生足以影响结果的变化后才重跑。

1. 精确失败节点：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_workflow_projections.py::test_publication_reference_filter_includes_terminal_history \
  -q
```

2. 目标单元文件：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_workflow_projections.py \
  -q
```

3. Backend 全部 unit tests：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit -q
```

4. Backend Ruff：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend
```

5. 生产实现零改动与 diff 完整性：

```bash
git diff --exit-code -- backend/app/services/publication_queries.py
git diff --check
git status --short
```

6. Backend mypy 为条件检查：当前计划只改测试断言与测试导入，不触及 `backend/app` 类型相关代码，因此不列为实际 required command；若实施 diff 意外触及类型相关生产代码，先按范围约束停止。只有用户重新批准扩大范围后，才必须运行：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app
```

## Phase 3 — Review boundary

- [x] 最终 diff 只包含当前 Task artifacts 与 `backend/tests/unit/test_workflow_projections.py`。
- [x] reference/default 两类断言仍存在，且不再扫描完整 SELECT 文本。
- [x] `_work_context_query()` 的三个 identity `case()` 仍存在，生产查询 diff 为空。
- [x] 未运行完整 `make verify`、integration、E2E、build 或 GEO 检查；独立 Closeout Task 负责重新执行 Phase 4 Exit Gate。

## Expected changed files

- 规划阶段：
  - `.trellis/tasks/08-12-publication-work-reference-filter-unit-contract-correction/task.json`
  - `.trellis/tasks/08-12-publication-work-reference-filter-unit-contract-correction/prd.md`
  - `.trellis/tasks/08-12-publication-work-reference-filter-unit-contract-correction/implement.md`
- 批准实施后：
  - `backend/tests/unit/test_workflow_projections.py`

明确不改：`backend/app/services/publication_queries.py`、OpenAPI、数据库、前端、生成类型、稳定 spec、业务文档和 GEO 文件。

## Rollback

测试变更没有数据或运行时迁移。若最小结构断言不能准确表达现有业务合同，停止并恢复本 Task 对目标测试的未提交改动；不以生产查询改写作为兼容方案。

## Execution record — 2026-08-12

- 精确失败节点：通过。
- `backend/tests/unit/test_workflow_projections.py`：通过，19 个测试节点全绿。
- Backend 全部 unit tests：退出码 0，全绿。
- Backend Ruff：`All checks passed!`。
- Backend mypy：不适用；本次只修改测试导入与断言，`backend/app` 零改动。
- `git diff --exit-code -- backend/app/services/publication_queries.py` 与 `git diff --check`：通过。
- `trellis-check` 与逐行 diff 自审：未发现 spec 漂移、生产行为变化、完整 SELECT 扫描、私有 SQLAlchemy 属性、重复测试分支、额外抽象或范围外文件。
- `trellis-update-spec` 复核后不更新稳定 spec：本次只修正一次性测试断言粒度，现有 publication workbench spec 已准确表达默认非终态合同，没有新的 API、数据库、运行时或项目级测试约定。
- 触及范围的既有中文测试 docstring 已准确描述合同，未增加或修改 comments/docstrings/developer-visible text。
- 用户已确认提交计划与归档收尾；仍未合并、push，也未运行完整 `make verify` 或进入 GEO。
