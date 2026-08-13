# 技术设计

## 1. Boundary and Invariant

权威不变量是：Platform Type 的名称/slug/revision、直接 PlatformProfile 引用总数、删除资格和管理员权限都由服务端 Configuration domain 决定；浏览器只展示并提交该投影。

保持 `routes -> domains -> design-system/shared`：

- route：复用 `_admin` 权限边界、prefetch、CSRF/auth 注入和跨页面 cache 装配；
- Configuration domain：持有 Type API/query key、action mapping、form mapping、页面与 mutation；
- design-system/shared：只复用现有 primitive，不导入 Configuration；
- PostgreSQL：继续是业务状态与 slug 唯一性的唯一权威。

不新建 DTO、CRUD framework、Settings abstraction 或第二 action registry。

## 2. Contract Decisions

### 2.1 `platform_count`

`PlatformType` additive 增加 required `platform_count`。现有 `platform_types_out()` 已按所有 item IDs 一次分组统计 `PlatformProfile.platform_type_id`；直接把同一 count map 同时用于展示字段、deletion blocker 与 DELETE action，不新增查询。

口径：所有当前存在且 `platform_type_id=<type id>` 的 PlatformProfile，Enabled/Disabled 均计入。原因是删除命令和 `ON DELETE RESTRICT` 不按 `is_active` 排除引用；展示列必须与真实删除引用规则一致。

列表 SQL 改为：

```text
ORDER BY lower(platform_types.name), platform_types.id
```

因此 list query + grouped reference query 保持固定两次，不随行数增长。

### 2.2 DELETE revision

```text
DELETE /api/v1/platform-types/{platform_type_id}
  ?expected_revision=<required integer >= 0>
```

服务命令顺序：

1. FastAPI 完成 ADMIN、CSRF 与 query shape 校验。
2. `SELECT ... FOR UPDATE` 锁定 PlatformType；不存在返回 404。
3. 比较 `expected_revision`；stale 返回 `409 REVISION_CONFLICT`。
4. 持锁统计所有直接 PlatformProfile 引用；存在时返回 `409 PLATFORM_TYPE_IN_USE`，`details.references=[{type:"PLATFORM_PROFILE",count:N}]`。
5. 写既有审计、删除并提交。

revision 必须先于 blocker 检查，所以“stale 且已有引用”稳定返回 `REVISION_CONFLICT`。V1 直接调用只追加 row revision query，不做其他重构。

### 2.3 Field and uniqueness rules

| Field | Authoritative rule | Decision |
|---|---|---|
| name | DB `VARCHAR(160) NOT NULL`，无 unique | 服务端 schema trim，trim 后 1–160；允许重名 |
| slug | DB `VARCHAR(100) NOT NULL` + `uq_platform_types_slug` | 1–100、`^[a-z0-9-]+$`、大小写由格式限制，不自动 normalize；允许 update |

create/update 的 flush/commit 在同一个小型 Platform Type constraint mapper 中只识别 `uq_platform_types_slug`：rollback 后返回 `PLATFORM_TYPE_SLUG_EXISTS` 和 slug 字段位置。它不是通用 IntegrityError framework；其他约束错误继续抛出。

无需 migration：真实开发库已确认约束名为 `uq_platform_types_slug`，模型和 migration 已有相同长度/唯一事实。

## 3. Permission Matrix

| Surface | ADMIN | ENGINEER | Authority |
|---|---|---|---|
| Platform List/Workspace subsettings link | 显示 | 隐藏 | route auth 仅控制导航 UX |
| `/settings/platforms/types` | 页面与管理 UI | `_admin` 边界保留 URL 并显示 403 | route boundary |
| GET Type list | 200 | 403 | backend `AdminUser` |
| POST/PATCH/DELETE | 允许尝试，并重新校验 CSRF/revision/引用 | 403 | backend `AdminUser` + service |

不提供 ENGINEER 只读 Type 页面。Platform List/Workspace 自身仍保持既有全认证读取，不被移动到 admin boundary。

## 4. Route and Component Hierarchy

路由文件使用 pathless admin group：

```text
/_app/_admin/settings.platforms.types.tsx
  -> URL /settings/platforms/types
```

它设置 `navId=platforms`、breadcrumb，prefetch Type list，并装配页面；静态 `types` 路由由 TanStack Router 优先于 `$platformId`。不移动现有 settings/platform route。

```text
PlatformTypesRoute (existing AdminBoundary)
└── PlatformTypesPage
    ├── header: back link + create trigger
    ├── loading / empty / error / refresh notice
    ├── TableShell (desktop/tablet)
    │   └── Name | Slug | Platform count | RowActions overflow
    ├── mobile card rows (375px)
    │   └── same four fields/actions
    ├── PlatformTypeFormDialog (create/edit, RHF + Zod)
    └── blocker / delete confirmation Dialog
```

List 与 Workspace page 只增加一个 `canManagePlatformTypes` prop，由各自 route 从 `auth.isAdmin` 注入并渲染 subsettings link。权限判断不进入 API/action mapping。

## 5. Action Mapping

| Server projection | UI command | Placement |
|---|---|---|
| `primary_task=EDIT_CATEGORY` + `UPDATE` | 编辑 | overflow `•••` |
| `available_actions` contains `UPDATE` | 编辑 | overflow `•••` |
| `available_actions` contains `DELETE` + empty blockers | 删除确认 | overflow `•••` |
| non-empty `deletion.blockers` and no DELETE | 查看删除条件 | overflow `•••` |

