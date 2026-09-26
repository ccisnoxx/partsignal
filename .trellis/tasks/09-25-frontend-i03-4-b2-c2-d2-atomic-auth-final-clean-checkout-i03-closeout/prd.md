# I03-4-B2-C2-D2 原子认证候选最终 clean-checkout 复验与 I03 收尾

## Goal

从 ff018cb9 固定候选执行单次 clean-checkout 全仓门禁、资源清理、完整候选独立高风险复核并在 NO BLOCKER 后完成 I03 收尾。

## Requirements

- 固定产品候选为 commit `ff018cb90f932e54cacda9cead06c74c7880ab42`、tree `20c544cec50073af26c217401007834827cfea21`，总体基线为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 从固定提交创建新的 detached validation worktree；bootstrap、依赖、缓存、测试和运行时产物只位于 validation，候选与原检出区不得被污染。
- 门禁前后同时检查原始 `${TMPDIR}`、canonical realpath 与 `/tmp`，按真实目录去重；只识别仓库 lifecycle/deploy harness 定义的资源，未知或不能证明 owner 的资源不得删除并视为 blocker。
- 唯一完整门禁是单次 `make verify`；只覆盖指定 `DATABASE_URL` 与 Redis DB 14，不 source 或整体导出 `.env`。保存完整日志、退出状态、字节数、SHA-256 与前后资源快照。
- 失败只做最小诊断，不重复运行完整门禁；本任务不修改产品代码、测试、合同、依赖、Makefile、CI、Compose 或部署脚本。
- 只有完整门禁、secret scan、资源清理、固定 tree 与工作区边界全部成立后，才派发 fresh `critical_reviewer` 复核基线到固定候选的全部 tracked 差异与本轮证据。
- 只有独立复核为 `NO BLOCKER` 才依次完成 D2、跨快照 blocker、C2、cleanup blocker、B2、身份边界 blocker、I03-4 与 I03；总体交付保持 `in_progress`，随后创建 I04。
- 任一 blocker 都在首次远程写入前停止，不创建或执行 I04。

## Acceptance Criteria

- [ ] validation HEAD/tree 精确匹配固定候选，tracked 与 non-ignored untracked 为空，全部候选维护源、合同、generated types、测试与部署脚本均 tracked。
- [ ] 门禁前相关临时目录、固定端口、Redis DB 14、`partsignal_e2e_%` 数据库、对象存储和 secret fixture 全部为 0。
- [ ] 单次 `make verify` 退出 0，并实际覆盖合同/runtime/generated types、静态检查、三层测试、production build、前后端 Docker build、两套 Playwright、两次 secret scan、全部 lifecycle/deploy harness 与 Compose config。
- [ ] 门禁后相同资源清单全部为 0，validation HEAD/tree 未漂移，`git diff --check` 通过，候选和原检出区保持 clean 与固定 HEAD。
- [ ] fresh `critical_reviewer` 对 `9100774b..ff018cb9` 完整候选结论为 `NO BLOCKER`。
- [ ] I03 父链按顺序完成，真实证据写入任务记录；validation worktree 安全移除并 prune。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-b2-c2-auth-session-cross-snapshot-blocker/`。
- D1 已完成定向验证与最终 `NO BLOCKER` 独立复核；其结果不能替代本次完整 clean-checkout 门禁。
- 2026-09-26 单次完整门禁结论：`BLOCKER`。`make verify` 顶层退出码为 `2`，真实栈 Playwright 16 个用例中 15 passed、1 failed；失败为 `system-admin-real-stack.spec.ts` 的 `reset-invalid-session` 阶段记录到两次失效会话读取的 `GET /api/v1/auth/session` 401，但运行时允许表仍只声明旧 `/api/v1/auth/me` 401。
- 完整门禁日志：`/tmp/partsignal-i03-d2-ff018-make-verify.log`，151913 bytes，SHA-256 `ff58ff180b8e4455b6a1bd7ace11f270b0ab526a2057f7e213349b1d1231b7fd`；状态文件：`/tmp/partsignal-i03-d2-ff018-make-verify.status`，SHA-256 `fe09bb5a2d9b5bb78670211d06b81f74237b9938d4ba7c62749f7d8b63c01202`。
- 门禁前资源快照：`/tmp/partsignal-i03-d2-ff018-resource-pre.log`，3588 bytes，SHA-256 `727e12954ea9982149cbc09df1b43168c1c838922d7bd2f60fe871d704562b8a`；门禁后快照：`/tmp/partsignal-i03-d2-ff018-resource-post.log`，3589 bytes，SHA-256 `5dc663fce7a82721dda6ffeda592c5403cbc54287404299a370ecc0002359721`。两次清单均为 0。
- 已通过的门禁：合同/runtime/generated types、Ruff、ESLint、mypy（80 source files）、TypeScript、backend unit（23 files / 683 passed）、frontend Vitest（91 files / 777 passed）、PostgreSQL integration（26 files / 337 passed）、frontend production build、frontend/backend Docker build，以及真实栈 secret scan。由于真实栈 Playwright 失败，fixture Playwright、第二次 secret scan、frontend container、process/database lifecycle、post-run secret、staging/production deploy harness、production TMPDIR cleanup regression 与 dev/prod Compose config 均未执行，不得视为通过。
- 按条件 C 未派发最终候选复核、未完成任何父任务、未创建 I04，且未执行 fetch、push、SSH 或任何远程读写。后续由子 blocker `09-26-frontend-i03-4-b2-c2-d2-system-admin-atomic-session-audit-blocker` 恢复。
