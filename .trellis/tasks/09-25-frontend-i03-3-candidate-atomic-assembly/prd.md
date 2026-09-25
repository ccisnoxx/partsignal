# I03-3 候选文件原子组装与恢复点

## Goal

把当前由 tracked 修改和 untracked 维护文件共同组成的前端重新开发候选，精确组装为由本地分支、commit 和 tree 完整表达的 Git 恢复点；不改变产品行为、测试逻辑、CI 设计或既有文档语义。

## Requirements

- 只在候选工作区 `/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal` 执行 Git 写操作；原检出区 `/Users/sc/PycharmProjects/partsignal` 只读核对并保持不变。
- 基线固定为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`，目标本地分支固定为 `codex/frontend-redevelopment-candidate`；不得覆盖、删除或重置已有分支。
- 实时重新清点 HEAD、worktree、index、tracked 修改和全部 untracked 文件，不沿用 I03-1 的旧数量。
- 对全部候选路径建立 owner/入口/必要性分类；显式排除 `.env`、凭据、密钥、manifest、依赖目录、构建/测试产物、缓存、临时数据库/对象存储、`/tmp` 日志、IDE/OS 文件和其他会话内容。
- 使用 NUL-safe Git 命令精确 staging 已审计路径，不使用 `git add -A`，不使用 stash、reset、clean 或丢弃改动的 checkout。
- 提交前由 fresh `critical_reviewer` 对 staged tree 做独立只读高风险复核；只有结论为 `NO BLOCKER` 才创建原子候选提交。
- 原子提交后记录 commit、parent、tree、文件计数与复核结论；如记录产生新 Trellis 差异，只允许第二个纯 I03-3/I03 收尾提交。
- 不运行 clean-checkout 完整复验、完整 `make verify`、Playwright、Docker build、PostgreSQL integration 或远端 Actions；不 push、不创建 PR、不合并、不发布、不部署。

## Acceptance Criteria

- [x] 当前候选由目标本地分支和明确 commit/tree 完整表达，全部候选维护文件进入 Git 对象。
- [x] staged 清单覆盖全部已审计 tracked/untracked 候选，不含敏感信息、缓存、产物、运行时文件或其他会话内容。
- [x] `git diff --cached --check`、提交前 staged 状态核对和 fresh `critical_reviewer` 高风险复核均无阻断。
- [x] 原子候选提交的 SHA、parent、tree、branch 和文件计数已核对并记录。
- [x] 如存在第二个提交，其范围只包含 I03-3/I03 收尾记录；最终分支 HEAD 与原子候选 commit 的关系明确。
- [x] 候选工作区最终 clean；原检出区状态和 HEAD 与任务开始时一致。
- [x] I03-3 标记 `completed`；I03 与总体交付保持 `in_progress`，下一任务记录为“I03 最终 clean-checkout 本地集成复验”。

## Notes

- 候选清单与排除证据：`research/candidate-assembly-manifest.md`。
- I02-3 和 I03-2 的既有验证只作为输入复用；本任务的 Git staging/commit 不改变候选文件内容。
