# I03-4-B2-C2-D2 验收设计

- validation worktree 是 bootstrap、门禁和本地临时资源的唯一 owner；候选工作区只写 Trellis 证据，原检出区在 I03 结束前只读。
- 前后资源快照复用同一探针，先记录 raw TMPDIR、canonical TMPDIR 与 `/tmp` identity，再按 canonical 路径去重统计仓库明确前缀。
- `make verify` 仅执行一次；完整日志通过 `bash -o pipefail` 写入固定路径，真实退出码单独落盘，分层计数只从本次日志提取。
- 顶层退出 0 之外还要求 secret scan、资源清理、固定 tree、tracked source 完整与三个工作区边界同时成立。
- fresh `critical_reviewer` 只读复核完整候选和本轮证据；任何 finding 都阻断 I03 收尾和远程写入。
