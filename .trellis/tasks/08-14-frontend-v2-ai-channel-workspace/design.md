# Frontend V2 AI Channel Workspace 设计

## 1. 设计结论

推荐保留三个实现子 Task：Core、Models、Runtime，顺序为 Core → Models → Runtime。拆分边界分别是 channel aggregate、model resource、read-only runtime；Basic 与 Request 不拆，因为共享一个完整 `AIChannelUpdate`、一个 channel revision 和一个 dirty baseline。

Workspace 不需要新的聚合 API、数据库结构、全局 store、Workspace framework 或 Action Registry。沿用现有 AI API owner，复用 Platform Workspace 的 route/header/tab/conflict 形态、Prompt Workspace 的 canonical URL/dirty 方法、AI Channel List 的 handoff 与 cache keys、Table Kit/RowActions；`WorkspaceShell` 的三栏能力不适合当前单主区五 section 蓝图，强行使用只会制造空 context/reference pane，因此本设计不使用它。若实现时出现真实的三栏信息关系，再在对应子 Task 设计评审中证明后复用，不预建抽象。

## 2. 当前实现与蓝图 gap analysis

| 主题 | 已验证现状 | 缺口 | 决定 / 子 Task |
| --- | --- | --- | --- |
| 路由与 handoff | V2 List 已生成 `/settings/ai/{id}?tab=basic|request|models|usage`；无详情路由或占位页 | 五 section、canonical search、direct/refresh/history 尚不存在 | Core 注册真实 `$channelId` route；Runtime 增加 usage/logs 条件 search，不建占位 |
| 创建渠道 | V1 使用 `AIChannelCreate` Modal；V2 List 明确没有入口 | 新建入口缺失；`/new` 没有真实需求 | Core 在 List 页面增加真实 Dialog，成功进入新 Workspace；不建 `/new` route |
| Detail read model | `GET /ai-channels/{id}` 已返回非凭据标量、Header、enabled model summary、workflow/action/revision | Header 普通 value 仍会回显并进入 query cache；全量模型不能由 enabled summary 表达 | Core 从 Header read model 移除所有 value；Models 按需读取模型集合；不新增 Workspace context API |
| Basic / Request | V1 编辑 Modal 一次提交所有 update 字段；OpenAPI `AIChannelUpdate` 全部 required | 若分 Task 或独立 partial form，会猜测/补齐另一 section 的字段 | 同一 Core Task、同一 RHF owner、同一 baseline；两 tab 只分展示，不分提交合同 |
| API Key | 后端仅回 `configured/updated_at`，PUT replacement 已用 channel revision | V2 无替换 UI；错误/关闭后的生命周期未定义 | Core 独立 replacement Dialog；`gcTime: 0`、立即 reset，永不 seed Query cache |
| Header | create/update 已比较 channel revision并失效 models；敏感值不回显，普通值会回显；delete 无 revision | 所有 Header value 的缓存安全不满足；delete stale command 可成功 | Core 删除 response `value`；普通/敏感均替换式；delete 增 required `expected_channel_revision` |
| Channel revision | update/key/header/enable/disable/delete 使用 channel revision；Header 变化递增 channel 并递增所有 model revision | 客户端 baseline、dirty、冲突锁定尚未实现 | Core 明确 channel owner；409 保留非敏感草稿、禁止旧 revision resubmit、显式 reload |
| Model list/CRUD | 现有 GET/POST/PATCH/DELETE；model 有独立 revision | create 无自身 revision是合理初始状态；delete 无 revision | Models 保留 create 合同；delete 增 required model revision |
| Model discovery | 真实调用 Provider，当前无 request body、无调用前后 revision 复核 | stale UI 可能对变化后的配置发起远端调用，调用期间变化仍可能返回旧结果 | Models 增 channel `RevisionRequest`，调用前后比较；不重试、不持久化、不审计 |
| Model test | 真实外部调用；后端内部 snapshot channel/model revision 并在回写前复核；前端请求无 revision | 用户看到的 stale model 可在最新配置上开始测试 | Models 增 required model `RevisionRequest`；前置比较后保留现有调用后双 revision 复核 |
| Model enable/disable | 已比较 model revision与测试门禁 | 同态命令仍会递增 revision并写审计 | Models 服务端拒绝 no-op `INVALID_STATE_TRANSITION`；前端仍只按 token 呈现 |
| Model action tokens | 服务端已有 workflow/primary/actions，V1 大量从字段呈现 | V2 无穷尽映射；读 token 不能替代命令校验 | Models 建 domain-local exhaustive resolver，不建立第二套通用 registry |
| Usage | 服务端按 `7d/30d/90d/all` 聚合正式作业，null 语义已完整；V1 period 是 local state | V2 URL owner 缺失 | Runtime 以 URL `period` 驱动 exact query；无 backend/OpenAPI 变化 |
| Logs | 服务端稳定分页渠道+关联模型审计，使用安全 whitelist 投影；V1 page 是 local state且另查 users | V2 URL owner与只读 UI 缺失；不得显示 raw details | Runtime URL `page/pageSize` + server pagination；直接用 actor；详情按需读现有安全详情 |
| Audit 安全 | 写入前拒绝敏感 key；展示只允许 CONFIGURATION whitelist；API key/Header value 不在现有审计 | UI 若 dump raw error/fixture payload仍可能泄漏；旧日志兼容分支存在但仅读取历史安全 `channel_id` | Core/Models strict fixture 不保存 secret body；Runtime 只显示投影字段。保留现有历史读取，不新增 compatibility 字段 |
| ADMIN boundary | V2 `_admin` 有明确 403；AI 后端 reads/writes 均为 `AdminUser`，writes 有 CSRF | 新 route/tests 尚未覆盖 direct API | 各子 Task 同时覆盖 UI 与后端 403/CSRF；不加前端平行权限判断 |
| Cache consumers | V2 List 已使用 `aiChannelKeys.lists()`、`promptKeys.previewOptionsRoot()`、`contentKeys.isGenerationOptions` | detail/models/runtime keys 与 mutation matrix未定义 | 扩展同一 `ai-channel.api.ts` key factory；按第 8 节精确失效 |
| Provider test evidence | 后端集成有真实本机协议替身；V1 E2E 有真实请求；V2 List fixture only | Workspace fixture 不能冒充真实 Provider | Models 同时交付 strict fixture E2E 与 backend/real-stack Provider 测试，明确分层 |
| 响应式 | List 已覆盖四档；Workspace 未实现 | forms/tables/dialog/logs 在 375/768 风险高 | 三个子 Task 各自覆盖四档，Runtime 重点验证 Logs 表格折叠/摘要 |

