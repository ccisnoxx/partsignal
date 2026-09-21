# 修改本地工作流

先读 `.trellis/workflow.md` 的相关步骤及当前宿主入口；只在任务状态或资料确实影响变更时读取对应任务。

| 变更 | 权威位置 |
|---|---|
| 是否建任务、规划与实施授权 | Phase Index、Phase 1、start/brainstorm/continue |
| 委派与资料加载 | Phase 2、角色和 before-dev；Hook 协议由实际源码定义 |
| 验证与停止条件 | 全局规则及项目明确门禁；check 引用它们 |
| 暂停、提交、归档 | Phase 3、finish-work 和实际生命周期脚本 |
| 每轮程序状态 | `.codex/hooks/` 及 `common.active_task`，不修改流程文案冒充修复 |

保留 `## Phase Index`、`## Phase 1: Plan` 和 `#### X.Y` 的提取合同；仍消费文本提示的平台需要配对的 workflow-state 标签。Codex 状态 Hook 不读取这些流程正文。

恢复路由以真实状态、剩余验收和授权为准：planning 缺少必要信息时补齐，已准备且获准实施时 start；in_progress 继续未完成工作；completed 核实实际完成/归档。详情由 `trellis-continue` 入口维护，这里不再复制第二张完整路由表。

验证阶段提取、相关状态输出和必要引用；不为流程修改创建或归档真实业务任务。Trellis 更新时比较本地定制，不能直接覆盖。
