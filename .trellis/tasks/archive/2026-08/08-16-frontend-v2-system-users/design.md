# Frontend V2 System Users 设计

## 1. 设计结论与范围决定

实现一个完整、独立的 Users 纵向切片，不再拆第二个 Users Task：创建用户、编辑 `display_name/account_type/status`、单用户启停、重置临时密码、删除、当前服务端筛选 CSV export 和 bulk enable/disable 全部纳入。它们已经共享同一个 `UserList`、同一 action/revision owner 和同一管理页面；拆分只会留下不可用的半页并重复敏感表单与并发规则。

复用现有 V2 Platform/AI/Query Topic 列表结构和 Table Kit：route 负责 canonical URL、预取和 auth handoff；identity model 负责 URL/API 映射、显示注册表与 action projection；API 模块负责生成类型约束的一个集合请求和既有命令；页面用一个 domain 文件组合表格、局部表单、selection、partial feedback 与冲突恢复。

先做最小 contract-first 修正：DELETE/reset 增加 revision，reset 返回安全 canonical `User`，bulk 把稳定失败码写入合同并拒绝同状态 no-op。保持现有 `UserList`、数据库、认证和权限 owner；不增加 User Detail、Audit placeholder、通用 CRUD/Bulk framework、第二 DTO、依赖或缓存层。

## 2. 缺口分析摘要

| 主题 | 已有能力 | 最小缺口/决定 |
| --- | --- | --- |
| V2 页面 | `_admin/system.users` route 与 nav 已存在 | 替换 placeholder，增加 canonical route/loader/page |
| UserList | 服务端 search/filter/page/summary/action/deletion/revision 完整 | 直接复用；加固定查询数回归，不改响应形状 |
| 单用户命令 | create/update/status/reset/delete/export 已有 | delete/reset 缺 revision；reset 缺 canonical response |
| bulk | 每项 revision、partial commit、last-admin 已有 | failure code 未类型化；同状态会虚增 revision |
| 权限 | 路由均使用 ADMIN 权威点 | 增加全部 interfaces 的 ENGINEER 403 回归 |
| V1 | 已有完整 Users 管理页 | 只适配共享 delete/reset 合同和生成类型 |
| Audit handoff | API 已支持 `actor_id` | 下一 Task 建 `/system/audit?actorId=`；本页不做链接 |
| 敏感信息 | 服务端只存 password hash，响应不回密码 | V2 mutation/form 生命周期还需严格限定 |

完整证据和九项审计结论见 `research/users-audit.md`。

## 3. 页面层级与文件责任

### 3.1 Component hierarchy

```text
Route(/system/users)
└─ UserListPage
   ├─ Page header
   │  ├─ 新增用户（唯一 page primary）
   │  └─ 导出列表
   ├─ GlobalUserSummary（UserList.summary 紧凑一行）
   ├─ Notice（stale refresh / mutation / partial feedback）
   ├─ TableToolbar
   │  └─ UserFilters（FilterBar + q/accountType/status）
   ├─ BulkActionBar（selection > 0）
   ├─ TableShell
   │  ├─ TableSkeleton | EmptyTable | out-of-range recovery
   │  └─ row
   │     ├─ checkbox
   │     ├─ UserIdentity（Display name + @username + mobile compact facts）
   │     ├─ role/status/security/created cells
   │     └─ RowActions（一个 primary + overflow）
   ├─ TablePagination
   ├─ UserFormDialog（create/edit 两种明确模式）
   ├─ ResetPasswordDialog
   ├─ UserCommandDialog（enable/disable/delete/blockers）
   └─ BulkStatusDialog（仅停用确认；409/transport error 保留）
```

短组件先作为 `user-list-page.tsx` 私有函数；不为单页新增通用 Notice、Form、Action Registry 或 selection framework。create/edit 可以复用一个私有表单壳，但 schema、提交 payload 和敏感字段按 mode 分开，避免把 password 变成可选兼容字段。

### 3.2 精确文件责任

#### 合同与后端

- `contracts/openapi.yaml`
  - DELETE 增加 required query `expected_revision`。
  - `ResetPasswordRequest` 增加 required `expected_revision`；reset 由 204 改为 `200 User`，补标准错误响应。
  - `UserBulkStatusFailure.code` 固定为四个 enum：`NOT_FOUND`、`REVISION_CONFLICT`、`LAST_ADMIN_REQUIRED`、`INVALID_STATE_TRANSITION`。