## 3. 最终子任务拆分

### 3.1 `frontend-v2-ai-channel-workspace-core`

候选分支：`codex/frontend-v2-ai-channel-workspace-core`。

**In scope**

- `$channelId` route、UUID/search canonical、真实 Workspace header与 Basic/Request tabs。search parser识别最终五个合法token，但Core的delivered-tab gate只放行`basic|request`；`models|usage|logs`在页面渲染前进入route-level not-found。不得把未交付tab规范到Basic、跳回V1或渲染“尚未迁移”卡片。最终策略见“阶段 handoff”小节。
- List 创建 Dialog、真实 `AIChannelCreate`、成功导航。
- Channel detail query；Header read model移除 value。
- Basic/Request 共享 form、完整 update、dirty guard、save/cancel/reload。
- API Key replacement；Header create/update/delete。
- Workspace header 的 channel actions：只呈现服务端 channel token；启停/删除可复用 List command owner并在成功后导航/刷新。
- channel revision、Header-as-channel-revision、409 lock、cache/secret tests。
- OpenAPI/backend/V1 直接消费者、两套 generated types、相关 docs/spec。

**Out of scope**

- Model query或命令、discovery/test Provider 调用。
- Usage/Logs query、指标/日志 UI。
- 通用 Workspace/Header/Form abstractions、Header 自身 revision、数据库变化。

**Independent review value**

- List 的名称、`UPDATE/REPLACE_API_KEY/CREATE_HEADER/COMPLETE_CONFIGURATION` handoff 变为可用；管理员可创建并完整配置连接，不需要 Models/Runtime 才验证。

### 3.2 `frontend-v2-ai-channel-workspace-models`

候选分支：`codex/frontend-v2-ai-channel-workspace-models`。依赖 Core 已归档并 fast-forward 合入 `main`。

**In scope**

- Models tab、lazy model list、加载/空/错误/旧数据刷新失败。
- discovery、manual create、edit、test、enable、disable、delete。
- model form 的 `request_parameters` JSON boundary、reserved field error与 server error mapping。
- model `workflow_stage/primary_task/available_actions` typed exhaustive mapping，复用 `RowActions`。
- discovery channel revision；test/delete model revision；enable/disable no-op rejection；409 no replay。
- 真实 external test confirmation、fixture/real Provider 分层、cache matrix。
- OpenAPI/backend/V1 直接消费者、两套 generated types、相关 docs/spec。

