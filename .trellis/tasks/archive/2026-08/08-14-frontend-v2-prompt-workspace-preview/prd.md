# Frontend V2 Prompt Workspace Preview

## 1. 目标与用户价值

在已交付的 Prompt Workspace Core 中加入真实、可追溯的 Platform Prompt Preview：管理员选择服务端判定合格的 ContentTask 与可用模型，明确确认后创建普通 GenerationJob 和 AI ContentVersion，并在页面追踪 Job 到不可变结果或公开失败。

Preview 用于验证已保存、已绑定 Prompt 的真实生成效果，不是未保存模板沙箱或无痕 AI 调用。

## 2. 显式依赖

- 父规划：`.trellis/tasks/08-13-frontend-v2-prompt-workspace`。
- Core 已验证、提交、归档至 `.trellis/tasks/archive/2026-08/08-14-frontend-v2-prompt-workspace-core`，并 fast-forward 合入 main。
- Preview 从包含 Core 的 clean main 开始，不直接建立在未合入的 Core branch/worktree 上。
- 候选临时分支：`codex/frontend-v2-prompt-workspace-preview`。
- 用户已批准本最新规划并授权 start/建分支。

## 3. 已确认事实

- 现有 generation endpoint只允许 ContentTask 平台当前绑定的已保存 Prompt ID/revision；服务端锁内校验 Prompt、Task、Fact、Product、Platform、model并冻结 snapshot。
- 现有 ContentTask action projection是 `CREATE_GENERATION_JOB` 资格权威。
- 现有 generation-options只能在已知 task后返回模型/当前 Prompt，不能为某 Prompt提供完整合格 context集合。
- V1 通过分页/全量 ContentTask list + 客户端 action过滤 + generation-options形成 waterfall，不可复制。
- V2 Content AI Production已实现 stable Idempotency-Key、existing POST、按返回 Job ID轮询 task Job list、terminal stop、failure和ContentVersion模式。
- Preview成功会创建普通 AI DRAFT并推进所选ContentTask当前主线；没有独立preview job type或audit_log action。

## 4. 范围

### 4.1 Preview Options 合同

新增 ADMIN-only：

`GET /api/v1/platform-prompts/{platform_prompt_id}/preview-options`

响应只包含：

- 当前 Prompt identity：id/name/revision。
- 全部当前合格 Test Context identity：task identifier、Product、Platform、Fact version。
- 当前 enabled channel + enabled/tested models。

不返回 Prompt/Fact Markdown、完整Task、actions、Job history、ContentVersion、snapshot、credential或secret。

### 4.2 资格与服务端 owner

- Preview Options属于Content production/read-query owner；endpoint路径按Prompt定位但不把生成规则移到Configuration。
- 候选任务必须是平台当前绑定目标Prompt，并最终复用 `content_tasks_out` 的 `CREATE_GENERATION_JOB` action筛选；不复制状态机。
- contexts由服务端稳定排序；sparse/dense固定查询次数，无N+1。
- 模型options与既有generation-options复用同一query helper。
- 写命令继续锁内重新校验；read model不授予权限或替代mutation authority。

### 4.3 Preview UI

- 只对已保存、clean且Detail revision与options prompt revision一致的Prompt启用。
- 用户必须显式选择Test Context和model；不设置默认。
- loading/empty/error/retry明确；无context时说明Prompt必须绑定到拥有合格首稿任务的平台。
- 提交Dialog明确说明：将创建普通、可审计的GenerationJob和AI ContentVersion，并占用所选任务首稿位置；不是沙箱。
- 当前未保存Markdown与既有Preview结果视觉上明确区分。

### 4.4 Command、Polling 与结果

- 调用既有 `POST /content-tasks/{id}/generation-jobs`，payload使用options response的Prompt ID/revision和显式model。
- 同一command signature使用稳定`crypto.randomUUID()` Idempotency-Key；payload变化或IDEMPOTENCY_CONFLICT后废弃旧key。
- 只追踪create response的Job ID；仅PENDING/RUNNING轮询其task Job list，terminal停止。
- FAILED展示公开error code/summary；不自动retry、不伪造结果。
- SUCCEEDED按`content_version_id`读取既有immutable ContentVersion，展示title/summary/body/tags/status、Job/Version identity和task link。
- Prompt之后update/delete/unbind不改变当前结果；不读取完整Job snapshot来渲染Preview。

### 4.5 Cache

- Preview Job create：保存returned Job，invalidate exact task Job list、Preview Options、Content task list/detail/editor contexts。
- terminal：停止polling，读取Version；invalidate Preview Options和Content task list/detail/editor contexts。
- Prompt update/delete、Platform bind/unbind补充Preview Options invalidation。
- 不清QueryClient，不失效/重写历史Job或Version。

### 4.6 文档

更新V2 03/05/08/09，记录Preview Options、真实首稿副作用、幂等/polling/result与测试证据。无数据库schema变化，不修改database contract或migration。

## 5. 验收标准

- [x] OpenAPI、generated V1/V2 types与runtime FastAPI一致。
- [x] Preview Options ADMIN 200、ENGINEER 403、未知Prompt 404。
- [x] contexts仅包含当前Prompt绑定平台且拥有CREATE_GENERATION_JOB资格的任务，稳定排序且无N+1。
- [x] models仅包含channel/model enabled且model test PASSED；与generation-options共用query owner。
- [x] dirty/new/revision mismatch禁用Preview且有明确原因。
- [x] context/model无默认，用户显式选择并确认真实首稿副作用。
- [x] command使用既有endpoint、准确Prompt revision与stable Idempotency-Key，pending防重。
- [x] 只跟踪returned Job；PENDING/RUNNING polling，SUCCEEDED/FAILED terminal stop。
- [x] 成功读取immutable ContentVersion；失败只显示公开error，无假成功/auto retry。
- [x] create/terminal/Prompt/Platform mutation精确失效真实消费者。
- [x] production-artifact fixture覆盖pending/success/failure/empty/error和四档布局；未声明API/runtime error失败。
- [x] backend integration + fixture + 既有Content AI real-stack形成证据链，不重复整套provider flow。
- [x] 文档与合同/代码一致。

## 6. 排除项

- 未保存Prompt preview、raw prompt endpoint、browser直连provider。
- preview Job type/flag/table、临时ContentVersion、可变历史或额外audit_log协议。
- Humanization Prompt或自然化Preview。
- Prompt CRUD重写、Platform bind UI、AI配置CRUD/discovery/test/credential。
- 完整Job snapshot默认读取、自动retry、批量Preview、通用workflow engine。
- 数据库migration、新依赖、Phase 6完整real-stack E2E。

## 7. 风险与 Deferred

- Preview是实际业务首稿，会消耗context；通过确认、任务链接和terminal后的context移除管理风险，不增加沙箱语义。
- 复用`content_tasks_out`可能产生比专用SQL更多但固定的查询；只有实测不可接受时才在同一owner抽取共享资格projection，不能复制规则。
- 现有GenerationJob记录可追溯但没有“从Prompt Workspace发起”的持久化标记；本范围明确把它当普通生成，不新增origin字段。
- 没有阻塞性产品问题；唯一执行阻塞是Core必须先合入main。
