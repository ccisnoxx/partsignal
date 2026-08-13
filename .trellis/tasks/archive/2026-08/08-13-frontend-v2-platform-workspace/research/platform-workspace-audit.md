# Platform Workspace 审计记录

## 1. 开始前证据

- 主工作目录：`/Users/sc/PycharmProjects/partsignal`。
- 初始分支：`main`。
- 初始工作区：干净。
- 前置提交已在 `main`：`90f3e27 feat(frontend-v2): add platform list`。
- Platform List 归档与 journal 提交已在 `main`：`1a0f1af`、`adee96d`。
- 创建本 planning Task 前无 active Trellis Task。
- 已创建 `.trellis/tasks/08-13-frontend-v2-platform-workspace`，状态为 `planning`；未运行 `task.py start`，未创建分支。

## 2. 关键代码证据

### Frontend V2

- `frontend-v2/src/domains/configuration/` 当前只有 Platform List API/model/page/tests，没有 Workspace。
- 根 frontend component/visual spec 的具体组件条款仍面向 V1 Ant Design；更具体的 `frontend-v2/AGENTS.md` 与 01–09 蓝图固定 V2 为 shadcn/Base UI/Tailwind。规划只继承不冲突的动作、响应式、焦点和可访问性原则，不复制 V1 技术栈。
- `platform.api.ts` 当前只有 list keys 与 Platform lifecycle commands。
- `platform-list.model.ts` 已拥有 typed Platform primary/available/deletion action resolver 和 canonical Workspace href。
- `routes/_app/settings/platforms/index.tsx` 已建立 search canonicalization、cache-aware prefetch 和 thin route pattern。
- `DirtyGuard` 已覆盖 path/search/hash/beforeunload，并显式恢复焦点。
- Tabs、Form Kit、RowActions、Dialog、Table Kit、DetailSection、shared file transfer均已存在；不需新依赖或通用框架。
- App Shell breadcrumb只消费 static route metadata，现有动态详情页也使用“产品详情/发布工作台”等静态标签。

### Platform Detail / Update

- OpenAPI `PlatformProfileDetail` 已包含 `profile + account_summary + reference_summary`。
- `PlatformProfile` 已包含 Logo、名称、slug、类型、官网、domains、revision、状态、Prompt reference、账号 total/enabled、readiness、workflow、primary/actions/deletion、updated_at。
- Detail runtime router当前使用 `AdminUser`，service固定 `platform_profile_out(..., can_manage=True)`。
- Detail会分多次读取 Platform、账号聚合、ContentTask引用和动作投影，但 route当前未在首次查询前设置 `REPEATABLE READ`；相邻 Product/Content/Publication Context 已使用该项目惯例。
- `PlatformProfileUpdate` 不包含 slug；required字段为 revision/name/domains/type/prompt/website，Logo按字段 presence三态。
- update service锁 Prompt bindings与 Platform，校验 revision、type、Prompt、Logo并一次递增 revision；类型/Prompt消失显式 not-found。
- allowed domains 由服务端 trim、去尾点、IDNA ASCII、casefold和 DNS label规则规范化；website使用 `HttpUrl`。

### Accounts

- Account List允许 `CurrentUser`，按 platform ID过滤并批量投影。
- create/update/enable/disable使用 `EngineerUser`，实际允许 ADMIN + ENGINEER；delete最终校验 ADMIN。
- projection对两个角色都返回 UPDATE + ENABLE/DISABLE，仅 ADMIN得到 deletion和可能的 DELETE；平台停用投影 `PLATFORM_DISABLED/HANDLE_PLATFORM`。
- create要求 active Platform；update/status允许维护停用平台下既有账号。
- identifier唯一性由服务端预检和数据库 `uq_platform_accounts_profile_identifier_normalized` 双重保证，规则为同平台 `lower(btrim(identifier))`；两条冲突路径目前只有稳定 code/message，没有 `details.errors[].loc` 字段位置。
- delete实时复核非终态 PublicationWork，但 OpenAPI/router/service都没有 expected revision；这是明确合同缺口。

### Prompt

- Detail中的 `PlatformPromptReference` 已有 id/name/revision/updated_at。
- `GET /platform-prompts` 为 ADMIN-only，ListItem只在 reference上增加 updated_by/bound count/actions，不含 Markdown正文；足以作为按需 options read model。
- Prompt绑定/解绑使用 Platform PATCH和 Platform revision；不需要新 endpoint。

### Logo/File

- 候选 endpoint固定访问 Icon Horse，禁止 redirect；下载后验证 PNG/JPEG/WebP/ICO、2 MiB、像素与解码，再写自有存储。
- upload intent已支持 `PLATFORM_LOGO + PUBLIC`，通用 transfer helper存在。
- Platform PATCH省略/UPLOAD/null分别保持/替换/移除。
- 绑定只接受 VERIFIED/PUBLIC/PLATFORM_LOGO；未绑定候选24小时清理，最后解绑旧 Logo七天后清理；前端不拥有清理逻辑。

## 3. 调用与缓存消费者证据

- Content creation options实时返回 active Platform id/name。
- Content Task List/Detail/Editor Context使用实时 Platform name/website/logo，故 Platform identity mutation需失效对应 cache。
- Generation options读取当前 Platform Prompt，故 bind/unbind需精确失效 generation option queries。
- Publication ready items读取 active Platform与enabled Accounts。
- 非终态 Publication Work list/context使用实时 Platform/Account identity；终态成果使用 snapshot，不应因配置 mutation刷新。
- Publication Workspace eligible accounts读取当前平台启用账号。

## 4. 旧 Frontend 证据（仅业务行为）

- V1 Platform编辑已将 update映射为一个完整 PATCH，并把 slug保持为create-only。
- V1 Logo已实现 explicit candidate preview/confirm、UPLOAD/NONE/UNCHANGED和不接受SVG的帮助文本。
- V1 Accounts页面已有 create/update/status/delete直接调用；delete当前省略 revision，需要随合同做单点兼容。
- V1不作为 V2 组件、布局或架构来源。

## 5. 未发现的需求

- 未发现第三种账户角色、账号 credential字段、Platform Type在 Workspace独立保存 endpoint、Prompt reference专用 options endpoint或需要新数据库列的证据。
- 未发现需要 Redux、通用 Settings Workspace、通用 CRUD Form、通用 Upload/媒体管理或新依赖的证据。
