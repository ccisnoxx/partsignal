# 技术设计

## 1. 方案结论

复用并增量扩展现有 `GET /api/v1/platform-profiles`，不新增 endpoint、表、migration 或客户端 DTO。现有搜索、筛选、双模式分页、稳定排序、summary 与批量投影继续作为唯一 owner；只补足 V2 蓝图缺失的 readiness、enabled account count、普通用户类型 options、actor-aware Primary 与 DELETE revision。

采用新增 `readiness_*` 合同而不是重定义旧 `configuration_*`：前者表达“Prompt + 启用账号”的列表就绪度，后者继续表达“是否绑定 Prompt”。这是保持 V1 与 Content domain 完整参考集合消费者不变的最小方案。

## 2. Contract 与 backend read model

### 2.1 Schema 增量

新增：

```text
PlatformReadinessStatus = COMPLETE | MISSING_PROMPT | MISSING_ACCOUNT

PlatformProfile:
  readiness_status: PlatformReadinessStatus
  enabled_platform_account_count: integer >= 0
  primary_task: PlatformPrimaryTask | null

PlatformProfileSummary:
  readiness_complete_total: integer >= 0
  missing_account_total: integer >= 0

PlatformProfileList:
  platform_type_options: PlatformTypeSummary[]
```

保留并澄清：

- `configuration_complete` 与 query `configuration_status` 仍只表示 Prompt 绑定完整度。
- `platform_account_count` 仍是启用与停用账号总数。
- `summary` 是当前 actor 可读范围内、不受当前筛选影响的实时汇总；`total` 才应用当前筛选。
- `page/page_size` 必须成对提供；两者省略时继续返回完整参考集合。
- 固定排序写入合同：`lower(platform name), platform id`。

`GET /api/v1/platform-profiles` 新增可选 query `readiness_status`。V2 URL 的 `configurationStatus` 映射到该字段；旧 V1 的 `configuration_status` 不变。export 不在范围内，不增加 readiness filter。

### 2.2 投影规则

批量账号聚合在同一次 grouped query 中同时得到 total 与 enabled，禁止逐行查询：

```text
if platform_prompt is null:
    readiness_status = MISSING_PROMPT
else if enabled_platform_account_count == 0:
    readiness_status = MISSING_ACCOUNT
else:
    readiness_status = COMPLETE
```

该优先级使三态互斥且总和等于平台总数；`missing_account_total` 只统计“已有 Prompt 但没有启用账号”的平台。disabled 平台仍按真实配置投影 readiness，启停状态由独立列表达。

列表 predicate、filtered count 与 readiness filter 共用同一个 SQL 条件 owner；summary 用同一规则做不受筛选影响的聚合。类型 options 在同一请求中读取所有可见类型，按 `lower(name), id` 稳定排序，并复用 `PlatformTypeSummary`，不暴露管理员动作与 deletion。

### 2.3 权限与动作投影

- `GET /api/v1/platform-profiles` 继续使用 `CurrentUser`，Navigation 对所有已认证用户可见。
- backend 在 `can_manage=false` 时返回 `primary_task=null`、`available_actions=[]`、`deletion=null`；前端不读取 `isAdmin` 来补动作规则。
- ADMIN 的 workflow/primary/actions/deletion 沿用现有服务投影。mutation endpoint 继续使用 `AdminUser`，后端是最终权限权威。
- enable/disable 在锁内同时校验 revision 与真实目标状态；同态命令返回明确 `INVALID_STATE_TRANSITION`，不把重复请求当成功。

### 2.4 DELETE revision 与兼容边界

推荐将 `expected_revision` 作为 DELETE 必填 query 参数。service 在锁定平台后先比较 revision，再检查停用状态与实时 blocker；409 不携带可自动覆盖的“新 revision”。OpenAPI 删除说明同步改为：只允许删除已停用且无 OPEN 内容任务/非终态发布工作的聚合，账号属于清理影响而非 blocker。

