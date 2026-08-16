# Frontend V2 System Audit 设计

## 1. 设计结论

交付一个完整但窄的 Audit 只读纵向切片：先收紧已有共享 Audit contract，再实现 `/system/audit` 的 canonical server table、URL-owned detail 和 responsive Pane/Sheet，最后让 Users handoff 与既有 AI Channel Runtime 复用同一个全局 Audit detail owner。

最小结构变化只有两处：

1. 后端把九模块 facts/changes registry 放入既有 `audit_types.py`，写入与读取共享；List 不再投影 details，Detail 对未知/不安全历史结构显式返回结构化失败。
2. V2 建立 `domains/audit`，只承载 global Audit API/model/详情内容；不建立通用 Timeline、JSON Viewer、DataTable 或事件框架。

不改数据库、append-only/retention、权限模型或历史数据；不增加依赖、mutation、自动刷新或第二 Audit DTO。

完整代码与合同证据见 `research/system-audit-audit.md`。

## 2. 缺口与修正摘要

| 主题 | 当前 | 最小决定 |
| --- | --- | --- |
| V2 route/nav | 只有 `/system/users` | 新增 `_admin/system.audit` route 和 ADMIN nav item |
| List shape | 每行必带/计算 `change_summary` | 从唯一 `AuditLog` 移除；所有 list consumers 同步适配 |
| Detail shape | `Any/additionalProperties: true` | 合同化 `AuditSafeValue`：scalar/null/一维 scalar list |
| allowlist | read-only，且漏实际写入 key | registry 移到 `audit_types.py`，write/read 同源并补齐 |
| unknown data | 静默丢弃 | 新写入拒绝；历史 Detail 结构化 409，List 不受影响 |
| keyword | 搜 details facts，漏批准 metadata | 只搜 actor + metadata/result fields，count/rows 同条件 |
| 权限测试 | 三 GET 都有 AdminUser，options 403 未断言 | 补全 API 与 route 证据 |
| detail owner | Configuration 私有 global query/renderer | 移到最小 `domains/audit`，Configuration 复用 |
| Users handoff | blocker 无 link | 只加 actorId canonical link，不发 Audit GET |
| responsive | Sheet 已有；无 Audit Pane | 1280+ pane，其余 Sheet；一个 `logId` owner |

## 3. 精确文件责任

### 3.1 Contract 与 backend

- `contracts/openapi.yaml`
  - 从 `AuditLog` 移除 `change_summary`。
  - 新增 `AuditSafeScalar/AuditSafeValue`，收紧 `AuditChange.before/after` 与 `AuditLogDetail.facts`。
  - Detail 补 `409 ErrorResponse`。
- `backend/app/audit_types.py`
  - 保留现有 module/action/entry owner；新增九模块 `AUDIT_FACT_KEYS/AUDIT_CHANGE_FIELDS` 与 safe value 类型/检查。
  - 补齐已确认的 CONFIGURATION 与 CONTENT_PLANNING 写入 keys；不为未观察的字段预留。
- `backend/app/audit.py`
  - `validate_audit_entry` 复用 registry，拒绝未登记 fact/change、object、nested list 和不安全 value。
  - 保持现有 sensitive-key 检查、retained-success action、同事务 append。
- `backend/app/schemas/common.py`
  - `AuditLogOut` 移除 `change_summary`；`AuditChange/AuditLogDetail.facts` 使用显式 safe union。
- `backend/app/services/audit_logs.py`
  - metadata-only list projection；strict detail projection；generic projection error 不回显原始 key/value。
  - keyword 改到 approved columns/current actor，不搜索 details。
  - 保持稳定 order、actor join、filter-options 与 related lookup。
- `backend/app/routers/identity.py`
  - 保持 AdminUser 和参数；仅在需要时补 detail 409 文档/注释，不新增 endpoint。
- `backend/tests/unit/test_audit.py`
  - 覆盖 write/read registry、safe scalar/list/null、unknown/sensitive/object/nested failure、metadata list 不读 details。
- `backend/tests/unit/test_contract.py`
  - 冻结 Audit list/detail safe shape、409 与 runtime/OpenAPI 一致性。
- `backend/tests/integration/test_identity_management.py`
  - 扩充 global audit list/filter/detail 的筛选、keyword、时间、排序、权限、actor、related/projection error 与 SQL 次数。
