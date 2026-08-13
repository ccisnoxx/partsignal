# 技术设计

## 1. 结论摘要

- 现有 `PlatformProfileDetail` 的字段边界基本足以支撑 Workspace Shell 与 Overview，但 runtime 只允许 ADMIN，且固定以 `can_manage=True` 投影；这是 Workspace read 的首要缺口。
- Detail 内部会顺序读取 Platform、账号聚合、任务引用和动作投影，却尚未建立 `REPEATABLE READ` 快照；作为 Workspace 首屏必须补齐这一现有项目惯例。
- Detail 缺少平台类型编辑选项。为避免首屏再请求 Platform List 或管理员专用的完整 Platform Type CRUD list，建议在 Detail 中加入稳定的 `platform_type_options: PlatformTypeSummary[]`。
- Platform update 已是一个锁定 Platform revision 的完整 PATCH；Logo、Prompt bind/unbind 都在该命令中原子更新，不需要新写 endpoint。
- 现有 Prompt List 不含 Markdown 正文，已是可复用的 reference/options read model；只在管理员编辑 Generation 时按需加载。
- 现有 Account List 和 action projection 已对当前两个角色正确区分管理能力：两者可 UPDATE/ENABLE/DISABLE，仅 ADMIN 得到 deletion/DELETE。唯一结构性缺口是 DELETE 不携带 revision。
- Logo candidate、上传、绑定、解绑和延迟清理已完整存在；前端只需编排现有生命周期。
- 完整交付会同时修改 Configuration 和 Publication 两个业务 owner，建议按 Core / Accounts 拆为两个 Task。

## 2. Gap analysis

| 蓝图/要求 | 当前实现 | 判断与最小方案 |
|---|---|---|
| `/settings/platforms/$platformId` | Platform List 只输出 href；route/page 不存在 | 新增一个 canonical file route 和 Configuration domain page |
| 三个可恢复区域 | 不存在 | `tab=overview|accounts|generation`，默认显式 overview，未知/额外参数 replace |
| 首屏单 read model | `GET /platform-profiles/{id}` 已返回 profile、account summary、reference summary | 复用并改为 actor-aware；不新增 Workspace endpoint |
| 全角色只读 Workspace | Detail router 使用 `AdminUser` | 改为 `CurrentUser`，按 actor 传 `can_manage` |
| 首屏快照一致性 | Detail 由多条查询组成，route 未设置事务隔离级别 | 请求开始、首次查询前设置 `REPEATABLE READ`；不新增 endpoint |
| Platform Type 编辑选项 | Detail 只有当前 type；Platform List 才有稳定 options | Detail additive 增加 `platform_type_options`，固定批量查询 |
| Platform update | 已有完整 `PlatformProfileUpdate`，含 revision/name/domains/type/prompt/website/logo | 直接复用；Slug 不在 update，保持只读 |
| readiness、Prompt/账号/引用摘要 | Detail 已具备 | 直接消费服务端字段，不在浏览器推导 |
| Logo | candidate +通用上传+三态 PATCH+延迟清理已实现 | 复用；只新增 Platform scoped UI，不抽象通用媒体层 |
| Accounts read/actions | list 按 platform filter；projection 固定批量查询 | tab 按需加载；UI 穷尽 token |
| Account 权限 | ADMIN/ENGINEER 均可写状态/身份；DELETE 仅 ADMIN | 与真实两角色合同一致，无需新角色模型 |
| Account create | create 是集合级页面动作，现有两个真实角色均可调用 | 不增加资源 token，不使用 `isAdmin`；平台停用由 POST 最终拒绝 |
| Account DELETE 并发 | 无 `expected_revision` | required query 参数贯穿 OpenAPI/router/service/V1/V2/tests；锁后先校验 revision |
| Account blocker/唯一性 | 非终态 PublicationWork 实时阻断；normalized unique constraint 已存在，但唯一冲突缺标准字段位置 | blocker 直接消费 projection；预检/constraint 统一补 `account_identifier` 字段错误 |
| Prompt options | `PlatformPromptListItem` 是 reference + 管理 metadata，无 Markdown | ADMIN 在 Generation 编辑时按需复用；不 GET Prompt Detail |
| 动态 breadcrumb | App Shell 只支持 static route metadata | 保持现有模式：静态“平台工作区”，真实名称在页面 H1；不扩展全局 metadata contract |
| 响应式账号表 | 无 V2 Account surface | ≥768 使用现有 Table/RowActions；375 使用同源 mobile list，不保留不可操作宽表 |

