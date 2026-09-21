# 本地上下文加载

Codex Hook 负责恢复状态和资料索引，工作流与技能负责说明流程，代理按当前任务读取必要资料。`<trellis-state>` 的出现不表示资料正文已经加载。

状态唯一来源是 `.trellis/scripts/common/active_task.py` 解析的 `.trellis/.runtime/sessions/`。Codex Hook 只采用事件 payload 的会话身份，禁用环境覆盖和单会话猜测；没有身份报告 `unknown_session`，无指针报告 `no_task`，失效指针报告 `stale_task`。任务路径及所列资料必须解析在仓库内；损坏 JSON、未知任务状态、越界或缺失依赖是可见错误。

任务正常状态为 `planning`、`in_progress`、`completed`。Hook 不修改任务、不推进生命周期、不读取历史或生成任务。SessionStart 与 UserPromptSubmit 均输出状态索引；SubagentStart 为 implement/check 加对应 JSONL 路径，为 research 加已有 research 目录。

JSONL 每行是对象，例如 `{"file":".trellis/spec/backend/index.md","reason":"相关后端约束"}`。忽略没有 file 的种子行，结合 reason 与委派范围按需读取；代码由代理直接查找。PRD、design、implement 按任务相关性读取，无固定全量附件装载。

若任务丢失，先核对 Hook 注册、宿主信任、事件身份与对应 session 指针；CLI 环境身份与 Hook payload 是两条不同入口，不能用另一个窗口的任务补位。
