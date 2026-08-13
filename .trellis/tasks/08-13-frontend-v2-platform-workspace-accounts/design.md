# 技术设计

## 1. Boundary

本 Task 只扩展 Core 已存在的 Accounts section。Configuration Domain 持有页面 Account API/model/action mapping；Publication backend 继续持有 Account command、PublicationWork blocker 和数据库约束。Route 只组合跨域 cache key owner。

不创建新 route、Workspace context、Account DTO、CRUD abstraction 或跨领域 registry。

## 2. Actor-aware Row Actions and Page Create

现有行级 projection 已满足真实角色合同：

| Actor/state | Row actions |
|---|---|
| ADMIN | UPDATE、ENABLE/DISABLE；无 blocker 时 DELETE/deletion |
| ENGINEER | UPDATE、ENABLE/DISABLE；deletion=null |
| Platform disabled | primary_task=HANDLE_PLATFORM；UPDATE 与 ENABLE/DISABLE 仍由服务端投影 |

创建是集合级页面动作，不属于任何 row `primary_task/available_actions`，因此不修改 `PlatformAccountList` schema。当前 `AccountType` 只有 ADMIN 与 ENGINEER，既有 create endpoint 对两者开放；页面无需也不得用 `isAdmin` 补资格。POST 仍锁定 Platform 并最终复核 active 状态，平台停用返回 `PLATFORM_DISABLED`。

## 3. Delete Revision Contract

```text
DELETE /api/v1/platform-accounts/{platform_account_id}
  ?expected_revision=<required integer >= 0>
```

命令顺序：

1. 校验 ADMIN 与 CSRF。
2. 复用 `_lock_platform_account`，按既有 Platform → Account 固定顺序锁行；PublicationWork 创建使用同一锁序。
3. 不存在返回 404。
4. 比较 `expected_revision`，过期返回 `REVISION_CONFLICT`。
5. 持锁实时统计非终态 PublicationWork；存在时返回结构化 `PLATFORM_ACCOUNT_IN_USE`。
6. 删除并提交既有审计/生命周期副作用。

不能把 revision 设为 optional，也不能在浏览器 GET 最新 revision 后代替用户确认。

账号标识唯一性沿用数据库约束 `uq_platform_accounts_profile_identifier_normalized`。现有预检和 `_flush_platform_account` 竞态路径必须调用同一个错误构造 owner，统一输出 `409 PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 与 `details.errors[].loc=["body","account_identifier"]`；未知 `IntegrityError` 原样上抛。

## 4. Component and Form Flow

```text
PlatformAccountsSection
├── page CREATE action
├── desktop/tablet Table Kit
├── mobile account list
├── AccountFormDialog (create/edit)
├── resolved RowActions
└── blocker / destructive confirm
```

- create/edit 表单只持有 label 与 account_identifier；edit baseline 额外保存 row revision。
- `UPDATE / ENABLE / DISABLE / DELETE` 使用 generated token 穷尽 switch。
- `HANDLE_PLATFORM` 指向同 route 的 `?tab=overview`；该导航仍经过 DirtyGuard。
- 409 不关闭 Dialog；显式 reload 丢弃当前表单后 refetch accounts/detail。
- Base UI Dialog 使用既有 final focus 机制，不用 React key 重挂 Root。

## 5. Cache Invalidation

| Mutation | Configuration | Publication |
|---|---|---|
| create | Platform lists + current detail + accounts | ready items + workspace contexts |
| update label/identifier | lists + detail + accounts | ready items + nonterminal work lists + workspace contexts |
| enable/disable | lists + detail + accounts | ready items + workspace contexts |
| delete | lists + detail + accounts | ready items + work lists + workspace contexts |

终态 PublishedArticle 使用冻结账号 snapshot，不失效。Account mutation 不触碰 Content queries。route composition 复用现有 Publication key owner，不写 predicate 或全 QueryClient clear。

## 6. Expected Files

- `contracts/openapi.yaml`
- `backend/app/schemas/publication.py` 或现有 Account List schema owner
- `backend/app/routers/publication.py`
- `backend/app/services/publication.py`
- Account projection/contract/integration tests
- 两套 generated schema
- `frontend/src/features/settings/SettingsPage.tsx` 及直接测试
- Core 已建立的 `frontend-v2/src/domains/configuration/platform.api.ts`
- Platform Workspace account model/page/components/tests
- 既有 Platform fixture/Playwright spec 增量
- 直接相关 backend/frontend specs、acceptance 与 ADR

不修改数据库 schema、migration、Core route、全局 CSS、Design System 或依赖。

## 7. Risk and Rollback

- 最大风险是 stale DELETE 与 PublicationWork 创建竞态；复用双方已有 Platform → Account 锁序，并在同一持锁命令中复核 revision 与 blocker。
- 唯一性预检不能覆盖并发插入；真实 PostgreSQL constraint 路径必须产生同一字段错误，不能解析数据库英文文本。
- page CREATE 不得被误塞入行级 action registry；若未来新增只读角色，必须先扩展权威集合读取合同，不能在前端补角色分支。
- V1 generated contract 会同步变更，但业务适配只限 Account DELETE 调用点。
- 无 migration；回滚可撤回 additive list action 和 required query，但不得留下 V1/V2 与 OpenAPI 漂移。
