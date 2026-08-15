# Frontend V2 AI Channel Workspace

## Goal

在 Frontend V2 为管理员交付真实的 `/settings/ai/$channelId` AI Channel Workspace，完整闭环已归档 AI Channel List 生成的 `basic/request/models/usage` handoff，并补齐 `logs`。Workspace 只消费服务端权威状态、动作和 revision，敏感值不回显、不进入读取缓存或可观察诊断面，真实 Provider 副作用保持显式、不可自动重放。

本父 Task 只负责总体审计、合同决策、子任务拆分与跨子任务验收。本轮保持 `planning`，不实现业务代码、不运行 `task.py start`、不创建业务分支；规划经批准后，每个实现子 Task 在独立会话和独立临时分支中执行。

## 已验证基线

- 主工作目录位于 clean `main`；`frontend-v2-ai-channel-list` 已以 `f07a96d4` 归档并合入 `main`。
- 创建本父 Task 前没有活动 Trellis Task；当前唯一活动上下文是本 planning Task。
- 不存在 `codex/frontend-v2-ai-channel-workspace*` 分支或额外 worktree。
- Frontend V2 已有 `/settings/ai` List，名称与服务端动作会生成真实 `/settings/ai/{channelId}?tab=basic|request|models|usage` 链接，但仓库中尚无 `$channelId` 路由或占位页。
- OpenAPI、后端和 V1 已具备渠道、Header、模型、Usage Summary 与渠道审计日志的主要业务能力；本任务只收紧已确认的 Workspace 合同缺口，不增加数据库结构。

## 用户、路由与蓝图

- 用户：仅 `ADMIN`。
- 目标路由：`/settings/ai/$channelId`。
- canonical sections：`basic | request | models | usage | logs`。
- 浏览器 URL 是 tab、Usage period 与 Logs pagination 的唯一持久化 owner；刷新、直达、Back/Forward 必须恢复同一视图。
- `_admin` 仅是前端可见边界；所有读取和写命令仍由后端 `AdminUser` 与 CSRF 做最终权限验证。

## 父任务范围

### 范围内

- 审计并冻结 Workspace route、组件、query、mutation 与 form ownership。
- 决定创建渠道采用真实 Dialog 还是真实路由；不得创建 `/new` 假页面。
- 冻结 Basic/Request 的完整聚合提交、dirty、revision 与冲突行为。
- 冻结 API Key 与 Header value 的替换式、永不回显行为。
- 收紧 Header discovery/model test/model delete 等已验证 revision 缺口。
- 冻结 Models 的发现、CRUD、测试、启停、删除与服务端 token 映射。
- 冻结 Usage period、Logs server pagination、只读投影与 URL state。
- 冻结 AI Channel、Prompt Preview 和 Content generation-options 的精确 cache invalidation。
- 把实现拆为可独立 review、验证、提交、归档和 fast-forward 合入 `main` 的 vertical slices。
- 从第一个实现子 Task 开始要求 component tests、严格 Playwright fixture、四档响应式验收与 V1 消费者验证。

### 范围外

- 本轮任何业务代码、OpenAPI、后端、V1、V2、稳定规范或设计文档修改。
- 新数据库表、列、迁移、Redis 状态、部署配置或第三方依赖。
- 通用 Workspace framework、万能表格、第二套 Action Registry、第二套 DTO 或客户端状态机。
- Header 独立 revision 字段；现有持久化和业务语义由 channel revision 管理 Header 集合。
- Usage/Logs 的客户端聚合、客户端分页、日志副本或运行指标缓存服务。
- 自动重放 revision 冲突、Provider discovery/test 或任何外部调用。
- 为尚未实现的 section 留空白成功页、固定成功 fixture 或不可操作的占位卡片。

## 功能要求

### 1. Workspace canonical navigation

- `channelId` 必须是有效 UUID；合法大写 UUID 使用 `replace` 规范为小写，非法 ID 在请求前显式失败。
- canonical search 必须始终包含 `tab`。缺失/非法 tab 规范为 `tab=basic`；未知参数移除。
- `usage` 只接受 `period=7d|30d|90d|all`，默认并显式保留 `30d`；其他 tab 不保留 `period`。
- `logs` 只接受正整数 `page` 与 `pageSize=10|20|50`，默认显式保留 `page=1&pageSize=20`；其他 tab 不保留分页参数。
- List 链接进入服务端指定 section；浏览器 Back 返回原 List URL 与筛选。Workspace 的显式“返回 AI Channel List”链接只指向 canonical List 默认 URL，不增加 `from` 参数、sessionStorage 或第二份历史状态。
- tab 切换写入浏览器历史；canonical 修正使用 `replace`。刷新、直达、Back/Forward 均从 URL 恢复。

