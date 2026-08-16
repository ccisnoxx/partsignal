# Frontend V2 System Audit 规划审计

## 1. 审计范围与当前状态

- 主工作目录为 `main`，创建 Task 前 clean；`git status --short --branch` 为 `main...origin/main [ahead 237]`，未 pull/push。
- `frontend-v2-system-users` 已归档；当前 main 最新业务提交包含 `feat(frontend-v2): implement system users management`。
- 创建前没有 active/current Trellis Task，没有 `codex/frontend-v2-system-audit` branch，也没有额外 worktree。
- 已创建 `.trellis/tasks/08-16-frontend-v2-system-audit`，状态保持 `planning`；未运行 `task.py start`、未创建分支、未修改业务代码。
- repository 中审计读取 owner 已从旧的 `backend/app/services/identity.py` 拆到 `backend/app/services/audit_logs.py`；router 仍位于 identity router。规划以实际 owner 为准，不把逻辑搬回 identity service。

## 2. 已有产品与 V2 基础

| 主题 | 证据 | 结论 |
| --- | --- | --- |
| 页面蓝图 | `docs/frontend-v2/03-page-and-workflow-blueprint.md:444-448` | 固定 Table + Detail Pane、七列、无操作列、row 打开详情、mobile Sheet。 |
| Phase 7 顺序 | `docs/frontend-v2/07-migration-plan.md:482-488` | Users 已完成；Audit 是当前独立 slice；管理员完整 E2E 与抽象回顾留后续。 |
| Users handoff | `docs/frontend-v2/03-page-and-workflow-blueprint.md:442`、`frontend-v2/src/domains/identity/user-list-page.tsx:813-826` | 后端已经支持 actor filter，但 blocker 仍明确说入口未实现；本 Task 应只加 canonical link，不让 Users 请求 Audit。 |
| Router pattern | `frontend-v2/src/routes/_app/_admin/system.users.tsx:11-30` | 复用 typed search、`isCanonical`、`beforeLoad` replace、loader/queryOptions、RouteError。 |
| ADMIN UX boundary | `frontend-v2/src/routes/_app/_admin/route.tsx` | `/system/audit` 应与 Users 同处 `_admin`，客户端 boundary 只做 UX；服务端继续最终 403。 |
| Navigation | `frontend-v2/src/app/navigation.ts:19-25,87-90` | 系统管理当前只有 Users；需加一个 ADMIN-only Audit 项和 typed `NavId/to`。 |
| Table Kit | `frontend-v2/src/design-system/data-table/*` | `TableShell` 已提供局部 overflow/region；`FilterBar`、`TableSkeleton`、`EmptyTable`、`TablePagination` 可直接复用。 |
| Responsive owner | `frontend-v2/src/design-system/workspace/workspace-shell.tsx:67-82` | V2 已以 1280px 作为 desktop pane breakpoint；不足宽度把 reference 转为替代呈现。Audit 可采用同一阈值，不新增 breakpoint 系统。 |
| Sheet/focus | `frontend-v2/src/design-system/primitives/sheet.tsx`、`frontend-v2/src/domains/configuration/ai-channel-runtime-section.tsx:208-231` | 现有 Base UI Sheet 支持 focus trap、Escape 与 `finalFocus`。 |

旧全局 frontend visual spec 仍描述 V1 Ant Design，并反对可点击 row；本 Task 的用户硬要求与更具体 V2 蓝图明确要求整行 trigger，因此本页局部实现 focusable row，不修改通用 Table Kit，也不把它推广为全站模式。

## 3. OpenAPI 与后端现状

### 3.1 endpoint 与响应

- `contracts/openapi.yaml:248-303` 已声明 list、filter-options、detail 三个 GET；list 参数覆盖用户要求的全部 snake_case filter。
- 三个 router 都依赖 `AdminUser`：`backend/app/routers/identity.py:334-406`。当前 integration 只断言 list/detail 的 ENGINEER 403，漏了 filter-options。
- `AuditLog` 当前把 `change_summary` 作为所有 list item 必填字段：`contracts/openapi.yaml:3563-3582`。
- `AuditChange.before/after` 和 `AuditLogDetail.facts` 当前是无形状约束的 JSON：`contracts/openapi.yaml:3547-3554,3592-3603`。
- `primary_task` 已由合同固定为 `VIEW_LOG_DETAIL`，运行时前端仍需拒绝被 cast/fixture 注入的未知 token。

### 3.2 list、keyword、排序与 actor

