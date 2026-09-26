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

## 下一步

检查完整 diff并形成新的固定候选；然后只在另一个全新 detached checkout 中运行一次完整 `make verify`。只有退出 0、门禁后资源为 0，才派发 fresh `critical_reviewer`。