- `backend/tests/integration/test_ai_channel_management.py`
  - 更新 channel AuditLogList shape，证明 shared list contract 兼容和固定 list 行为。

### 3.2 V1 shared contract compatibility

- `frontend/src/shared/api/schema.d.ts`：生成，不手改。
- `frontend/src/features/configuration/AuditLogPage.test.tsx`
  - fixtures 移除 list `change_summary`，保留现有 V1 URL/list/detail 行为测试。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
  - channel/global Audit list fixtures 适配新 shape。
- V1 production component 仅在 typecheck 暴露实际引用时做最小适配；审计已确认 global Audit page 与 channel page不绘制 list summary，不主动重构。

### 3.3 Frontend V2 global Audit owner

- `frontend-v2/src/domains/audit/audit.api.ts`
  - `auditKeys`、list/filterOptions/detail query options、domain-local safe request error。
  - detail key 固定 `['audit','detail',logId]`，供 System 与 Configuration 共用。
- `frontend-v2/src/domains/audit/audit.model.ts`
  - canonical search schema/record、camelCase→snake_case、Beijing datetime conversion。
  - module/outcome/action/field labels、strict `primary_task` 与 safe values/changes/facts projection。
  - related link resolution 只返回已确认 V2 route descriptor。
- `frontend-v2/src/domains/audit/audit.model.test.ts`
  - URL、API mapping、日期、label、安全 shape、primary token、related mapping 的纯边界测试。
- `frontend-v2/src/domains/audit/audit-detail-content.tsx`
  - 唯一安全详情 renderer：metadata、changes/facts、result/error、related status/link。
  - 不拥有 query、pane/sheet 或 selection；无 raw JSON renderer。
- `frontend-v2/src/domains/audit/system-audit-page.tsx`
  - page/filter/table/list states、focus registry、responsive detail containers。
  - 私有小组件保留同文件；不新增全局 Notice/Pane/row-trigger framework。
- `frontend-v2/src/domains/audit/system-audit-page.test.tsx`
  - 页面行为、query lazy/focus/states/安全输出测试。

### 3.4 Route、navigation、Users 与 Configuration

- `frontend-v2/src/routes/_app/_admin/system.audit.tsx`
  - typed search、canonical replace、list prefetch、RouteError、URL navigation。
- `frontend-v2/src/app/navigation.ts` / `navigation.test.ts`
  - 增加 `audit` NavId、`/system/audit` ADMIN item、active/breadcrumb evidence。
- `frontend-v2/src/routeTree.gen.ts`
  - 由 TanStack Router/Vite 生成；不手改。
- `frontend-v2/src/domains/identity/user-list-page.tsx` / `.test.tsx`
  - blocker 文案改为可追溯说明，增加 `/system/audit?actorId=user.id` Link；不加 query/import Audit API。
- `frontend-v2/src/domains/configuration/ai-channel.api.ts`
  - 删除 Configuration 私有 global audit detail key/options；channel list 保留。
- `frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts`
  - 删除被 global Audit projection 取代的 detail/summary registry；保留 AI channel 自身 search/action/runtime model。
- `frontend-v2/src/domains/configuration/ai-channel-runtime-section.tsx`
  - channel list 移除“安全摘要”列/移动端摘要；详情复用 `auditDetailQueryOptions` 与 `AuditDetailContent`。
- `frontend-v2/src/domains/configuration/ai-channel-workspace-page.test.tsx`
  - 更新 list shape并证明 global detail owner仍 lazy、focus/相关链接/安全失败不漂移。

### 3.5 Strict fixture/E2E 与文档

- `frontend-v2/tests/e2e/fixtures/system-audit.fixture.ts`
  - generated-type strict ADMIN/ENGINEER fixture，声明 auth + 三个 Audit GET；支持 filters/page/options/detail/status/error/projection failure。
- `frontend-v2/tests/e2e/system-audit.spec.ts`
  - production artifact 的 URL、七列、row keyboard、Pane/Sheet、lazy detail、focus、状态、安全、四档。
- `frontend-v2/tests/e2e/fixtures/ai-channel-workspace.fixture.ts`、`ai-channel-workspace-runtime.spec.ts`
  - shared list/detail shape 与 owner 兼容；保留现有 Runtime 边界。
- `frontend-v2/tests/e2e/fixtures/users.fixture.ts`、`system-users.spec.ts`
  - blocker link/handoff 证据；不让 Users fixture声明 Audit data GET（导航后可只断言 URL，或由组合 fixture显式接手）。