必填参数会让 generated V1 调用类型报错，因此计划包含且仅包含一处已批准的 V1 兼容修正：旧平台删除 mutation 传当前行 `revision`，并调整其直接测试 fixture。不采用 optional revision、客户端版本 header 或第二套 V2 删除 endpoint。

## 3. URL 与数据流

Canonical URL：

```text
/settings/platforms?page=1&pageSize=20
```

字段及映射：

| URL | 默认/允许值 | API |
| --- | --- | --- |
| `q` | trim 后非空，最长 200；否则省略 | `q` |
| `platformTypeId` | UUID；否则省略 | `platform_type_id` |
| `status` | `ENABLED | DISABLED`；否则省略 | `status` |
| `configurationStatus` | `COMPLETE | MISSING_PROMPT | MISSING_ACCOUNT`；否则省略 | `readiness_status` |
| `page` | 正整数，默认显式 `1` | `page` |
| `pageSize` | `10 | 20 | 50`，默认显式 `20` | `page_size` |

Domain model 复用 GEO Query Topic 的 Zod preprocess/canonical record 模式。未知键、非法原值、缺失默认值和非 canonical 表达由 route `beforeLoad` 以 `replace: true` 修正；普通搜索/筛选导航使用 push。q、筛选或 pageSize 变化回 page 1，只有翻页保留当前 page。

```text
settings/platforms route
  -> platformSearchSchema
  -> toPlatformListParams(search)
  -> platformKeys.list(params)
  -> GET /api/v1/platform-profiles
  -> PlatformListPage
```

query key 只使用已映射 API params，不使用 raw URL，也不复制 Content domain 的平台参考 query。

## 4. Component hierarchy

```text
_app/settings route (Outlet + metadata boundary)
└── _app/settings/platforms route (section metadata)
    └── index route (search/loader/page assembly)
        └── PlatformListPage
            ├── PageHeader
            ├── summary strip
            ├── FilterBar
            │   ├── q
            │   ├── platform type options
            │   ├── Enabled/Disabled
            │   └── readiness status
            ├── TableShell
            │   ├── TableSkeleton
            │   ├── EmptyTable / error + retry
            │   └── seven columns + RowActions
            ├── TablePagination
            ├── status-change confirmation Dialog
            └── delete confirmation / blocker Dialog
```

页面直接复用 Design System primitives；状态 label/variant 与 action token mapping 保留在 Configuration domain。Logo 缺失用页面内文字/首字符 fallback，不为单消费者新增 Avatar primitive。初始失败替换列表；已有数据刷新失败保留 stale table 并显示可重试反馈。越界页回到最后一个合法 canonical page，不把它当真实 empty。

响应式先使用现有 Table semantic classes：375px 隐藏类型、账号数和更新时间等次要列，必须保留平台、readiness、启停状态与 sticky actions。若 production fixture 证明共享 `52rem` min-width 导致页面级溢出，只做 Platform 页面级最小 class/CSS 修正，不改造全局 Table Kit。

## 5. Server action registry

`primary_task` 与 `available_actions` 分开穷尽解析，未知 token 通过 `assertNever`/运行时失败显式暴露。

Primary：

| token | 解析 |
| --- | --- |
| `ENABLE_PLATFORM` | 管理员确认后 POST enable，发送当前 revision；从 overflow 去掉重复 `ENABLE` |
| `CONFIGURE_GENERATION` | canonical link `/settings/platforms/$platformId` |
| `VIEW_PLATFORM_OPERATION` | canonical link `/settings/platforms/$platformId` |
| `null` | 无 Primary |

Overflow：

| token / projection | 解析 |
| --- | --- |
| `UPDATE` | canonical link `/settings/platforms/$platformId`；编辑表单由后续 Workspace 提供 |
| `ENABLE` | 仅在未被 Primary 消费时显示，确认后 POST enable + revision |
| `DISABLE` | 确认后 POST disable + revision |
| `DELETE` | 停用且无 blocker 时，确认清理影响后 DELETE + expected_revision |
| `deletion.blockers` 且无 `DELETE` | disabled “查看删除条件”，Dialog 展示服务端 blocker，不自行推导 DELETE |

