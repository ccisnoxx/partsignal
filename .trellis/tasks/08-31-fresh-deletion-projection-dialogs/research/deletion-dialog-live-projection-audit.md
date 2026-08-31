# 删除 Dialog 最新投影审计

审计日期：2026-08-31（Asia/Shanghai）。

性质：静态只读审计与规划证据。本轮未运行测试、未运行 `task.py start`、未修改前端代码、公共合同、后端、数据库或生产数据。

## 1. 审计结论

四类目标页面的删除条件或删除确认流程都保存了打开瞬间的完整业务对象；Platform Type 与 Platform Account 的确认 Dialog 还在内部复制了一次对象。TanStack Query 后续得到新数据时，表格行会更新，但已打开 Dialog 的名称、revision、deletion blockers 和动作资格不会更新。

目标状态所有权必须统一为：页面本地只保存 `{ id, command, focusReturn }`，Dialog 每次渲染都从当前活动 query 的最新数据按 ID 解析目标；首次确认与 409 后显式 reload 后的再次确认，都必须在调用 mutation 前重新读取同一 query owner 的当前 cache，并只把该次请求的 `{ id, expectedRevision }` 固化为 mutation variables。

OpenAPI 已经提供完成该改造所需的全部字段和 DELETE revision 参数。本 Task 不需要修改 OpenAPI、generated client、backend 或数据库。

## 2. 权威合同事实

`contracts/openapi.yaml` 中四类 read model 都直接包含删除 Dialog 所需投影：

- `PlatformProfile`：`id/name/primary_task/available_actions/deletion/revision`，见 `contracts/openapi.yaml:4145-4187`。
- `PlatformType`：`id/name/platform_count/primary_task/available_actions/deletion/revision`，见 `contracts/openapi.yaml:4244-4271`。
- `PlatformAccount`：`id/label/workflow_stage/primary_task/available_actions/deletion/revision`，见 `contracts/openapi.yaml:5737-5763`。
- `User`：`id/username/display_name/primary_task/available_actions/deletion/revision`，见 `contracts/openapi.yaml:3430-3451`。
- `DeletionProjection` 本身没有 `ALLOWED/BLOCKED` 状态字段，只有服务端给出的 `blockers[]`，见 `contracts/openapi.yaml:3422-3429`。
- 四个 DELETE operation 都要求 `expected_revision`；服务端继续在命令边界最终复核权限、revision 与实时 blocker。

因此本 Task 所说的 ALLOWED/BLOCKED 只对应服务端投影组合，不是新增前端状态：

- 可确认：最新 `available_actions` 包含 `DELETE`，且最新 `deletion` 非空、`blockers` 为空。
- 被阻断：最新 `available_actions` 不含 `DELETE`，且最新 `deletion.blockers` 非空。
- 当前不可执行：服务端未投影 `DELETE`，且没有可展示 blocker，或当前 query 正在刷新/刷新失败而无法证明投影最新。

前端不得从旧 blocker 数量、`status`、`is_active`、`account_type`、当前角色或错误码补出 DELETE 资格。现有 model 中对未知 token 和矛盾投影的显式失败仍保留。

## 3. 完整对象快照清单

| 对象 / 页面 | 当前保存完整对象的位置 | 当前直接读取的陈旧字段 | 规划边界 |
| --- | --- | --- | --- |
| Platform Profile / Platform List | `BlockerTarget.platform`，`platform-list-page.tsx:64-78,119-126`；DELETE 还由 `RowActions.pendingAction` 保存打开时的静态确认 presentation，`row-actions.tsx:117-139` | blocker Dialog 读取 `target.platform.name/deletion`，`platform-list-page.tsx:512-538`；静态确认可在 DELETE token 撤销后继续触发旧命令 | blocker 与 delete confirm 改为同一 deletion intent；enable Dialog 和非删除 status command 不改 |
| Platform Type / Types Settings | `DialogTarget.platformType` 被 `conditions/deleteTarget` 保存，`platform-types-page.tsx:46-80`；Delete Dialog 又用 `canonical` 复制完整对象，`:432-449` | 条件 Dialog 读取旧 `name/id/blocker`，`:401-428`；DELETE 读取旧 `canonical.id/revision`，`:460-509` | 条件/删除 target 只存 ID/命令/focusReturn；Editor baseline 不改 |
| Platform Account / Accounts Tab | `AccountBlockerTarget.account`、`AccountCommandTarget.account`，`platform-workspace-page.tsx:643-657,692-714`；Command Dialog 再复制 `account`，`:969-1018` | blocker 读取旧 `label/deletion`，`:1056-1078`；delete 读取旧 `label/revision`，`:982-1049` | 从共享 status command target 中拆出 deletion intent；edit、enable、disable 不做全面重构 |
| User / Users List | `CommandTarget.user` 被 edit/reset/status/delete/blocker 共用，`user-list-page.tsx:92-114,211-231` | delete/blocker 读取旧 `username/id/deletion/revision`，`:797-860`；mutation 读取 `target.user`，`:157-174` | 只拆分删除家族 intent；edit/reset/status/bulk baseline 保持现状 |

