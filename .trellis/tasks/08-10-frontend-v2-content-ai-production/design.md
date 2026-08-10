# 设计：Frontend V2 Content AI Production

复用 Core Editor Context 与 Workspace，不新增第二个页面状态机。generation-options 和完整 job detail 只在用户打开对应界面时请求；轮询只针对当前创建 job。所有 snapshot、source、based_on_id 和 source_job_id 由服务端决定。该任务不得修改 Core 的人工 payload 或不可变规则。
