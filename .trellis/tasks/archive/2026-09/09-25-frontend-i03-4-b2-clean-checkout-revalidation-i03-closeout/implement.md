# I03-4-B2 执行计划

1. 恢复任务链、前端计划/清单、CI/E2E/secret/deploy 门禁入口和适用 spec；核对 B1、候选、原检出区与 I04 真实状态。
2. 从固定修复提交创建新的 detached validation worktree，证明 HEAD/tree、tracked/non-ignored untracked、候选维护源完整性和工作区隔离。
3. 仅在 validation 中 bootstrap；准备并核对 PostgreSQL、Redis DB 14、固定端口、E2E 数据库与临时敏感产物。
4. 只覆盖本次测试所需的数据库与 Redis URL，使用 `bash -o pipefail` 单次执行 `make verify`，保存完整日志和状态。
5. 提取本次各层测试/skip/退出码、Docker build、secret scan、六项 harness、Compose 和部署脚本的真实证据，并完成门禁后资源、tree 与三处工作区核对。
6. 全部前置条件成立后，按多代理审计流程派发 fresh `critical_reviewer` 只读复核完整候选与本轮证据。
7. 仅在结论为 `NO BLOCKER` 时完成 B2、blocker、I03-4、I03 与总体交付记录；按授权最多创建一个纯 Trellis 本地提交，随后安全移除 validation worktree并 prune。

## 排除

- 不修改任何候选生产代码、测试、公共合同、Makefile、CI、Compose、部署脚本或依赖。
- 不执行 I04、远端 CI、push、PR、merge、rebase、reset、archive、发布或真实部署。

## 2026-09-25 实际执行与停止点

- 固定恢复点经再次核对为 commit `bcd985251fabc15d02a4f3be9bde721f2fdd459f`、tree `486a17b1105c156121bf6399d07437db1c671794`；候选分支与 detached validation 初始均 clean，原检出区为 clean 的 `main@9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- validation bootstrap 退出 0；日志 `/tmp/partsignal-i03-4-b2-bootstrap.log`，SHA-256 `c2ec4958f12abc7c0fe35b9951c2f39460004c7369bbde0e7bf83028531ed078`。
- 只覆盖指定 `DATABASE_URL` 与 `REDIS_URL=redis://127.0.0.1:56379/14`，单次执行顶层 `make verify`。日志 `/tmp/partsignal-i03-4-b2-clean-verify.log`，SHA-256 `83a437c3fea20ae009278dc6c9d0d1f7170c71c6073ea04bc7fffad753364e96`，247711 bytes；状态为 `MAKE_VERIFY_EXIT=0`。
- 同一次执行中：backend unit 23 个测试文件、679 passed、0 skipped；frontend Vitest 91 个文件、774 passed、0 skipped；backend integration 26 个测试文件、337 passed、0 skipped；real-stack Playwright 9 个 spec、16 passed、0 skipped；fixture Playwright 46 个 spec、494 passed、34 skipped。contract/generated types、Ruff、ESLint、mypy（80 source files）、TypeScript、production build、frontend/backend Docker build、两次 secret scan、dev/prod Compose config 和部署脚本测试均运行并报告通过；前后端 Docker build 各一次，real-stack 与 fixture Playwright 各一次。顶层 `make verify` 明确各执行一次六项 harness：`test-frontend-container.sh`、`test-e2e-run-lifecycle.sh`、`test-e2e-database-lifecycle.sh`（5 scenarios）、`test-secret-artifact-post-run.sh`、`test-deploy-staging.sh`、`test-deploy-production.sh`；因此 I02-1/I02-2 的进程/数据库生命周期和资源清理检查确实来自本次顶层入口，而非旧证据或手工补跑。
- 非阻断警告仅包括 oss2 `SyntaxWarning`、Node `NO_COLOR`/`FORCE_COLOR` 提示、Markdown editor 729.88 kB chunk 警告；预期 AI timeout 流程被恢复且测试通过。
- 门禁后端口 8000/9001/4174/19009、Redis DB 14 和 `partsignal_e2e_%` 数据库均清零，但 macOS `${TMPDIR}` 下发现本轮 `partsignal-production-test.a1zmEJ` 以及三处同日历史目录。根因位于 `deploy/scripts/test-deploy-production.sh:5-15`：规范化后的 `/private/var/...` `test_dir` 无法匹配基于原始尾斜杠 `/var/.../T/` 构造的 cleanup case，trap 静默跳过删除却仍返回成功。
- 该缺陷证明 production deploy harness 存在资源清理误报，也说明门禁前临时目录核对遗漏了 macOS `${TMPDIR}`。最终复查还发现两处创建于本轮门禁前约 16 小时、含 key/manifest fixture 的历史 `partsignal-secret-scan.*` 目录；它们不是本轮 secret scan 新产物，但进一步证明资源前置条件并未真实成立。即使所有测试层退出 0，本轮证据仍不满足资源前置/后置条件，不能安排 `critical_reviewer` 或完成 B2/I03。
- 已创建未启动 P1 子任务 `09-25-frontend-i03-4-b2-production-harness-tmpdir-cleanup-blocker`，记录失败命令、日志、恢复点、根因和建议修复范围。本会话不修复、不重跑完整门禁、不推进 I04。
- 四处 production harness 目录和两处历史 secret-scan 目录均无打开句柄，已分别精确移动到 `/Users/sc/.Trash/partsignal-i03-4-b2-production-test.*` 与 `/Users/sc/.Trash/partsignal-i03-4-b2-secret-scan.*`；临时根已清零且内容未被读取。validation 在移除前再次证明 HEAD/tree 精确匹配、tracked 与 non-ignored untracked 均为 0、`git diff --check` 通过；随后已安全移除并执行 `git worktree prune`。后续应先修复 blocker，再从新固定提交执行全新 B2 复验。