- 权威文档：`contracts/database.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`、`docs/frontend-v2/02...`、`03...`、`05...`、`07...`、`08...`、`09...`。
- `docs/frontend-v2/README.md` 仅在其 phase/status index 需要记录当前实现时更新；不复制 contract 细节。

## 4. Component hierarchy

```text
Route(/system/audit)
└─ SystemAuditPage
   ├─ PageHeader（无 primary action）
   ├─ FilterBar
   │  ├─ keyword
   │  ├─ createdFrom / createdTo（native datetime-local）
   │  ├─ module / outcome（OpenAPI enum）
   │  └─ more filters
   │     ├─ actorId
   │     ├─ action / targetType（filter-options）
   │     ├─ targetId
   │     └─ requestId
   ├─ Notices（filter-options / background list error）
   ├─ Audit workspace
   │  ├─ List column
   │  │  ├─ TableShell
   │  │  │  ├─ TableSkeleton | EmptyTable | recoverable error
   │  │  │  └─ AuditRow × N（click/Enter/Space）
   │  │  └─ TablePagination
   │  └─ Detail（logId only）
   │     ├─ Desktop Detail Pane (>=1280)
   │     └─ Adaptive Sheet (<1280)
   │        └─ AuditDetailContent
   └─ no mutation / no actions / no auto refresh
```

`AuditDetailContent` 是两个已有真实 consumer 的共享语义组件，不提供配置式 schema、插件、render registry 注入或 arbitrary JSON。System page 的 filter/table/pane 仍是 domain-local composition。

## 5. 状态与所有权

| 状态/事实 | 唯一 owner | 规则 |
| --- | --- | --- |
| filters/page/logId | TanStack Router URL | 唯一可持久恢复状态 |
| URL parse/canonical/API params | `audit.model.ts` | 严格 normalize；无 alias/兼容字段 |
| default near-3-day instant | route/model 初始化 | 计算一次并写 URL，render 不漂移 |
| list server state | `auditKeys.list(apiParams)` | 不含 logId；metadata-only AuditLogList |
| filter options | `auditKeys.filterOptions()` | 独立、真实 DB values |
| detail server state | `auditKeys.detail(logId)` | System/Configuration 共用；仅 logId enabled |
| selected row | URL `logId` | 不镜像到 component state |
| row focus targets | page-local `Map<logId,HTMLElement>` ref | 非业务临时状态，不入 URL/cache |
| desktop breakpoint | page-local `matchMedia('(min-width:1280px)')` | 只决定容器，不改变 URL/query |
| safe field/action registry | backend `audit_types.py`; frontend generated+explicit display registry | server 最终安全 owner；frontend严格显示 |
| related availability | backend Detail | frontend不 GET对象；仅映射已有 route |
| permission | backend `AdminUser` | `_admin` 只做客户端 UX |

不使用 Zustand/store，不把 query data复制进 state，不让 list row持有完整 detail，不把 secret/value放入 query key。

## 6. Canonical URL 与时间

### 6.1 默认与形状

首次进入无 query 的 `/system/audit` 会 replace 为类似：

```text
/system/audit?createdFrom=2026-08-13T09%3A30%3A00.000Z&createdTo=2026-08-16T09%3A30%3A00.000Z&page=1&pageSize=20
```

Users handoff 先规范为：

```text
/system/audit?createdFrom=<near-3-days>&createdTo=<now>&actorId=<uuid>&page=1&pageSize=20
```

完整 direct detail 示例：

```text
/system/audit?createdFrom=<iso>&createdTo=<iso>&module=CONFIGURATION&outcome=SUCCESS&page=2&pageSize=50&logId=<uuid>
```

query 输出字段顺序固定，便于 URL/test 稳定；重复参数只取 schema 的 canonical scalar 后 replace，unknown 参数移除。

### 6.2 日期规则

- API 合同是带 timezone 的 instant，不是 floating local time。
- `<input type="datetime-local">` 显示北京时间；提交时将输入明确解释为 `+08:00` 并转换成 ISO UTC。
- URL 输入接受合法 timezone-aware ISO；canonical 输出统一 `toISOString()`。
- 日期必须成对、严格 from < to。任何一项非法时不保留半个范围，整体恢复该 route 初始化的近三天。
- 筛选 submit 才更新 URL；draft input 保留在 form local state，URL变化（Back/Forward）重置 draft到 canonical值。