- `backend/app/schemas/common.py`
  - 对齐 reset revision 和 bulk failure `Literal`，继续用唯一 `UserOut`。
- `backend/app/routers/identity.py`
  - 解析 delete revision；reset 返回 `present_managed_user`。
- `backend/app/services/identity.py`
  - delete/reset 在行锁内校验 revision。
  - bulk 复用共同更新函数，但只在 bulk source 要求状态真实变化；同态项进入 typed partial failure。
  - 不改 list 查询、permission owner、事务与 DB schema。
- `backend/tests/unit/test_contract.py`
  - 新增 Users delete/reset/bulk OpenAPI 精确合同断言。
- `backend/tests/integration/test_identity_management.py`
  - 更新既有测试并补 revision conflict、reset safe canonical response、bulk no-op/partial、全部 Engineer 403、固定查询数。

#### V1 兼容

- `frontend/src/shared/api/schema.d.ts`：由 `api:generate` 生成，不手改。
- `frontend/src/features/users/UserManagementPage.tsx`
  - delete query 发送当前 revision；reset body 发送当前 revision并消费安全 User。
  - 其他 V1 UI/URL/action/selection 不重构。
- `frontend/src/features/users/UserManagementPage.test.tsx`
  - 更新 delete/reset request/response 和 shared enum fixture。
- `frontend/tests/e2e/mvp-flow.spec.ts`
  - 所有 Users delete/reset 调用使用观测到的 revision，更新 reset 200 断言；不扩大其他 V1 场景。
- `frontend/tests/e2e/ai-channel-management.spec.ts`
  - 测试账号准备流程的 reset body 补观测 revision并适配 200；不修改 AI 渠道业务场景。

#### Frontend V2

- `frontend-v2/src/shared/api/generated/schema.d.ts`：由 `api:generate` 生成，不手改。
- `frontend-v2/src/domains/identity/user.api.ts`
  - `userKeys`、list query options、create/update/reset/delete/bulk/export；所有类型从 generated operations 推导。
  - domain-local structured request error；不重构全局 error wrapper。
- `frontend-v2/src/domains/identity/user-list.model.ts`
  - Zod URL schema、canonical record、camelCase → snake_case、page-size normalize、label registry。
  - primary/overflow projection、重复/unknown/矛盾校验、表单 schema/payload 的纯函数。
- `frontend-v2/src/domains/identity/user-list.model.test.ts`
  - URL/API/表单/action/矛盾 projection 的小型稳定边界测试。
- `frontend-v2/src/domains/identity/user-list-page.tsx`
  - 页面、query/mutations、selection、dialogs、partial feedback、密码生命周期。
- `frontend-v2/src/domains/identity/user-list-page.test.tsx`
  - 可观察 UI、request payload、selection/revision、409、缓存/auth handoff 与敏感字段测试。
- `frontend-v2/src/routes/_app/_admin/system.users.tsx`
  - search validation/canonical replace、loader prefetch、route error、URL navigation；向页面提供 current user ID、CSRF 和 `auth.refresh`。
- `frontend-v2/src/routeTree.gen.ts`
  - 由 TanStack Router/Vite 自动生成；不手改。
- `frontend-v2/src/styles/global.css`
  - 只加 `.user-list-table` 的局部 375/768 响应式规则；不改通用 Table Kit。
- `frontend-v2/tests/e2e/fixtures/users.fixture.ts`
  - generated-type strict production fixture，完整声明 list/commands/revision/partial/403；未声明 API 501 + teardown fail。
- `frontend-v2/tests/e2e/system-users.spec.ts`
  - production artifact 的 URL、状态、动作、bulk、密码、四档、键盘与错误审计。

#### 权威文档

- `.trellis/spec/backend/available-actions-contract.md`：User command revision、typed bulk failure、server final guard。
- `.trellis/spec/frontend/state-management.md`：V2 Users canonical URL、selection/revision 与 secret mutation 生命周期。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`：补全 Users 单用户/批量交互和 Audit handoff。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`：UserList、revision、partial、safe reset response。
- `docs/frontend-v2/07-migration-plan.md`：仅在实现完成后记录 Users slice，不提前宣称 Phase 7 完成。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：Users strict fixture 与 required evidence。
- `docs/frontend-v2/09-architecture-decisions.md`：新增 Users 单一 read model、local revision selection、无 Audit placeholder ADR。
- `contracts/database.md` 不改：没有表、列、约束、不可变性或持久化语义变化。

