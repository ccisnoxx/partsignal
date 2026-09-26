# I03-4-B2-C1 production harness TMPDIR 清理修复

## Goal

修复 production deploy harness 在 macOS TMPDIR 路径规范化下的临时目录清理误报，增加稳定回归检查并完成定向高风险复核。

## Requirements

- 只修改 production deploy harness 的临时目录生命周期、对应最小回归检查和 Makefile 的 deploy-script 门禁接线；不改变真实 Production 部署、manifest、镜像、数据目录、回退或远端行为。
- 将 `${TMPDIR:-/tmp}` 先解析为唯一 canonical 临时根，再由同一根创建、规范化、验证并清理直属 `partsignal-production-test.*` 目录。
- cleanup 只允许删除 harness 自己创建且仍位于 canonical 根直属位置的目录；越界、owner 不匹配或删除失败必须输出可诊断错误并使原本成功的 harness 非零退出。
- 正常成功、主流程失败、INT、TERM 都必须执行 cleanup；主流程非零状态不能被 cleanup 覆盖，cleanup 失败也不能被成功状态吞掉。
- 回归检查必须观察真实文件系统结果，覆盖尾斜杠、raw/canonical 字符串不同、成功、主流程失败、cleanup 拒绝/失败、INT、TERM和同根无关 sibling 保留。
- 相邻 staging/frontend harness 只在确认存在相同的 canonicalize 后 owner mismatch 时修改；不顺便统一其他脚本。
- 本会话只做定向验证与 fresh 独立高风险复核，不运行 `make verify`、完整前后端测试、完整 Playwright、clean-checkout 完整复验、真实部署、远端 CI 或 I04。

## Acceptance Criteria

- [x] 旧实现以 macOS 默认尾斜杠 TMPDIR 运行时退出 0，却在 canonical 根遗留 `partsignal-production-test.*`；命令、退出码和前后目录状态有保存证据。
- [x] production harness 只使用一个 canonical 临时根 owner，mktemp、test_dir canonical path、直属目录 allowlist 与 cleanup 判定一致。
- [x] cleanup 拒绝或删除失败可诊断并导致非零；主流程失败保留原始非零状态。
- [x] 成功、创建后立即失败、正常失败、INT 与 TERM 后均无 harness 自有目录；同根无关 sibling 未删除。
- [x] `sh -n`、cleanup 回归脚本、production harness 定向执行和 `git diff --check` 全部通过，且每次检查前后 raw/canonical 根均无本轮残留。
- [x] fresh `critical_reviewer` 最终结论为 `NO BLOCKER`，且确认没有改变真实 Production 部署行为或夹带无关变化。
- [x] C1 记录实际证据后标记 completed；父 blocker 与 B2、身份 blocker、I03-4、I03、总体交付保持 in_progress；下一恢复点固定为重新执行 B2 clean-checkout 完整门禁与收尾。
- [x] 创建一个获授权的本地修复提交，记录 commit/parent/tree；候选工作区 clean，原检出区仍为 clean 的 `main@9100774b0e124d1d834f8c726cf85f2c0e171e5e`。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-b2-production-harness-tmpdir-cleanup-blocker/`。
- 修复前恢复点：commit `bcd985251fabc15d02a4f3be9bde721f2fdd459f`，tree `486a17b1105c156121bf6399d07437db1c671794`。
- 旧完整门禁日志 `/tmp/partsignal-i03-4-b2-clean-verify.log` 的 SHA-256 为 `83a437c3fea20ae009278dc6c9d0d1f7170c71c6073ea04bc7fffad753364e96`；该次资源验收无效，不能据此完成 B2。
