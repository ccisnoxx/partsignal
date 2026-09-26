# I03-4-B2-C2-D2-E1-F1 Blocker 完整门禁 E2E lifecycle harness 静默失败

## Goal

固定候选 c99529cf 在全新 detached checkout 的唯一一次完整 make verify 中，认证真实栈与 fixture E2E 均通过，但 test-e2e-run-lifecycle.sh 在无具体断言输出的情况下退出 1；必须定位并修复 lifecycle harness 后形成新候选，禁止复用本次完整门禁。

## Requirements

- 保留固定产品候选 `c99529cf14a2d754f4d69b08ad0d29e5da9551a3` / tree `f2a6088fe73bc67fcd5a7e0f1f53d09cc40e13b7` 的认证实现与已通过证据，不把 lifecycle harness 失败误判为产品认证回归。
- 从 `deploy/scripts/test-e2e-run-lifecycle.sh` 的 `assert_case` 边界定位首个失败 case 和精确断言；当前日志只证明脚本在未输出 mismatch 诊断的静默断言路径退出 1，不能猜测具体 case。
- 修复 harness 的真实 owner；不得扩大 allowlist、吞掉非零状态、弱化 process-group/secret-scan/cleanup 断言，或用 sleep 掩盖竞态。
- 定向验证必须覆盖 INT、TERM、Playwright failure、secret scan failure、cleanup failure 和 stubborn descendant SIGKILL escalation，并确认临时 secret、marker、进程与目录全部清理。
- 修复后形成新的固定 commit/tree；本次失败的完整门禁证据不得复用。
- 在另一个全新 detached checkout 中只运行一次完整 `make verify`，其前后资源必须全部为 0；只有通过后才派发 fresh `critical_reviewer`。
- 在新完整门禁和独立复核均为 `NO BLOCKER` 前，E1、D2 与 I03 父链保持 `in_progress`，不得创建 I04、fetch/push、连接 Hostdzire 或执行任何远程写入。

## Acceptance Criteria

- [x] `test-e2e-run-lifecycle.sh` 为每个失败 case 提供可归因证据，且首个静默失败条件已定位并在其权威 owner 修复。
- [x] lifecycle 定向测试通过全部六类退出/信号路径，资源和 secret artifact 清理为 0。
- [x] 新固定候选保留 session_binding 跨标签页 epoch、同 BrowserContext 双页面 A→B/ABA 和精确流量断言。
- [x] 新固定候选在全新 detached checkout 的唯一一次完整 `make verify` 退出 0，门禁前后资源全部为 0。
- [ ] fresh `critical_reviewer` 对总体基线到新候选及完整门禁证据给出 `NO BLOCKER`。

## Notes

- 失败 checkout：`/Users/sc/.codex/worktrees/frontend-i03-e1-c995.Sc3aaG/partsignal`，detached HEAD/tree 在门禁后仍精确匹配固定候选且工作区无 tracked/non-ignored untracked 漂移。
- 唯一一次完整门禁状态为 `2`。日志 `/tmp/partsignal-i03-e1-c995-make-verify.log`：241414 bytes，SHA-256 `14d0c79b5dd2caf4c7338e35660b2e887025b12f4d62ab73538684b40199ea72`；状态文件 SHA-256 `53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3`。
- 门禁前资源日志 `/tmp/partsignal-i03-e1-c995-resource-pre.log`：4376 bytes，SHA-256 `362f9de8dbc4f5deef59926e9f7b62e9c9a94c7304980515e8821aa6613e98d4`，全部受控资源为 0。
- 已通过部分包括 contract/generated types、Ruff、ESLint、mypy、TypeScript、backend unit 683、frontend Vitest 780、PostgreSQL integration 337、两类 Docker build、real-stack Playwright 17、fixture Playwright 494 passed / 36 skipped、两次 secret scan和 frontend container harness。
- 失败点为 `deploy/scripts/test-e2e-run-lifecycle.sh`。顶层日志没有 case mismatch 文本，说明尚不能区分 expected-result grep、scanner/cleanup count、尾序、secret 删除、信号顺序或 stubborn escalation 断言；本轮不重跑以免违反单次完整门禁合同。
- 门禁后资源日志 `/tmp/partsignal-i03-e1-c995-resource-post-failed.log`：1594 bytes，SHA-256 `be61ba2817a3c4c942975e99c127af2f3eb73571201d3b00596d9d246a194b52`；受控临时目录、端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库和 frontend test 容器均为 0。
- 未派发 fresh reviewer，未创建 I04，未执行 fetch、push、SSH、Hostdzire inventory 或任何远程写入。
- case 级诊断在第 3 轮复现 `int-scan-fails`：`reporter-finished` 位于第 3 行，`playwright-parent-exited` 位于第 4 行，二者均在第 5 行 `scanner-called` 之前。根因是 harness 错误要求父进程必须早于同组 reporter；process-group 广播信号不保证 sibling 调度顺序。
- 修复把伪约束改为分别断言 parent/reporter 都在 scanner 之前；六类状态、cleanup 次数、secret 删除、SIGKILL escalation 和退出码断言均保留。每个 case 现在输出 begin/pass，失败输出 case、断言、期望/实际和不含 marker/secret 内容的 output/events。
- 修复后 30 轮压力验证全部通过，共覆盖 180 个 case。summary `/tmp/partsignal-i03-e1-f1-lifecycle-fixed-stress-summary.log`：621 bytes，SHA-256 `41c04cfc871ba54bdbdfa859e8b1143d136a0f5362d1f561639b6d0c06f93f13`。
- 最终定向日志 `/tmp/partsignal-i03-e1-f1-lifecycle-final.log`：651 bytes，SHA-256 `6b61128ba1b2ecf26d9576e49924dcc287583e388f3869fde099dc67ea58e131`；状态文件为 0，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。原始 TMPDIR、canonical TMPDIR 与 `/tmp` 中 lifecycle/secret 临时资源均为 0。
- 新固定候选为 commit `94fd8aaecfc683b9117764a879658731e91f88e6`、tree `23d67ad5c778a1a7115de262626f52afad8f6546`。全新 detached checkout `/Users/sc/.codex/worktrees/frontend-i03-e1-f1-94fd.mEDvD3/partsignal` 中唯一一次完整 `make verify` 退出 0；日志 `/tmp/partsignal-i03-e1-f1-94fd-make-verify.log` 为 222907 bytes，SHA-256 `d95ac8286dfee8f3131102a4ae2c7325fc89cb908e0821473940487b0fdf9421`；状态文件 SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 门禁前后资源日志均为 1686 bytes 且 SHA-256 同为 `16b58ab4bdf15f1faa16e2669a4be22f885b32a0f7137d9b95c9585924e3ae16`，全部受控临时资源、端口、Redis DB 14、E2E 数据库和测试容器为 0；candidate 与 validation identity 未漂移。
- fresh `critical_reviewer` 审计 Bundle `20260926T093221Z-i03-e1-f1-final-critical-review-591abf2a` 结论为 `BLOCKER`：持久 `STARTED` 没有 crash-safe owner、租约或孤儿回收，发送页在 `SETTLED` 前崩溃/关闭会永久关闭所有标签页和重载后的 session read barrier。已建立 G1 子 blocker；I03 父链继续 `in_progress`，I04 未创建，远程写入仍为 0。