- list 先 count，再以 `outerjoin(User)` 读取 rows，按 `(created_at DESC, id DESC)` 排序：`backend/app/services/audit_logs.py:308-350`；SQL 次数当前固定为 2，actor 没有 N+1。
- actor 是当前 User 目录投影；用户被物理删除后数据库 `SET NULL`，因此 `actor_id=null`、`actor=null`。前端统一显示“用户已删除/未记录”，不请求 Users 补装。
- `created_from` 为 `>=`，`created_to` 为 `<`；值必须带时区，且两者同时存在时必须严格 `created_from < created_to`：`backend/app/services/audit_logs.py:240-248,274-277`。数据库按 UTC 存储/传输，合同为半开区间 `[from,to)`：`contracts/database.md:203-211`。
- 当前 keyword 与稳定 spec 不一致：代码只匹配 `target_id` 和若干 `details` facts（`audit_logs.py:292-304`），而 `.trellis/spec/backend/database-guidelines.md:654-657` 要求匹配 actor、module、action、target type/id、request ID、result message、error code，并禁止搜索 raw details。实施需修正 authoritative query，而不是在前端补搜索。

### 3.3 filter-options

- `audit_log_filter_options` 对 action 与 target type 各做一次 `DISTINCT ORDER BY`：`backend/app/services/audit_logs.py:354-360`。
- 结果是数据库真实值、稳定排序、去重，固定 2 条 SQL；应保持独立 query，不与 list 合并。
- module/outcome 已有 OpenAPI enum，不应从当前页 rows 或 filter-options 重建。

### 3.4 详情安全投影

- 九个 `AuditModule` 都在 `_SAFE_FACT_KEYS/_SAFE_CHANGE_FIELDS` 有 entry，但“模块有 entry”不等于“覆盖实际写入”。
- 当前安全 value 接受 primitive/null 和递归 list，拒绝 object；嵌套 list 仍会通过：`backend/app/services/audit_logs.py:161-167`。
- `_project_details` 遇敏感 key 返回空集合；未知 key、未知 change field、坏 change/value shape 全部静默跳过：`audit_logs.py:173-207`。这不满足“未知 key/value shape 显式投影失败”。
- `project_audit_log` 对每一行读取并复制安全 details 到 `change_summary`：`audit_logs.py:210-236`。System Audit 七列表格不消费它，形成无必要暴露和 CPU 投影。
- `get_audit_log` 先投影 base，再投影 details，并最多做一次 related object lookup：`audit_logs.py:447-466`。详情不会请求业务 HTTP API，但当前 projection 失败语义不严格。
- 写边界只限制顶层为 `changes/facts`、拒绝敏感 key，并允许任意递归 JSON value：`backend/app/audit.py:85-139`。它没有校验 module-specific key，因此 read allowlist 可与实际写入漂移。
- 实际漂移已存在：
  - CONFIGURATION 写入 `bound_platform_count/bound_platform_ids`（`backend/app/services/platform_configuration.py:731-734`）、`unbound_platform_count`（`:834-840`）、`platform_account_count`（`:973-977`），当前 allowlist 缺这些键。
  - CONTENT_PLANNING 写入 `generation_job_count/content_version_count/content_review_record_count/publication_work_count`（`backend/app/services/publication.py:1544-1553`），当前 allowlist 缺这些键。
- 当前 unit tests 明确冻结“unknown/sensitive 忽略”行为：`backend/tests/unit/test_audit.py:110-160`；实施必须把这些测试改成新的显式失败合同，不能同时保留旧 fallback。

### 3.5 related entry

- server 当前只对 Product、FactVersion、ContentTask、ContentVersion、PublicationWork、PublishedContentIssue、GeoObservation、PlatformProfile、PlatformProfileVersion、PlatformAccount、AIChannel、AIModel 做明确投影；其他 target type 为 `UNSUPPORTED`：`backend/app/services/audit_logs.py:372-432`。
- `AVAILABLE` 表示当前对象存在，`MISSING` 表示支持该 kind 但对象已不存在，`UNSUPPORTED` 表示没有可靠 lookup；前端必须分开呈现。
- V2 已存在可精确构造的 routes：Product、FactVersion（需要 parent）、ContentTask、ContentVersion、PublicationWork、PublishedContentIssue、GeoObservation、PlatformProfile、AIChannel，以及 AIModel 所属 Channel。PlatformAccount 只有所属平台 Accounts tab，没有 account identity deep link；可链接父页但必须明确文案。其他类型不猜 route。

## 4. 14 项重点合同审计结论