验收中的“Dialog state 不保存完整业务对象”限定于本 Task 的删除条件与删除确认 Dialog。编辑、启停、reset 和 bulk command 的快照语义属于明确排除项，不因本 Task 顺带修改。

## 4. 最新 projection owner

| 对象 | 当前活动 query result | 精确 query key | focus / invalidation 现状 | 目标消失的权威判定 |
| --- | --- | --- | --- | --- |
| Platform Profile | `PlatformListPage` 的 `platforms = useQuery(platformListQueryOptions(search))`，`platform-list-page.tsx:75-80` | `platformKeys.list(platformSearchToApiParams(search))`，`platform.api.ts:35-80` | 已有 `refetchOnWindowFocus: 'always'`；mutation 失效 list/detail/accounts | 当前活动筛选/分页 query 成功返回后，`items` 中找不到 intent ID |
| Platform Type | `PlatformTypesPage` 的 `types = useQuery(platformTypeListQueryOptions())`，`platform-types-page.tsx:53-60` | `platformKeys.types()`，`platform.api.ts:35-63` | 已有 `refetchOnWindowFocus: 'always'`；成功失效 types/platform lists/platform details | types query 成功返回后 `items` 中找不到 ID |
| Platform Account | `PlatformAccountsSection` 的 `accounts = useQuery(platformAccountsQueryOptions(platformId, active))`，`platform-workspace-page.tsx:659-675` | `platformKeys.accounts(platformId)`，`platform.api.ts:35-46,100-114` | 当前缺 `refetchOnWindowFocus: 'always'`；成功失效 platform lists/detail/accounts 与 publication consumers | Accounts tab 当前独立 query 成功返回后 `items` 中找不到 ID；不得回退 Platform Detail 或其他 list cache |
| User | `UserListPage` 的 `users = useQuery(userListQueryOptions(search))`，`user-list-page.tsx:107-123` | `userKeys.list(userSearchToApiParams(search))`，`user.api.ts:29-50` | 已有 `refetchOnWindowFocus: 'always'`；成功失效所有 Users lists，必要时刷新 auth | 当前活动筛选/分页 query 成功返回后 `items` 中找不到 ID；不得跨其他筛选 key 查找 |

目标因筛选、分页、删除或新的 actor-aware projection 不再出现在当前成功 query 时，应清理 deletion intent。若 refetch 失败但 cache 仍有旧 data，不能把旧 data 当 fresh canonical projection；Dialog 进入不可执行刷新表面。Users query 返回 401/403 且保留旧 data 时同样禁止删除，不能继续信任缓存中的 ADMIN 动作。

## 5. 当前状态转换缺口

### 5.1 Platform Profile

平台列表的 blocker Dialog 保存完整 row。DELETE 由 `resolveAvailableAction` 生成静态 `confirmation`，见 `platform-list.model.ts:181-220`；`RowActions` 在确认期间保存该 presentation，即使后续 projection 撤销 DELETE，旧确认仍可触发。删除调用 `runPlatformCommand(command, platform)`，请求 revision 来自传入对象，见 `platform.api.ts:285-301`。

平台列表失败会失效 list，结构化错误保留 request ID，现有组件测试已证明一次 DELETE 不会自动重放，见 `platform-list-page.test.tsx:283-328`。改造必须保留该错误合同，但把 DELETE 改为 custom Dialog，并在任何删除 409 后冻结确认，提供显式刷新当前 list projection 的入口。

### 5.2 Platform Type

Types query 已能窗口聚焦强制刷新，但 `conditions`、`deleteTarget` 和 Dialog 内 `canonical` 均不随 query 更新。现有 409 路径正确保留 request ID、禁用旧确认、显式 `types.refetch()`、不 replay，见 `platform-types-page.tsx:83-89,445-509`。需要删除 `canonical` 对象 state；显式 reload 成功后只 reset mutation freeze，Dialog 展示与下一次请求 revision 都直接取最新 types cache。

### 5.3 Platform Account

Accounts 是独立 query owner，但缺少 `refetchOnWindowFocus: 'always'`，30 秒 fresh window 内不会保证跨标签页回读。`reloadAccount` 还没有检查 `fresh.error`，refetch 失败且保留旧 cache data 时可能把旧 revision 当成 reload 成功，见 `platform-workspace-page.tsx:677-690`。

