# Frontend V2 AI Channel Workspace Runtime

## Goal

为管理员交付 `/settings/ai/$channelId` 的 Runtime vertical slice：开放真实 `usage` 与 `logs` section，以浏览器 URL 唯一持有统计周期和日志分页，直接消费服务端 Usage 聚合、渠道审计分页和按需安全详情。页面不得补算指标、客户端分页、查询用户列表或展示 raw 审计 JSON；API Key、Header value 和完整可执行请求配置不得进入响应缓存、DOM、console、错误、fixture 记录或测试快照。

本 Task 是父 Task `08-14-frontend-v2-ai-channel-workspace` 的第三个实现子 Task。它依赖已归档 Core、Models 已合入 `main`；规划已获用户批准并在 `main` 进入实现，仍不创建分支、不自动提交或 push。

## 已验证基线

- 会话开始时主工作目录位于 clean `main`；Core 与 Models 的实现及归档提交均已合入，当前仅本 Task 工件和父 Task child metadata 形成预期 dirty state。
- 当前 route parser 识别 `basic|request|models|usage|logs`，但 search 只保留 `tab`，delivered gate 只开放 `basic|request|models`；`usage|logs` 在 Detail 请求前返回 route-level not-found。
- `ai-channel.api.ts` 只有无参数 `logs(channelId)` invalidation key，没有 Usage、分页 Logs 或 Audit Detail query；Workspace Header `VIEW_RUNTIME` 与模型 `VIEW_MODEL_RUNTIME` 仍明确禁用。
- 现有正式合同已经提供 ADMIN-only `GET .../usage-summary?period=`、`GET .../audit-logs?page=&page_size=` 和全局 `GET /audit-logs/{audit_log_id}`；无需新 endpoint、DTO、数据库结构或生成类型。
- Usage 只聚合正式 `GENERATE/HUMANIZE` 作业；零作业时计数为 `0`，成功率、平均耗时、Token 与最近使用保持 `null`。连接测试与模型发现不计 Usage。
- 渠道 Logs 来自全局 append-only `audit_logs`，列表已联结 actor 投影，详情由服务端 CONFIGURATION whitelist 过滤 `changes/facts`；前端无需也不得查询 Users 或 ORM raw details。
- OpenAPI 的通用 `page_size` 合同实际为 `1..100`，Workspace URL/控件才限制 `pageSize=10|20|50`。稳定后端规范中“其他 page_size 必须失败”的表述已与权威合同漂移，本 Task 只修正文档，不收紧 API。
- Frontend V2 已有 `TableShell`、`TablePagination`、`DetailSection`、`Sheet`、query/error primitives 和局部指标卡布局实例；没有 V2 `MetricTile`，无需为本页新增通用指标组件。

## Requirements

### R1. 最终 canonical URL

- 最终合法 tab 为 `basic|request|models|usage|logs`，canonical search 必须始终显式包含 `tab`。
- `basic|request|models` 只保留 `{tab}`；任何 `period/page/pageSize` 或未知参数都用 `replace` 移除。
- `usage` 只保留 `{tab:'usage', period:'7d|30d|90d|all'}`，缺失或非法 period 用 `replace` 规范为显式 `30d`。
- `logs` 只保留 `{tab:'logs', page:正整数, pageSize:10|20|50}`，缺失或非法值用 `replace` 规范为显式 `page=1&pageSize=20`。
- 用户切 tab、period、page 或 pageSize 使用新的 history entry；pageSize 变化回到 page 1。刷新、直达、Back/Forward 必须完全从 URL 恢复，不增加本地副本或 browser storage。

### R2. Route、tab 与服务端动作 handoff

- delivered gate 最终开放五个 tab；合法 Runtime URL 在 gate 后才预取现有 Channel Detail。
- Basic/Request 的共享草稿、DirtyGuard、409 与卸载合同保持不变；从 dirty 配置进入 Usage/Logs 仍须确认。
- Channel `VIEW_RUNTIME` 主任务进入 Usage；Model `VIEW_MODEL_RUNTIME` 也进入当前渠道 Usage。不得继续禁用、跳 V1、使用 `href='#'` 或创建模型级假 Runtime。
- Header、配置、Models 与 Runtime 三个页面 surface 显示同一套五 tab，不建立通用 Workspace framework。

### R3. Usage 查询与展示

- 只在 `tab=usage` 时请求当前渠道和 URL period 的 Usage Summary；period 必须进入 exact query key。
- 直接展示服务端 `total_jobs/succeeded_jobs/failed_jobs/success_rate/average_response_duration_ms/prompt_tokens/completion_tokens/total_tokens/last_used_at/period_started_at/period_ended_at`，不得以本地时钟重建窗口或从其他 query 计算。
- 非 nullable 计数的 `0` 是真实零；nullable 指标的 `null` 统一显示“暂无数据”，不得替换为 `0`、`0%` 或猜测值。
- 初始 loading/error、已有 data 的 refresh error 与显式 retry 分开处理；次级 Usage 失败不得隐藏 Channel identity、返回入口、tabs 或兄弟能力。

### R4. Logs 服务端分页与列表

- 只在 `tab=logs` 时请求 URL page/pageSize 对应的渠道审计页，API 参数映射为 `page/page_size`，exact key 必须包含二者。
- 保持服务端返回顺序、`total/page/page_size` 与 actor projection；不得客户端排序、截取、聚合、搜索 raw details、请求 Users 或从 actor_id join 名称。
- 列表展示时间、已知 AI 配置动作、actor display name/account type、outcome、安全变更摘要、request ID 和详情入口；移动主单元保留同样事实。
- `items=[] && total=0` 显示真实空态。`items=[] && total>0` 视为越界页，提供用户触发的“返回最后有效页”；不得静默改 URL。
- `TablePagination` 受 URL 控制；宽表只允许 `TableShell` 内部滚动，页面根不得横向溢出。

