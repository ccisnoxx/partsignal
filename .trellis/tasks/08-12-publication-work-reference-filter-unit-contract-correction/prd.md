# Publication Work Reference Filter Unit Contract Correction

## Goal

修正 `test_publication_reference_filter_includes_terminal_history` 的断言边界，使它只验证 `list_publication_works()` row statement 的真实 WHERE 结构，不再把共享 SELECT projection 中合法的 live/frozen identity `CASE` 误判为默认非终态门禁，并恢复 backend unit gate。

## Confirmed Background

- 规划基线为本地 `main` commit `9d6a73d3e90394a2faf0a167ebba144571eb88a5`；创建 Task 前工作树干净，没有活动 Task，也没有创建或切换分支。
- 指定精确节点在 2026-08-12 复现为 `1 failed`：`backend/tests/unit/test_workflow_projections.py:592` 将完整 row `SELECT` 转为字符串后，命中 `_work_context_query()` 在 SELECT projection 中合法的 `CASE WHEN publication_works.status IN (...)`。
- `QueryCaptureSession` 每次调用依次记录两个 SQLAlchemy `Select`：索引 0 是 `db.scalar(count_query)` 的 count statement，索引 1 是 `db.execute(...)` 的 row statement；当前失败断言检查的是索引 1。
- SQLAlchemy 2.0.51 的公开 `Select.whereclause` 可直接取得组合后的 WHERE，公开 `ClauseElement.compare()` 可比较表达式结构，无需读取私有属性、编译完整 SELECT 或解析 SQL 文本。
- 实际诊断显示 count 与 row 的 WHERE 一致：
  - `platform_account_id` 引用：仅 `publication_works.platform_account_id = ...`；
  - `content_task_id` 引用：仅 `publication_works.content_task_id = ...`；
  - 无 status/reference filter 的默认列表：`publication_works.status IN ('PREPARING', 'PLATFORM_REVIEW', 'AWAITING_VERIFICATION', 'ACTION_REQUIRED')`。
- `backend/app/services/publication_queries.py:335-365` 的三个 SELECT `case()` 是 F-14 所需的 live/frozen identity projection；`list_publication_works()` 在 `backend/app/services/publication_queries.py:597-608` 只在没有显式 status 和两类引用筛选时追加默认非终态 WHERE，生产行为正确。
- `content_task_id` 的终态历史已有更直接的 PostgreSQL 行为证据：`test_publication_work_read_surfaces_use_state_aware_identity` 通过 `content_task_id` 读取并断言 `CLOSED`、`COMPLETED` Work；该节点已在归档 `publication-work-projection-contract-correction` Task 的 required validation 中通过，因此本单元测试不重复新增同类分支。

## Requirements

### R1. 精确修正单元断言

- 优先且预计只修改 `backend/tests/unit/test_workflow_projections.py`。
- 保留现有 platform reference 与 default workbench 两类行为断言，继续检查 row statement（捕获索引 1）。
- 通过公开 `Select.whereclause` 取得真实 WHERE，并用公开 `ClauseElement.compare()` 做结构比较：
  - reference WHERE 精确等于 `PublicationWork.platform_account_id == account_id`；
  - default WHERE 精确等于 `PublicationWork.status.in_(NONTERMINAL_WORK_STATUSES)`。
- 不扫描完整 SELECT，也不新增 SQL parser、字符串切割 helper、正则、snapshot 文件或测试抽象。

### R2. 保持生产合同

- 不修改 `backend/app/services/publication_queries.py`；若实施时出现生产 WHERE 与上述诊断不一致的证据，立即停止并报告，不扩大 Task。
- 保留 `_work_context_query()` 的 live/frozen identity SELECT `CASE`，不得删除、改写或复制。
- 不修改 OpenAPI、数据库、前端、生成类型、稳定 spec 或业务文档。

### R3. 范围与阶段边界

- 本 Task 是 test-only lightweight correction，不创建空 `design.md`，不拆分子 Task。
- 当前仅完成复现、诊断和规划；未经用户批准不运行 `task.py start`、不创建分支、不修改测试。
- 本 Task 不运行完整 `make verify`；修复后的 Phase 4 最终门禁由独立 Closeout Task 执行。
- 不进入 GEO。

## Acceptance Criteria

- [x] AC1：精确失败节点通过，且断言只检查 row statement 的公开 WHERE 结构。
- [x] AC2：reference WHERE 精确等于 platform account predicate，不含默认非终态门禁；default WHERE 精确等于非终态 status predicate。
- [x] AC3：共享 SELECT projection 的 live/frozen identity `CASE` 保持存在，`backend/app/services/publication_queries.py` 零改动。
- [x] AC4：`backend/tests/unit/test_workflow_projections.py` 与 backend 全部 unit tests 通过。
- [x] AC5：backend Ruff 与 `git diff --check` 通过；本次只修改测试导入和断言，backend mypy 不适用。
- [x] AC6：最终 diff 只包含当前 Task artifacts 与 `backend/tests/unit/test_workflow_projections.py`，没有合同、数据库、前端、生成类型、文档或 GEO 漂移。

## Out of Scope

- 修改任何生产查询、状态机、DTO、合同、数据库或前端行为。
- 为 `content_task_id` 重复新增已有 PostgreSQL 终态历史证据。
- 运行 integration、E2E、build、完整 `make verify` 或 Phase 4 Gate 重判。

## Planning Decision

这是一个单文件、test-only 的断言边界修正。最小实现是把两处完整 SQL 文本判断替换为 row `Select.whereclause` 的结构比较；没有实际架构或兼容设计内容，因此按用户要求不创建 `design.md`。