## 3. 权限矩阵

当前数据库与 `AccountType` 只有 ADMIN、ENGINEER；“其他已认证角色”不是现有合同，不能为假想角色增加分支。

| 能力 | ADMIN | ENGINEER | 权威来源 |
|---|---:|---:|---|
| 读取 Platform List | 是 | 是 | `CurrentUser` + actor-aware list projection |
| 读取 Workspace Detail | 应为是 | 应为是 | 本 Task 将 Detail 改为 `CurrentUser` |
| 更新/启停/删除 Platform | 是 | 否 | Platform `available_actions/deletion` + ADMIN endpoint |
| 发现/上传/绑定/移除 Logo | 是 | 否 | Platform UPDATE / Logo candidate endpoint；上传 endpoint 接受两角色，但 Platform 写仍 ADMIN |
| 读取 Accounts tab | 是 | 是 | Account List `CurrentUser` |
| 创建/编辑/启停 Account | 是 | 是 | `EngineerUser`（ADMIN + ENGINEER）+ Account projection |
| 删除 Account | 是 | 否 | `deletion/DELETE` 只向 ADMIN 投影；DELETE endpoint 再校验 ADMIN |
| 读取当前 Prompt 摘要 | 是 | 是 | actor-aware Platform Detail |
| 读取 Prompt options | 是 | 不需要/不请求 | 现有 Prompt List 为 ADMIN endpoint |
| bind/unbind Prompt | 是 | 否 | Platform UPDATE projection + ADMIN endpoint |

前端不得以 `auth.isAdmin` 补出业务动作。只读 shell/字段对两个角色相同；动作只消费响应 token。即使用户绕过 UI，写 endpoint 仍最终拒绝。

## 4. Read model 与请求边界

### 4.1 首屏

唯一首屏业务请求：

```text
GET /api/v1/platform-profiles/{platform_profile_id}
-> PlatformProfileDetail {
     profile,
     account_summary,
     reference_summary,
     platform_type_options
   }
```

服务端在首次查询前设置 PostgreSQL `REPEATABLE READ`，再以固定查询数读取 Platform、账号聚合、ContentTask 引用、Platform action/deletion 和全部稳定 Platform Type summary。`profile.id` 必须与 URL ID 一致；不一致视为合同错误并阻断页面。

明确不做：

- 不请求 Platform List 再搜索当前平台。
- 不首屏请求 Account List、Prompt List 或 Platform Type CRUD List。
- 不把全部账号或 Prompt 明细塞入 Detail。
- 不创建第二个 `/workspace-context` endpoint；现有 Detail 已拥有这个职责。

### 4.2 按需读取

| 触发 | 请求 | 内容边界 |
|---|---|---|
| 首次进入 Accounts | `GET /platform-accounts?platform_profile_id=<id>` | 当前平台账号及 actor-aware actions；不含平台列/凭据 |
| ADMIN 首次进入 Generation 或开始编辑 | `GET /platform-prompts` | reference/list metadata；不含 Markdown body |
| ADMIN 显式发现官网候选 | `POST /platform-logo-candidates` | 一个已下载到自有存储的候选与临时 preview |
| ADMIN 选择本地 Logo | upload intent → transfer → complete | 一个 VERIFIED/PUBLIC/PLATFORM_LOGO FileRecord |

## 5. URL 与 Router 方案

使用 search param，而不是 local React tab state或新增三个子路由：

```text
tab = overview | accounts | generation
```

规则：

