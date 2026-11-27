# I03-4-B2-C2-D2-E1-F1 实现记录

## 根因

`e2e-process-group.py` 向独立 process group 广播终止信号，父 Playwright fixture 与 reporter 是同组 sibling，内核不保证二者的 signal handler 调度顺序。原 harness 却要求 `playwright-parent-exited < reporter-finished < scanner-called`，因此在 reporter 先完成的合法交错中误报。

诊断增强后的第 3 轮定向运行捕获到：

```text
reporter-started
playwright-started
reporter-finished
playwright-parent-exited
scanner-called
cleanup
```

这证明进程组已在 scanner 前完整收敛，失败仅来自无合同依据的 sibling 顺序断言。

## 修复

- 每个 lifecycle case 输出 `status=begin` / `status=passed`。
- 每条失败断言输出 case、断言名、期望/实际，以及不读取 marker/secret 文件的 output/events。
- 保留 parent 与 reporter 都必须先于 scanner 的约束，但不再规定 parent 与 reporter 之间的顺序。
- 保留六类退出码、scanner/cleanup 单次执行、最终 cleanup、secret 文件删除和 stubborn descendant SIGKILL escalation 断言。
- 将 sibling 顺序合同写入 `.trellis/spec/infra/e2e-isolation.md`。

## 定向验证

- shell syntax 与 `git diff --check` 通过。
- 首次增强诊断运行通过；随后压力复现在第 3 轮捕获精确失败断言。
- 修复后 30/30 轮通过，共覆盖 180 个 case。
- 最终定向运行六个 case 全部通过，状态 0。
- 原始 TMPDIR、canonical TMPDIR 与 `/tmp` 的 lifecycle/secret 临时资源均为 0。

## 完整门禁与复核

- 固定候选 `94fd8aaecfc683b9117764a879658731e91f88e6` / tree `23d67ad5c778a1a7115de262626f52afad8f6546` 在全新 detached checkout 中唯一一次完整 `make verify` 退出 0。
- 日志 `/tmp/partsignal-i03-e1-f1-94fd-make-verify.log` SHA-256 为 `d95ac8286dfee8f3131102a4ae2c7325fc89cb908e0821473940487b0fdf9421`；门禁前后资源快照逐字节相同，SHA-256 均为 `16b58ab4bdf15f1faa16e2669a4be22f885b32a0f7137d9b95c9585924e3ae16`。
- fresh critical review 审计 Bundle `20260926T093221Z-i03-e1-f1-final-critical-review-591abf2a` 拒绝候选：认证 transition 的持久 `STARTED` 缺少 crash-safe owner/租约和孤儿回收，发送页未发布 `SETTLED` 即终止时会永久锁死 session read barrier。

## 下一步

进入 G1 子 blocker，设计并实现不重开旧主体窗口的孤儿 `STARTED` 回收收敛；补充发送页在 `STARTED` 后关闭/崩溃、存活页恢复与全页面重载恢复的同 BrowserContext 真实栈证据。形成新候选后必须再次使用全新 detached checkout 且只运行一次完整 `make verify`，通过后再派发另一名 fresh `critical_reviewer`。
