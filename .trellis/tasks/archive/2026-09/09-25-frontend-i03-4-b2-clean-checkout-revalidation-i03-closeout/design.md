# I03-4-B2 验收设计

- 候选工作区只承载 Trellis 记录；固定提交的 bootstrap、门禁与运行时副作用全部隔离到新 detached validation worktree；原检出区始终只读。
- `make verify` 是唯一可接受的完整门禁证据。日志、退出状态、SHA-256、分层计数和运行次数从同一次执行提取，旧 I03-4 与 B1 定向测试只作历史背景。
- 门禁前后使用相同资源清单核对端口、Redis DB、E2E 数据库和临时 secret/storage 产物；任何候选非 Trellis 文件变化或 validation tracked tree 漂移都会使证据失效并停止本会话。
- fresh `critical_reviewer` 仅在完整门禁、资源清理和 tree 一致性成立后派发；审查范围是 `9100774b..bcd98525` 全部 tracked 差异和本轮证据，代理只读且禁止 Git 写操作。
- 只有 reviewer 为 `NO BLOCKER` 才更新父任务链。若门禁或审查发现实质候选缺陷，则建立独立 blocker、保留恢复点和日志并结束，不在 B2 中修复。