- canonical URL 始终显式包含 `tab`。
- 无 `tab`、未知值、数组值、额外 search key 均 replace 到同 ID 的 `?tab=overview`。
- `platformId` trim/lowercase 后必须通过 `z.uuid()`；合法大写 UUID replace 为小写 canonical ID，非法 ID 在请求前进入明确 route error。
- Tabs 为 controlled component；选择 tab 调用 Router navigate，不把业务 tab 写入组件 local state。
- route loader 只在 query cache 尚无 Detail key 时非阻塞 prefetch；页面仍拥有 loading/403/404/error/retry。
- route `key={platformId}` 重建 Workspace 身份，避免同 revision 跨平台复用表单。
- breadcrumb 使用静态 route metadata“平台工作区”，页面 H1 使用 `profile.name`；不为一个页面改造 App Shell metadata/loaderData。

## 6. Component hierarchy

```text
PlatformWorkspaceRoute
└── PlatformWorkspacePage
    ├── PlatformWorkspaceHeader
    │   ├── Logo / identity / type
    │   ├── status + readiness
    │   └── return link / projected platform actions
    ├── controlled Tabs (URL owner in route)
    │   ├── PlatformOverviewSection
    │   │   ├── identity/readiness/reference summaries
    │   │   └── PlatformOverviewForm
    │   │       └── PlatformLogoField
    │   ├── PlatformAccountsSection
    │   │   ├── desktop/tablet semantic table
    │   │   ├── mobile semantic list
    │   │   ├── AccountFormDialog
    │   │   └── projected RowActions / blocker dialog
    │   └── PlatformGenerationSection
    │       └── PromptReferenceForm
    └── DirtyGuard
```

复用边界：

- 复用 design-system 的 Tabs、FormField/FormLayout、DirtyGuard、Dialog、Badge、TableShell/RowActions、DetailSection、Skeleton。
- 根 `.trellis/spec/frontend/component-guidelines.md` 与 `visual-system.md` 仍以 V1 Ant Design 为实现语境；V2 实施按更具体的 `frontend-v2/AGENTS.md` 和 Frontend V2 01–09 蓝图使用现有 shadcn/Base UI/Tailwind primitives，只继承其中不冲突的业务动作、响应式、焦点和可访问性约束，不把 V1 组件栈复制进 V2。
- 不复用三栏 `WorkspaceShell`：它解决 context/main/reference 响应式布局，不是顶部业务 tab owner。
- Logo UI 留在 Configuration domain；只复用 shared `sha256File/transferFile`，不跨域导入 GEO/Publication upload 组件。
- Platform List 与 Workspace 已成为两个真实消费者时，只把 platform lifecycle action/command 映射最小提取为 Configuration domain owner；不创建全站 Action Registry。
- Account resolver只属于 Accounts section，不上提 design-system。

## 7. 状态所有权

| 状态 | Owner |
|---|---|
| Detail、Accounts、Prompt options、mutation canonical response | TanStack Query |
| `platformId`、`tab` | TanStack Router |
| Overview/Generation/Account 表单与 dirty baseline | React Hook Form + generated type映射 + Zod |
| Dialog open、候选预览、上传 phase、tab focus return | React local state |
| Platform/Account 权限、workflow、readiness、blocker、revision | Server projection/command |

Overview 与 Generation 是同一 Platform revision 的两个独立编辑 surface；任一时刻只允许当前区域持有未提交草稿。切换 URL tab 时 DirtyGuard 生效。保存成功以 canonical Platform response 前进 revision，再重读 Detail；409 时不 reset 表单。

## 8. 表单与命令映射

### 8.1 Platform update

Overview Form 映射到一个 `PlatformProfileUpdate`：

- `expected_revision`：Detail baseline revision。
- `name/allowed_domains/platform_type_id/website_url`：表单值。
- `platform_prompt_id`：保留 Detail 当前绑定。
- `logo`：仅发生 Logo 操作时按三态写入；保持时省略字段。

Generation Form 同样提交一个 `PlatformProfileUpdate`：

- 保留 Detail 当前 `name/allowed_domains/platform_type_id/website_url`。
- 只改变 `platform_prompt_id`。
- 省略 `logo`。

