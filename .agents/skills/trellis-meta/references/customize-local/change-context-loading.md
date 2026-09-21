# 修改上下文加载

本项目 Codex 的注入源是 `.codex/hooks/runtime_context.py`，它提供当前任务状态和资料路径。代理定义 `.codex/agents/trellis-*.toml` 说明如何按委派读取资料；JSONL 记录有关规范和研究的路径与 reason。工作流负责流程说明，不由每轮 Hook 原样注入。

按实际问题定位：

| 问题 | 权威位置 |
| --- | --- |
| 状态或任务路径错误 | common/active_task.py、事件 session 身份与指针 |
| 注入太多/缺字段 | runtime_context.py |
| 代理没读相关资料 | 委派范围、角色定义和任务 JSONL |
| 加载时机不正确 | .codex/hooks.json 与宿主信任 |
| JSONL 验证错误 | common/task_context.py |

任务资料按实际问题渐进读取；已有且未变的上下文可以复用。保留 PRD 验收与相关合同的权威性，但不要求每次读全部规范、研究、历史和工作流。Hook 不可用时使用主代理明确提供的任务路径，不能把另一个 session 的任务当作恢复信息。

验证新的加载行为同时检查隔离与失败路径。CLI 的 current/list-context/validate 可用于已明确任务的诊断，但默认不要以枚举所有任务或读取历史代替身份核对。
