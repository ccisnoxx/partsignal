# Frontend V2 Platform Workspace Core

## 1. Goal

在 `/settings/platforms/$platformId` 交付 Platform Workspace 的核心闭环：统一平台身份、概览、Logo、平台生命周期和生成配置，并提供按需读取的发布账号只读区域。页面必须使用可恢复 URL、服务端 action/revision 和一致性 read model，不引入通用 Configuration framework。

本 Task 是父 Task `frontend-v2-platform-workspace` 的第一个子 Task。计划分支为 `codex/frontend-v2-platform-workspace-core`；只有用户批准本子 Task 的最终规划后才可创建。

## 2. Dependency

- 基线必须包含 `90f3e27 feat(frontend-v2): add platform list` 及其归档、journal 提交。
- 本 Task 完成、验证、提交、归档并 fast-forward 合入 `main` 后，`frontend-v2-platform-workspace-accounts` 才可启动。
- Accounts 子 Task 不得在本 Task 分支并行实施。

## 3. In Scope

### 3.1 Workspace Shell

- 唯一 route：`/settings/platforms/$platformId`。
- `platformId` 在发请求前执行 UUID 校验和小写 canonicalization。
- `tab` 只接受 `overview | accounts | generation`；缺失、非法、数组或额外 search 参数 replace 为显式 `?tab=overview`。
- static breadcrumb、返回 Platform List、真实 Platform Logo/名称/类型/状态/readiness/revision/updated time。
- loading、403、404、普通错误、retry 和 stale data background error。
- Tabs 由 TanStack Router URL state 持有；DirtyGuard 覆盖 tab、返回、站内导航和 beforeunload。
- 375/768/1024/1440、键盘、焦点、非颜色状态表达和 200% 缩放基础可用性。

### 3.2 Actor-aware Detail read model

- 复用 `GET /api/v1/platform-profiles/{platform_profile_id}`，不新增 Workspace endpoint。
- 读取从 `AdminUser` 改为 `CurrentUser`；ADMIN 获得管理动作，ENGINEER 获得空 Platform 管理动作。
- 请求首次查询前建立 PostgreSQL `REPEATABLE READ` 快照。
- `PlatformProfileDetail` additive 增加稳定的 `platform_type_options: PlatformTypeSummary[]`。
- 固定查询数返回 `profile + account_summary + reference_summary + platform_type_options`；首屏不请求 Platform List、Account List、Prompt List 或 Platform Type CRUD List。

### 3.3 Overview 与 Platform 生命周期

- 展示并在服务端 `UPDATE` 动作存在时编辑 Name、Platform Type、Website URL、Allowed Domains；Slug 只读。
- readiness、Prompt、账号、业务引用、revision、updated time 直接消费 Detail 投影。
- 一次完整 `PlatformProfileUpdate` PATCH 保存全部字段和当前 revision，不拆分 PATCH。
- 409 保留草稿并要求显式 reload，不自动重放。
- 启停、删除复用 Platform List 的 command、action resolver、revision conflict、blocker 和 cache owner；删除成功返回 Platform List。

### 3.4 Logo

- 已有 UPLOAD/legacy EXTERNAL Logo、缺失 fallback、显式移除。
- 手工上传复用 upload intent → transfer → complete/abort，固定 `PUBLIC + PLATFORM_LOGO`。
- 选择器只接受 PNG/JPEG/WebP/ICO，明确 2 MiB 与拒绝 SVG；服务端最终校验 MIME、大小、像素和解码。
- 官网候选必须由用户显式请求、预览并确认；未确认 candidate 不进入 PATCH。
- 保持/替换/移除严格映射为省略 `logo` / `UPLOAD file_id` / `null`。
- 文件清理继续由现有服务端生命周期所有者完成。

### 3.5 Accounts read-only 区域

- 仅首次进入 `tab=accounts` 时请求当前平台 Account List。
- 桌面/平板显示业务标签、内部账号标识、状态；375px 使用同源移动列表。
- 本 Task 不渲染 create/edit/status/delete 入口，即使 API 已返回行级动作；账号写闭环由第二子 Task交付。
- 不显示 API key、secret、密码、Cookie 或凭据。

### 3.6 Generation

- 展示当前 Prompt identity、revision、updated time 和 readiness 影响。
- 只有 Platform `available_actions` 包含 `UPDATE` 时开放编辑；不使用 `isAdmin` 推导。
- 编辑时按需复用窄 `PlatformPromptList` options，不读取 Prompt Detail 或 Markdown。
- bind/unbind 使用一次完整 Platform PATCH 和当前 revision；409 保留选择并要求显式 reload。

## 4. Acceptance Criteria

- [x] Platform List 名称可进入 canonical Workspace，direct/refresh/Back/Forward 恢复正确 tab。
- [x] 首屏只发一个 actor-aware、`REPEATABLE READ` Platform Detail 请求，固定查询数且无客户端 join。
- [x] ADMIN 与 ENGINEER 均可读取；只有 ADMIN 响应包含 Platform 管理动作。
- [x] Overview 初始化、dirty、cancel、save、409 reload、Slug readonly 与一次 PATCH 均有测试证据。
- [x] Logo 已有/缺失/上传/candidate confirm/remove 完整，SVG 不可选且未确认 candidate 不保存。
- [x] Accounts 按需读取、保持只读，在 375px 标签/标识/状态均可达。
- [x] Generation 按需加载 options，bind/unbind 使用 Platform revision，ENGINEER 不请求 options。
- [x] loading/403/404/error/retry、DirtyGuard、焦点恢复与四档宽度由 production-artifact fixture 覆盖。
- [x] Platform mutation 只失效真实 Configuration、Content 和非终态 Publication consumers，不清空整个 QueryClient。
- [x] OpenAPI、runtime schemas、两套 generated types、代码、测试和直接相关文档一致。

## 5. Out of Scope

- Account create/update/enable/disable/delete 与 Account DELETE revision 合同。
- Platform 新建、Platform Type CRUD、Prompt Workspace/Markdown/preview/history、AI Channel/Model、凭据管理。
- 通用 Settings Workspace、CRUD Form、Upload/媒体或跨域 Action Registry。
- 数据库 migration、Phase 6 完整 real-stack E2E、Workbench、Cutover 和无关清理。

## 6. Blocking Questions

无。分拆范围已由用户批准；本规划仍需一次新的实施批准。