**Out of scope**

- 修改 channel form/API key/Header；Usage/Logs；模型批量操作、默认模型、自动选择、自动测试或自动启用。
- 通用 model registry/table framework、Provider-specific adapters或新协议。

**Independent review value**

- List 的 `TEST_MODEL/DISCOVER_MODELS/CREATE_MODEL` 与 models handoff 完整闭环，且真实外部副作用和 revision 可独立验证。

### 3.3 `frontend-v2-ai-channel-workspace-runtime`

候选分支：`codex/frontend-v2-ai-channel-workspace-runtime`。逻辑上只依赖 Core，执行顺序放在 Models 后以保持单线 clean-main 集成。

**In scope**

- Usage tab、URL period、Usage Summary exact query、null/empty/error/rendering。
- Logs tab、URL page/pageSize、server pagination、安全列表、按需安全详情、actor与request ID。
- read-only loading/empty/error/refresh/越界页、Table Kit/移动摘要、secret sentinel tests。
- 更新五 tab 的最终 canonical schema、docs与 Configuration E2E handoff。

**Out of scope**

- 新 runtime API、客户端聚合、日志搜索/导出、日志 mutation、轮询、用户列表 join、raw details JSON、Usage 缓存服务。
- AI 调用历史详情、Generation Job snapshot 或成本账单。

**Independent review value**

- List 的 `VIEW_RUNTIME`/usage handoff 与 Workspace logs 完整闭环，不影响配置 mutation 设计。

### 3.4 阶段 handoff 纪律

现有 List 的 models/usage href 在 Core 合入前后都是真实未来 URL，但对应section尚不可用。Core的canonical parser识别这些最终token，随后由delivered-tab gate明确route-level 404；它们不能被当作非法参数replace到Basic。Models合入时gate开放`models`；Runtime合入时开放`usage|logs`。每次合入都更新对应href的E2E期望，禁止在可访问tab下渲染“即将推出”空卡。

这是一项明确阶段取舍：它保留 List 既有未来 handoff，但不把未交付能力伪装为完成。若批准后希望 Core 首次合入即保证所有既有 href 都返回 200，则必须把 Runtime 的只读最小实现并入 Core；当前不推荐，因为会扩大 Core review 面。

## 4. Route、component、query、mutation 与 form ownership

### 4.1 Route ownership

| Owner | 责任 |
| --- | --- |
| `frontend-v2/src/routes/_app/_admin/settings.ai.$channelId.tsx` | UUID/canonical search、detail prefetch、tab navigation、ADMIN route context、跨领域 invalidation callbacks、delete 后回 List |
| `frontend-v2/src/routes/_app/_admin/settings.ai.tsx` | 继续拥有 List canonical search；Core 只增加 create Dialog callback与成功导航，不把 detail search 混入 List |
| TanStack Router URL | `tab`、usage `period`、logs `page/pageSize` 的唯一持久化状态；组件不复制 |
| 浏览器 history | List → Workspace → tab 的 Back/Forward；不新增 `from` 参数或 storage |

推荐最终 search 形态：

```text
/settings/ai/{uuid}?tab=basic
/settings/ai/{uuid}?tab=request
/settings/ai/{uuid}?tab=models
/settings/ai/{uuid}?tab=usage&period=30d
/settings/ai/{uuid}?tab=logs&page=1&pageSize=20
```

tab 切换时只保留下个 tab适用的参数；非法、空白、额外参数使用 `replace` 规范化。用户触发的合法 tab/period/page 变化使用 push，因而 Back/Forward 可恢复。

### 4.2 Component ownership

```text
AIChannelWorkspacePage
├─ Back link（canonical List default）
├─ AIChannelWorkspaceHeader
│  ├─ identity/status/workflow/revision
│  └─ RowActions（channel server tokens）
├─ Tabs（domain tabs，不新增 design-system 业务组件）
│  ├─ ChannelConfigurationSection(tab=basic|request)  [Core]
│  │  ├─ BasicFields
│  │  ├─ RequestFields
│  │  ├─ ApiKeyDialog
│  │  └─ HeaderTable + HeaderDialog
│  ├─ AIChannelModelsSection                       [Models]
│  │  ├─ ModelTable + RowActions
│  │  ├─ DiscoverModelsDialog
│  │  └─ ModelDialog / TestDialog
│  ├─ AIChannelUsageSection                        [Runtime]
│  └─ AIChannelLogsSection                         [Runtime]
└─ DirtyGuard（仅 configuration edit surface）
```