## 4. 状态所有权

| 状态/事实 | 唯一 owner | 规则 |
| --- | --- | --- |
| `q/accountType/status/page/pageSize` | TanStack Router URL | 唯一可持久恢复的列表状态 |
| URL parse/canonical/API mapping | `user-list.model.ts` | 只在边界规范化，不做业务 fallback |
| `['identity','users','list',apiParams]` | `user.api.ts` | 只缓存 `UserList` server state |
| list loader + Back/Forward | `/system/users` route | 与页面复用同一 query options |
| create/edit/reset form | 对应 Dialog 内 RHF | 关闭/成功卸载；不进入 URL/query cache |
| selection | `UserListPage` 局部 state | canonical window + `{id,username,revision}` snapshot |
| confirm target/focus return | 页面局部 Dialog state | 409 保留；成功/取消销毁 |
| partial feedback | 页面局部非敏感 state | 只保留 success count 与 username/code/message |
| action eligibility | backend `UserOut` projection | V2 只做穷尽映射，不根据字段推断 |
| current session | `AuthProvider` | 自操作成功通过既有 `auth.refresh()` 更新 |

不建立 Zustand/store，不把 query data 镜像到 component state，不缓存 derived summary/actions。

## 5. Canonical URL 与服务端请求

### 5.1 URL 形状

V2 使用 camelCase，`status/page/pageSize` 显式 canonical；`q/accountType` 仅非空时存在：

```text
/system/users?status=ENABLED&page=1&pageSize=20
/system/users?q=alice&accountType=ENGINEER&status=ALL&page=2&pageSize=50
```

| URL | 合法值/默认 | API |
| --- | --- | --- |
| `q` | trim 后 1..200；默认省略 | `q` |
| `accountType` | `ADMIN | ENGINEER`；默认省略 | `account_type` |
| `status` | `ENABLED | DISABLED | ALL`；默认 `ENABLED` 并显式 | `status`；`ALL` 时省略 API 参数 |
| `page` | 正整数；默认 1 并显式 | `page` |
| `pageSize` | `10 | 20 | 50`；默认 20 并显式 | `page_size` |

筛选、搜索、重置和 pageSize 变化把 page 置 1；page 翻页保留其他参数。非法/重复/空参数经 Zod 规范化后 route `replace`。export 只发送当前 `q/account_type/status`，不发送 page/page_size。

### 5.2 请求和查询数

- 首屏只允许 `GET /api/v1/users`；不请求 User Detail、Audit、逐行权限或引用端点。
- backend 继续一次 query 返回当前页、全局 summary、actor-aware actions/deletion/revision。
- 固定 SQL 回归比较 0 行、少量行、密集业务引用页，证明次数不随行数增长；不把“固定 5 条”误写成所有空页也必须 5 条。

## 6. 表格、summary 与可恢复状态

### 6.1 固定六列

| 列 | 权威字段 | 展示 |
| --- | --- | --- |
| 用户 | `display_name/username` | Display name + `@username`，无链接/Avatar 请求 |
| 角色 | `account_type` | ADMIN / ENGINEER badge |
| 状态 | `is_active` | Enabled / Disabled，文字不只靠颜色 |
| 登录安全 | `must_change_password/workflow_stage` | 正常 / 必须修改密码；只显示事实，不推 action |
| 创建时间 | `created_at` | `<time dateTime>` 本地格式化 |
| 操作 | `primary_task/available_actions/deletion/revision` | 最多一个 Primary + overflow |

1024/1440 显示六列。375/768 仍使用同一行/同一 `User`：用户主单元紧凑重复角色、登录安全和创建时间，隐藏对应独立 metadata 列，保留 checkbox、用户、状态、操作；不创建第二数据源。TableShell 提供局部 overflow，页面根保持 `scrollWidth <= clientWidth`。

### 6.2 全局 summary

在筛选区上方或下方用一条紧凑文本/inline badges 显示“全局用户摘要”：用户总数、启用、停用、需改密、管理员。明确标为全局且不受筛选影响；当前筛选结果数只由 `UserList.total`/pagination 显示。没有 MetricTile dashboard，也不从 rows 计算。

### 6.3 状态矩阵

