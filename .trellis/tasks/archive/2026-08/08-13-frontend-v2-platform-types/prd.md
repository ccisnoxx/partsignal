# Frontend V2 Platform Types

## 1. Goal

在 `/settings/platforms/types` 交付 Platform Type 管理子设置：管理员可读取稳定列表并创建、编辑、删除类型，能看到权威平台数量、删除 blocker 与 revision conflict；普通用户由现有管理员路由边界和后端共同拒绝。

本页是“平台与账号”的 subsettings，不占 Sidebar，不创建 Detail 页面，也不抽象通用 Configuration CRUD。计划临时分支为 `codex/frontend-v2-platform-types`；只有用户批准本 Task 最新规划后才可创建。

## 2. Verified Current State and Gaps

### 2.1 Already available

- `GET/POST/PATCH/DELETE /api/v1/platform-types` 已存在，全部使用 `AdminUser`；写命令有 CSRF。
- `PlatformType` 已返回 `primary_task=EDIT_CATEGORY`、`available_actions`、`deletion` 与 `revision`。
- 服务端已用一次 grouped query 统计每个类型的直接 `PlatformProfile` 引用，并据此投影 blocker/DELETE；不存在逐行查询。
- 数据库 `platform_types.slug` 的真实唯一约束名为 `uq_platform_types_slug`；`name` 没有唯一约束。
- Platform List 与 Workspace Detail 已返回按 `lower(name), id` 排序的 `platform_type_options`，并展示当前类型名称。
- V2 已有 TableShell、RowActions、Base UI Dialog、RHF/Zod form、Empty/Error、DirtyGuard 与 375px card-row pattern。

### 2.2 Gaps

- `PlatformType` wire model 未暴露权威 `platform_count`。
- 类型列表当前按 `created_at`，与既有 options 稳定顺序不一致。
- UPDATE 要求 `expected_revision`，DELETE 尚未要求 revision。
- `name` 只在 service 中 `.strip()`，空白值可越过请求校验；name/slug 未在请求合同声明数据库长度上限。
- slug 唯一约束竞态会落入全局 `REVISION_CONFLICT`，没有稳定字段错误。
- V2 尚无目标路由、页面、Platform List/Workspace 管理入口与 production-artifact fixture。
- V1 Platform Types DELETE 是唯一直接兼容调用点，当前未传 revision。

## 3. Requirements

### 3.1 Read model and ordering

- `PlatformType` 增加 required `platform_count: integer >= 0`。
- 数量统计所有直接引用该类型的 `PlatformProfile`，包括 Enabled 与 Disabled；这与删除时的真实引用门禁完全一致。
- 普通展示列直接消费 `platform_count`，不得读取 `deletion.blockers` 推导，也不得请求 Platform List 后在浏览器计数。
- List 按 `lower(name), id` 服务端稳定排序；不增加 search、pagination、sort query 或客户端排序。

### 3.2 Mutations and field contract

- 创建/编辑字段仅 `name`、`slug`；编辑提交当前 row revision。
- `name` 由服务端请求 schema 统一 trim，trim 后长度为 1–160；前端只镜像该规则提供即时反馈。
- `slug` 长度为 1–100，格式 `^[a-z0-9-]+$`，不自动大小写转换或生成；update 继续允许修改。
- `name` 不唯一；`slug` 由数据库唯一约束权威保证。create/update 的 `uq_platform_types_slug` 冲突统一返回 `409 PLATFORM_TYPE_SLUG_EXISTS`，并以 `details.errors[].loc=["body","slug"]` 定位字段；未知 IntegrityError 原样上抛。
- DELETE 改为 required `expected_revision` query。服务端锁行后先比较 revision，再统计全部 PlatformProfile 引用；过期返回 `REVISION_CONFLICT`，引用存在返回 `PLATFORM_TYPE_IN_USE`，两者不得混用。
- 不允许 optional revision、自动 GET 后重放 DELETE 或第二套 V2 endpoint。

### 3.3 Permissions and navigation

