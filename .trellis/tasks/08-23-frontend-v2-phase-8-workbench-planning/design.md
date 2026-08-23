# Frontend V2 Phase 8 Workbench — Design

## 1. 设计结论

采用一个 V2 专用、只读、actor-aware 的 `GET /api/v1/workbench`，由 backend Workbench service 直接从 PostgreSQL 当前事实投影。V2 `/` 只消费这一响应；V1 继续使用旧 `/api/v1/dashboard/summary`，两者不共享 DTO 或 frontend glue。

这是 Phase 9 前的有界迁移边界，不是两个 V2 owner。

## 2. 依赖与所有权

```text
/_app/ route
  └─ domains/workbench page + query + model
       ├─ design-system primitives / semantic tokens
       └─ shared/api generated client
                         ↓
GET /api/v1/workbench
  └─ backend Workbench router → service → existing domain predicates/models
                                      ↓
                                  PostgreSQL
```

- route：metadata、首屏 prefetch、渲染 Workbench page；不写业务映射。
- Workbench frontend domain：唯一 query key、合同断言、文案/tone、loading/error/empty/data UI。
- Design System/shared：保持业务无知；不接收 Workbench DTO。
- Workbench backend service：六类 eligibility、health、30 日 GEO window、recent item 排序和 canonical href 的唯一 owner。
- 原 domain services：继续拥有状态机、动作、当前版本/链尾和 mutation；Workbench 只复用稳定 predicate/纯投影，不调用其他 HTTP endpoint。

## 3. API 设计

### 3.1 Endpoint

```http
GET /api/v1/workbench
```

- operation id：`getWorkbench`
- auth：现有 `CurrentUser`；ADMIN/ENGINEER 都可读，服务端按 actor 返回可操作投影。
- response：`WorkbenchAggregate`
- errors：复用统一 `401`/错误结构；无 mutation、CSRF 或请求参数。
- 不增加缓存、DB 表、migration、版本 alias 或兼容字段。

### 3.2 最小响应语义

```text
WorkbenchAggregate
├─ generated_at
├─ actionable_counts
│  ├─ fact_reviews              { value, href }
│  ├─ content_reviews           { value, href }
│  ├─ publication_verifications { value, href }
│  ├─ publication_actions       { value, links[] }
│  ├─ content_issues            { value, href }
│  └─ geo_accuracy_issues       { value, links[] }
├─ workflow_health
│  ├─ fact        { status: CLEAR|ATTENTION, summary }
│  ├─ content     { status: CLEAR|ATTENTION, summary }
│  ├─ publication { status: CLEAR|ATTENTION, summary }
│  └─ geo         { status: CLEAR|ATTENTION, summary }
├─ geo_summary
│  ├─ window { date_from, date_to }
│  ├─ discovery_rate { numerator, denominator, value|null }
│  ├─ mention_rate   { numerator, denominator, value|null }
│  └─ accuracy_rate  { numerator, denominator, value|null }
└─ recent_attention_items[0..10]
   └─ { category, resource_id, title, summary, occurred_at, href }
```

`category` 只允许上述六类。列表按 `occurred_at DESC, category ASC, resource_id ASC` 稳定排序并限制 10 条。响应不返回正文、prompt、密码、token、Cookie、CSRF、请求 header/body、审计 raw details 或外部页面内容。

### 3.3 聚合口径

| 类别 | 服务端事实 | count href | item href |
| --- | --- | --- | --- |
| fact_reviews | 当前 `FactVersion.status=PENDING_REVIEW` 且 actor 可审核 | canonical Products filter | Fact Review Workspace |
| content_reviews | 当前 `ContentVersion.status=PENDING_REVIEW` 且 actor 可审核 | canonical Content Tasks filter | Content Review Workspace |
| publication_verifications | `PublicationWork.status=AWAITING_VERIFICATION` | canonical Work list filter | Work verification section |
| publication_actions | `PREPARING`、`PLATFORM_REVIEW`、`ACTION_REQUIRED` 中仍有服务端 primary task 的 work | 三个既有 canonical filter link | 服务端 primary task section |
| content_issues | 当前 open PublishedContentIssue | canonical OPEN issue filter | Issue Workspace/repair owner |
| geo_accuracy_issues | 最近 30 UTC 自然日 current tail 中 legacy 或 manual article 存在 `PARTIAL/INCORRECT` | 两个既有 canonical accuracy filter link | Observation Detail |

`publication_actions` 不能用一个不存在的多状态 URL。API 返回总数和三个既有 canonical filter link，UI 直接渲染；不扩展 Publication list 的 search contract 只为首页服务。GEO accuracy 同理保留 PARTIAL/INCORRECT 两个现有入口。

GEO summary 使用同一 30 日 window 和 current-tail predicate，沿用现有逐篇指标口径；分母为 0 时 `value=null`。workflow health 是上述服务端计数的薄投影，只表达 `CLEAR/ATTENTION`，不新增严重度阈值或复制 domain state machine。

