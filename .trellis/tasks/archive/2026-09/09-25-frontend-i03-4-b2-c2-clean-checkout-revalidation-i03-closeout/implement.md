# I03-4-B2-C2 执行计划

1. 恢复指定任务链、计划/清单、infra spec 与全部顶层门禁 owner；核对 C1、固定 commit/tree、两个既有工作区、worktree 列表、父链状态和 I04 状态。
2. 从固定提交创建新的 detached validation worktree，证明 HEAD/tree、tracked/non-ignored untracked、维护源 tracked 与隔离边界。
3. 仅在 validation bootstrap；启动或复用获授权的本地 PostgreSQL/Redis 测试基础设施，完成 raw/canonical TMPDIR、`/tmp`、端口、Redis DB 14、E2E 数据库和敏感 fixture 的前置清单。
4. 只覆盖指定数据库与 Redis URL，使用 `bash -o pipefail` 单次执行顶层 `make verify`，保存完整日志和状态。
5. 从本次日志提取所有测试/skip/退出码、Docker build 次数、secret scan、lifecycle/deploy harness、C1 regression、Compose 和顶层退出码；完成同一资源清单的后置核对、tree 检查与三个工作区核对。
6. 全部条件成立后，按多代理审计流程派发 fresh `critical_reviewer` 复核完整候选与本轮证据。
7. 仅在复核为 `NO BLOCKER` 时更新 C2 与父链的 PRD/design/implement/task 记录，精确检查并创建最多一个纯 Trellis 本地提交。
8. 提交后核对候选/原检出区，安全移除本任务 validation worktree，执行 `git worktree prune` 并再次核对 worktree 列表；结束且不创建 I04。

## 排除

- 不修改任何候选生产代码、测试、公共合同、依赖、Makefile、CI、Docker/Compose 或部署脚本。
- 不运行第二次完整 `make verify`，不以定向诊断替代完整门禁。
- 不执行远端 CI、真实 staging/production 部署、push、PR、merge、rebase、reset、archive、发布或 I04。

## 2026-09-25 实际执行与停止点

- 从固定 commit 创建 detached validation `/Users/sc/.codex/worktrees/frontend-redevelopment-i03-4-b2-c2/partsignal`；HEAD/tree 始终精确为 `6aaf05a5ad5371493bb20c95b5cbdb5908a27cf9` / `8a07b055bcb9f8d2b4038f7e31ac5fab71c815e1`，tracked 与 non-ignored untracked 均为 0。候选门禁 owner 全部 tracked；bootstrap 只生成 ignored `.env`、依赖与缓存。
- 门禁前按 raw TMPDIR、canonical realpath 与 `/tmp` 两个真实根去重扫描：所有已知临时目录 0，端口 8000/9001/4174/19009 为 0，Redis DB 14 为 0 key，`partsignal_e2e_%` 数据库为 0，PostgreSQL/Redis healthy。候选只有本任务 Trellis 记录，原检出区为 clean 的固定 main。
- 仅覆盖指定 `DATABASE_URL` 与 `REDIS_URL`，使用 `bash -o pipefail` 单次运行顶层 `make verify`。日志 `/tmp/partsignal-i03-4-b2-c2-clean-verify.log` 为 227525 bytes，SHA-256 `9f6c68bc57ec8bf8e9ac48bd6b231a238a4634fc88c57efe74984fc6990c9ca6`；状态文件 `/tmp/partsignal-i03-4-b2-c2-clean-verify.status` 为 `MAKE_VERIFY_EXIT=0`，SHA-256 `edf64405e10ca46b29062e55558b8fe58eb9231cd801980c17aeae70026c9d85`。
- runtime OpenAPI/generated types、Ruff、ESLint、mypy（80 source files）与 TypeScript 通过。backend unit：23 files / 679 passed / 0 skipped / exit 0；Vitest：91 files / 774 passed / 0 skipped / exit 0；PostgreSQL integration：26 files / 337 passed / 0 skipped / exit 0。
- frontend/backend Docker build 各 1 次，production frontend build 通过。real-stack Playwright：9 specs / 16 passed / 0 skipped / exit 0；fixture Playwright：46 specs / 494 passed / 34 skipped / exit 0。两次 `E2E_SECRET_SCAN status=clean`，两次组合 `playwright=0 secret_scan=0`。
- frontend container、process lifecycle、database lifecycle（5 scenarios）、post-run secret regression、staging deploy harness、C1 production TMPDIR cleanup regression、production deploy harness 各 1 次且 exit 0；dev/prod Compose config 与部署脚本检查通过。I02-1、I02-2 与 C1 regression 均由本次顶层入口实际执行。
- 非阻断输出只有 oss2 依赖 `SyntaxWarning`、Node `NO_COLOR`/`FORCE_COLOR` 提示与 Markdown editor chunk-size 提示。
- 未执行任何事后手工清理。门禁后同一资源清单全部为 0，validation fixed tree/clean，Playwright artifacts 为 0，候选产品 tree 未变且无非 Trellis 变化，原检出区未变；validation working tree 与 `9100774b..6aaf05a5` range 的 `git diff --check` 均退出 0。
- fresh `critical_reviewer` 验证日志大小、哈希、入口次数、资源证据与 525 个 tracked 文件范围后，确认门禁和 cleanup 证据有效，但发现 1 个 P1 发布阻断：`auth-provider.tsx:106/116/123/214` 将两个独立时刻的 `/auth/me` 和 `/auth/csrf` 拼接成 AuthSession；权限降级或跨标签页账号替换可绕过 principal epoch 推进。现有 `auth-provider.test.tsx:552-565` 未覆盖两次响应之间的身份/权限变化。
- 已创建未启动 blocker `.trellis/tasks/09-25-frontend-i03-4-b2-c2-auth-session-cross-snapshot-blocker/`。审计包 `20260926T050726Z-i03-4-b2-c2-bd695dc3` 已关闭并验证通过。C2 与全部父链保持 `in_progress`；没有收尾提交、远端 CI、真实部署、发布或 I04。
- 独立复核与 blocker 记录完成后，validation worktree 在 fixed/clean 状态下安全移除并执行 `git worktree prune`；最终 `git worktree list` 仅保留原检出区 main 与候选工作区。