不得发送多个 PATCH，也不得维护客户端 `PlatformProfileUpdateV2`。

### 8.2 Platform actions

复用 List 已有映射：

| Token | Workspace 呈现 |
|---|---|
| `UPDATE` | 开启 Overview 编辑 |
| `ENABLE` | revision confirmation → enable command |
| `DISABLE` | revision confirmation → disable command |
| `DELETE` | deletion projection一致时显示 destructive confirm |
| blocker 且无 DELETE | 查看删除条件 |

`primary_task` 只定位默认高频区域：`CONFIGURE_GENERATION` 激活 Generation，其他保持 Overview/显式 lifecycle action；不得按 status 重算。

### 8.3 Account actions

| Token / projection | 呈现 |
|---|---|
| `UPDATE` | 编辑 label + identifier Dialog |
| `ENABLE` | expected_revision status command |
| `DISABLE` | expected_revision status command |
| `DELETE` + empty blockers | expected_revision destructive confirm |
| deletion blockers | 查看 `PUBLICATION_WORK` 数量；无 DELETE |
| `HANDLE_PLATFORM` | 指向本 Workspace Overview，不替代 available_actions |
| unknown token | 穷尽映射抛出明确开发错误，不静默忽略 |

平台停用时不由前端移除 UPDATE/ENABLE/DISABLE；create 保持页面级动作，POST 最终复核并返回 `PLATFORM_DISABLED`。

## 9. 并发与错误处理

- Platform PATCH/enable/disable/delete：始终使用当前 Detail/Profile revision。
- Account PATCH/enable/disable/delete：始终使用当前 Account revision；DELETE 合同由本任务收紧为 required。
- mutation 前取消相同 Detail/Accounts key 的在途 GET，避免旧响应覆盖 canonical response。
- 409 `REVISION_CONFLICT`：保留表单/选择/Dialog，不自动重放；“重新加载”显式丢弃本地草稿并 refetch。
- `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`：映射到 account_identifier 字段或 ErrorSummary，保持 Dialog。
- `PLATFORM_ACCOUNT_IN_USE`：刷新 Account projection并展示 blocker，不伪造删除成功。
- Platform Type/Prompt 并发删除 404：保留表单，明确提示选项已不存在并提供 reload。
- 初始 403/404 使用专用整页状态；普通错误可 retry；已有 data 的背景错误保留 Workspace 并显示局部刷新失败。
- 删除当前 Platform 成功后先导航到 List，再以 `refetchType:'none'` 失效旧 Detail；不得在活动 observer 下 remove 后触发已删除资源 GET。

## 10. Query keys 与 cache invalidation matrix

Configuration owner 扩展既有 keys：

```text
platformKeys.lists()
platformKeys.detail(platformId)
platformKeys.accounts(platformId)
platformKeys.promptOptions()
```

Content/Publication 的跨域失效由 route composition callback 使用各 domain 已导出的 key owner，不让 Configuration domain 硬编码 sibling key 数组。若现有 Content key 不能形成精确 options 前缀，只在 Content owner 中补一个真实多消费者 prefix；不使用 predicate 猜 key、不失效整个 `['content']` 或整个 QueryClient。

| Mutation | Configuration cache | Content consumer | Publication consumer |
|---|---|---|---|
| Platform identity/type/website/domains/logo update | lists + current detail | platform references、creation options、task lists、task details、editor contexts | nonterminal work lists + workspace contexts |
| Platform enable/disable | lists + current detail + current accounts | creation options | ready items + workspace contexts |
| Platform delete | lists；旧 detail/accounts 标失效且退出 route | platform references、creation options、task lists/details/editor contexts | ready items、work lists、workspace contexts |
| Prompt bind/unbind | lists + current detail | generation-options 精确前缀 | 无 |
| Account create | lists + detail + accounts | 无 | ready items + workspace contexts |
| Account update label/identifier | lists + detail + accounts | 无 | ready items + nonterminal work lists + workspace contexts |
| Account enable/disable | lists + detail + accounts | 无 | ready items + workspace contexts |
| Account delete | lists + detail + accounts | 无 | ready items + work lists + workspace contexts |
| Logo candidate/upload未保存 | 无 Platform cache | 无 | 无 |