- Page/header/tabs 借用 Platform Workspace 结构，不抽 `ConfigurationWorkspaceHeader`。
- Basic/Request 使用现有 `DetailSection`、Form Kit、`StickyActionBar`、`DirtyGuard`。
- Header/Model 列表复用 Table Kit 与 `RowActions`；不造万能表格。
- `WorkspaceShell` 不使用：此页没有三栏 context/main/reference 关系，五个 section 是同一主区 tab。
- design-system 只提供 UI/interaction primitives，禁止导入 configuration type、token或API。

### 4.3 Query ownership

扩展现有 `frontend-v2/src/domains/configuration/ai-channel.api.ts`，保持 AI domain 单一 API owner：

```text
aiChannelKeys.lists()
aiChannelKeys.list(params)
aiChannelKeys.details()
aiChannelKeys.detail(channelId)
aiChannelKeys.modelsRoot(channelId)
aiChannelKeys.models(channelId)
aiChannelKeys.usageRoot(channelId)
aiChannelKeys.usage(channelId, period)
aiChannelKeys.logsRoot(channelId)
aiChannelKeys.logs(channelId, page, pageSize)
aiChannelKeys.auditDetail(logId)  # 仅在现有 V2 没有通用 owner时由本域按需拥有
```

- Detail 首屏由 route loader prefetch；页面复用同 key。
- Models、Usage、Logs 只在对应 active tab 启用。Basic/Request 不请求 models collection，Header 已在 detail中。
- Logs detail 只在打开详情时请求；不预取全页详情。
- Query key参数必须是 canonical URL/API参数，不能把 form values、API key、Header value或完整 mutation payload放入 key。

### 4.4 Mutation ownership

- 所有 request function 放在 `ai-channel.api.ts`，参数直接从 generated operations/schema 推导。
- 页面/section只拥有 pending target、confirm dialog、focus return、field/form error呈现，不直接调用 shared API client。
- channel enable/disable/delete复用现有 `runAIChannelCommand`；允许调整返回后的 detail/list同步，但不复制一套 Workspace command。
- mutation成功先用安全 canonical response更新 exact detail/model cache（适用时），再按矩阵 invalidation；失败不写伪成功。
- secret mutation设置 `gcTime: 0`，Dialog close/settled立即 `reset`，变量不被复制到 error、toast、log或测试收集器。

### 4.5 Form ownership

| Form | Owner / baseline | Submit contract | Dirty / conflict |
| --- | --- | --- | --- |
| Create | List Create Dialog局部状态 | `AIChannelCreate`完整 payload | 关闭即销毁；secret清除；无 revision |
| Channel configuration | `ChannelConfigurationSection`，baseline=`AIChannel` detail revision | 一次完整 `AIChannelUpdate`；Basic/Request字段同 owner | basic↔request可保留；离开编辑 surface阻断；409保留非敏感草稿并锁定旧 revision |
| API Key | Request tab独立 replacement Dialog | `{expected_revision, api_key}` | 无默认值；任何结束清除；409后 reload并重新输入 |
| Header | 每个 Header Dialog局部 owner | create/update完整 `{expected_channel_revision,name,value,is_sensitive}` | value永远空起；409清 value、保留非敏感metadata，显式 reload后重开 |
| Model | Models Dialog局部 owner，baseline=model revision | create或完整 `AIModelUpdate` | 409保留非敏感草稿，旧 revision禁重提；显式 reload |
| Discovery/Test | confirm target局部 owner | required revision，一次调用 | 无 dirty；pending禁止重复；失败/409不自动重放 |

`ChannelConfigurationSection` 只在 `basic|request` 路由表面挂载；basic↔request传同一组件实例和 form context。离开到 Models/Usage/Logs 时 `DirtyGuard` 阻断；确认放弃后该 section卸载，从而不会留下隐藏 dirty form。

## 5. OpenAPI / backend 合同变化

### 5.1 Core contract-first changes

| 合同 | 当前 | 目标 | 影响 |
| --- | --- | --- | --- |
| `AIChannelHeader.value` | nullable；普通 Header 返回明文 | 从 schema/runtime response移除 | V1 Header显示/编辑改为替换式；两套 types重生成 |
| `DELETE /ai-channel-headers/{header_id}` | 无 revision | required query `expected_channel_revision >= 0`；锁定 Header/Channel 后比较 | OpenAPI/router/service/integration/V1/V2 consumer；409/422 responses |
| `AIChannelUpdate` | 全字段 required | 保持，不增 partial/compatibility字段 | Core共享 form必须按真实合同提交 |
| `AIChannelApiKeyReplace` | channel revision + secret | 保持 | 只补 V2 UI/secret lifecycle tests |
| `AIChannel` detail | 含非凭据连接字段、Header metadata、enabled model summary | 保持单 detail read；Header不含 value | 不新建 context/read-model endpoint |