- Type route 放入现有 `_admin` pathless boundary；普通用户没有只读模式。
- List/CRUD endpoint 继续由 `AdminUser` 最终拒绝非管理员；隐藏入口不是授权。
- Platform List 与 Platform Workspace 只在 `auth.isAdmin` 时显示“平台分类”subsettings 入口；Sidebar 不新增项目。
- 页面提供明确返回 `/settings/platforms` 的入口。

### 3.4 Server-driven actions

- 行操作列只渲染 overflow `•••`，不渲染独立 primary button。
- `primary_task=EDIT_CATEGORY` 表达服务端当前任务语义，并要求与 UPDATE token 一致；不决定按钮位置。
- UPDATE 映射“编辑”，DELETE 映射“删除”，非空 deletion blocker 映射“查看删除条件”。只有 `available_actions` 含 DELETE 才能进入删除确认。
- 未知 primary task、action token 或 blocker type 显式失败，不静默忽略。

### 3.5 UI states and interaction

- 固定四列：名称、Slug、平台数量、操作。
- 完整覆盖 loading、empty、error、retry 和保留旧数据时的 refresh error。
- 创建/编辑使用短 Dialog + React Hook Form + Zod；409 保留输入并禁用重复提交，只有显式 reload 才采用服务端新 baseline。
- 删除 blocker 使用服务端类型与数量，`PLATFORM_PROFILE` 链接固定为 `/settings/platforms?platformTypeId=<id>&page=1&pageSize=20`。
- 删除 conflict 不自动重放。关闭未移除行的 Dialog 时恢复原触发器；成功删除后聚焦下一可用 overflow，若无下一行则聚焦页面标题。
- 375px 使用现有局部 card-row pattern，Name、Slug、platform count 与 overflow actions 全部可读可操作；不修改全局 Table Kit。

### 3.6 Cache consistency

- Type create/update/delete 只失效：Type Settings list、全部 Platform List queries、全部 Platform Workspace Detail queries。
- 不失效 Content、Publication、Account、Prompt 或其他 Configuration 查询，不清空 QueryClient。

## 4. Acceptance Criteria

- [ ] `/settings/platforms/types` 只对 ADMIN 可达，ENGINEER 保留 URL 并看到明确 403；endpoint 同样返回 403。
- [ ] Platform List 与 Workspace 仅管理员看见 subsettings 入口，Sidebar 无新增项，页面可返回 Platform Settings。
- [ ] 固定四列按 `lower(name), id` 显示，`platform_count` 为全部 Enabled/Disabled PlatformProfile 的权威总数。
- [ ] 创建、编辑、删除使用真实合同；编辑和删除都提交当前 revision。
- [ ] stale update/delete 返回 `REVISION_CONFLICT`，不自动重放；显式 reload 前保留用户上下文。
- [ ] 有引用时没有 DELETE 确认入口，并显示 `PLATFORM_TYPE_IN_USE`/blocker 与 canonical Platform List 链接。
- [ ] name 非唯一，name trim/长度、slug 格式/长度及数据库 slug 唯一冲突均有稳定服务端结果；slug 冲突定位表单字段。
- [ ] `EDIT_CATEGORY` 不生成独立 primary button；未知 action/primary/blocker 显式失败。
- [ ] 三类 mutation 精确失效真实 Platform Type/Platform List/Workspace consumers。
- [ ] loading、empty、error/retry、焦点返回及 375/768/1024/1440 production artifact 有直接测试证据。
- [ ] OpenAPI、runtime schema、两套 generated types、V1 DELETE 兼容调用、后端/前端测试与直接相关文档一致。

## 5. Out of Scope

- Platform List、Platform Workspace、Platform Account、Prompt Workspace、AI Channel 的新业务功能。
- Platform Type Detail、搜索、分页、排序参数、批量、导出。
- 通用 Settings Table、CRUD Form、Action Registry、DataTable abstraction 或新依赖。
- 数据库 migration、Phase 6 完整 real-stack E2E、Phase 6 抽象回顾、Workbench、Cutover、旧 frontend 重构。

## 6. Blocking Questions

无实现 blocker。合同收紧会同步修改唯一的 V1 DELETE 直接调用点及其直接测试；规划仍需用户批准。
