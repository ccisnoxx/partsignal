# Audit 列表投影失败隔离设计

## 1. 设计不变量

本 Task 只建立一个不变量：

> 未知 Audit action 必须显式失败，但失败最多停留在产生它的单条列表行或单个动作筛选投影，不得越过该局部边界替换路由、兄弟 query、合法行或已打开的合法详情。

严格 allowlist、服务端筛选、详情安全投影和 ADMIN 权限都高于展示便利性。未知 action 不是可展示事实，也不是可选择业务项。

## 2. 当前调用链与异常逃逸

### 2.1 Audit list

```text
GET /api/v1/audit-logs
  -> auditListQueryOptions().queryFn 原样返回 AuditLogList
  -> SystemAuditPage.logs.data.items
  -> rows.map(log => <AuditRow log={log} />)
  -> AuditRow render
  -> auditActionLabel(log.action)
  -> 未登记时 throw
  -> /system/audit route errorComponent
  -> 整个路由替换为 RouteError
```

关键位置：`audit.api.ts:27-39`、`system-audit-page.tsx:55-56, 134-137, 191-210`、`audit.model.ts:194-197`、`system.audit.tsx:32-34`。

### 2.2 Filter options 与 current URL action

```text
GET /api/v1/audit-logs/filter-options
  -> auditFilterOptionsQueryOptions().queryFn 原样返回 actions: string[]
  -> SystemAuditPage.options.data.actions
  -> AuditFilters actionOptions
     + 若 search.action 不在 options 中，当前实现先把它补入 actionOptions
  -> actionOptions.map(value => auditActionLabel(value))
  -> 任一未登记值 throw
  -> 同一个 route errorComponent
```

`auditSearchSchema` 只校验 action 为最长 120 的非空字符串，不把 UI label registry 当服务端筛选 enum。这一开放 URL/API 筛选合同必须保留；修复点只能是展示投影，不能把 unknown search 静默删除。

### 2.3 Detail

Detail 的网络 query 与展示投影已经独立。`AuditDetailContent.projectDetail()` 在同一个 `try/catch` 中完成 action、changes、facts 和 related link 投影；未知 action/field 会转成详情内部 `role="alert"`，不会进入 route error。服务端也可能直接返回 `409 AUDIT_PROJECTION_FAILED`，由 Pane/Sheet 内的 query failure 表面处理。

本 Task 不修改这条链，也不修改 AI Channel Runtime 对 `auditDetailQueryOptions()` 和 `AuditDetailContent` 的复用。

## 3. 权威 owner 与判别式结果

`audit.model.ts` 继续是 Audit action label allowlist 的唯一 owner。新增 domain-local 判别式结果，建议形态：

```ts
type AuditActionLabelProjection =
  | { status: 'projected'; label: string }
  | { status: 'failed' };

function projectAuditActionLabel(action: string): AuditActionLabelProjection;
```

合同：

- `projected` 只从现有 `auditActionLabels` 取得正式中文标签。
- `failed` 不包含 `action`、`label`、error message 或任意原始 token 副本，避免组件误用失败数据展示未知值。
- 不新增第二份 registry。现有严格 `auditActionLabel()` 可以继续服务共享 Detail/AI Runtime 的既有合同；若实现内部复用新 projector，未知分支仍必须抛错，不能改成字符串 fallback。
- 该类型只属于 Audit domain，不上移到 shared/design-system，也不推广成全站投影框架。

## 4. 两个最小局部边界

### 4.1 单条 AuditRow

每个 `AuditRow` 先取得自己的 `AuditActionLabelProjection`，然后在行内穷尽分支：

- `projected`：保持当前 `<tr>` click、Enter、Space、`tabIndex=0`、`aria-selected`、含正式中文标签的 `aria-label` 和 `onOpen`。
- `failed`：仍渲染一个完整的七列 `<tr>`，但不绑定 click/keydown、不增加 `tabIndex`、不调用 `onOpen`，动作单元格显示不含 token 的“无法安全投影”。失败文案使用可被辅助技术读取的局部状态语义；不能把整行变成 route error 或空白行。

失败行保留的六类 metadata 来自同一个 metadata-only `AuditLog` 合同：时间、actor/deleted marker、登记 module 标签、target type/ID、登记 outcome、Request ID。action 字段自身、详情入口以及任何 detail 内容全部隐藏。

不允许从失败行打开 Detail。原因不是前端推断权限，而是当前 list projection 已经证明 strict Detail 的必要 action registry 条件不成立；继续发请求只能得到服务端 409 或共享 renderer 的局部失败，且可能把未知 token 带入现有详情错误文案。本 Task 不为此修改共享 owner。

direct/off-page `logId` 不依赖当前页行，是现有独立 Detail 合同，保持不变。已经打开的合法详情也不因 list refresh 产生坏行而清除。

### 4.2 动作筛选项

动作筛选不能复用“整行失败”结果，因为它还要保留 current URL action 的 server-side filter 身份。设计分为两层：

