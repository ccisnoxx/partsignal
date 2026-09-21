---
name: trellis-continue
description: 继续已有 Trellis 任务，定位上次进度与剩余验收。用于明确继续任务，或跨会话恢复后需要确定下一步时。
---

# 继续任务

通过已提供的准确任务路径或 `python3 ./.trellis/scripts/task.py current --source` 确认本会话任务；缺少路径时不要借用别的会话。

读取缺失或变化的 `prd.md`、相关设计/执行记录和验证证据，复用仍完整的当前上下文。

| 状态与证据 | 下一步 |
|---|---|
| planning，目标或必要设计未清楚 | 补足具体缺口，必要时 brainstorm |
| planning，已准备且有实现授权 | `task.py start <task-dir>` 后实施 |
| in_progress，验收仍有未完成项 | 继续实现与相关检查 |
| in_progress，验收完成 | 按需同步文档；提交/归档分别依授权 |
| completed | 核对归档与交付，避免再次实现 |

`prd.md` 存在不等于规划或实现完成；只规划的原请求也不因恢复命令自动变成实施授权。已有明确实施授权不需要重复批准。

工作流细节由 `.trellis/workflow.md` 管理；必要时运行 `get_context.py --mode phase --step <X.Y> --platform codex`。
