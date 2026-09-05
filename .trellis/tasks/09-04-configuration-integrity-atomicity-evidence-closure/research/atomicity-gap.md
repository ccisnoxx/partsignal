# 原子性证据基线

## 权威来源

- 父任务：`.trellis/tasks/09-04-configuration-integrity-error-domain-mapping`
- 父任务已批准设计的失败原子性来自 `design.md` 第 4.3 节和 `prd.md` R2。
- 新的 full `trellis-check` 与唯一 targeted re-review 都确认：并发证据已关闭，仅剩 Header create/update、Model update、Prompt duplicate 的失败后持久断言不完整。

## 当前绿色基线

- Backend unit：父任务实施候选最近完整运行 `426 passed`。
- 六文件 PostgreSQL integration：`26 passed`。
- 父任务 targeted re-review：受影响节点 `9 passed, 16 deselected`，附加 API nodes `2 passed`。
- Backend Ruff、Frontend targeted Vitest/ESLint、`git diff --check` 与 Trellis task validation 均通过。
- `make contract-check` 尚未运行，保留给父任务最终候选。

## 待补路径与当前锚点

- `backend/tests/integration/test_ai_channel_management.py`
  - Header create duplicate：当前约第 789 行。
  - Header update duplicate：当前约第 839 行。
  - Model update duplicate：当前约第 931 行。
- `backend/tests/integration/test_platform_workspace.py`
  - Prompt precheck/constraint duplicate：当前约第 151 行。

行号只用于规划定位，实施时以 test name 和实际代码为准。

## 已排除方案

- 不再新建独立 Session/barrier 并发测试；父任务已有且通过。
- 不把当前绿测当作豁免原子性断言的理由。
- 不修改父任务验收条件，不用代码顺序审查完全替代数据库结果证据。
- 不注册新 fixture/framework，不修复未授权的 schema 格式差异或 frontend publication typecheck 问题。