### 3.4 查询约束

- 同一 request/session 内完成，查询次数固定且不随 recent item 数量增长；禁止 per-item query。
- 复用 `_current_observation_clause` 和已有 publication/product/content 状态常量或纯查询 helper；若 helper 语义不完全相同，保留 Workbench-local 查询并用 integration test 冻结，不为一个 consumer 改造通用 framework。
- `generated_at` 和 GEO window 在请求开始时计算一次，所有时间条件复用该值。
- 不从多个内部 HTTP endpoint 聚合，不引入 Redis 或应用缓存。

## 4. Frontend V2 设计

### 4.1 文件 owner

计划最小新增：

- `frontend-v2/src/domains/workbench/workbench.api.ts`
- `frontend-v2/src/domains/workbench/workbench.model.ts`
- `frontend-v2/src/domains/workbench/workbench-page.tsx`
- 对应两个定向 Vitest 文件
- 修改 `frontend-v2/src/routes/_app/index.tsx`
- 新增 `frontend-v2/tests/e2e/workbench.spec.ts` 与 strict fixture
- 修改 Foundation smoke/fixture 的访问 route，不放宽其 API allowlist

不新增 `shared/workbench`、dashboard component kit、全局 CSS bundle 或跨 domain registry。页面布局优先使用 Tailwind utility 和 `global.css` 现有 semantic tokens；只有 utility 无法清晰表达且确有复用证据时才考虑局部样式。

### 4.2 页面结构

1. 简短问候和“需要处理”总量。
2. 六类 compact actionable count；零值显示“当前无需处理”，但链接仍可验证 canonical filter。
3. attention queue 作为视觉主区，最多 10 条，每条完整可键盘访问。
4. 四域 workflow health。
5. GEO 30 日 summary，明确 numerator/denominator 和 nullable“暂无数据”。

不做大面积 vanity KPI、快捷入口、图表、自动轮询、客户端排序/过滤或 mutation。loading 使用 Skeleton；fatal error 显示 request error 与显式重试；成功但无 attention 时展示清晰空态，同时仍显示真实零 count 与 GEO summary。

### 4.3 Query/cache

- `workbenchKeys.aggregate()` 是唯一 query identity。
- route 采用现有“cache 不存在时 prefetch、page 用 `useQuery`”模式。
- Workbench 没有 mutation，不跨域写 cache，也不订阅其他 domain query。
- 其他 domain mutation 不在本任务扩展 Workbench invalidation；用户回到 `/` 时按既有 stale/refetch 行为取得新聚合。只有实际 UX 证据证明返回首页必须即时刷新时，才在对应 mutation owner 中精确 invalidate。

## 5. 测试职责

| 层 | 证明内容 | 明确不证明 |
| --- | --- | --- |
| backend integration | 六类口径、actor、current tail、30 日边界、nullable rate、稳定排序、href、固定查询次数、敏感字段缺席 | 浏览器布局 |
| Workbench model/component | generated contract 穷尽映射、零/null/error/retry、链接、可访问语义 | PostgreSQL truth |
| strict fixture Playwright | production artifact、唯一 aggregate 请求、no client join、375/768/1024/1440、键盘/溢出/错误 | 真实状态转换 |
| 既有 real-stack specs | 已有 UI mutation 后，`/` 读取真实 aggregate 并进入 canonical target | 不重复创建跨域数据 |
| abstraction review | 依赖、owner、重复测试、文档一致性与 Phase 8 gate | 不新增产品功能 |

## 6. 文档更新

- aggregate Task：`contracts/openapi.yaml`、generated clients、`docs/frontend-v2/05` 精确合同、`09` 新 ADR（独立 V2 Workbench read model 与 V1 legacy boundary）。
- UI Task：必要时更新 `03` 的实际页面结构；若蓝图已完全覆盖则只记录无需改动。
- E2E Task：`08` 增加 Workbench test owner 与 real-stack 复用边界。
- abstraction review：只有 Exit Gate `MET` 才把 `07` Phase 8 更新为完成并同步 `08` 最终证据；`NOT_MET` 只记录 Task evidence，不提前宣称完成。
- 无数据库 invariant 变化，默认不改 `contracts/database.md`。

## 7. 回滚与停止

- 新 endpoint 是 additive 且无 migration；回滚删除 Workbench router/service/schema/OpenAPI/generated types，旧 V1 不受影响。
- UI 回滚恢复 `/` 占位页并删除 Workbench domain/fixture；App Shell/navigation 不变。
- E2E 回滚只删除既有 spec 中的 Workbench checkpoint，不触碰原业务流程。
- 只反向应用本 Task 确切 hunks，不使用 reset-hard、checkout 或历史改写。
- 若需要 DB/permission/既有状态机变更、第二 cache/source、V1 修改、重复 orchestration 或敏感字段，立即停止并建议独立 blocker。
