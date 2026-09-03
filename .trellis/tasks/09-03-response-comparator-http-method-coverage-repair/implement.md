# Response comparator HTTP 方法覆盖修复实施计划

## Change Boundary

- 行为缺口：`operation_map()` 只识别五种方法，导致合法 `HEAD`、`OPTIONS`、`TRACE` operation 被静默丢弃。
- 权威 owner：`backend/app/tools/contract_check.py` 的 OpenAPI operation 枚举与 `operation_map()`。
- 预期产品代码修改：仅扩充 checker 的 operation 方法集合。
- 预期测试修改：在 `backend/tests/unit/test_contract_check.py` 通过默认 `check()` 路径参数化冻结三种方法的缺失/新增 operation 诊断，并保留 Path Item 非 operation 字段行为。
- 预期文档修改：在既有 backend error-handling spec 的默认完整门禁场景中补充八种方法与对应 mutation 要求。
- 明确不改：`backend/app/main.py`、CORS、公共合同、generated client、router/service、权限、事务、状态转换、错误映射和其他任务外 dirty 文件。

## Implementation

- [x] 将 checker 的方法集合补齐为 OpenAPI 3.1 八种 operation 方法。
- [x] 增加 `HEAD`、`OPTIONS`、`TRACE` 的 contract-only/runtime-only 默认门禁变异测试。
- [x] 增加或复用断言，确认 Path Item 非 operation 字段不被误判，且默认门禁仍只由 comparator 报告 operation drift。
- [x] 检查实际 diff，不引入共享常量模块、兼容分支、filter 或第二套 operation owner。
- [x] 更新既有稳定 spec，记录八种 operation 方法和防止 future false-green 的测试要求。

## Required Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py::test_runtime_openapi_matches_frozen_operations
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/tools/contract_check.py backend/tests/unit/test_contract_check.py
make contract-check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-response-comparator-http-method-coverage-repair
```

先运行两个 pytest 定向检查与 Ruff；全部通过后只运行一次 `make contract-check` 作为本 Task 的最终完整门禁。完整 backend/frontend suites、build、Playwright、`make typecheck` 和 `make verify` 不属于本修复的 required validation。

## Review Gate

- `trellis-check` 独立核对 operation 方法覆盖、默认调用链、Path Item 固定字段边界、测试是否能真实捕获回归及任务外 diff 隔离。
- 这是发布门禁核心修复；若 Review 发现 MEDIUM+，最多执行一次机械修复和一次 targeted re-check，仍失败则停止。

最终结果：`trellis-check` 无 finding；只读 release-gate Review 初审发现 PRD 未将 Phase 3.3 spec 纳入提交边界，完成一次机械文档修复后 targeted re-review 通过，无未解决 MEDIUM+。

## Validation Evidence

- `backend/tests/unit/test_contract_check.py`：68 passed。
- `test_runtime_openapi_matches_frozen_operations`：1 passed；独立合并 targeted re-check 为 69 passed。
- Ruff 定向检查：通过。
- `make contract-check`：只运行一次，backend 完整契约门禁与 frontend `api:check` 均通过。
- Task context validation 与 `git diff --check`：通过。
- 未运行完整 backend/frontend suites、build、Playwright、`make typecheck` 或 `make verify`；本次只修改 checker 方法枚举、定向测试和稳定 spec，现有 162-operation 集成快照由 required validation 保持零漂移。

## Commit Boundary

- 工作提交只允许包含 `backend/app/tools/contract_check.py`、`backend/tests/unit/test_contract_check.py`、`.trellis/spec/backend/error-handling.md` 与本 Task 的规划/上下文文件。
- 使用显式 pathspec 提交，禁止吸入现有 staged artifacts 删除、`.gitignore` 或 `backend/app/schemas/configuration.py`。