Header delete并发仍要求同一目标两请求只产生一个 204/一条成功审计，等待者为 404；revision过期在删除副作用前返回 409。不得为了兼容旧消费者把 revision设 optional。

### 5.2 Models contract-first changes

| 合同 | 当前 | 目标 | 理由 |
| --- | --- | --- | --- |
| `POST .../discover-models` | 无 body/revision | required `RevisionRequest`（channel revision）；调用前后比较 | 防 stale/调用期间变更返回旧 provider结果 |
| `POST /ai-models/{id}/test` | 无 body；仅内部 snapshot | required `RevisionRequest`（model revision）；前置比较，保留现有调用后 channel+model比较 | 保证用户所见 baseline 与真实副作用一致 |
| `DELETE /ai-models/{id}` | 无 revision | required query `expected_revision`（model revision） | stale delete明确409，不自动重放 |
| model enable/disable | model revision；允许 no-op | revision后拒绝目标同态，409 `INVALID_STATE_TRANSITION` | 服务端动作权威，不写虚假成功审计 |
| `AIModelCreate` | 无 expected revision | 保持 | 新资源尚无自身 revision；channel revision不拥有 model个体，不伪造 revision |
| `AIModelUpdate` | 完整字段 + model revision | 保持 | 不加 partial/compatibility字段 |

Discovery/test都不是永久审计事件；真实调用本身不计 Usage。Test只回写模型测试状态与安全 error summary，继续保持 model disabled。Provider错误只能映射既有公开 code/message，不得带 URL、请求体、API Key、Header或响应正文。

### 5.3 Runtime contracts

- `AIChannelUsageSummary`、`AIUsagePeriod`、`AuditLogList`、`AuditLogDetail` 与两个 GET path现状足够，不改 OpenAPI/backend。
- Logs 保持当前全局 append-only `audit_logs` 单一数据源与安全 whitelist；不增加 channel log表、raw details endpoint或客户端 join。
- 无数据库变化。现有 `ai_channels.revision`、`ai_models.revision` 与 Header归属足够表达批准语义；`contracts/database.md` 无需更新。

### 5.4 V1 consumer impact

Core 必须同步：

- `AIChannelDetailPage.tsx` 不再读取/显示/预填普通 Header value；所有 Header编辑都要求替换值。
- Header delete发送 detail当前 channel revision。
- `ConfigurationPages.test.tsx` 与 `ai-channel-management.spec.ts` 更新 Header contract与无明文断言。

Models 必须同步：

- V1 discovery发送 channel revision；test发送当前 model revision；model delete发送 model revision。
- `frontend/tests/e2e/mvp-flow.spec.ts`、`shared-data.setup.ts`、`ai-channel-management.spec.ts` 的直接 API调用同步 required body/query。
- V1 fixture与类型检查不得用 `as any`、固定 revision或兼容字段绕过。

每个改合同的子 Task都运行 V1/V2 `api:generate`，生成文件不手改，并验证 V1组件与直接 API E2E。

## 6. Revision、dirty 与 conflict matrix

| 资源/命令 | Revision owner | 客户端 baseline | 服务端最终检查 | 409 UI |
| --- | --- | --- | --- | --- |
| channel update | channel | detail.revision | lock channel后比较 | 保留非敏感form；禁旧 revision重提；显式 reload |
| API Key replace | channel | detail.revision | lock channel后比较 | 清 secret；显示冲突；reload后重新输入 |
| Header create/update/delete | channel（Header无独立revision） | detail.revision | lock Header/Channel并比较 channel revision | 清 value；不 replay；reload detail |
| channel enable/disable/delete | channel | header/detail/list revision | lock后比较并重验state/action | 不 patch成功；显式 reload；delete冲突不导航 |
| discovery | channel | detail.revision | 调用前后比较 channel revision | 丢弃结果；不重试；reload detail |
| model create | 新资源，无自身revision | channel identity仅用于归属 | channel存在、boundary/unique约束 | 领域冲突显式显示；不伪造revision |
| model update | model | model.revision | lock channel→model后比较 | 保留非敏感form；reload models |
| model test | model输入；内部同时snapshot channel | model.revision | 前置model比较；外部调用后复核model+channel | 丢弃结果；不重试；reload detail/models |
| model enable/disable/delete | model | model.revision | lock channel→model后比较；启停重验test与no-op | 不自动invalidate/重放；显式 reload models |

