# Frontend V2 Platform Workspace

## 1. 背景与目标

Frontend V2 已在两个获批子 Task 中交付 `/settings/platforms/$platformId` Platform
Workspace。Core 统一了平台详情、概览、Logo、平台生命周期和 Prompt 绑定；Accounts 在同一
Workspace 中补齐发布账号管理闭环。

本需求的最终目标是在一个 canonical Platform Workspace 中统一“平台身份、发布账号、生成配置”三种心智：

```text
/settings/platforms/$platformId?tab=overview
/settings/platforms/$platformId?tab=accounts
/settings/platforms/$platformId?tab=generation
```

Workspace 必须以服务端 read model、action projection 和 revision 为权威，形成可刷新、可回退、可处理冲突的闭环；不得引入第二套 DTO、客户端权限推导、通用 CRUD/Workspace/媒体框架或新依赖。

## 2. 已批准的交付拆分

完整目标同时跨越 Configuration 与 Publication 两个后端业务边界，并包含两个可独立验证的并发合同：

1. Platform Workspace Core：actor-aware Detail、Workspace Shell、概览、Logo、平台生命周期、生成配置。
2. Platform Workspace Accounts：账号 CRUD/启停/删除、actor-aware action、删除 revision、PublicationWork blocker。

用户已批准并完成两个连续、可独立 review 的子 Task。当前 Task 作为父规划与最终一致性 owner，未创建业务分支，也没有独立业务代码提交。

已批准验收边界：

- `frontend-v2-platform-workspace-core`：交付 canonical route、三个 URL tab、完整概览和生成配置；发布账号区域按需读取并提供只读列表，使三个区域均可恢复、可访问，但不开放账号写动作。
- `frontend-v2-platform-workspace-accounts`：在同一账号区域补齐 create/update/enable/disable/delete、blocker、revision conflict、移动端动作与账号 mutation cache ownership。

实际交付遵守了顺序 gate：Core 完成验证、提交、归档并 fast-forward 合入 `main` 后，Accounts 才从更新后的 `main` 启动。

## 3. 功能要求

### 3.1 Workspace Shell

- 注册唯一 canonical route `/settings/platforms/$platformId`。
- `platformId` 必须是 UUID；无效参数不得发业务请求。
- `tab` 只接受 `overview | accounts | generation`，缺失、未知或额外 search 参数必须 replace 到显式 `?tab=overview`。
- breadcrumb 复用 route hierarchy：`平台与账号 / 平台工作区`；页面标题显示真实平台名称，不扩展全局动态 breadcrumb 机制。
- 提供返回 Platform List 的链接。
- Header 显示 Logo、名称、类型、Enabled/Disabled、readiness、revision 和更新时间摘要。
- 初始读取覆盖 loading、403、404、普通错误与 retry；有旧数据的后台刷新失败不得卸载页面。
- 三个区域由受控 Tabs 消费 URL state，refresh、Back、Forward 可恢复。
- 任一未提交表单在 tab 切换、返回列表、站内导航、刷新或关闭前由 DirtyGuard 拦截。
- 键盘、焦点、状态非颜色表达、375/768/1024/1440 响应式满足现有 V2 规范。

### 3.2 概览

- 展示真实 `PlatformProfile`：Logo、Name、Slug、Platform Type、Website URL、Allowed Domains、状态、readiness、Prompt 摘要、账号摘要、业务引用摘要、Revision、Updated time。
- Slug 只读；`PlatformProfileUpdate` 不包含 slug，不得从 create contract 推导可编辑性。
- 只有服务端 `available_actions` 包含相应 token 时呈现平台更新、启停和删除入口。
- 平台更新使用一次完整 `PlatformProfileUpdate` PATCH，携带当前 `expected_revision`；不得按字段拆成多个 PATCH。
- Name 去除首尾空白、Website URL 解析和 Allowed Domains 的 IDNA/主机名规范化由服务端请求 Schema 最终权威；前端只做等价的表单即时反馈，不改变 canonical 值。
- 409 `REVISION_CONFLICT` 保留本地输入并要求显式 reload，不自动重放。
- Platform Type 或 Prompt 并发删除产生的 404/409 必须明确展示，不增加猜测 fallback。
- 启停、删除复用 Platform List 已有 action resolver、revision command 和删除阻断展示；删除成功返回 Platform List。

### 3.3 Logo

- 显示当前 `UPLOAD` 或 legacy `EXTERNAL` Logo；缺失时显示可识别 fallback。
- 手工上传复用通用 upload-intent/transfer/complete/abort 流程，固定 `PUBLIC + PLATFORM_LOGO`。
- 客户端选择器只接受 PNG、JPEG、WebP、ICO；帮助文本明确最大 2 MiB 和不接受 SVG；服务端仍最终校验真实 MIME、大小和像素。
- 官网候选必须由管理员显式点击，调用既有 `POST /platform-logo-candidates`，预览后再次确认才把 `file_id` 放入待保存表单。
- 保持、替换、移除严格映射为：省略 `logo`、`{source:"UPLOAD",file_id}`、`null`。
- 替换/移除后的旧文件调度与清理由服务端现有 Logo 生命周期处理；前端不创建媒体库或文件清理器。

### 3.4 发布账号