1. 对 API `actions[]` 逐项使用同一个 `projectAuditActionLabel()`。只把 `projected` 项转换为 Select item；`failed` 项从可选业务值中排除。
2. 在动作 Select 邻近显示局部、可访问且不含 token 的反馈，例如“部分动作筛选项无法安全投影，已从可选项中隐藏”。可以显示失败项数量，但不能显示内容。

若 `search.action` 本身未知：

- 内部 draft 仍保留原 action，以保证用户没有改动时 canonical URL 和 API `action=` 参数不被组件偷偷清除。
- Select 使用一个仅供本地 UI 的 opaque unavailable selection，显示“当前动作无法安全投影”，不能用原 token 作为 item label、visible value、DOM data attribute 或 React key。
- 用户选择“全部动作”时明确清除该 action；选择已登记 action 时改为新值；Reset 使用现有 canonical reset。
- 不得把 unknown current selection 显示成“全部动作”，否则视觉状态与实际 server filter 不一致。

列表 query 与 options query 仍各自成功。projection failure 不写入 query error，也不触发 retry；重新请求 options 仍只用于真实 transport failure。

## 5. Query、URL 与 stale-data 保持

- `auditKeys.list(apiParams)`、`auditKeys.options()`、`auditKeys.detail(logId)` 不变。
- list key 继续只含 snake_case API 参数，`logId` 不进入 list key。
- loader 继续仅预取 list 与 options；detail 保持 lazy。
- list 初始 error、cached refresh error、options transport error、detail 403/404/409/transport error保持现有独立表面。
- 改筛选或分页继续清除 `logId`；仅 list refresh 不清除合法详情。
- 越界页 replace、server order、page/pageSize、半开时间范围和 canonical search 都不改变。

## 6. 七列、键盘、ARIA 与响应式

- `<thead>` 与每个成功/失败 row 都保持七列，列角色和顺序不变。
- 成功行沿用当前键盘合同；失败行不是虚假的详情入口，因此不创建失效 tab stop，也不声明可执行的“查看详情”名称。
- 失败 action 单元格提供明确文字和局部状态语义；不能只靠颜色或图标表达。
- `TableShell`、`.audit-list-table`、局部横向滚动、1280px Pane、窄屏 Sheet 与 375/768/1024/1440 布局保持不变。
- 已打开合法详情的关闭、Escape、Back/Forward 和 trigger/title focus fallback 不变。

## 7. 非泄漏设计

失败分支不得插值 `action`，也不得把失败结果的 Error message直接显示给用户。以下位置都要做负向断言：

- 行动作单元格、row accessible name、筛选 Select trigger/options、局部失败提示。
- 整个 document 的 visible text/HTML。
- canonical URL（未知 token 来自 API fixture 时不应进入 URL）。
- console/pageerror/requestfailed 审计输出。

fixture 应在未知 list action 和未知 filter option 中使用可识别 token，并额外放入只供泄漏检测的 sentinel/未声明字段。测试原始 fixture response 本身当然包含输入 sentinel；验收对象是浏览器 DOM、URL、可见错误和运行时输出，不能把 fixture controller 的原始 response capture 误判为 UI 泄漏。

## 8. 文件影响边界

计划修改：

- `frontend/src/domains/audit/audit.model.ts`
- `frontend/src/domains/audit/audit.model.test.ts`
- `frontend/src/domains/audit/system-audit-page.tsx`
- `frontend/src/domains/audit/system-audit-page.test.tsx`
- `frontend/tests/e2e/fixtures/system-audit.fixture.ts`
- `frontend/tests/e2e/system-audit.spec.ts`

只读回归确认，不计划修改：

- `frontend/src/domains/audit/audit.api.ts`
- `frontend/src/domains/audit/audit-detail-content.tsx`
- `frontend/src/routes/_app/_admin/system.audit.tsx`
- `frontend/src/domains/configuration/ai-channel-runtime-section.tsx`
- OpenAPI、generated schema、backend、database contracts。

## 9. 拒绝的替代方案

- `label ?? action`、`String(action)` 或显示原 token：违反 strict allowlist 和非泄漏要求。
- 给未知 action 一个“其他操作”成功标签：把投影失败伪装成已批准业务事实。
- 在 `rows.map` 外包一层 `try/catch`：一个坏行仍会替换整张表，边界不够小。
- 全局/路由内新建 ErrorBoundary：只能捕获症状，不能让合法兄弟行和筛选项继续工作。
- 在 queryFn 中因一个坏值拒绝整个 `AuditLogList` 或 `FilterOptions`：把局部投影失败错误升级为整 query 失败。
- 修改 OpenAPI enum、后端 action registry 或 Detail registry：超出本 Task，且会改变现有公共合同。
- 同步修复 AI Channel Runtime list：属于独立 surface，用户明确排除 Runtime 重构；本 Task 只保证共享 Detail owner 不受影响。
