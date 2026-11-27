# I03-4-B2 production harness 清理 blocker 执行建议

1. 用最小可控命令复现尾斜杠临时根经过规范化后 cleanup pattern 不匹配、harness 仍退出 0 的行为。
2. 在 `deploy/scripts/test-deploy-production.sh` 内建立唯一规范化临时根，并让创建、所有权判断和 cleanup 共用该值；保留目录越界防护。
3. 让 cleanup 跳过或失败可观测且影响最终退出状态；增加不依赖真实部署的路径语义回归检查。
4. 执行受影响的 production deploy harness 定向检查；输入发生实质变化后，再从更新后的固定提交运行一次全新 B2 clean-checkout `make verify`。
5. 重新核对两类临时根、固定端口、Redis DB 14、E2E 数据库、validation tree 与候选 tree，并安排 fresh `critical_reviewer`。

以上段落是 blocker 创建时留下的后续修复建议；创建 blocker 的上一会话没有实施代码或测试基础设施修改。

## C1 修复结果

- 子任务 `09-25-frontend-i03-4-b2-c1-production-harness-tmpdir-cleanup-fix` 已完成：旧缺陷直接复现，canonical owner/strict allowlist/失败传播修复与文件系统回归全部通过，最终 fresh `critical_reviewer` 为 `NO BLOCKER`。
- 本父 blocker 继续保持 `in_progress`；尚未执行修复提交后的 B2 clean-checkout 完整 `make verify`、全资源清理和完整候选独立复核。
- 下一恢复点：基于 TMPDIR cleanup 修复提交重新执行 I03-4-B2 clean-checkout 完整门禁、资源清理、完整候选独立复核和 I03 收尾。
