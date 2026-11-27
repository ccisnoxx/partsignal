# I03-4-B2 Blocker production deploy harness TMPDIR 清理误报

## Goal

修复 deploy/scripts/test-deploy-production.sh 在 macOS TMPDIR 尾斜杠与 /var→/private/var 规范化下无法清理 mktemp 目录、却仍返回成功的门禁误报。

## Requirements

- 修复 `deploy/scripts/test-deploy-production.sh:5-15` 的临时目录所有权与清理合同：创建目录、规范化路径和 cleanup allowlist 必须使用同一个规范化的临时根。
- 覆盖 macOS 默认 `TMPDIR` 以尾斜杠结尾且 `/var/...` 经 `realpath` 变成 `/private/var/...` 的路径语义；不得因字符串表示不同跳过清理。
- harness 退出 0 后不得残留 `partsignal-production-test.*`；cleanup 被拒绝或失败时不得继续报告成功。
- 增加稳定回归检查，至少证明尾斜杠 `TMPDIR` 和路径规范化场景下成功、失败与信号退出路径都不会遗漏 harness 自有目录。
- 修复后从固定候选重新建立 detached clean checkout，并重新执行 B2 的完整 `make verify`、资源清理核对和独立高风险复核；旧的本轮绿色测试结果不能单独完成 B2。
- 不扩大到生产部署行为变更，不执行真实部署、远端写入或 I04。

## Acceptance Criteria

- [x] `test_dir` 与 cleanup allowlist 共享同一规范化临时根，尾斜杠和 `/var`→`/private/var` 不再造成不匹配。
- [x] cleanup 拒绝或删除失败会使 harness 非零退出，并提供可诊断错误；不会以“测试通过”掩盖资源泄漏。
- [x] 回归测试在 macOS 默认 `TMPDIR` 形态或等价可控 fixture 下复现旧缺陷，并验证修复后的目录清零。
- [ ] 修复后的顶层 `make verify` 重新完整通过，门禁前后 `${TMPDIR}` 与 `/tmp` 均无相关临时目录，固定端口、Redis DB 14 和 `partsignal_e2e_%` 数据库也清零。
- [ ] fresh `critical_reviewer` 对更新后的完整候选和复验事实给出 `NO BLOCKER` 后，方可恢复 B2/I03 收尾。

## Notes

- 发现命令：仅覆盖 `DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal` 与 `REDIS_URL=redis://127.0.0.1:56379/14` 的单次顶层 `make verify`。
- 发现恢复点：commit `bcd985251fabc15d02a4f3be9bde721f2fdd459f`，tree `486a17b1105c156121bf6399d07437db1c671794`。
- 门禁日志：`/tmp/partsignal-i03-4-b2-clean-verify.log`，SHA-256 `83a437c3fea20ae009278dc6c9d0d1f7170c71c6073ea04bc7fffad753364e96`，247711 bytes；状态文件记录 `MAKE_VERIFY_EXIT=0`。
- 缺陷证据：`/tmp/partsignal-i03-4-b2-production-temp-leak.txt`，SHA-256 `06c22eff1f85352905b92b3c70ca0931381d1e52f850b41eebc72d8c7c6e0db7`。本轮新目录 `partsignal-production-test.a1zmEJ` 的 birth time 为 `2026-09-25T18:32:46-0700`；同一缺陷还留下三处同日历史目录。
- 根因：第 5 行以原始 `${TMPDIR}` 创建目录，第 6 行将 `test_dir` 规范化为 `/private/var/...`，第 12 行却继续用带尾斜杠的原始 `/var/.../T/` 组成 case pattern；两种字符串无法匹配，trap 静默跳过删除而仍退出 0。
- `9100774b0e124d1d834f8c726cf85f2c0e171e5e..bcd985251fabc15d02a4f3be9bde721f2fdd459f` 未修改该脚本，因此归类为既有但会使当前验收证据失真的测试基础设施缺陷，不在 B2 中顺手修复。
- 四处遗留目录均无打开句柄，已按精确路径移动到 `/Users/sc/.Trash/partsignal-i03-4-b2-production-test.*`，可从废纸篓恢复；未删除其他临时目录。