删除与 enable/disable 共用 `AccountCommandTarget`。本 Task 应拆出 deletion intent，不全面重构 status commands。`PLATFORM_ACCOUNT_IN_USE` 等非 `REVISION_CONFLICT` 的 409 也必须展示真实错误、冻结旧确认并显式刷新；不能只对 `REVISION_CONFLICT` 提供 reload。

Accounts 整区“已有 data 后后台刷新失败仍隐藏缓存 surface”的一般问题继续属于 `configuration-secondary-stale-state`。本 Task 只处理删除 Dialog 的不可执行状态，以及显式 reload 不得采用失败结果中的旧 cache data。

### 5.4 User

Users list query 已能窗口聚焦强制刷新，但 delete/blocker 与 edit/reset/status 共用完整 `CommandTarget`。本 Task 只拆分 deletion intent；status、edit、reset、bulk 不变。

User blocker 是服务端每次 list 动态统计的业务历史引用，projection 可以在 User row revision 不变时变化。因此不能用“revision 未变”维持旧 DELETE 资格。`REVISION_CONFLICT`、`USER_IN_USE`、`USER_ACTIVE` 等删除 409 都必须冻结旧确认；后台 focus refetch可以更新展示，但只有显式 reload 成功才能清除该次 409 freeze。权限 refetch 返回 403 且旧 data 被保留时，删除 Dialog必须关闭或保持不可执行。

## 6. 目标状态机

删除 Dialog intent 的唯一业务本地状态为：

```ts
type DeletionDialogIntent<Command> = {
  id: string;
  command: Command;
  focusReturn: HTMLElement | null;
};
```

`command` 表达用户发起的是“查看删除条件”还是“删除”，但 Dialog 当前呈现不由原命令锁死。每次 render 都从最新 projection 重新得到 `CONFIRM`、`BLOCKED`、`UNAVAILABLE` 或 `MISSING`：

| 当前投影 / query 状态 | Dialog surface | 是否可发 DELETE |
| --- | --- | --- |
| ID 存在、`DELETE` 存在、blockers 为空、无 fetch/error、无未解除 409 | 最新删除确认，名称与 revision 均来自当前 projection | 是 |
| ID 存在、`DELETE` 不存在、blockers 非空 | 最新 blocker surface；ALLOWED→BLOCKED 直接转换 | 否 |
| ID 存在、从 BLOCKED 变成 `DELETE` + 空 blockers | 同一 intent 转成最新确认；不得自动提交 | 是 |
| ID 存在但服务端未给 DELETE 且无 blocker | 当前不可删除 surface，展示服务端当前资格；不补动作 | 否 |
| query 正在重新读取 | 同步中，不允许确认 | 否 |
| query/refetch 失败且有旧 cache data | 显式刷新 surface；旧 data 只可作为带 stale 标识的最后已知展示，不可提交 | 否 |
| 最新成功 query 不含 ID | 清理 intent并关闭；不得跨 cache 找对象 | 否 |
| 任意删除 409 | 展示原 ErrorEnvelope/request ID，冻结确认；后台 query 更新不能自动清除 freeze | 否，直到显式 reload 成功 |

mutation pending 后，本次网络请求的 `{ id, expectedRevision }` 是合法的请求快照，不再随 query 改变；这是 HTTP 并发命令参数，不是 Dialog 业务状态。服务端仍是最终权威，pending 期间的新竞态通过 409 返回。

## 7. 提交 revision 与 409 边界

现有四个 delete API helper 都接收完整业务对象并从中取 revision。实施时应把删除 helper 收窄为显式 `{ id, expectedRevision }` 参数。确认点击的同一个同步事件中，页面必须：

1. 从当前活动 query 的精确 key 读取 QueryClient 当前 cache；
2. 按 intent ID 找到对象；
3. 重新运行既有 projection 校验；
4. 确认最新 `available_actions/deletion` 仍为可删除；
5. 只把当前 `id/revision` 传给 mutation；
6. 若任一步不成立，不发请求，并让 Dialog投影最新 surface。

不得在点击确认时先发一个 GET 再自动 DELETE。首次请求可以采用已经由 focus/refetch/invalidation 更新过的当前 cache；发生 409 后则必须显式 reload，且 reload 成功只解除 freeze，不自动重放。这样同时满足“首次动作使用最新 query projection”和“409 后用户显式采用新 baseline”。

## 8. focusReturn

`RowActions` 的 custom command 已能把真实 overflow trigger 交给页面，见 `row-actions.tsx:117-133`。focusReturn 必须继续作为独立 presentation state，不与业务对象一起保存。

