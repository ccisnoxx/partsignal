# 本地工作流维护

`.trellis/workflow.md` 是本项目的流程维护源；AGENTS 管理项目约束，任务资料记录验收和决策，Hooks 负责实际状态。改变流程时同步受影响的技能/角色入口，避免再次复制整套规则。

`## Phase Index` 与 `#### X.Y` 由 `common/workflow_phase.py` 提取，编号不是 task.json 字段。保留现有编号以兼容旧调用；新增阶段或状态时同时核对解析器、状态写入者和 continue 路由。

Codex Hooks 输出任务状态和资料路径，不再按每轮内联 workflow 正文。文件中的配对 workflow-state 标签保留给仍消费文本提示的平台；修改标签不能冒充程序状态发生变化。

小任务不强制建记录；planning 就绪且已有实现授权可继续执行。委派按独立收益和复核风险决定，auto 不强制代理轮转；显式 inline 仍由主会话执行。提交、归档、会话结束分别按真实授权和验收判断。

更改后检查 `.trellis/workflow.md`、相关 `.agents/skills/`、`.codex/agents/` 和 `.codex/hooks/` 的适用部分。维护项目副本并保留更新差异，不修改 npm 安装缓存，也不假设当前会话已经重载。