1. **AuditLogList/change_summary**：不需要。System 七列不消费；当前每行投影 details 是额外暴露。保持单一 `AuditLog` DTO并从它移除 `change_summary`；同步调整 AI Channel Runtime 的列表摘要列/移动端摘要，详情继续按需展示安全字段。不要新增“compact Audit DTO”。
2. **全部模块 allowlist**：枚举覆盖九个模块，但实际 key 不完整。把 module-specific facts/changes registry 移到既有 `audit_types.py` 作为写/读共享合同，补齐已观察的八个缺失 fact key；不建新 framework。
3. **未知 key/value**：当前静默过滤。新写入在 `validate_audit_entry` 显式拒绝；历史 row 在 detail read 返回不含 key/value 的结构化 `409 AUDIT_PROJECTION_FAILED`。List 不读 details，坏历史 row 不应拖垮首屏。
4. **ADMIN-only**：三个 router 当前均为 ADMIN-only；补 ENGINEER filter-options 403、三 GET contract/integration 与页面 `_admin` 证据。
5. **list SQL/N+1**：当前 count + outerjoin rows 固定 2，actor 无 N+1；keyword 修正后 count 与 rows 必须复用同一 join/conditions，并用 sparse/dense statement counter 锁定固定次数。
6. **deleted actor**：`actor_id/actor` 都 nullable；删除后为 null，不是历史 identity snapshot。UI 固定“用户已删除/未记录”。
7. **filter-options**：当前稳定排序、去重、固定 2 查询；补测试并保持独立 query。
8. **时间合同**：UTC instant，必须带 timezone；`created_from` inclusive、`created_to` exclusive、严格 from < to。V2 UI 以北京时间编辑/显示，URL/API 使用规范 ISO instant。
9. **排序**：当前 `(created_at DESC,id DESC)` 正确；没有用户可选 sort，不增加 sort 参数。
10. **Detail selection owner**：应由 canonical URL `logId` 持有，query key 不含在 list key 中；direct/refresh/Back/Forward 可恢复，选择不会重读 list。
11. **AI Runtime owner**：当前 global detail query key 在 Configuration (`['configuration','audit-logs','detail',id]`)，详情 value/key renderer 也只在 Configuration；新增 System 会形成第二 owner。
12. **最小公共 owner**：建立 `frontend-v2/src/domains/audit/`，只拥有 global Audit list/filter/detail API、canonical safe value/key projection 和一个详情内容组件。Configuration 复用 detail query/renderer；channel-specific logs list、workspace UI、channel/model handoff 仍留 Configuration。不建 Timeline/JSON Viewer/通用审计 framework。
13. **Users handoff**：blocker Dialog 增加 `/system/audit?actorId=<user-id>` link；点击只导航，不请求 Audit，不改变 Users list/query owner。
14. **V1 兼容**：V1 global Audit table 不读取 `change_summary`，只需更新 fixtures/generated type；V1 AI Channel 页面也不绘制摘要。共享 OpenAPI 变化必须跑 V1 Audit/Configuration tests、typecheck/build。V2 AI Runtime 当前绘制摘要，需有明确兼容改动和回归。

## 5. 最小 contract-first 修正

### 5.1 OpenAPI/runtime schema

- 从 `AuditLog.required/properties` 移除 `change_summary`，从而同时收紧 global 与 channel Audit list；不增加第二个 list item DTO。
- 新增 `AuditSafeScalar` 与 `AuditSafeValue`：`null|string|number|boolean`，或由这些 scalar 组成的一维 array；object、nested array 不合法。
- `AuditChange.before/after` 与 `AuditLogDetail.facts.additionalProperties` 引用 `AuditSafeValue`。
- detail endpoint 补结构化 409 response，用于 retained historical row 无法按当前 allowlist 安全投影；消息不包含未知 key、value 或 sentinel。
- 生成 V1/V2 types；不手改 generated 文件。

### 5.2 backend single owner

- `audit_types.py` 持有九模块 facts/change key registry 与 safe value type/validator；`audit.py` 写前校验，`audit_logs.py` 读历史时复用。
- list projection只读 row metadata/actor，不读取 details。
- detail 对 details 顶层、facts/change entry、登记 key、value shape 做完整正向校验；任何未知/敏感/对象/嵌套结构整体失败，不回显原因中的原始 key/value。
- keyword 改为只搜索批准列与 current actor fields，不搜索 details JSON；count 与 rows 使用同一 join/conditions。
- 不改 table、migration、append-only/immutability、权限或历史数据。

## 6. Canonical URL 决定

URL 使用 V2 camelCase，API 映射只在 model 边界完成：

