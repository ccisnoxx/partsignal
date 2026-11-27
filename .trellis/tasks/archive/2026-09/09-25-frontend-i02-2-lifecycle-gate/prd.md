# I02-2 生命周期故障测试接入顶层门禁

## Goal

将进程与数据库 lifecycle harness 接入 test-deploy-scripts，使 make verify 必经且失败可靠传播。

## Requirements

- 只在候选工作区把 `deploy/scripts/test-e2e-run-lifecycle.sh` 与 `deploy/scripts/test-e2e-database-lifecycle.sh` 接入 `Makefile` 的 `test-deploy-scripts` 必经路径。
- 任一 lifecycle harness 非零退出时，`test-deploy-scripts` 必须立即非零停止，并由依赖关系使后续 `make verify` 非零；不得吞掉或覆盖失败。
- 保持 frontend container、secret artifact、staging 和 production deploy script 门禁继续执行。
- 复用输入未变化的 I02-1 证据；不修改数据库隔离实现、业务代码或页面，不运行完整 `make verify`，不进入 I02-3 或 I03。
- 完成定向验证和独立只读高风险复核后，记录实际证据、残余风险与 I02-3 后继并停止。

## Acceptance Criteria

- [x] 两个 lifecycle harness 均位于 `test-deploy-scripts` 的顺序 recipe 中，且该目标仍是 `verify` 的直接依赖。
- [x] 两个 harness 分别通过；相关 shell syntax 与 `git diff --check` 通过。
- [x] 轻量静态/受控 Make 证据证明原有四类门禁仍在路径中，并证明任一 lifecycle harness 非零时 recipe 与顶层依赖链不继续执行。
- [x] 独立只读高风险复核无阻断；实际修改、验证、复核、残余风险和下一任务 I02-3 已记录，任务标记完成。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i02-full-candidate/`。
- 前置任务：`.trellis/tasks/09-25-frontend-i02-1-e2e-database-isolation/`，其实现与验证输入未变化时直接复用。
- 禁止提交、归档、发布、部署或修改原检出区。