Channel连接级变化（protocol/base URL/timeout/API Key/Header）继续通过 `invalidate_channel_models` 递增 channel revision、停用 channel、递增所有 model revision并重置测试。Channel名称/描述/Provider的非连接更新只递增 channel revision；model revision不变。Model CRUD/状态由自身 revision拥有，model collection membership不把 channel revision伪装成 aggregate ETag。

## 7. 服务端 action authority

### Channel

- Workspace header主动作只按 `AIChannel.primary_task`：`COMPLETE_CONFIGURATION/TEST_MODEL/ENABLE_CHANNEL/VIEW_RUNTIME`。
- overflow只按 `available_actions`：`UPDATE/REPLACE_API_KEY/ENABLE/DISABLE/DELETE/DISCOVER_MODELS/CREATE_HEADER/CREATE_MODEL`。
- 若目标 tab尚未交付，route保持不可用而非转到另一 tab；子 Task合入时闭环。
- Unknown/duplicate/contradictory token显式中文错误；不使用状态字段fallback。

### Header

- 每行只按 `primary_task` 与 `available_actions` 映射 edit/reconfigure/delete。
- `is_sensitive/is_configured`只用于文案和状态，不用于授权推导。
- 即使读投影含 token，命令仍校验 ADMIN、CSRF、channel revision与Header存在。

### Model

- primary mapping：`TEST_CONNECTION/VIEW_FAILURE_AND_RETRY/ENABLE_MODEL/ENABLE_CHANNEL/VIEW_MODEL_RUNTIME`。
- overflow mapping：`UPDATE/TEST/ENABLE/DISABLE/DELETE`；与主动作同义动作去重。
- `workflow_stage`只展示业务阶段；客户端不得从 `test_status/is_enabled/channel.is_enabled`生成动作。
- 测试/启停/删除入口即使在 stale UI可见，服务端仍拒绝不满足的真实状态。

## 8. Cache invalidation matrix

Key owner沿用：AI domain `aiChannelKeys`、Prompt domain `promptKeys.previewOptionsRoot()`、Content domain `contentKeys.isGenerationOptions`。不新增跨域 registry。

| 成功事件 | AI List/detail/models | Prompt Preview | Content generation-options | Logs | Usage/历史 |
| --- | --- | --- | --- | --- | --- |
| create channel | invalidate all lists；seed/读 exact detail后导航 | 不变（无可用模型） | 不变 | 日后按需读取 | 不变 |
| channel update | set exact detail；invalidate lists | invalidate root（名称或可用性可能变） | predicate invalidate全部 generation-options | invalidate该channel logs root | Usage/Jobs/Versions不变 |
| API Key replace | set detail；invalidate lists + models | invalidate root | predicate invalidate | invalidate channel logs | 不变 |
| Header create/update/delete | set/refetch detail；invalidate lists + models | invalidate root | predicate invalidate | invalidate channel logs | 不变 |
| channel enable/disable | set detail安全响应；invalidate lists + models | invalidate root | predicate invalidate | invalidate channel logs | 不变 |
| channel delete | remove exact detail/models/runtime；invalidate lists | invalidate root | predicate invalidate | remove已删除channel runtime queries | 历史Job/Version不失效 |
| discovery | 不变；结果只在dialog局部 | 不变 | 不变 | 不变（不审计） | 不变 |
| model create | invalidate lists/detail/models | 不变（未测试且disabled） | 不变 | invalidate channel logs | 不变 |
| model update | invalidate lists/detail；set/refetch models | invalidate root（label或可用性可能变） | predicate invalidate | invalidate channel logs | 不变 |
| model test | invalidate lists/detail；set/refetch models | 不变（测试后仍disabled） | 不变 | 不变（不永久审计） | 不变 |
| model enable/disable/delete | invalidate lists/detail；set/refetch/remove models | invalidate root | predicate invalidate | invalidate channel logs | 历史Job/Version不变 |
| Usage period/page read | exact key read only | 不变 | 不变 | 不变 | 不互相失效 |
| 409/失败 | 不写/不失效；用户显式reload exact owner | 不变 | 不变 | 不变 | 不变 |

“精确”在跨域消费者上表示只使用现有 Preview root与 generation-options predicate，不刷新 Prompt detail/list、Content task list/detail/editor、Generation Jobs或Versions。AI list使用 root invalidation是必要的，因为筛选、计数、排序与页面归属可能变化；不做跨页 optimistic patch。