| URL | canonical 规则 | API |
| --- | --- | --- |
| `page` | 正整数，默认/显式 `1` | `page` |
| `pageSize` | `10|20|50`，默认/显式 `20` | `page_size` |
| `createdFrom` | timezone-aware ISO instant；默认当前时刻前 3 天并显式 | `created_from` |
| `createdTo` | timezone-aware ISO instant；默认当前时刻并显式；必须大于 from | `created_to` |
| `actorId` | canonical lowercase UUID；可选 | `actor_id` |
| `module` | OpenAPI `AuditModule`；可选 | `business_module` |
| `action` | trim，1..120；可选 | `action` |
| `targetType` | trim，1..80；可选 | `target_type` |
| `targetId` | trim，1..100；可选 | `target_id` |
| `outcome` | OpenAPI `AuditOutcome`；可选 | `outcome` |
| `requestId` | trim，1..100；可选 | `request_id` |
| `keyword` | trim，1..100；可选 | `keyword` |
| `logId` | canonical lowercase UUID；可选 | path `audit_log_id`，不进入 list params |

- 默认近三天来自既有 stable spec (`.trellis/spec/backend/database-guidelines.md:666`)；以一个 route/model 创建期的 `now` 计算一次，写成 ISO UTC URL，不在 render 中漂移。
- UI 使用原生 `datetime-local`；只做固定 `Asia/Shanghai`（UTC+08:00）显示/输入转换，不增加日期依赖。
- 日期缺一、无时区、不可解析或 `from >= to` 时整体规范到默认近三天；blank optional filters 删除；unknown/repeated/非法参数丢弃。canonical correction 用 replace。
- 筛选、搜索、重置和 pageSize 变化回到 page 1；用户选择筛选/翻页/开关 detail 用 push。
- response 证明 page 超出范围时 replace 到最后有效页；`total=0` 则 replace 到 page 1。它是 server-known canonical correction，不猜数据。

## 7. 前端呈现与安全边界决定

- 固定七个 table header；无 action column、无“查看详情”button。`tr` 保留 table row 语义并局部 `tabIndex=0`，处理 click/Enter/Space，Space 阻止页面滚动，提供 visible focus 与 selected state。
- 1440（`min-width:1280px`）在表格右侧显示约 340–380px pane；375/768/1024 使用现有 Sheet。该阈值与 Workspace pattern 一致，避免 1024 把七列表格压坏。
- `logId` 驱动 pane/sheet。打开行记录该 row element；close、Escape 或 Back 导致 `logId` 消失后把焦点返回对应行。direct URL 若该行在当前页，同样可按 id 找到 row；不在当前页时返回 table region/页面 heading 的稳定焦点目标。
- list 与 filter-options 是两个独立 query；detail 仅 `logId` 存在时 enabled。选择/关闭详情不会让 list key 改变。
- 详情只绘制 typed metadata、changes/facts、result/error 和 related status；不 raw dump、不显示 `change_summary`、不调用业务 detail API。
- safe renderer 对已登记 key 使用中文 label；primitive/null/一维 primitive list 有明确文本。空 list 显示“空列表”，null 显示“未记录”。unknown key/value/object/nested list/unknown primary token 显式 `安全投影失败`，不 stringify 原始值。
- action/target type 的历史 raw token可以作为其自身的非敏感 identity 显示；不据此推断业务状态或路由。related link 只由 `related_entry.status/kind/parent_id` 与已存在 route 的精确表驱动。
- 页面无 mutation、action eligibility、Users join、自动刷新、轮询、export 或 target-wide router guess。

## 8. 测试缺口

- Backend integration 当前覆盖主要 filter/order/detail/options、deleted actor 和 list/detail Engineer 403，但缺 filter-options 403、keyword authoritative columns、固定 SQL、严格 projection error、所有 related status、安全 shape matrix。
- Backend unit 当前冻结 silent ignore，需改为 write/read strict registry tests，并枚举实际 retained write keys。
- V1 Audit unit 已覆盖旧 snake_case URL/详情/自动刷新，作为共享 contract compatibility，不作为 V2 设计模板。
- V2 AI Runtime 已覆盖 lazy detail、Escape focus、unknown shape、无 Users 和 sentinel；共享 owner/summary removal 后必须继续通过。
- 新 System Audit 需要 generated-type strict fixture：fixture 内保留 secret sentinel 作为“数据库原始数据”，HTTP response/controller logs 不得包含它；未声明 API 返回 501 并在 teardown 汇总失败。spec 使用 `trace: 'off'`，避免敏感模拟请求成为 trace artifact，并断言输出目录没有本 spec trace。

## 9. 不需要的工作

- 无数据库 migration/schema/history rewrite。
- 无新依赖；日期用平台 API/原生 input。
- 无第二 Audit DTO、客户端 join、通用 JSON viewer、Timeline framework、自动刷新、export 或 mutation。
- 不修无关 V1 UX，不做 Phase 7 全管理员真实栈 E2E或抽象回顾。

## 10. 阻塞与停止条件

当前没有产品决策 blocker。若实施中发现要满足要求必须修改 audit table/schema、重写历史 JSONB、改变 append-only/删除例外或改变权限模型，应立即停止并回到用户评审；这些影响不在当前授权内。