- 进入 `accounts` tab 时才请求 `GET /platform-accounts?platform_profile_id=<id>`；首屏不加载账号明细。
- 平台上下文中不重复“平台”列。桌面/平板列为业务标签、内部账号标识、状态、操作；375px 使用同一数据的移动列表/卡片，标签、状态和动作均可达。
- 不出现 API key、secret、密码、Cookie 或凭据字段。
- 所有已认证角色可读取；ADMIN 与 ENGINEER 可 create/update/enable/disable；仅 ADMIN 可 delete。
- UI 只消费 `primary_task / available_actions / deletion / revision`；未知 token 必须穷尽失败。
- 平台停用时沿用服务端投影：`workflow_stage=PLATFORM_DISABLED`、`primary_task=HANDLE_PLATFORM`；现有 UPDATE 与启停账号动作仍可维护，create 由服务端以 `PLATFORM_DISABLED` 拒绝。
- create/update 使用服务端唯一性规则；相同平台内 `btrim + case-insensitive` 的账号标识由数据库约束和服务端错误 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 权威保证。
- update/enable/disable/delete 都必须使用当前 account revision。DELETE 合同需补 required `expected_revision`，并在行锁后先检查 revision，再实时复核非终态 PublicationWork blocker。
- 409 保留 create/edit 输入或当前 Dialog 上下文，要求显式 reload；不执行“先 GET 再 DELETE”或 optional revision 兼容分支。
- Dialog 关闭或命令完成后焦点返回触发器。

### 3.5 生成配置

- 展示当前 Prompt identity、revision、updated time 和对 readiness 的服务端影响。
- 只有管理员可进入编辑；只读角色不请求 Prompt options。
- 管理员进入 generation 或开始编辑时按需请求既有窄 `PlatformPromptList`，只使用 reference 字段形成选择项，不请求 Prompt Detail、不读取 Markdown 正文。
- 选择现有 Prompt或解除绑定，保存时使用一次完整 `PlatformProfileUpdate` PATCH 和当前 Platform revision。
- 409 保留用户选择并要求显式 reload；并发删除 Prompt 的 404 明确失败。
- 不实现 Prompt Markdown 编辑、preview、创建、删除、revision history 或 AI channel/model 配置。

## 4. 权限与权威

- 当前账户类型只有 `ADMIN` 与 `ENGINEER`，不存在第三种“普通已认证角色”；测试矩阵以这两个真实角色为准，另保留 403 响应 UX。
- Workspace read 应由现有 Platform Detail endpoint 改为 `CurrentUser`，并按 actor 投影 `profile` 管理动作。
- Workspace Detail 的多条读取必须在一个 PostgreSQL `REPEATABLE READ` 请求中完成，避免平台、账号和引用摘要来自不同快照。
- Platform update/enable/disable/delete、Logo candidate、Prompt bind/unbind 仍仅允许 ADMIN。
- Account create/update/enable/disable 继续允许 ADMIN 与 ENGINEER；delete 仍仅允许 ADMIN。
- 前端 `auth.isAdmin` 只可用于非业务布局；Platform/Account 最终动作只由服务端 projection 决定，写 endpoint 继续最终复核权限和状态。

## 5. 验收标准

- [x] Platform List 名称可进入 canonical Workspace，direct URL、refresh、Back、Forward 恢复正确 tab。
- [x] 首屏只读取一个 actor-aware、`REPEATABLE READ` 的 Platform Detail/Context，不请求 Platform List 搜索当前行，不产生无条件多接口 waterfall。
- [x] Overview、Accounts、Generation 三个区域均使用真实 generated contract 和服务端投影。
- [x] ADMIN/ENGINEER 权限差异与服务端 endpoint 一致；403/404/普通错误可恢复。
- [x] Platform 表单、Generation 选择和 Account 表单具备 dirty/cancel/save/409 显式 reload 行为。
- [x] Platform 生命周期复用 List owner；账号 action mapping 穷尽 typed token。
- [x] Logo 已有/缺失/候选/上传/替换/移除使用现有文件生命周期，不接受 SVG，不绑定未确认外部候选。
- [x] Account create/update/enable/disable/delete 使用当前 revision；数据库唯一性和 PublicationWork blocker 仍为最终权威。
- [x] Mutation 只失效矩阵中有真实消费者的 query 前缀，不清空整个 QueryClient。
- [x] 375px 无不可操作宽表；四档宽度无页面根横向溢出。
- [x] generated-type strict production fixture 拒绝未声明 API，并审计 console/page/request errors。
- [x] 直接相关 contract、spec、Frontend V2 文档与实现一致。

## 6. 明确排除

- 新建 Platform 页面或表单、Platform Type CRUD、Prompt Workspace/编辑/预览/历史、AI Channel/Model、凭据管理。
- Platform List 导出、Workbench、Cutover、旧 frontend 视觉迁移、通用 Configuration/Settings Workspace/CRUD Form/Action Registry/媒体框架。
- 新依赖、Redux、通用跨域 state store、客户端业务状态机、无关 backend/frontend 清理。
- Phase 6 完整 real-stack E2E、Phase 6 抽象回顾和其他 domain E2E。

## 7. 最终交付状态

- Core：交付提交 `30ae3f67 feat(frontend-v2): add platform workspace core`，归档提交 `f7887c23`。
- Accounts：交付提交 `e669a492 feat(frontend-v2): add platform account workspace`，归档提交 `23ff00d8`。
- 两个子 Task 均已完成各自 Required validation、归档并进入 `main`；验证证据保存在各自归档的 `implement.md`。
- 父 Task 没有独立业务分支和独立代码提交，只负责拆分、顺序 gate 与最终一致性收口。
- 本次父 Task 收口不修改业务代码，也不重复运行子 Task 已通过的测试。
- Phase 6 下一项为 Platform Type subsettings；本 Task 不创建或启动该后续 Task。