## 9. Secret handling matrix

| 材料 | 持久化 owner | 读取/Query cache | UI生命周期 | 日志/错误/审计 | 测试 |
| --- | --- | --- | --- | --- | --- |
| API Key | 后端AES-256-GCM ciphertext | 仅 `configured/updated_at`；绝不返回value/片段 | create/replace password input；不prefill；`gcTime:0`；close/settled reset | 不含payload、URL query、message/details、audit facts/change/result | sentinel不进入response/DOM/console/snapshot；fixture不收集request body字符串 |
| Header value（普通/敏感） | 普通现有列/敏感ciphertext；持久化现状不变 | `AIChannelHeader`不再含 `value`；只返回name/type/configured/actions | create/update都从空value开始并完整替换；password-style输入；结束清除 | 只允许安全 `is_sensitive`/channel_id等事实；不得打印value | 不用snapshot记录payload；显式断言response/cache/DOM/audit无sentinel |
| base URL / protocol / provider / timeout | channel当前配置 | ADMIN detail可缓存非凭据字段 | 共享非敏感form，可dirty/冲突保留 | audit不展示完整地址；错误使用公开code/message，不拼接URL | fixture可用 `.invalid` 地址但不快照完整mutation；无真实凭据 |
| 完整可执行请求配置 | 不存在单一可读对象；后端调用边界临时组合 | 不得进入任何 Query key/data；API Key/Header value缺失保证detail非完整 | 只在提交/Provider调用栈短暂存在，不提供“复制完整配置” | 禁止记录或展示 | fixture/trace说明与secret sentinel断言；无快照 |
| model request parameters | PostgreSQL model配置；非凭据请求body extras | Models query按合同返回用于编辑 | JSON form，服务端继续拒绝系统reserved字段 | audit只记channel_id/revision，不记参数；Provider error不回显body | 只使用公开假参数；不把完整配置对象写snapshot |
| model test error summary | model安全公开摘要 | 可进入Models cache/Logs UI仅在合同字段处 | 只读 | 必须是现有公开AppError message，禁止Provider body/URL/header | 真实替身用公开固定错误码；断言secret sentinel不存在 |

禁止实现 V1 现有“复制配置”的等价 V2 功能；当前需求没有该动作，且它容易把非敏感字段与Header metadata误组合成可导出配置。

## 10. Usage 与 Logs read ownership

### Usage

- URL `period` → `AIUsagePeriod` → `aiChannelKeys.usage(channelId, period)` → `GET usage-summary`。
- `period_ended_at`与聚合值来自同一响应；客户端不以本地时钟重建窗口。
- `success_rate/average_response_duration_ms/token totals/last_used_at`的null保持null，统一可访问文案“暂无数据”。
- period切换保留tab，只push URL；不维护`useState`副本。

### Logs

- URL `page/pageSize` → API `page/page_size` → exact logs key。
- pageSize变化回page=1；越界页由真实`total + empty items`呈现返回最后有效页入口，不静默改URL。
- 表格字段限定：时间、动作、actor display name/account type、outcome、safe change summary、request ID、详情动作。
- 详情只展示`AuditLogDetail.changes/facts/result_message/error_code/related_entry`的服务端安全投影；不展示ORM raw details或序列化整个对象。
- 移动端把action/outcome/actor/request ID收进主单元摘要，保留详情动作，不横向溢出。

## 11. Responsive 与 accessibility acceptance

| 视口 | Core | Models | Runtime |
| --- | --- | --- | --- |
| 375 | Header actions可达；tabs横向滚动但页面根不溢出；表单单列；Sticky actions不遮字段；Dialog在视口内 | 模型主单元含name/id/status/test；RowActions键盘可达；JSON editor不撑宽 | Usage cards单列；Logs移动摘要；pagination/详情Dialog可用 |
| 768 | Basic/Request合理双列；Header表折叠非关键列；dirty Dialog焦点恢复 | 模型表保留核心状态与动作；discovery/model Dialog不溢出 | Usage 2列；Logs隐藏辅助列并保留全部事实 |
| 1024 | Workspace header与actions不重叠；form/table使用可读宽度 | 模型表完整主要列 | Usage cards与Logs表完整，允许TableShell内部滚动但根不溢出 |
| 1440 | 内容不无限拉宽；section层级清楚 | 宽表列稳定，无多余空pane | metrics/log detail信息密度合理 |