平台名称始终输出相同 canonical href。因为 `$platformId` route 明确不在本任务内，点击后的 router not-found 是真实未迁移边界；Playwright 只断言 href/URL handoff，不把详情内容当成功条件，也不注册占位页。

Mutation 成功后失效 platform list query；409 不重放，只提示数据已变化并重新拉取列表。Dialog 关闭、Escape 或完成后焦点回到触发器。

## 6. 测试设计

- Contract/backend：精确覆盖 readiness predicate/projection/summary、enabled count、类型 options 稳定排序、ADMIN/ENGINEER 投影、成对 pagination、search/filter/count/summary、稳定排序、固定查询次数、DELETE stale revision/实时 blocker、enable/disable 同态守卫与 runtime OpenAPI 一致。
- Model/component：canonical defaults、非法/未知参数、URL→API、page reset、两套 token 穷尽映射、七列和所有缺失值、三态、无权动作、admin actions、blocker、409、focus、loading/empty/error/stale retry/pagination。
- Production fixture Playwright：fixture 由 generated types 约束，未知请求 501，收集 console/page/runtime error；覆盖 direct/refresh、search/filter/page、Back/Forward、canonical name handoff、primary/overflow 和四档 viewport。

不创建 real-stack Platform E2E 编排；backend 真实行为由 targeted PostgreSQL integration test 证明。

## 7. 文档一致性

- 更新 `contracts/openapi.yaml`；无持久化结构变化，因此不修改 `contracts/database.md`。
- 更新 `.trellis/spec/backend/database-guidelines.md`，把 Prompt-only configuration 与 list readiness 两个不同合同写清，避免未来再次混用。
- 更新 `docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md` 中直接受影响的 read model、Phase 6 进度、fixture acceptance 与决策记录。
- 02/03/04/06 的路由、七列、Design System 和依赖方向已经与计划一致，不重复维护同一事实；若实现中未改变这些权威描述则不改。

## 8. 风险与回滚

- 最大风险是把 readiness 与旧 Prompt-only configuration 混成一个字段；通过独立 enum/query/summary 和 contract tests 隔离。
- 同一 endpoint 仍服务无分页参考集合；所有新增字段必须对该模式生效，且不得引入逐行查询。
- `$platformId` 尚未注册，canonical handoff 暂时到 router not-found；这是明确的迁移边界，不用假页面掩盖。
- DELETE revision 的 V1 单点豁免已批准；实现必须保持在直接调用点及其测试内。
- 所有 schema/read-model 变更均可通过回退同一提交恢复；无 migration 或数据回滚。

## 9. 预计修改文件

实现时以真实调用链为准，预计最小影响面：

- Contract/backend：`contracts/openapi.yaml`、`backend/app/schemas/configuration.py`、`backend/app/routers/planning.py`、`backend/app/routers/configuration.py`、`backend/app/services/platform_configuration.py`、`backend/app/services/projections.py`、平台列表专项 integration test、`backend/tests/unit/test_workflow_projections.py`、`backend/tests/unit/test_contract.py`。
- Generated/V1 兼容：`frontend/src/shared/api/schema.d.ts`、`frontend-v2/src/shared/api/generated/schema.d.ts`；经批准后仅修改 `frontend/src/features/configuration/PlatformsPage.tsx` 及其直接测试中的 DELETE revision 调用。
- V2 App/Domain：`frontend-v2/src/app/navigation.ts` 及测试、settings/platform routes、`frontend-v2/src/routeTree.gen.ts`、Configuration domain 的 `platform.api.ts`、`platform-list.model.ts`、`platform-list-page.tsx` 与 colocated tests。
- Playwright：Platform generated-type fixture 与 `platform-list.spec.ts`。
- Docs/spec：上节列出的 05/07/08/09 与 backend database guideline。

不预计修改 Design System、全局 CSS、数据库合同、migration 或依赖；只有 375px production fixture 证明页面级样式确有缺口时，才增加最小 Platform scoped CSS。