- initial loading：`TableSkeleton`。
- 有旧数据的 background fetching：保留表格；失败显示 Notice + 重试。
- 初始 error：error EmptyTable + retry。
- total=0 且无用户筛选：empty，仍保留“新增用户”。
- total=0 且有筛选：filtered-empty + 清除筛选。
- total>0 但当前 rows=0：越界页，显示“返回最后一页”；不静默改 URL。
- delete 当前页最后一行且 page>1：成功后导航前一页；其他 mutation 不改 URL。

## 7. Primary、overflow 与矛盾处理

### 7.1 Primary 映射

| `primary_task` | 必须同时含 | Primary |
| --- | --- | --- |
| `MANAGE_LOGIN_SECURITY` | `RESET_PASSWORD` | 重置临时密码 Dialog |
| `MANAGE_USER` | `UPDATE` | 编辑用户 Dialog |
| `ENABLE_USER` | `ENABLE` | 启用确认 Dialog |

Primary 只读 `primary_task`；同义 `available_actions` 只用于验证并从 overflow 去重。不会因为 `must_change_password/is_active/account_type` 改主动作。

### 7.2 Overflow 映射

| token | UI/命令 |
| --- | --- |
| `UPDATE` | 编辑用户；若已是 primary 则去重 |
| `RESET_PASSWORD` | 重置临时密码；若已是 primary 则去重 |
| `ENABLE` | 启用确认；若已是 primary 则去重 |
| `DISABLE` | 停用确认，说明立即撤销全部活动会话 |
| `DELETE` | 删除确认，不可恢复；提交当前 revision |

如果没有 `DELETE` 且 `deletion.blockers` 非空，overflow 增加 UI-only “查看删除条件”命令打开 blocker Dialog；这不是业务资格或 action token，也不生成链接。

以下情况在 model 层显式抛错并由 route error boundary 提供 retry，不降级为空动作：unknown token、重复 token、缺 primary 同义 token、同义动作同时重复显示、`DELETE` 与 blocker 非空、未知 blocker type、可删除 projection 缺失/矛盾。

## 8. 单用户 Form 与命令

### 8.1 Create

- RHF/Zod 字段严格对应 `UserCreate`：username、display_name、temporary_password、account_type。
- username 最小 3、display name 非空、temporary password 最小 12；以生成类型/合同为准，不增加猜测最大值。
- 成功关闭并卸载表单、reset mutation、invalidate all Users lists；不把响应建 detail cache。

### 8.2 Edit 与 status

- Edit 对应完整 `UserUpdate`：当前 `expected_revision/display_name/account_type/is_active`。
- primary/overflow 的 enable/disable 复用同一 PATCH，只改变 `is_active`，其他字段使用当前 canonical row，不新增 enable/disable API。
- 停用说明撤销目标全部活动会话；自停用/自降级由 server 最终裁决。

### 8.3 Reset password

- body 为 `{temporary_password, expected_revision}`，成功返回 safe `User`。
- 说明目标全部会话立即撤销、下次登录必须改密；不能重置自己，由服务端 422。
- 409 保留仍打开 Dialog 和密码输入，禁止自动 replay；用户可显式“重新加载列表”，确认丢弃本地密码后关闭 Dialog并 refetch。

### 8.4 Delete 与 blocker

- DELETE query 发送目标 `expected_revision`；确认说明清理账号/会话、不可恢复、历史审计保留且 actor 可置空。
- blocker Dialog 只显示 `USER_BUSINESS_HISTORY` count 和刷新操作；不链接 `/system/audit`。
- server 在锁内依次校验 revision、停用状态、业务引用/FK；前端不做最后管理员或引用资格判断。

## 9. Bulk selection 与 partial success

### 9.1 Selection 边界

selection state 形状为：

```text
scope = canonical(q, accountType, status, page, pageSize)
items = Map<userId, { username, revision }>
```

- URL window 变化立即视为无选择并清理。
- 同一 window background refetch 后，若任一已选用户消失或 revision 改变，清空整组选择并提示“列表已更新，请重新选择”；相同 revision 的普通 refetch 可保留。
- checkbox 只选择当前页；不 preserve 跨页 ID，不进入 URL/session/local storage。
- 不根据 action/status/role 判断能否批量启停。selection>0 时始终显示 Enable、Disable、Clear；server 按每项 revision、当前状态和 last-admin 裁决。

### 9.2 Request 与确认

