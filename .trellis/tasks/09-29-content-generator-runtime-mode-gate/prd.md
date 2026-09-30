# CONTENT_GENERATOR 正式 Worker 运行模式门禁修复

独立任务，parent=null，基线 clean main `743ace98a322fc8b060360e54d2cb8298d296eba`。上一任务记录已经单独提交并 fast-forward push。

## 目标与边界

- 保留 deterministic 兼容值，正式 GENERATE/HUMANIZE/RETRY 禁止业务第三方调用，不生成固定成功内容；管理员显式模型测试/发现独立于业务模式。
- openai-compatible 保持严格 PUBLIC、配置状态、快照、凭据/Header、Usage、lineage、at-most-once 与 lease 合同。
- 服务端 actions/options/Prompt Preview 收敛；直接命令在 Job 写入/commit/Redis 前明确拒绝；Worker 对历史或竞态 PENDING fail-closed 到诊断终态、重复投递幂等。
- 已 RUNNING 请求无法撤回；配置为进程启动快照，沿用租约与迟到结果合同。
- 测试显式 ContentGenerator 注入继续仅测试使用，正式 Celery UUID 入口不接受注入。
- 按 contract-first 更新必要错误码、OpenAPI、生成类型、前后端与文档。
- 仅本地实现/验证/独立复核/Git 收口，不接真实 OSS、不改线上 credential/env/数据库/容器，不部署 Hostdzire、不做 Production cutover/release；保留旧任务与其他任务/工作区。

## 验收

- [x] 独立只读分析与调用图确认最小语义；Settings/CLI/bootstrap/env/CI/E2E/部署工具覆盖。
- [x] deterministic actions/options 关闭；create/humanize/retry 在副作用前拒绝。
- [x] PENDING Worker 终态、重复投递、provider sentinel=0，无 Version/成功 Usage。
- [x] openai-compatible GENERATE/HUMANIZE/RETRY 精确一次调用，lineage/Usage/错误映射不变。
- [x] RUNNING 无重放、Beat redispatch、eager/Celery 一致；配置两种值与未知/production 约束。
- [x] 前端消费服务端动作与空模型候选，无可点击生成入口。
- [x] 定向检查、lint/typecheck/contract、真实 PostgreSQL/Redis/Celery lifecycle 通过。
- [x] fresh critical_reviewer 最终 NO BLOCKER，有效 SUBAGENT_EXECUTION_DIGEST。
- [x] 候选稳定后仅一次完整 make verify，保存日志/退出码/测试数量/SHA/清理证据。
- [x] 最后 diff/secret scan/JSON 解析，原子提交并非强制 fast-forward push；local main=origin/main，clean。

若调查需要删除 CONTENT_GENERATOR，不破坏兼容；记录 blocker 并停止等待单独合同决策。