### 2. 创建渠道

- 复用现有 `AIChannelCreate` 真实合同，在 `/settings/ai` List 上增加“新建渠道”Dialog；不创建 `/settings/ai/new` 路由。
- Dialog 一次提交 `name/description/protocol_type/provider_brand/base_url/api_key/timeout_seconds`，成功后导航到新渠道 `/settings/ai/{id}?tab=basic`。
- 创建 Dialog 是短生命周期局部表单，不写 Query cache、URL 或 browser storage；关闭、失败处理完成和成功后都清除 API Key。

### 3. Basic 与 Request

- `AIChannelUpdate` 当前要求同时提交 `name/description/protocol_type/provider_brand/base_url/timeout_seconds/expected_revision`。因此 Basic 与 Request 必须位于同一个 Core 子 Task，并由一个共享 form owner 和一个 canonical baseline 产生完整 payload。
- Basic 展示名称、描述、Provider 与服务端 workflow/status；Request 展示 Protocol、base URL、timeout、API Key 状态与 Headers。
- Basic/Request 视觉上可分 tab，但切换时不得丢失共享表单值；离开这两个编辑 section 或离开 Workspace 时使用现有 `DirtyGuard`。
- 保存成功以服务端响应重置 baseline；`409 REVISION_CONFLICT` 保留非敏感草稿、禁止旧 revision 再提交，并只提供显式“重新加载服务端版本”。不得自动 refetch 覆盖草稿或自动重放。

### 4. API Key 与 Headers

- API Key 只能创建/替换，读取只返回 `api_key_configured/api_key_updated_at`；任何响应都不得回显明文或片段。
- Header value 无论 `is_sensitive` 为何都不得进入读取响应或 Query cache。普通和敏感 Header 的更新都要求用户输入完整替换值；敏感 Header 使用更明确的不可恢复提示。
- Header create/update 继续提交 `expected_channel_revision`；Header delete 必须补 required `expected_channel_revision` 并在锁内比较，过期返回 `REVISION_CONFLICT`。
- Header 没有独立 revision；Header 集合由 channel revision 唯一拥有。任一 Header 变化继续使 channel 与依赖旧连接配置的 model test 状态失效。
- Header `primary_task/available_actions` 只由服务端投影；前端穷尽映射，不从 `is_sensitive/is_configured` 推导动作资格。

### 5. Models

- Models section 按需读取当前渠道模型；不由 `AIChannel.enabled_models` 重建全量列表。
- discovery 是真实远端调用，必须提交当前 channel revision；调用前后都复核 revision，配置变化返回 409，结果只供本次选择且不落库、不自动重试。
- model create 使用现有创建合同。新模型没有可比较的自身 revision，创建后从服务端获得初始 model revision；不得伪造 `0` 或借用 channel revision 作为 model revision。
- model update/enable/disable 使用自身 revision；model test 补 required model revision；model delete 补 required model revision。
- model test 是真实外部副作用：明确确认、只发送一次、测试期间继续复核 channel/model snapshot、成功或失败后模型保持停用。开发 fixture 和真实 Provider 测试必须明确分层。
- 服务端必须拒绝 model enable/disable no-op；前端只消费 `workflow_stage/primary_task/available_actions`，未知或矛盾 token 显式失败。

### 6. Usage 与 Logs

- Usage 直接读取 `GET .../usage-summary?period=` 的服务端聚合；`null` 指标显示“暂无数据”，不得替换为 `0` 或客户端计算。
- Logs 直接读取 `GET .../audit-logs?page=&page_size=` 的服务端稳定分页；只读展示安全的 `AuditLog` 投影，详情按需读取现有全局审计详情合同。
- Logs 不读取用户列表做 actor join；使用响应中的 actor 投影。不得浏览器分页、搜索 raw `details` 或展示未经白名单投影的 JSON。
- Usage/Logs 不新增 mutation、轮询、复制按钮或导出能力。

### 7. 服务端权威、缓存与安全