### R5. 按需安全审计详情

- 只有用户点击当前日志行的 `VIEW_LOG_DETAIL` 才请求全局 Audit Detail；关闭详情不改变 Logs URL。
- 详情使用现有 `Sheet`，展示基础身份、服务端 whitelist 中已知的 CONFIGURATION `changes/facts`、`result_message/error_code/related_entry`；不得 `JSON.stringify` 整个对象或呈现未知字段。
- 前端 display allowlist 只是呈现边界，不是新的安全权威；若服务端返回未登记字段或不支持的值 shape，显式显示投影错误并停止该详情，不能静默 dump、猜标签或兼容处理。
- 详情初始 loading、403/404/普通错误、retry、Escape 与触发点焦点恢复均可用；不增加复制、导出、删除或日志 mutation。

### R6. Query key、cache 与安全

- 继续由 `ai-channel.api.ts` 唯一拥有 keys/functions：增加 `usageRoot/usage`、`logsRoot/logs` 与 domain-local `auditDetail`；现有 mutation 的日志 invalidation 改为 `logsRoot(channelId)`。
- Runtime 三类 GET `retry:false`，只读之间互不失效；period/page 变化不刷新 Detail、Models、Prompt、Content、Jobs、Versions 或其他历史。
- 删除渠道继续移除该渠道 detail/models/runtime keys；其他配置 mutation 只失效该渠道 logs root，不主动刷新 Usage。
- Query key/data、错误、DOM、console、Sheet、fixture、trace/snapshot 中不得出现 API Key、Header value、Provider body 或完整可执行请求配置。

### R7. 测试与响应式

- model/component tests 覆盖条件式 canonical search、API 参数/key、Runtime action handoff、null/zero、safe projection、lazy query、refresh error、越界页与无 Users 请求。
- 扩展现有 strict workspace fixture，新增 `ai-channel-workspace-runtime.spec.ts`；未声明 API 继续返回 501 并在 teardown 失败，fixture 记录结构化 method/path/query，不记录 secret request body 字符串。
- E2E 覆盖 direct/refresh/Back/Forward、period/page/pageSize、on-demand detail、actor projection、safe summary、secret sentinel、375/768/1024/1440、键盘、Escape/focus return 和无 root overflow。
- Core/Models production-artifact specs 必须继续通过，证明共享 route/page/tab 修改没有回归前两片。

### R8. 文档与交付边界

- 更新 `.trellis/spec/frontend/state-management.md` 为最终五 tab、Runtime URL/query/action 合同。
- 修正 `.trellis/spec/backend/ai-configuration-guidelines.md` 的 page_size 漂移：API 权威范围 `1..100`，Workspace UI 只提供 `10|20|50`。
- 更新 `docs/frontend-v2/02/03/05/07/08/09` 中 Usage/Logs 已交付、测试边界与 ADR；不重复维护未变化事实。
- `contracts/openapi.yaml`、backend runtime、generated types 与 `contracts/database.md` 默认不改。若实施发现当前合同无法满足上述可观察行为，返回 planning 评审，不自行增加字段或兼容 fallback。

## Acceptance Criteria

- [x] 五个 tab 都是可直达真实能力；canonical URL 按 tab 只保留适用参数，刷新与 Back/Forward 恢复同一 Runtime 视图。
- [x] `VIEW_RUNTIME` 与 `VIEW_MODEL_RUNTIME` 都进入真实 Usage，Basic/Request dirty 离开仍由现有 guard 阻断。
- [x] Usage 只发 active period 的一次 exact GET；真实零与 nullable“暂无数据”可区分，时间窗完全来自响应。
- [x] Logs 只发 active page/pageSize 的服务端分页 GET，不请求 Users、不客户端排序/分页、不展示 raw details。
- [x] 越界日志页不静默改 URL，用户可显式返回最后有效页；pageSize 变化回 page 1。
- [x] Audit Detail 只在点击后读取；只展示登记的安全 projection，未知字段显式失败，关闭后焦点返回触发器。
- [x] Runtime GET 与现有 mutation 使用同一 AI key owner；日志 root 失效精确，Usage/历史及无关 query 不被刷新。
- [x] API Key、Header value 与完整请求配置不出现在 response cache、DOM、console、错误、fixture、trace 或 snapshot。
- [x] model/component、Core/Models/Runtime production-artifact E2E、lint、typecheck、build、API drift check 与目标 backend integration 全部通过。
- [x] 代码、OpenAPI、generated types、spec/docs 一致；无 API/数据库/依赖/全局 store/通用 Runtime framework/客户端统计或审计副本。

## Out of Scope

- 新 Runtime endpoint、OpenAPI 字段、数据库表/列/迁移、Redis 状态、缓存服务或部署配置。
- Usage 客户端聚合、趋势图、成本账单、轮询、自动刷新、导出或复制。
- Logs 搜索/筛选、客户端排序、用户目录 join、raw details、全文 JSON、mutation、删除或导出。
- AI 调用历史详情、Generation Job/Version history、模型级独立 Runtime、第二 Audit API owner 或通用 metrics/log viewer。
- 完整 Configuration real-stack 浏览器闭环；它在三个 Workspace 子 Task 后由独立 Task 验收。
