# T2 启动前 dirty baseline

记录时间：2026-09-04（Asia/Shanghai）

- checkout：`main`
- 任务启动前状态：`planning`
- 全工作区 dirty 条目数：559
- `git status --porcelain=v1 -uall` SHA-256：`5d92317419025f879bfcb83d66ffcb52ed550a40bdba3d744bc8c9288a1823b6`
- `43c252da`、`a805aeeb`、`1a526da9` 均已确认是当前 `HEAD` 的祖先。
- `design.md` 第 8.1 节全部批准实施路径在启动前均无 tracked/untracked dirty 状态。

本记录仅用于区分用户既有工作与本 T2 变更。不得清理、还原、暂存或提交基线中的其他 dirty 文件和 artifacts。