- Channel、Model 的 `workflow_stage/primary_task/available_actions` 以及 Header 的动作 token 均由服务端最终投影；前端只做 typed exhaustive mapping。
- 所有命令入口重新验证 ADMIN、CSRF、revision 与当前业务事实；读投影不是授权凭证。
- AI 配置改变后只失效 AI Channel 自身/List、Prompt Preview options root、Content generation-options 与相应渠道日志；不刷新 Prompt 正文、Content history、Generation Job/Version history、Usage 历史或无关配置。
- API Key、Header value 和由地址、凭据、Header 值组成的完整请求配置不得进入响应读取 cache、日志、错误消息、审计展示、浏览器存储、复制内容或测试快照。
- `base_url/protocol/provider/timeout` 作为管理员可编辑的非凭据字段可以存在于 channel detail cache；由于 Header value 与 API Key 永不返回，读取 cache 中不得形成完整可执行请求配置。

## 推荐子任务与依赖

1. `frontend-v2-ai-channel-workspace-core`
   - route/header/create、Basic/Request、共享 form、API Key replacement、Header 管理、channel revision/dirty/409、Core 合同收紧。
   - 候选分支：`codex/frontend-v2-ai-channel-workspace-core`。
2. `frontend-v2-ai-channel-workspace-models`
   - Models、discovery、CRUD、真实测试、启停/删除、model revision 与 action registry、Models 合同收紧。
   - 依赖 Core 已合入并归档。
   - 候选分支：`codex/frontend-v2-ai-channel-workspace-models`。
3. `frontend-v2-ai-channel-workspace-runtime`
   - Usage、Logs、period/page URL state、只读 runtime、安全投影与响应式闭环。
   - 依赖 Core；执行顺序放在 Models 之后，使每个分支都从当时最新 clean `main` 开始。
   - 候选分支：`codex/frontend-v2-ai-channel-workspace-runtime`。

不采用单 Task：完整 Workspace 会同时修改三类 revision owner、两类真实远端调用、安全合同、两个前端消费者与五个 section，预计明显超过一个 5–20 个主要文件的可审查 PR。三片分别围绕 channel aggregate、model resource、read-only runtime 建立稳定 review 边界，不按文件数量机械拆分。

## 跨子任务验收标准

- [x] `/settings/ai/$channelId` 五个 canonical section 均为真实能力，没有空占位或固定成功路径。
- [x] List 的 basic/request/models/usage handoff 在对应子 Task 合入时立即闭环；logs 在 Runtime 闭环。
- [x] 创建渠道使用 List Dialog，成功进入真实 Workspace；不存在 `/new` 假路由。
- [x] Basic/Request 共用完整 `AIChannelUpdate` baseline、dirty guard 与 channel revision；409 不自动重放。
- [x] API Key 与所有 Header value 永不回显；读取 cache、日志、错误、审计、复制、快照与测试 snapshot 无明文。
- [x] Header create/update/delete 均由 channel revision 保护；Header delete 过期返回 409。
- [x] Model discovery/test/delete 携带正确 revision；测试真实副作用只发送一次，测试后模型保持停用。
- [x] Model CRUD/测试/启停/删除只消费服务端 token；后端拒绝 stale 与 no-op。
- [x] Usage period 与 Logs page/pageSize 只有 URL owner；服务端聚合/分页语义不在客户端复制。
- [x] persistent configuration mutation 后的 cache invalidation 与设计矩阵一致；历史与无关查询不被刷新。
- [x] ADMIN 页面与直接 API 权限、CSRF、revision 和最终状态验证均通过目标自动化测试。
- [x] Core 子 Task 起即具备 component tests 与严格 Playwright fixture；三个子 Task 均覆盖 375、768、1024、1440，无根横向溢出且键盘/焦点可用。
- [x] OpenAPI 变化先于后端/前端实现，两套 generated types 同步，V1 直接消费者通过 component/type validation；无 compatibility field 或 silent fallback。
- [x] 无数据库迁移、依赖、通用框架或 design-system → configuration 反向依赖。
- [x] 已形成独立 `frontend-v2-ai-channel-configuration-e2e` handoff：后续在真实后端、PostgreSQL 与本机 Provider 协议替身上闭环 List → create → configure → discover/create model → test → enable → usage/logs；在该 Task 完成前不宣称真实 Configuration 全链路已验收。

## Planning gate 与 Git 纪律

- 本父 Task 保持 `planning`；本轮完成文档后停止并等待用户批准。
- 本轮不运行 `task.py start`、不创建分支、不提交、不 push、不创建 PR。
- 每个获批子 Task 在新的独立会话中，从当时最新 clean `main` 创建唯一临时 `codex/frontend-v2-*` 分支。
- 每个子 Task Required validation 通过后，提交前展示 commit plan 并等待确认；不夹带未知 dirty 文件。
- 子 Task 归档后在主工作目录 fast-forward 合入 `main`，确认 clean，再删除临时分支；不 push。
