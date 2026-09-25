# I03-4 验收设计

- validation worktree 只从固定 Git commit 创建；候选工作区负责 Trellis 记录，原检出区只读，三者职责不混用。
- `make verify` 是唯一完整门禁入口；完整日志与 `PIPESTATUS` 单独持久化，拆分检查只能用于环境故障诊断，不能替代本轮门禁。
- 运行环境只覆盖宿主 PostgreSQL 测试连接和独占 Redis DB 14；不 source 或整体导出 `.env`，避免开发设置污染 production Settings 测试。
- 门禁前后记录端口、Redis key、E2E 数据库、临时目录和三处工作树状态；tracked tree 或候选代码变化立即使证据失效。
- 独立复核只在完整门禁通过和清理完成后进行；复核者只读，不修改文件或执行 Git 写操作。
- 收尾提交只表达 Trellis 验收结果；实际验证对象始终记录为该提交的直接祖先 `88992307cdf42b3935f30938bc73f750dd9cde4b`。