### 6.3 交互 history

- 搜索/筛选 submit、reset、分页、pageSize、打开/关闭 detail：push。
- parse correction、date correction、unknown params、server-known out-of-range：replace。
- filter/pageSize 变化固定 page=1；打开/关闭 logId不改 page/filter；切 filter时保留 logId，detail作为独立 identity继续可读，避免把合法 direct detail静默关闭。

## 7. Query 与请求矩阵

| 场景 | List | Options | Detail | Users/业务 API |
| --- | ---: | ---: | ---: | ---: |
| 初始 canonical page | 1 | 1 | 0 | 0 |
| direct URL + logId | 1 | 1 | 1 | 0 |
| 选择不同 row | cache-stable | cache-stable | 1/new id | 0 |
| 关闭 detail | 0 | 0 | 0 | 0 |
| filter/page change | 1/new key | cache-stable | 0 unless logId changes | 0 |
| options retry | 0 | 1 | 0 | 0 |
| detail retry | 0 | 0 | 1 | 0 |

- query options统一 `retry:false/retryOnMount:false/staleTime:30_000`，沿用当前 V2 domain模式；用户显式 retry。
- route只 prefetch list；options由页面独立读取；不因 loader等待 options 阻塞 list首屏。
- valid `logId` detail query可以与 list并行；没有逐行 waterfall。

## 8. Filter 与列表状态

### 8.1 Filter layout

- 第一层：keyword、时间起止、module、outcome、搜索/重置。
- `moreFilters`：actorId、action、targetType、targetId、requestId。
- action/targetType Select 使用 filter-options；URL 当前值即使 options临时失败也必须可见并继续发送，不从 rows猜选项。
- actorId 使用 UUID text input；不请求 Users combobox。Users handoff进入后可直接看到/清除该值。

### 8.2 可恢复状态

- initial list loading：七列 `TableSkeleton`。
- initial list error：`EmptyTable(kind=error)` + retry；options是否成功不掩盖 list error。
- background list error：保留旧 rows，显示 Notice + retry。
- empty：无附加筛选且 total=0，说明近三天暂无记录。
- filtered-empty：存在 actor/module/action/target/outcome/request/keyword等筛选且 total=0，提供 reset。
- options loading/error：list仍可用；select显示当前 URL value，错误 Notice只 retry options。
- out-of-range：收到 total 后计算 `max(1,ceil(total/pageSize))` 并 replace；显示稳定 loading/announce，不要求用户猜合法页。
- detail 404/403/409/transport error：只占 detail容器，保留 URL和 list，提供 retry/close。

## 9. Table 与 row interaction

七列直接来自 `AuditLog` metadata：

| 列 | 展示 |
| --- | --- |
| 时间 | `<time dateTime>`，北京时间格式 |
| 操作者 | display name + account type；null 固定文案 |
| 模块 | typed Chinese label + code可访问文本 |
| 动作 | 已登记时显示中文 label并保留 action code；未知历史 token明确标为“未登记动作”，不猜语义 |
| 对象 | `target_type / target_id`；null 为“未创建/未记录” |
| 结果 | SUCCESS/FAILED/DENIED badge + 中文，不只靠颜色 |
| Request ID | monospace、可换行，不变更值 |

整行仍是原生 `<tr>`，不改为 `role=button` 以免破坏 table semantics；增加 `tabIndex=0`、`aria-label`、`aria-selected`、pointer/keyboard handler 和 focus-visible ring。Space `preventDefault()` 后打开，Enter直接打开。没有嵌套链接/button，因此 row click不会与内部 action冲突。

窄屏保持同一七列表格与同一 rows，`TableShell` 局部横向滚动；不复制成第二 mobile list/data source。页面 root设置 `min-w-0/overflow`边界，测试只允许 table region自身 scrollWidth超出。

## 10. Detail Pane/Sheet 与焦点

- page 用 V2 已有 1280px desktop media query语义；只在 desktop render pane，只在较窄宽度控制 Sheet open。
- Pane约 22rem，sticky到 viewport顶部可见区，包含明确“关闭详情”button；Sheet复用现有 `SheetContent`。
- `logId` 是打开状态；viewport切换只换容器，不改变 URL/query。
- row被激活时把 element注册到 map并 push `logId`。关闭/Sheet Escape push移除 `logId`。
- effect观察 prior logId → undefined：优先 focus同 id row；若 direct detail所对应 row已渲染也能找到；否则 focus table region/heading。
- Back/Forward同样经过该 effect恢复焦点；不依赖 Sheet私有 finalFocus作为唯一 owner。Sheet仍传 `finalFocus`加强 Base UI关闭路径。