- body 每项只含 `user_id/expected_revision`，最大 100 由合同；status 为 `ENABLED` 或 `DISABLED`。
- bulk disable 使用页面自有 Dialog 说明成功项会撤销会话并要求确认；不使用会在提交瞬间丢上下文的内置 fire-and-forget 确认。
- bulk enable 可直接提交；pending 防重复。

### 9.3 Response 后规则

- HTTP 200 partial result 后：立即清空全部 selection；保存非敏感 feedback `{succeededCount, failures[{username,code,message}]}`；invalidate Users lists。
- failure username 只从提交前 local snapshot 按 `user_id` 映射，不新增 API join；即使目标并发删除仍能显示观测时 username。
- 若 `succeeded` 含 current actor，随后 `auth.refresh()`；其他用户不刷新 auth。
- 所有失败项（含 stale/no-op/last-admin/not-found）不自动重选，因为 list refetch 后 revision/状态可能已改变。用户阅读 feedback 后重新选择。
- transport/顶层失败：没有 canonical item result，保留 selection 和停用确认上下文，不 invalidate、不 replay；显示可重试错误。

## 10. Revision、409 与 cache invalidation 矩阵

| 操作 | revision 来源/成功响应 | 成功后 | 409/失败 |
| --- | --- | --- | --- |
| create | 无 revision 输入；`201 User` | 关闭表单；invalidate all user lists | 保留输入；不 replay |
| edit | row revision；`200 User` | 关闭；invalidate lists；若 self 则 auth refresh | Dialog 保留输入；显式 reload |
| enable/disable | row revision；`200 User` | 关闭；invalidate lists；若 self 则 auth refresh | 确认 Dialog 保留；显式 reload |
| reset | row revision；`200 User` | 销毁密码表单；invalidate lists | 保留当前密码输入；显式 reload 会先销毁表单 |
| delete | row revision；204 | 关闭；invalidate lists；必要时前一页 | 确认 Dialog 保留；显式 reload |
| bulk | 每项 snapshot revision；`200 result` | 清 selection、保留 feedback、invalidate；self success 则 auth refresh | 顶层失败保留 selection/confirm；逐项 conflict 属于 200 规则 |
| export | 无 mutation cache | Blob 下载后立即 revoke URL | 保留列表；显示错误 |

不做 optimistic patch。任何会改变过滤归属、页数、action/deletion 或 summary 的命令都 invalidate list root，让唯一服务端 projection 重建；没有 User detail cache、Audit cache或全局 Users store。

## 11. Temporary password 生命周期

- password 只存在于 create/reset Dialog 的 RHF input 与本次 mutation variables；query key、query cache、URL、selection、feedback、Toast、error details、日志和 analytics 均不含它。
- 对 create/reset mutation 设置 `gcTime: 0`；Dialog cancel、成功和显式 reload 都先卸载 form，再 `mutation.reset()`，不把表单 values 提升到页面父 state。
- 输入使用 `type=password` / `autoComplete=new-password`；不会渲染回显、复制到隐藏字段或 snapshot。
- API error 只展示 server `code/message/request_id`，不 stringify request variables。
- strict fixture 用固定 sentinel 作为收到的 request 内存值，但 controller 只记录“已收到/长度符合”之类脱敏元数据，不保存原始 body。`system-users.spec.ts` 显式 `trace: 'off'`，避免 Playwright 失败 trace 捕获 request postData；测试只断言字段存在/长度与响应不含 secret，不做 secret snapshot/attachment。
- CSRF 只从 AuthProvider 传入 request header；DOM、错误、日志和 fixture result 不输出 token。

## 12. 后端变化与事务语义

### 12.1 DELETE

`delete_user_command(..., expected_revision)`：继续 `_USER_STATE_LOCK` → row `FOR UPDATE` → existence → revision → active → live business refs → delete/flush FK guard → audit → commit。只增加 revision，不改变管理员删除、会话 cascade 或历史审计规则。

### 12.2 reset-password

`reset_user_password_command`：self guard → row `FOR UPDATE` → existence → revision → hash password → `must_change_password=True` → revision++ → revoke sessions → audit → commit；router 之后用同一 actor 生成 `UserOut`。响应永不含 password/hash/session。

### 12.3 bulk no-op

