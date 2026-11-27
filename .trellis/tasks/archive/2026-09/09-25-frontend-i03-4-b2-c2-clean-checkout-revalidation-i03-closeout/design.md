# I03-4-B2-C2 验收设计

- validation worktree 是依赖、bootstrap、门禁和运行时资源的唯一 owner；候选工作区只承载 Trellis 记录，原检出区只读。
- 门禁前后使用同一份资源探针：先解析 raw TMPDIR、canonical TMPDIR 与 `/tmp` 的 identity，再按真实目录去重；只统计当前仓库 harness 明确定义的前缀与 fixture，不删除未知 owner。
- `make verify` 只执行一次。使用 `bash -o pipefail` 将 stdout/stderr 保存到固定日志，并把真实退出状态单独写入状态文件；分层计数与执行次数全部从该日志提取。
- 完整日志退出 0 仍不单独构成通过：secret scan、资源清理、固定 tree、三个工作区边界和门禁入口覆盖必须同时成立。
- fresh 独立复核只在所有前置证据成立后派发；复核者只读，禁止修改文件或执行 Git 写操作。任何 blocker 都终止本轮收尾并建立新的独立 blocker。
- 纯 Trellis 收尾提交是验证对象之后的元数据提交；产品候选身份始终是 `6aaf05a5` / tree `8a07b055`，不能把收尾 commit 误写为已验证产品 tree。

## 实际停止条件

- 固定候选的单次完整门禁、两次 secret scan、C1 cleanup regression、production harness、前后资源清理和 tree 一致性均成立；绿色结果没有依赖事后手工删除。
- fresh `critical_reviewer` 仍发现认证 refresh 跨两个独立响应拼接 session 的 P1 权限边界反例，因此 `NO BLOCKER` 条件不成立。依设计不更新父链为 completed、不创建收尾提交，也不在 C2 内修复。
- 新 blocker 固定为 `.trellis/tasks/09-25-frontend-i03-4-b2-c2-auth-session-cross-snapshot-blocker/`；后续修复会改变产品 tree，必须重新建立固定候选和完整门禁证据。
