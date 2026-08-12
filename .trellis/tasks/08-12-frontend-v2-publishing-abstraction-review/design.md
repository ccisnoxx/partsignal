# Design — Publishing Vertical Slice 抽象回顾

## 1. Design principle

采用“先删除、再复用、最后才提升”的顺序：

1. 已有 Design System/shared pattern 继续复用，不再包一层。
2. 只删除无生产消费者的 helper 与无语义 alias。
3. 已证实的前端一致性缺陷在现有 owner 内修复，不新增框架。
4. 后端投影与 OpenAPI 缺口独立建 Task；本任务不跨越合同边界。
5. 名称相似但 DOM、交互、可访问性或 props 不一致的实现继续留在 Publication domain。

## 2. Boundary model

```text
Publishing routes
  -> validate params/search/hash
  -> prefetch Publication query options
  -> metadata + page composition
  -> approved cross-domain invalidation callback only

Publication domain
  -> generated Publication DTO aliases
  -> API + query keys + error mapping
  -> Work / Article / Issue presentation and action registries
  -> RHF/local transient state + 409 no-replay ownership
  -> server-projected data rendering

Design System/shared
  -> WorkspaceShell / DetailSection / Timeline / StickyActionBar
  -> RowActions / Dialog / Badge / RouteError primitives
  -> no Publication DTO, token, permission, role, status-machine dependency

Backend + OpenAPI
  -> authoritative resources, transitions, filtering, snapshots, history
  -> follow-up owner for projection/contract defects
```

## 3. Ownership matrix

| Concern | Authoritative owner | Publication consumer rule | Decision |
|---|---|---|---|
| Work / Article / Issue DTO | `contracts/openapi.yaml` + generated schema | 只做 type alias，不建第二 DTO | Keep in Publication Domain |
| Publication endpoint、query options、query keys、error parser | `publication.api.ts` | 所有页面复用同一 owner | Keep in Publication Domain |
| Work / Article / Issue action token 与状态展示 | 各自 Publication model | 不跨资源合并 registry | Keep in Publication Domain |
| eligibility / `primary_task` / candidates | backend projection | 前端只消费，不推导 | Keep in Publication Domain |
| URL state | route + canonical model | query/search/hash 可见、可分享、可重放 | Keep in Publication Domain |
| RHF 与 transient dialog state | 对应 domain page/action component | 409 保留输入、不自动 replay | Keep in Publication Domain |
| same-domain cache invalidation | mutation owner/page composition | 精确失效；不复制 query-key 常量 | Keep in Publication Domain |
| cross-domain Content projection invalidation | route/application composition callback | 保持 Publication 不导入 Content domain internals | Keep in Publication Domain |
| Workspace / Detail / Timeline / Sticky actions | Design System workspace kit | domain 先映射为通用 props | Keep in Design System/shared |
| Row action interaction、Dialog、Badge | Design System primitives | 业务 token、文案、确认语义留 domain | Keep in Design System/shared |
| backend read snapshot 与 immutable history | backend Publication query/service/database guards | 前端不补偿、不 browser join | Keep in Publication Domain |
| route error boundary UX | route + existing `RouteError` primitive | 未批准前不新增 Publication route error UX | Deferred product/UX decision |

## 4. Minimal implementation design

### 4.1 Article `OPEN_ISSUE` 409

在现有 `OpenIssueDialog` 内增加 conflict/stale 状态；409 后：

- 保留 RHF 输入；
- 禁用再次提交，禁止自动 replay；
- 显示显式“重新加载 Article”入口；
- reload 只 refetch canonical Article detail；reload 完成后重新读取 server-projected `available_actions` 与 `open_issue_id`，不由 status 推导资格；
- 若 `OPEN_ISSUE` 已消失，关闭 dialog，由 Article page 展示服务端返回的 issue handoff。

不新增 mutation coordinator、通用 conflict framework 或第二 error owner。

### 4.2 Issue repair-context 409

现有 Workspace reload 只刷新 Issue Workspace Context，不能证明按需 repair-context 已刷新。最小修正是在 stale reload 路径中，当当前动作是 `CREATE_REPAIR_TASK` 时同步 `repair.refetch()`；只有两个 canonical context 都成功后才清除 stale。保留输入，不自动 replay。

### 4.3 Resolved outcome fail-closed

对 `RESOLVED` issue 穷尽 `RESTORED` / `RETIRED`。缺少 `resolution_outcome` 时显示明确合同不完整错误，不再把 null/未知值静默解释为 `RETIRED`。不改变后端状态机或合同。