共同 `_update_user_locked` 增加一个仅由 bulk 调用启用的明确参数（如 `require_status_change=True`）；revision 校验后若当前状态等于目标状态，抛 `INVALID_STATE_TRANSITION/409`，bulk allowlist 捕获为逐项 failure。普通 update 仍可在状态不变时编辑名称/角色，不制造第二更新实现。

### 12.4 查询与权限

不改 UserList SQL，只用 SQLAlchemy statement counter 锁定固定次数。不改 `AdminUser/assert_account_types`，只把测试补全到所有 interfaces。

## 13. Strict production fixture 与 Playwright

新增独立 `users.fixture.ts`，只允许：

- `GET /api/v1/auth/me`、`GET /api/v1/auth/csrf`。
- `GET /api/v1/users`、`GET /api/v1/users/export`。
- `POST /api/v1/users`、`POST /api/v1/users/bulk-status`。
- `PATCH/DELETE /api/v1/users/{id}`、`POST /api/v1/users/{id}/reset-password`。

fixture 用 generated types 构造 UserList 和 mutation responses，执行真实 query filter/page、revision、no-op、partial 和 403 语义。任何 User Detail/Audit/逐行/未声明 API 返回 501 并由 teardown 失败；未声明非 2xx、console error、page error、request failure 也作为失败。

该 spec 单独关闭 trace，fixture controller 不保留 create/reset 原始 request body；全局 Playwright 其余 suite 的 trace 策略不改变。

Playwright 同一 spec 在 `foundation-mobile` 与 `foundation-desktop` projects 运行，并在场景内切换四档：

- 375×900、768×900、1024×900、1440×1000。
- 每档断言 `document.documentElement.scrollWidth <= clientWidth`、TableShell 局部可滚动、主事实/状态/操作可达。
- direct URL、refresh、Back/Forward、canonical query/API snake_case、server paging/filter/export。
- loading、empty、filtered-empty、error/retry、越界恢复。
- primary/overflow、unknown/contradiction route error、无 detail/audit link。
- create/edit/reset/delete、409 不 replay、session consequence 文案、密码 response/DOM/console/artifact 无残留。
- selection window/revision refresh、bulk disable confirm、mixed partial feedback、成功后清 selection。
- keyboard-only 选择、overflow、Dialog Escape/Cancel、焦点返回；ENGINEER route 403。

## 14. 文档、Ponytail、风险与 Audit handoff

### 14.1 文档一致性

实施已同步更新 OpenAPI、backend/frontend specs、V2 页面/合同/测试/ADR/迁移文档。`contracts/database.md` 保持不变，因为没有持久化 schema 或 constraint 变化。

### 14.2 Ponytail 约束

- 复用现有 UserList、identity service、V1 行为、Table Kit、RHF/Zod、TanStack Router/Query、Base UI Dialog。
- 不加依赖、第二 DTO、详情 route、Audit placeholder、头像系统、通用 CRUD/Bulk/Action registry、乐观 cache patch 或兼容分支。
- 只有共同更新函数出现真实共享不变量时增加一个小参数；其他页面组件保持同文件私有。

### 14.3 风险与控制

- delete/reset 是共享破坏性合同变化：contract-first 后全仓修正直接调用者，V1 compatibility tests/E2E 必跑，不保留 optional revision。
- reset password 会短暂存在 TanStack mutation variables：`gcTime=0` + Dialog unmount/reset 是现有依赖下最小可验证边界；如果测试证明 mutation cache 仍保留 secret，则停止并把 mutation owner 移到随 Dialog 卸载的私有组件，不增加自定义 secret store。
- self demotion/disable 可能使当前页面立即失去管理员资格：成功后等待 auth refresh，由现有 `_admin` boundary 显示 403，不伪装仍可继续管理。
- 若实施需要 DB migration、认证或权限模型变化，停止并请求重新评审。

### 14.4 Audit handoff

下一独立 Task `frontend-v2-system-audit` 负责 `/system/audit` Table + Detail Pane/Sheet，并接管 canonical `actorId` → API `actor_id`。Users Task 只展示 deletion blocker count；不创建路由、链接、disabled link 或 placeholder。

### 14.5 Git/Trellis 交付

规划批准后已在唯一获准临时分支 `codex/frontend-v2-system-users` 实施，未启动 subagent。Required checks 通过后展示精确 commit plan 并等待确认；确认后提交，不 push/PR，再解释 archive/session bookkeeping、归档 Task、fast-forward 合入 `main` 并删除本地临时分支。