## 11. 安全详情投影

### 11.1 Server registry 与 shape

`audit_types.py` 中 registry按 module列出真实允许的 fact/change key。`validate_audit_entry` 在写入前确认：

- details只有 `facts/changes`；
- facts是 object，changes是 list；
- key/field在当前 module registry；
- before/after/fact value为 `null|string|number|boolean` 或一维 scalar/null list；
- sensitive key递归检查仍通过。

read Detail对历史 rows执行相同规则。任一未知/敏感/坏 shape抛：

```json
{
  "error": {
    "code": "AUDIT_PROJECTION_FAILED",
    "message": "审计详情无法按当前安全合同展示",
    "details": {},
    "request_id": "<current request id>"
  }
}
```

错误不包含原始 key/value、target payload或 stored request body。List metadata projection完全不读 details，因此仍可定位该 row并得到显式 detail failure。

### 11.2 Frontend renderer

- `AuditDetailContent`先断言 `primary_task`、module、facts/changes key和 safe value shape，再生成 display items；未知 action作为明确标识的历史 metadata显示，不把它当作 fact，也不猜中文语义。
- null → “未记录”；boolean → “是/否”；number保留准确值；string按普通文本；list逐项文本显示，空 list → “空列表”。
- 不调用 `JSON.stringify` 展示值；object/nested list/unknown key整体显示 generic“安全投影失败”，不渲染部分详情。
- `result_message/error_code`按 server scalar直接文本呈现；不把 response object或 error dump输出到 console。

## 12. Related entry 映射

| `status/kind` | UI | Link |
| --- | --- | --- |
| AVAILABLE + Product | 对象可用 | `/products/$productId` |
| AVAILABLE + FactVersion + parent | 对象可用 | `/products/$parentId/facts/versions/$targetId` |
| AVAILABLE + ContentTask | 对象可用 | `/content/tasks/$targetId` |
| AVAILABLE + ContentVersion | 对象可用 | `/content/versions/$targetId` |
| AVAILABLE + PublicationWork | 对象可用 | `/publishing/work/$targetId` |
| AVAILABLE + PublishedContentIssue | 对象可用 | `/publishing/issues/$targetId` |
| AVAILABLE + GeoObservation | 对象可用 | `/geo/observations/$targetId` |
| AVAILABLE + PlatformProfile | 对象可用 | `/settings/platforms/$targetId` |
| AVAILABLE + PlatformAccount + parent | 账号对象可用 | `/settings/platforms/$parentId?tab=accounts`（明确为所属平台页） |
| AVAILABLE + AIChannel | 对象可用 | `/settings/ai/$targetId?tab=basic` |
| AVAILABLE + AIModel + parent | 模型对象可用 | `/settings/ai/$parentId?tab=models` |
| MISSING | “关联对象已不存在，审计历史保留” | 无 |
| UNSUPPORTED | “当前对象类型没有稳定关联入口” | 无 |
| AVAILABLE但无精确 route/缺 parent | “对象可用，但当前无稳定入口” | 无 |

前端不根据 raw `target_type` 自由拼 path；只使用上表与 typed route API。PlatformProfileVersion当前 server只返回 MISSING，不构造版本详情链接。

## 13. Shared owner 与兼容迁移

### 13.1 AuditLogList

保持唯一 `AuditLog`：删除 `change_summary` 后，global list和 `/ai-channels/{id}/audit-logs`同时变窄。AI Runtime删除“安全摘要”列和移动端摘要，只保留动作、时间、actor、结果、详情入口；安全 changes/facts仍在按需 detail中完整可用。

V1 global Audit table与 V1 channel workspace未读取该字段，只更新 generated type与 fixtures。禁止把字段设 optional、保留空对象或新建 channel-specific DTO。

### 13.2 Detail owner

Configuration删除私有 global detail query key/options和 detail renderer registry，改用：

```text
auditDetailQueryOptions(logId)
AuditDetailContent(detail)
```

AI channel logs list、分页、workspace tab和“查看详情”button是 Configuration 自身现有 UX，不因 System Audit的“无操作列/row trigger”要求重写。只有相同的 endpoint/query key/safe detail semantics被共享。

