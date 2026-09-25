# I03 Canonical 源码接替与本地集成

## Goal

在 I02 完成后核对唯一 canonical frontend、构建/运行/生成类型引用、候选原子组装与本地集成复验；本阶段不含 I04 发布部署。

## Requirements

- I03 只处理 canonical 源码接替与本地集成，不包含 I04 发布、远端部署或生产观察。
- I03-1 先完成只读引用审计；后续修复、Git 原子组装与 clean-checkout 复验分别按独立任务和授权边界执行。
- 当前候选工作区为 `/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`，基线为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`；原检出区只读核对。
- 未获明确授权前不执行 Git staging、commit、branch、archive、push、发布或部署。

## Acceptance Criteria

- [ ] 唯一 canonical `frontend/` 与 Makefile、CI、Compose、Docker、部署脚本、环境变量和 OpenAPI 生成类型引用一致。
- [ ] 已确认的 CI 门禁缺口完成最小修复，并由对应 owner 验证。
- [ ] 当前候选的 tracked/untracked 维护文件形成可恢复的原子候选；涉及 Git staging 或 commit 时先取得用户明确授权。
- [ ] 从授权的 clean checkout 或等价可恢复组装点完成最终本地集成复验，真实失败与未运行项如实记录。
- [ ] I03 完成前不进入 I04。

## Notes

- I03-1 已建立为只读审计子任务；本会话不创建或实施 I03-2。
