# I03-4-B2 修复候选 clean-checkout 完整复验与 I03 收尾

## Goal

从固定修复提交执行 detached clean-checkout 完整仓库门禁、资源清理和独立高风险复核，并在全部条件满足后完成 blocker、I03-4、I03 与本地交付收尾。

## Requirements

- 固定验证对象为 `bcd985251fabc15d02a4f3be9bde721f2fdd459f`，tree 为 `486a17b1105c156121bf6399d07437db1c671794`，总体候选基线为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 从固定提交创建新的 detached clean validation worktree；bootstrap、完整门禁和运行时产物只允许位于该 worktree，不借用候选工作区未提交或 ignored 业务文件。
- 唯一完整门禁入口为单次 `make verify`；只向该进程覆盖本次测试所需的 `DATABASE_URL` 与 `REDIS_URL=redis://127.0.0.1:56379/14`，不得 source 或整体导出 `.env`。
- 使用 `bash -o pipefail` 保存 `/tmp/partsignal-i03-4-b2-clean-verify.log`、退出状态和日志 SHA-256；记录各层实际文件数、测试数、skip、退出码、Docker build 和 lifecycle/deploy harness 执行次数。
- 门禁前后核对 PostgreSQL、Redis、端口 8000/9001/4174/19009、`partsignal_e2e_%` 数据库、对象存储、secret manifest/key 与临时 E2E 目录；validation tree、候选代码和原检出区不得漂移。
- 失败先区分候选缺陷、环境问题和非阻断警告；没有相关输入变化不得重跑完整门禁。本任务不修改生产代码、测试、合同、Makefile、CI、Compose、部署脚本或依赖。
- 只有完整门禁通过、secret scan clean、资源清理完成且代码 tree 未变化后，才安排 fresh `critical_reviewer` 对基线到固定修复提交的完整差异与本轮证据做独立只读高风险复核。
- 不执行 I04、push、PR、merge、rebase、reset、archive、发布、真实部署或任何远端写操作；最多创建一个只含 Trellis 收尾记录的本地提交。

## Acceptance Criteria

- [ ] validation HEAD/tree 精确匹配固定恢复点；tracked 与非 ignored untracked 状态为空，全部候选维护源均 tracked。
- [ ] 本次单次 `make verify` 退出 0，并真实覆盖 contract/generated types、Ruff、ESLint、mypy、TypeScript、production build、前后端 Docker build、真实栈与 fixture Playwright、secret scan、六项 lifecycle/deploy harness、Compose config 和部署脚本测试。
- [ ] I02-1/I02-2 数据库生命周期与资源清理由顶层门禁实际执行，门禁后固定端口、Redis DB 14、E2E 数据库和临时敏感产物全部清零。
- [ ] validation HEAD/tree 未漂移、`git diff --check` 通过；候选在 Trellis 收尾前仅含本任务记录，原检出区仍为 clean 的固定 `main`。
- [ ] fresh `critical_reviewer` 对完整候选与本轮证据结论为 `NO BLOCKER`。
- [ ] B2、blocker、I03-4、I03 和总体本地交付任务全部标记 `completed`，旧 `88992307` 验证证据明确被本次固定修复候选复验取代。
- [ ] 若创建本地收尾提交，其内容仅为 Trellis 记录并记录 commit/parent/tree；最终候选与原检出区 clean，detached validation worktree 已安全移除并 prune。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-auth-boundary-late-mutation-blocker/`。
- B1 已完成并由独立高风险复核给出 `NO BLOCKER`；本任务只负责修复候选复验和本地任务链收尾。
- 2026-09-25 单次 `make verify` 的所有测试层退出 0，但 production deploy harness 在 macOS `${TMPDIR}` 下静默遗留测试目录；门禁前核对还遗漏了同根目录中的历史残留。因此资源前置/后置验收不成立，完整证据无效。
- 已建立 P1 子任务 `09-25-frontend-i03-4-b2-production-harness-tmpdir-cleanup-blocker`。在该基础设施缺陷修复并完成全新 clean-checkout 复验前，本任务保持 `in_progress`，不派发 `critical_reviewer`，不完成父任务链。