### 4.4 Local deletion only

- 删除无生产消费者的 `publicationCoreActions` 及其只验证死 helper 的测试。
- 将 `mapPublicationStartError` / `mapPublicationError` 收敛为一个 `mapPublicationError`；更新 Start dialog 调用方。
- 不合并 surface-specific 的 primary-task 文案、event 文案、Work/Article/Issue action registry。

## 5. Patterns explicitly retained

### Keep in Publication Domain

- 三个资源、三组 URL、三套 model/action presentation。
- `publication.api.ts` 的 endpoint/query/error owner。
- Article 与 Issue 的 identity fail-closed guards。
- Work Workspace、Article Detail、Issue Workspace 的 domain failure UI。
- status-to-label/tone registries、event mapping、form schemas、409 stale state。
- route/application composition 的 Content projection invalidation callbacks。

### Keep in Design System/shared

- `WorkspaceShell`、`DetailSection`、`Timeline`、`StickyActionBar`。
- `RowActions`、Dialog primitives、Badge primitive、已有 `RouteError`。
- 这些组件已有至少两个真实消费者，props 与 a11y 边界稳定，且没有 Publication 反向依赖。

### Do not promote now

- `ContextValue` / `Metadata`：ReactNode、className、mono、spacing 与布局不同。
- `errorMessage` 一行 helper：没有稳定的跨域错误合同。
- 三个 list route skeleton：schema、query、redirect、TanStack 类型不同。
- Work / Article / Issue status、event、action registry：业务语义不同。
- Domain dialogs：表单、pending、focus return、stale context 与恢复路径不同。

## 6. Test retention design

不删除 component、fixture Playwright 或 real-stack test 文件：

- component tests 证明 projection、payload、RHF、pending、409/no-replay 与 fail-closed 分支；
- fixture Playwright 证明 production artifact、真实 router/history/hash、strict undeclared API、响应式 root overflow、焦点与浏览器 transport；
- real-stack tests 证明真实数据库/对象存储/Content 审核到 Publishing 的跨域生命周期、旧/新 verification lineage 与快照；
- `publication-evidence-upload.test.tsx` 独有 SHA-256 与 signed PUT contract，不能由 fixture 的 method sequence 取代。

仅当 CI runtime 或覆盖报告指出精确重复且删除后仍保留同一 failure mode 时，才重新评估单个断言；文件数量不是触发条件。

## 7. Exact implementation whitelist

批准实施后，当前 Task 只允许修改下列业务代码/测试文件：

1. `frontend-v2/src/domains/publication/publication.api.ts`
2. `frontend-v2/src/domains/publication/publication.api.test.ts`
3. `frontend-v2/src/domains/publication/start-publication-dialog.tsx`
4. `frontend-v2/src/domains/publication/publication-workspace.model.ts`
5. `frontend-v2/src/domains/publication/publication-workspace.model.test.ts`
6. `frontend-v2/src/domains/publication/published-article-detail-page.tsx`
7. `frontend-v2/src/domains/publication/published-article-detail-page.test.tsx`
8. `frontend-v2/src/domains/publication/published-content-issue-workspace-actions.tsx`
9. `frontend-v2/src/domains/publication/published-content-issue-workspace-page.tsx`
10. `frontend-v2/src/domains/publication/published-content-issue-workspace-page.test.tsx`

收尾时可同步 `docs/frontend-v2/07-migration-plan.md` 与本 Task 文档；它们不计入主要代码文件。任何 backend、contract、generated schema、route、Design System、fixture 或 real-stack 文件变化均需停止并重新评估；若主要代码文件超过 10 个，拆分 Task。

## 8. Follow-up boundary

另建 `publication-work-projection-contract-correction` 处理：

- Work name/label/identifier 的 live-first/snapshot 投影规则；
- `GET /publication-works` 运行时 409 未在 OpenAPI 声明；
- 相应 backend integration、contract assertion、生成类型与文档同步。

本 Task 不触碰以上文件，也不把后端缺口包装成前端 fallback。

## 9. Rollback point

实施前记录 `main` 当前 commit 与 clean diff。每个 review unit 独立回滚：

1. Article 409 修正；
2. Issue stale reload + resolved outcome 修正；
3. dead helper / error alias 删除。

若任一 unit 验证失败，只恢复该 unit 的白名单文件到实施前内容；不保留 feature flag、兼容 alias、双实现或 silent fallback。后端/合同 follow-up 与当前 Task 互不作为回滚依赖。
