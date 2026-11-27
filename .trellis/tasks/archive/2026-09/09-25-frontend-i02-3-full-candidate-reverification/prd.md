# I02-3 完整候选复验与独立复核

## Goal

在不修改候选代码的前提下，单次执行当前仓库唯一顶层门禁 `make verify`，核对运行资源清理，并对完整候选相对基线 `9100774b0e124d1d834f8c726cf85f2c0e171e5e` 安排独立只读高风险复核，完成 I02 的真实收敛记录。

## Requirements

- 只在候选工作区 `/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal` 工作；原检出区 `/Users/sc/PycharmProjects/partsignal` 只读核对且保持不变。
- 复用输入未变化的 I02-1 与 I02-2 定向验证和独立复核证据，不重新实施它们。
- 前置确认 PostgreSQL、Redis、固定端口、Redis DB 14、`partsignal_e2e_%` 数据库与临时 E2E 目录均满足干净运行条件。
- 只向门禁导出本次所需的 `DATABASE_URL` 与 `REDIS_URL=redis://127.0.0.1:56379/14`；不得整体导出 `.env`。
- 使用 `bash -o pipefail` 单次执行 `make verify`，完整日志保存到 `/tmp/partsignal-i02-3-make-verify.log`，记录各层实际计数、退出码、secret scan、production build、Docker、Compose 与部署脚本结果。
- 失败时先归因；没有相关环境、代码、配置、依赖或诊断证据变化不得重跑。实质生产代码、公共合同、并发/资源生命周期或多文件缺陷只记录为独立 blocker 与恢复点，不在本任务扩展修复。
- 门禁通过且候选代码未变化后，核对端口、Redis、数据库、对象存储/密钥/manifest/临时目录、`git diff --check` 与原检出区状态，再安排 fresh `critical_reviewer` 对全部已跟踪和未跟踪差异及门禁证据做只读复核。
- 不创建或实施 I03，不执行 Git 提交、归档、发布或部署。

## Acceptance Criteria

- [x] 当前 `make verify` 单次完整通过，I02-1/I02-2 lifecycle harness 确实由顶层门禁执行。
- [x] secret scan clean，端口 8000、9001、4174、19009 已释放，Redis DB 14、`partsignal_e2e_%` 数据库及临时 E2E 资源无遗留。
- [x] `git diff --check` 通过；候选除 Trellis 验收记录外无本任务代码变化，原检出区保持不变。
- [x] 独立完整候选高风险复核结论为 `NO BLOCKER`，覆盖公开合同、认证/权限、持久化与不可变历史、并发/资源所有权、秘密产物、迁移兼容、Docker/Compose、部署脚本和门禁误报风险。
- [x] I02 的 `prd.md`、`design.md`、`implement.md`、`task.json` 记录真实证据、非阻断警告与覆盖缺口；I02 标记 `completed`，父任务仍为 `in_progress`。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i02-full-candidate/`。
- 前置任务：`.trellis/tasks/09-25-frontend-i02-1-e2e-database-isolation/`、`.trellis/tasks/09-25-frontend-i02-2-lifecycle-gate/`。
