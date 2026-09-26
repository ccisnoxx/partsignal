# 后续恢复建议

1. 启动本 blocker 后，读取认证 OpenAPI、identity service/router、AuthProvider、principal epoch owner 与现有 deferred 测试，确定原子 session snapshot 的权威合同。
2. 先增加能稳定控制两次响应交错的失败测试：ADMIN→ENGINEER、A→B 双标签页替换、ABA/session binding，以及旧 continuation/offline resume/paused retry/callback 内 await。
3. 按 contract-first 顺序实现 OpenAPI、runtime schema、generated types、后端原子响应和前端消费；保留同主体 refresh 正向行为。
4. 运行受影响合同、后端、前端并发测试和静态检查，并安排独立高风险定向复核。
5. 形成新固定 commit/tree 后，重新执行 detached clean-checkout 单次完整 `make verify`、门禁前后资源清理与 fresh 完整候选复核；只有 `NO BLOCKER` 才恢复 C2、I03 与总体交付收尾。

## 本轮失败证据与恢复点

- 固定候选：`6aaf05a5ad5371493bb20c95b5cbdb5908a27cf9`；tree：`8a07b055bcb9f8d2b4038f7e31ac5fab71c815e1`；基线：`9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 失败阶段不是门禁执行：单次顶层 `make verify` 已退出 0，日志 `/tmp/partsignal-i03-4-b2-c2-clean-verify.log` 为 227525 bytes，SHA-256 `9f6c68bc57ec8bf8e9ac48bd6b231a238a4634fc88c57efe74984fc6990c9ca6`；状态文件 `/tmp/partsignal-i03-4-b2-c2-clean-verify.status` 为 `MAKE_VERIFY_EXIT=0`，SHA-256 `edf64405e10ca46b29062e55558b8fe58eb9231cd801980c17aeae70026c9d85`。
- 门禁前后资源快照分别为 `/tmp/partsignal-i03-4-b2-c2-resource-pre.log` 与 `/tmp/partsignal-i03-4-b2-c2-resource-post.log`；相关临时目录、四端口、Redis DB 14、E2E 数据库、测试容器和 Playwright 产物均为 0，未依赖事后手工清理。
- fresh `critical_reviewer` 对 `9100774b..6aaf05a5` 的结论为 1 个 P1 发布阻断；审计包 `20260926T050726Z-i03-4-b2-c2-bd695dc3` 已关闭并验证通过。
- 本会话没有修改候选代码/测试/合同/依赖/门禁，也没有重复运行完整门禁；建议恢复点是本 blocker 的 contract-first 设计与确定性交错失败测试。

## D1 完成状态

- 子任务 `.trellis/tasks/09-25-frontend-i03-4-b2-c2-d1-atomic-auth-session-snapshot/` 已完成合同、后端、generated types、AuthProvider、确定性交错与 auth-session real-stack 修复。
- 定向检查与三轮独立高风险复核已闭环，最终结论为 `NO BLOCKER`；审计包 `20260926T055735Z-i03-4-b2-c2-d1-23f1a8df`。
- 父 blocker 保持 `in_progress`。下一任务固定为：“基于原子认证快照修复提交执行全新 clean-checkout make verify、资源清理、完整候选独立复核和 I03 总体收尾。”