## 14. Permissions、安全 fixture 与 E2E

### 14.1 Backend

- ADMIN：list/filter-options/detail 200。
- ENGINEER：三者 403；不只依赖 sidebar隐藏。
- statement counter：list empty/sparse/dense固定；filter-options固定2；detail无 related/有 related分别固定1/2，不随其他表数据增长。
- sentinel row：list response无 details；detail返回 generic 409；serialized response/error无 sentinel。

### 14.2 Production fixture

strict fixture只允许：

- auth/me 与 auth/csrf（沿用 foundation auth）；
- `GET /api/v1/audit-logs`；
- `GET /api/v1/audit-logs/filter-options`；
- `GET /api/v1/audit-logs/{id}`。

fixture执行真实 query参数解析、服务端 filter/page/stable order、options去重排序、deleted actor、三种 outcome、related三态和 detail lazy记录。内部 raw row可含 secret sentinel，但 response builder模拟 server allowlist/409，不保存 raw row到 controller record。未声明 API返回501；teardown汇总 unexpected API/non-allowed non-2xx/console/page/request failures。

`system-audit.spec.ts` 设置 `trace:'off'`；测试结束确认该 spec无 trace zip。responsePayload records、DOM、console/errors、URL/query key可观察字符串均不得含 sentinel。

### 14.3 Four widths

- 375：七列表格局部可滚，Sheet全宽，row键盘可达。
- 768：Sheet，filters wrap，pagination可达。
- 1024：Sheet，table不被 side pane压缩。
- 1440：右 pane，同屏 table/detail，row focus/selected清晰。
- 每档断言 `document.documentElement.scrollWidth <= clientWidth`。

## 15. 文档一致性

- `contracts/openapi.yaml` 是 API owner；`contracts/database.md` 记录 details正向 allowlist、半开时间、metadata-only list和无 schema变化。
- backend spec更新 keyword、安全 projection/query count；frontend spec更新 URL/query/detail owner。
- V2 02补 nav/route落地；03补完整 Audit page；05补 read contract；07只记录本 slice完成且 Phase 7未完成；08补 required evidence；09记录“metadata-only list + on-demand strict detail + URL-owned selection”的 ADR。
- 不在多个文档复制完整 field registry；registry只在代码/contract owner，文档描述规则与边界。

## 16. Ponytail 约束

- 复用现有 Audit endpoints/models、Router/Query、Table Kit、FilterBar、Sheet、Badge、Workspace 1280px语义、native datetime input。
- registry放入现有 `audit_types.py`，不创建 projection framework/module graph。
- 只有两个真实 consumer共享 API/model/detail content；table/filter/pane不抽象。
- 不加日期库、JSON viewer、global store、second DTO、optional compatibility、polling或猜测路由。

## 17. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 收紧 write registry暴露漏登记写入 | 已静态枚举所有 `AuditEntry`；unit参数化 retained write keys，实施时再跑全仓 search |
| 移除 list summary破坏 AI Runtime | 显式删除 summary UI并跑其 component/E2E与 backend channel integration |
| 历史不安全 row拖垮列表 | list不读取 details；仅 detail返回 generic 409 |
| keyword actor join造成 count漂移/N+1 | count/rows共享 outerjoin/conditions；statement counter与筛选结果测试 |
| 1024 pane挤压七列 | 1280以下统一 Sheet，与现有 workspace responsive语义一致 |
| row trigger破坏 table/accessibility | 保留 tr语义，不加 role=button；测试 headers、Enter/Space、focus、selected |
| URL默认时间在 render漂移 | route初始化一次，canonical URL显式保存 ISO values |
| related route猜测 | 封闭映射表；缺 parent/未支持时只显示状态不链接 |
| sentinel进入 Playwright artifact | server-style fixture不返回 raw secret，controller不记录，spec关闭 trace并检查 artifact |

## 18. 停止条件与 Git/Trellis

- 若需要 DB migration、历史 rewrite、权限改变、append-only/retention改变，停止实施并报告。
- planning批准前不运行 `task.py start`、不建 branch。
- 批准后只建 `codex/frontend-v2-system-audit`，不 pull/push/PR；主会话 inline实施/检查。
- Required validation通过后展示 commit plan并等待确认；未确认不 commit。
- 获得后续明确授权后才归档、fast-forward合入 main并删除临时 branch；Trellis bookkeeping commit前先解释。
