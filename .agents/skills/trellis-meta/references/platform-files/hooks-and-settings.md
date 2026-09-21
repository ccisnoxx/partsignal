# Hooks 与注册

本项目 Codex 在 `.codex/hooks.json` 注册 `UserPromptSubmit`、`SubagentStart` 和 `SessionStart`（startup/resume/compact）。三个入口调用 `.codex/hooks/runtime_context.py`，只提供 `<trellis-state>` JSON 状态索引，不注入工作流、PRD 或规范正文。

- `UserPromptSubmit`：恢复当前 session 的任务状态与资料路径；`no-trellis` 可跳过本次注入，配置 `prompt_injection.skip_keyword` 可调整。
- `SessionStart`：同样的只读状态恢复，没有首条回复确认或无任务建档要求。
- `SubagentStart`：仅匹配 `trellis-implement`、`trellis-check`、`trellis-research`，提供角色相关资料索引；代理自行读取与委派问题相关的资料。

注册存在不等于宿主已执行。项目与 Hook 内容需经宿主信任；修改后通过 Codex `/hooks` 检查或重新信任，不手写信任哈希。Hook 失败输出 stderr 并返回非零，不冒充 no_task。改变脚本或注册后，用合成 session 输入验证输出以及实际宿主加载状态。

其他平台仍以其真实设置和脚本为准，不因 Codex 的实现而复制事件名或宣称行为相同。工作流内容由 `.trellis/workflow.md` 维护，但 Codex Hook 不解析其中的 workflow-state 块。