`EDIT_CATEGORY` 是语义，不覆盖蓝图的 overflow-only 布局；mapping 会校验它对应 UPDATE，但 `RowActions.primary` 保持空。未知 primary/action/blocker 进入 exhaustive default 并抛出中文开发错误。若 DELETE 与非空 blocker 同时出现，也作为服务端投影不变量错误显式失败。

创建属于 collection header action，不伪造 `CREATE` row token。

## 6. Dialog and Conflict Flow

- create/edit form schema 镜像服务器 name/slug 规则，只显示 Name 与 Slug。
- edit baseline 保存 row id/revision；PATCH 使用 baseline revision。
- `PLATFORM_TYPE_SLUG_EXISTS` 映射 slug field；其他 validation/error 使用 ErrorSummary。
- UPDATE `REVISION_CONFLICT` 保留输入、阻止重复 submit；“重新读取规范版本”只 refetch Type list，找到同 id 后显式 reset form/revision。对象消失则关闭编辑并报告不存在。
- delete 只从 DELETE token 进入。确认提交当前 row revision；409 不自动重放。
- delete stale 后显式 reload 取得新 row/revision，用户再次确认才可重试；in-use 直接显示服务端 references 与 canonical link。
- create/edit 成功关闭 Dialog、恢复触发器焦点并失效权威 queries。取消、blocker、失败关闭恢复原 overflow；成功删除因原 trigger 消失，聚焦下一行 overflow 或页面标题。

## 7. Cache Invalidation Matrix

Configuration owner 增加两个 prefix key：Type collection 与全部 Platform Detail。单条 detail key继续从 detail prefix派生。

| Mutation | Type Settings list | Platform Lists | Platform Workspace Details | Other domains |
|---|---:|---:|---:|---:|
| create | invalidate | invalidate（options 增加） | invalidate（options 增加） | none |
| update | invalidate | invalidate（options + row type name） | invalidate（options + header/overview type name） | none |
| delete | invalidate | invalidate（options 移除） | invalidate（options 移除） | none |

DELETE 只允许无平台引用类型，因此当前 Platform 行/Header 不会引用被删类型，但 List/Detail options 仍是真实消费者。Account、Prompt、Content、Publication 均不直接消费 Platform Type list/name，不失效。

## 8. Responsive and Accessibility

- `sm` 以上使用语义 table；375px 使用 Workspace Accounts 已验证的局部 `sm:hidden` card-row pattern。
- 四个字段和 overflow 在两种布局都保留，不靠横向滚动隐藏动作。
- overflow button 有资源名 aria-label；Dialog 有 title/description；错误区 `role=alert`；loading rowgroup 与 empty/error 语义复用现有 primitive。
- 键盘 Enter/Space 可打开 overflow，Escape/取消恢复焦点；删除成功使用明确 fallback focus。
- 不改全局 Table Kit/CSS，不引入依赖。

## 9. Expected Files

### Contract/backend

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/app/schemas/configuration.py`
- `backend/app/routers/configuration.py`
- `backend/app/services/platform_configuration.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_workflow_projections.py`
- `backend/tests/integration/test_platform_types.py`（新增 targeted integration owner）

### Generated/V1 compatibility

- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `frontend/src/features/configuration/PlatformTypesPage.tsx`
- `frontend/src/features/configuration/PlatformTypesPage.test.tsx`

### Frontend V2

- `frontend-v2/src/domains/configuration/platform.api.ts`
- `frontend-v2/src/domains/configuration/platform-types.model.ts`（新增）
- `frontend-v2/src/domains/configuration/platform-types.model.test.ts`（新增）
- `frontend-v2/src/domains/configuration/platform-types-page.tsx`（新增）
- `frontend-v2/src/domains/configuration/platform-types-page.test.tsx`（新增）
- `frontend-v2/src/domains/configuration/platform-list-page.tsx` 及直接测试
- `frontend-v2/src/domains/configuration/platform-workspace-page.tsx` 及直接测试
- `frontend-v2/src/routes/_app/settings/platforms/index.tsx`
- `frontend-v2/src/routes/_app/settings/platforms/$platformId.tsx`
- `frontend-v2/src/routes/_app/_admin/settings.platforms.types.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（generated）
- `frontend-v2/tests/e2e/fixtures/platform-types.fixture.ts`（新增，复用 foundation/auth patterns）
- `frontend-v2/tests/e2e/platform-types.spec.ts`（新增）

### Specs/docs/task

- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- 本 Task 的 `prd.md / design.md / implement.md / research/platform-type-audit.md`

`02-information-architecture-and-routing.md` 与 `03-page-and-workflow-blueprint.md` 已准确规定 URL、subsettings、四列和无 Sidebar，预期无需修改。不存在数据库 schema 变化，因此不新增 migration/model 字段。

## 10. Risks and Blockers

- 最大并发风险是 stale DELETE 与新增/改绑引用竞态。现有 Type `FOR UPDATE`、PostgreSQL 外键检查取得的父行锁及 `ON DELETE RESTRICT` 共同形成最终门禁；实施时用 PostgreSQL 集成测试验证“先提交引用”和“先锁定删除”两种顺序，不增加第二套应用锁协议。
- slug constraint mapper 必须只识别已核实的 `uq_platform_types_slug`；不得吞掉其他 IntegrityError。
- Type mutation 会使多个已缓存的 Platform Detail options 过期；使用 detail prefix 精确失效全部真实 detail，不枚举当前页面。
- admin pathless static route 必须通过 generated route tree 与 direct/refresh 测试确认优先于 `$platformId`。
- 当前无阻塞问题；用户批准前不创建分支、不实施。
