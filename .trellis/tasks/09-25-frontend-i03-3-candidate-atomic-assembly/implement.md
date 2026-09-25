# I03-3 执行记录

## 执行顺序

1. 恢复总体交付、I03、I03-1、I03-2、I02-3、根/前端规则和目录/CI/E2E 规范。
2. 只读核对候选与原检出区的 HEAD、分支、worktree、index、tracked/untracked 和目标分支占用。
3. 对全部候选路径建立 NUL-safe 清单，复核 21 个任务目录外维护文件及全部 Trellis 任务记录的归属，并记录排除项。
4. 从当前基线位置创建 `codex/frontend-redevelopment-candidate`，确认工作树差异未丢失。
5. 精确 staging 已审计路径，核对 cached name-status/stat/check、工作区剩余状态、引用闭合、模式位和敏感/产物排除。
6. 创建持久化多代理审计 Bundle，派发 fresh `critical_reviewer` 对 staged tree 做只读高风险复核。
7. 复核为 `NO BLOCKER` 后创建原子候选提交，核对 commit、parent、tree、branch 和 staged 清单。
8. 写入实际恢复点和复核结论；必要时创建仅包含 I03-3/I03 收尾记录的第二提交，确认候选工作区 clean、原检出区不变后停止。

## 验证限制

- 只运行 Git diff/index/tree、文件存在性、引用和敏感路径检查。
- 不运行 clean-checkout 完整复验、完整 `make verify`、Playwright、Docker build、PostgreSQL integration 或远端 Actions。
- 不修改生产代码、测试逻辑、CI 设计、合同或稳定规范内容。

## 结果

- 待完成后填写。