每个 invalidation 只影响已加载 bounded prefix。Prompt bind 不清空全部 Content Task cache；账号 mutation 不刷新 PublishedArticle 等终态 snapshot。

## 11. Contract/backend 决定

### 必须修改

1. `PlatformProfileDetail` additive 增加 `platform_type_options`。
2. Detail endpoint 从 ADMIN-only 改为 all-authenticated，并按 actor 投影 Platform action/deletion。
3. Detail route 在首次查询前建立 `REPEATABLE READ` 快照，并以固定查询数形成完整响应。
4. Account DELETE 增加 required `expected_revision` query；router/service 锁行后校验 stale revision，再复核 PublicationWork blocker。
5. 两套 generated schema 同步；V1 `SettingsPage` 的既有 Account DELETE 单点携带 row revision，并更新直接测试。

### 不修改

- 数据库 schema、migration、Platform/Account 状态字段、Prompt schema、File/Logo lifecycle。
- Platform update 返回类型；成功后通过 canonical Platform response + Detail refetch校准 summaries/options。
- Account create/update/status endpoint 或角色依赖。
- Prompt Detail/Markdown、Platform Type CRUD、凭据模型。

## 12. 预计修改文件

以下是审计后的影响面，实施时只保留真实需要的文件。

### Core

- Contract/backend：`contracts/openapi.yaml`、`backend/app/schemas/configuration.py`、`backend/app/routers/configuration.py`、`backend/app/services/platform_configuration.py`、专项 backend tests。
- Generated：`frontend/src/shared/api/schema.d.ts`、`frontend-v2/src/shared/api/generated/schema.d.ts`。
- V2 Configuration：`platform.api.ts`、现有 `platform-list.model.ts` 的最小共享 action 提取、`platform-workspace.model.ts`、`platform-workspace-page.tsx` 及直接 tests；仅在职责清晰时增加 Platform scoped overview/logo/generation 文件。
- Route/fixture：`src/routes/_app/settings/platforms/$platformId.tsx`、generated route tree、`tests/e2e/fixtures/platforms.fixture.ts`、`tests/e2e/platform-workspace.spec.ts`。
- Docs/spec：直接相关 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md`、frontend state/route spec 和 backend platform list/database spec。

### Accounts

- Contract/backend：`contracts/openapi.yaml`、`backend/app/routers/publication.py`、`backend/app/services/publication.py`、`backend/tests/integration/test_publication_workflow.py` 或一个更窄的 account integration 文件、projection/contract unit tests。
- Generated/V1：两套 generated schema、`frontend/src/features/settings/SettingsPage.tsx` 及直接测试中的 Account DELETE revision 单点。
- V2：上述 Configuration API/model/page 的账号区域与 tests、同一个 generated-type fixture/spec。
- Docs/spec：账号 revision/action/cache 直接相关段落。

不预计修改全局 CSS、Design System、依赖、数据库合同或 migration；只有 production artifact 实测证明既有 primitive 无法满足 375px 时，才增加最小 Platform scoped 样式。

## 13. 已批准拆分

用户已批准拆分。理由不是文件大小，而是两个独立业务 owner 与并发合同：

- Core 的主要风险是 actor-aware Platform Detail、单 revision全量 PATCH、Logo 生命周期和 Prompt bind。
- Accounts 的主要风险是 Publication action projection、唯一性、非终态 PublicationWork blocker 和缺失的 DELETE revision。
- 两者可以各自拥有 targeted backend integration、component 和 Playwright acceptance；Accounts 在 Core 的已实现 read-only tab 上增量完成，不需要占位路由或第二套 fixture。

Core 先合入 `main`，Accounts 再从更新后的 `main` 启动。拆分不引入运行时抽象，只增加顺序交付 gate；父 Task 不持有业务分支。
