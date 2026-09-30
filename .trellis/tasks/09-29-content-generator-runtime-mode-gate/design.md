# 最小运行合同与所有权

- 配置 owner 是 Settings 启动快照；保留两个值和现有 production validation，不新增 runtime adapter/factory。
- 业务资格共享 owner 位于 generation.py 的模式 predicate / require guard，由 content_production、projections、model options 和 Worker 复用。管理员模型测试/发现不使用业务 guard。
- API create GENERATE/HUMANIZE/RETRY 在服务入口且幂等 replay 前拒绝 `AI_GENERATION_DISABLED`（409，details={}），没有 Job/commit/Redis 副作用。ErrorDetail.code 及 Job.error_code 原为 string，不新增全局错误 enum。
- Worker 先锁 Job 且吸收非 PENDING；模式门禁位于 PENDING 的 existing ContentVersion recovery 前。拒绝保持 attempt_count/started_at，设置 FAILED/error/finished_at/clear lease，commit 一次；不改变既有 ContentVersion 历史。真实 generate_for_job 外发边界再次 guard，覆盖直接调用。显式 generator 仅 APP_ENV=test 使用；正式 UUID/eager 入口永远不注入。
- RUNNING 重投不重放；执行者已发请求不由模式切换撤回，收尾不因关闭模式丢弃正常结果，保留现有 lease/迟到结果合同。env 修改不是热重载。
- Beat 仍只补投递超龄 PENDING UUID，由 Worker 最终模式裁决；不开第二状态机。API gate 后 commit/dispatch 之间进程配置差异由 Worker backstop 收敛。
- read projection 移除 CREATE_GENERATION_JOB/CREATE_HUMANIZATION_JOB/RETRY，保留人工工作流；共享模型 options deterministic 返回 []，Prompt Preview contexts 由动作筛选为空。
- 前端只消费动作/options：初始无入口，打开确认窗后的 action/candidate 撤销同时禁用控件与 submit handler。模式拒绝显示真实错误并刷新 canonical projections/options；不按错误推导资格或自动重发。
- OpenAPI operation/Schema descriptions、生成类型、database lifecycle 文档与稳定运维说明同步。无新表/列，是否需要 migration 由独立分析确认 current-head trigger。
- CI/backend-test 明确 openai-compatible 供本地协议 mock 成功回归，专门 deterministic 测试显式覆盖关闭模式；E2E 已显式 openai-compatible，无线上配置变更。

## 验证顺序

定向 unit/integration → lint/typecheck/contract → PostgreSQL/Redis/Celery lifecycle → fresh critical review NO BLOCKER → 单次 make verify → diff/JSON/secret scan/资源清理 → 原子 commit/非强制 push。