- ALLOWED↔BLOCKED 转换保持同一个 intent 和 Dialog，不改变 focusReturn。
- 普通取消或刷新后目标仍存在时，`finalFocus` 在关闭时惰性解析，优先返回仍连接的原 trigger。
- query 更新替换 DOM 但保留目标时，可复用已有 `resolveFocusReturn` 的“仍连接 / 同 aria-label 重定位”模式，见 `content-task-lifecycle.tsx:434-440`。
- 目标行已删除、离开当前 scope 或权限 surface 被替换时，不聚焦断开的元素或猜测相邻业务行；使用页面已存在的稳定创建/管理入口作为闭包 fallback，没有合适入口则返回 `null` 交给 Dialog primitive。

## 9. 现有测试与 fixture 缺口

| 页面 | 现有 component 证据 | 必补 component 回归 | fixture / E2E 缺口 |
| --- | --- | --- | --- |
| Platform Profile | 409 request ID、旧 revision 请求、无 replay、blocker focus，`platform-list-page.test.tsx:283-328` | query 更新后名称/blocker/DELETE 资格双向转换；最新 revision payload；目标消失；409 freeze + explicit reload；焦点 | `platforms.fixture.ts` DELETE 永远成功；需按 ID 改 projection、移除目标、一次性 409 与请求捕获 |
| Platform Type | 删除 409、显式 reload 到 revision 3、blocker link、成功焦点，`platform-types-page.test.tsx:216-270` | 删除 `canonical` 快照；focus/cache 更新双向转换；目标消失；最新 revision payload；完整 request ID | `platform-types.fixture.ts` 有 conflict/blocker injection，但缺通用 projection setter/remove |
| Platform Account | Accounts 按需 GET、status/delete revision、Editor 409、blocker 展示，`platform-workspace-page.test.tsx:187-219,480-607` | Accounts focus always；delete/blocker live transition；最新 revision；目标消失；任意 409 freeze；reload error 不采用旧 cache；focus | fixture mutation 不校验 account revision，controller 缺账号 projection setter/remove/conflict |
| User | reset 409 no replay/request ID、blocker/focus、status/delete E2E payload，`user-list-page.test.tsx:90-200` | DELETE 双向转换、同 revision blocker变化、最新 revision payload、目标/scope消失、409 freeze、403 stale-data禁用、focus | fixture 只有 reset conflict；需按 ID 改 projection/remove 和 delete 409 |

四个目标 Playwright spec 都是 production artifact fixture，不是真实 backend 栈。它们证明浏览器 Dialog/query/focus 与请求参数，不证明 PostgreSQL、权限或服务端最终复核；该边界必须在最终报告中保留。

代表性 Playwright 至少覆盖：一个列表对象在 Dialog 打开后 projection 更新并撤销 DELETE；一个独立 Accounts/Users query owner 在更新后改用最新 revision且禁止旧提交；既有 409 no-replay/request ID/focus 路径继续通过。四个对象的精细状态矩阵主要由各自 component test 证明。

## 10. 规范冲突与文档同步

`.trellis/spec/frontend/state-management.md:857` 当前写着 Account update/status/delete 始终提交打开 Dialog 时的 canonical row revision；`.trellis/spec/backend/available-actions-contract.md:349-351` 的 User 示例把“提交前自动拉最新 revision”列为错误。它们原本用于防止 409 后自动 reload/replay，但字面上会阻止本 Task 要求的首次提交 live query projection。

实施时应同步改写为：

- 编辑、reset、启停、bulk 等既有命令继续遵循自己的确认 baseline，本 Task 不改。
- 删除 Dialog 打开期间接受当前 query 的被动更新；首次确认从当前 cache取 revision，不额外发 GET。
- 一旦 DELETE 返回 409，该次确认冻结；被动 query 更新只能刷新展示，只有用户显式 reload 成功后才能再次确认，且仍不得自动 replay。

需要更新的稳定文档只包括与该不变量直接冲突的 `.trellis/spec/frontend/state-management.md`、`.trellis/spec/backend/available-actions-contract.md`，以及被本改造改变的 Frontend V2 删除 Dialog说明。OpenAPI、generated client、backend 与数据库合同不变。

## 11. 排除与残余风险

- Query Topic Dialog 属于后续 `query-topic-dialog-live-projection`。
- Product 与 ContentTask blocker 导航、configuration secondary stale-state、非删除 edit/status/reset/bulk、视觉风格与通用 Dialog 框架不在范围。
- 不引入轮询、BroadcastChannel、全局业务 store、跨 query-key cache 扫描或 User/Account detail 请求。
- Accounts 整个 secondary section 的 cached refetch error 展示仍由后续 Task 处理；这里只保证删除 Dialog 在无法证明 projection 最新时不执行。
- 当前没有四个页面的真实栈 Playwright；本 Task 不新增 backend/real-stack orchestration。
