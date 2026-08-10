# 设计：Frontend V2 Content AI Production

## 边界

复用 Core Editor Context、Content query keys 和现有 Workspace，不新增 route、全局 store、第二个页面状态机或通用 workflow framework。异步 AI 生命周期由 content domain 内一个局部 `content-ai-production` 组件负责；Core 页面只传入当前 Editor Context 和会话安全信息，人工编辑 model/payload 保持不变。

OpenAPI 已提供 generation options、job summary/detail、create/retry/humanization 命令以及 frozen snapshot union。本任务不新增合同 shape 或数据库表，只修复服务端 retry 动作投影与 command guard 的一致性。

## 数据流

1. 路由仍只预取 `ContentEditorContext`。
2. 用户打开生成或 humanization 对话框后，才请求 `generation-options`。
3. 生成对话框完整显示服务端返回的只读 Prompt identity、revision 和 Markdown；模型初始为空。确认提交只发送 `ai_model_id + platform_prompt_id + platform_prompt_revision`。
4. create/retry/humanization 使用浏览器原生 `crypto.randomUUID()`。组件按命令签名保存 key；只有明确成功、明确输入变化或服务端确认 key 冲突时才换 key，网络结果不确定时复用。
5. 作业创建响应或 Editor Context 的 `latest_generation.id` 成为当前跟踪 job。summary query 只在 AI surface 需要进度/失败处理时启用；`refetchInterval` 仅在该 job 为 `PENDING/RUNNING` 时返回轮询间隔，否则为 `false`。
6. job 进入 terminal 后立即停止轮询，invalidate 并 refetch 精确 Editor Context。页面不合成 ContentVersion，也不根据时间或版本号推导 current。
7. 用户显式点击“查看完整作业快照”时才请求 `GenerationJobDetail`，以只读形式显示 snapshot。retry 只发送 job ID 与幂等键。
8. humanization 入口只来自当前 ContentVersion 的 `CREATE_HUMANIZATION_JOB`；完成后新版本、`based_on_id`、`source_job_id` 和 current pointer 全部由服务端确认。

## 服务端动作权威

`generation_jobs_out` 必须基于数据库中每个 task 的真实最新 job 投影 `RETRYABLE_FAILURE/HISTORICAL_FAILURE`，不能把单 detail 请求自身视为最新。`retry_generation_job` 在锁定父 task 后复核同一最新性条件，避免客户端持有过期 `RETRY` token 时创建历史分叉。列表投影保持固定查询次数，不引入 N+1。

## 错误与竞态

- `PLATFORM_PROMPT_CHANGED`：保留明确错误，重新加载 options，清空旧确认，不使用旧 Prompt fallback。
- 网络结果不确定：保留相同命令签名和幂等键，由服务端返回已有作业。
- terminal 与 Editor Context pointer 更新竞态：以 terminal summary 触发 refetch，最终只渲染服务端 Context；不在客户端补 pointer。
- 非最新失败作业、任务关闭、事实或模型失效：服务端返回结构化错误，前端展示 request ID 并刷新权威投影，不自动改写请求。

## 测试边界

- Backend 单元测试覆盖 detail/list 最新性投影和 command 最终守卫；既有 generation reliability 测试继续证明 worker、exact snapshot 与 humanization 不变量。
- Component 测试覆盖按需 options/detail、明确确认、稳定幂等键、活动态轮询、terminal 停止/refetch、failure/retry 和 humanization。
- Typed fixture E2E 覆盖浏览器交互、请求 payload/header 和 current pointer 行为。
- 新增独立 V2 AI real-stack spec，复用现有 PostgreSQL、Redis、FastAPI、Celery、fake provider 和 preview 生命周期；成功/humanization 与 timeout/exact retry 使用各自独立 ContentTask，不创建第二套 orchestration。