四档共同断言：`documentElement.scrollWidth <= clientWidth`、可访问heading/tablist/table/dialog名称、Tab/Enter/Escape/focus return、状态不只靠颜色、pending/error/409为live alert且不泄漏secret。

## 12. Component tests 与 Playwright 场景

从 Core 第一实现子 Task 起，不等待最终 E2E：

### Core component tests

- canonical search/UUID/tab mapping与unknown token explicit failure。
- `AIChannelUpdate`由Basic+Request共享values生成完整payload，未触碰字段仍来自同revision baseline而非默认猜测。
- dirty：basic↔request保留；离开editing surface阻断；确认放弃后卸载。
- create/update/key/header三类request的CSRF/revision；secret mutation结束后state清理。
- 409不replay、不覆盖draft；显式reload才reset。
- Header response/model无value，普通/敏感编辑都从空替换值开始。
- channel actions只按server tokens。

### Core Playwright strict fixture

- List Create Dialog →真实POST → Workspace basic URL；未知API返回501并在teardown失败。
- List exact basic/request handoff、direct/reload/back/forward、uppercase UUID canonical。
- Basic/Request保存、dirty离开、409只一条命令、reload。
- API Key/Header sentinel不出response body、DOM、console、Query cache检查hook或测试可观察状态、snapshot。
- ADMIN/ENGINEER页面；后端直调403/CSRF由integration覆盖。
- 四档视口与键盘/focus。

### Models component/Playwright

- lazy GET、empty/error/refresh；action token穷尽/矛盾失败。
- discovery/test带正确revision，只发送一次；409/result stale不replay。
- create/edit JSON validation、enable门禁展示、server no-op/disable/delete。
- test确认明确真实副作用；返回PASS/FAIL后模型仍disabled。
- strict fixture明确是API隔离测试；另跑backend integration +本机Provider替身证明真实协议调用。
- 四档模型表/Dialog/JSON输入。

### Runtime component/Playwright

- usage/logs URL canonical、Back/Forward、period/pageSize/page mapping。
- Usage null/zero区分、empty/error/refresh。
- Logs server pagination、actor投影、safe summary/detail、越界页；不请求users或raw details。
- secret sentinel不出列表、详情、DOM、console/snapshot。
- 四档metrics/logs/pagination/detail。

### Configuration real-stack E2E handoff

三个子 Task归档后新增/扩展独立 `frontend-v2-ai-channel-configuration-e2e`：真实 PostgreSQL/FastAPI + 本机HTTP Provider替身，浏览器走V2完成 List → create → Basic/Request → Header → discover/create model → test → enable → Prompt Preview/generation-options可见 → Usage/Logs。Provider替身不是固定成功前端route；需同时覆盖成功、公开失败、timeout、revision并发变化，且每次真实调用最多一次。

## 13. 风险、阻塞与决策门禁

| 风险 | 控制 |
| --- | --- |
| Core范围偏大 | 保持channel aggregate单slice；不把Headers拆成补丁Task；不引入通用组件；major files目标约15–20 |
| Header value合同收紧影响V1 | contract-first、两套types、V1组件/E2E同Task修正；不保留optional value |
| discovery/test合同收紧影响直接API测试 | 全仓搜索所有operation consumers；V1 setup/MVP/E2E逐个使用真实revision |
| 409后Query后台refetch覆盖表单 | mutation conflict不自动invalidate；form baseline与query data分离；显式reload才reset |
| Provider副作用重复 | pending gate、confirm、single request断言、无retry、revision前后检查 |
| logs展示未来出现未知detail字段 | 服务端whitelist继续丢弃未知；UI只渲染typed safe fields，不JSON dump |
| 中间合入仍有List future href 404 | 明确保留未实现状态，禁止新增200占位；按Core→Models→Runtime尽快闭环 |
| 完整Workspace可能更适合单Task | 不采用：合同与测试面超过一个5–20主要文件PR且含三类review模型；若实现估算降到20文件内仍需在启动前重新提交拆分变更供用户批准 |

当前没有数据库或产品阻塞。唯一门禁是用户批准本父计划；任何实现前若发现 Header 独立并发确实无法由 channel revision表达、或现有持久化无法满足已批准行为，必须停止并请求数据库变更授权，不得自行迁移。

## 14. Ponytail 约束

- 复用现有 API paths、AI API owner、route/form/table primitives、server projections与cache consumer keys。
- 不新增依赖、Workspace context API、全局store、通用registry、generic settings form、optimistic跨页同步或secret compatibility字段。
- 三子 Task是满足独立review与revision一致性的最小拆分；不再细分“Header UI”“API Key UI”等补丁任务。
