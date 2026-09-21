---
name: trellis-start
description: 恢复 Trellis 项目的任务与规范入口。用于明确开始 Trellis 工作、会话恢复后缺少项目状态，或需要重新定位活动任务时。
---

# 启动与恢复

先复用本轮 Hook 已给出的真实状态；缺少时运行 `python3 ./.trellis/scripts/task.py current --source`。需要更完整的 git、身份或 workspace 概况时运行 `get_context.py`；不要为启动机械读取全部日志和任务。

首次不熟悉项目工作流时读取 `python3 ./.trellis/scripts/get_context.py --mode phase`。需要进入未知模块时用 `--mode packages` 查对应 spec 索引，仅读相关合同。Codex 支持 SessionStart，但是否启用须看本项目注册与信任，不能假定没有或已经运行。

- 无活动任务：按当前请求继续；是否持久记录沿用 `.trellis/workflow.md`，不为小修询问建任务。
- `planning`：检查目标、验收与实质未决事项；必要时加载 `trellis-brainstorm`。已有实现授权且就绪时可开始执行。
- `in_progress`：依据未完成验收继续实现或检查。
- `completed`：核对真正完成与归档情况；状态不证明代码已提交。

只有需要对应步骤时读取 `get_context.py --mode phase --step <X.Y> --platform codex`。
