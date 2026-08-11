# Frontend V2 Publication Workspace — Design

## 1. 审计结论

### 1.1 Contract/read-model 缺口

| Surface need | Current authority | Verified gap | Decision | Owner |
| --- | --- | --- | --- | --- |
| Work/status/actions/result/history | `GET /api/v1/publication-works/{id}` | Work、events、verifications、attachments 由多条 SQL 读取，publication router 未使用 `REPEATABLE READ`；无正文、平台上下文、账号选项或换版候选 | 新增 task-scoped Workspace Context；旧 Work GET 保留给现有消费者 | Core |
| Approved Markdown | `GET /content-versions/{id}/publication-package` | Package 是 derived/copy surface，点击前不应请求；Work 只有 title/version/hash | Context 返回绑定版本的 Markdown 最小快照；Package 仍按点击请求 | Core |
| Publishing Instruction | 无数据库/OpenAPI 字段；V1 只是固定四步提示 | 无可持久化事实来源 | 作为页面静态操作说明；不新增 API 字段 | Core |
| Platform context | Work 只有 profile id/name snapshot | 缺 website；客户端若请求全局 Platform 会形成 join | Context 返回最小 platform snapshot；不暴露全局配置对象 | Core |
| Preparation account choices | `GET /platform-accounts` | V1 全量读取后按 platform/active 过滤，违反服务端选择边界 | Context 只返回该平台当前合法 active account options | Core |
| Evidence upload/download | 文件 API 已存在 | V2 尚无上传 UI；Work attachments 只能展示记录，下载 URL 需按需获取 | 复用 upload-intent → 原生对象存储 PUT/POST → complete；下载按点击请求 signed URL | Core |
| Legal content switch | 命令最终校验 task current pointer、APPROVED fact/content、different version | 没有 read endpoint 暴露合法候选；V1 读取全部版本后过滤 | Context 返回零或一个服务端验证的 `switch_candidate`；不请求版本历史 | Verification |
| Endpoint errors | 多个 GET/command 在 OpenAPI 只声明 200/422 或 200/409 | 与实际 auth、permission、not-found、revision/state 错误不一致 | 按真实 guard 补 401/403/404/409/422；不声明不可能状态 | Respective child |
| Target Section | 旧蓝图 5.2、旧设计部分文字 | migration `0036`、ORM、database contract、OpenAPI 均确认字段已删除 | 修改 V2 蓝图，删除字段与 UI 要求，不恢复数据库/API/placeholder | Core |

### 1.2 为什么需要专用 Context

工作台的身份是 `workId`，且首屏必须同时解释当前绑定内容、当前命令、证据和历史。复用旧 Work GET 后再调用全局 Content/Platform/Account/Version 接口会产生浏览器 join、全局列表过滤和跨请求时点不一致；扩张 `PublicationWork` 又会让所有命令响应与 V1 Detail 被迫承载工作台专属数据。因此新增窄的 task-scoped Context 是最小稳定边界。

现有 Work response 的精确可用性如下：

- Product：已有 `id/brand/part_number` 紧凑身份，足够工作台展示，不需要完整 Product Detail。
- Content：已有绑定 ID/title/version/hash，但缺少批准 Markdown、summary 和 tags。
- Platform/Account：已有 ID 与不可变显示 snapshot，足够历史展示；缺少 website 和当前可选择账号集合。
- Instruction：数据库、Schema 与 OpenAPI 均不存在；只有 V1 固定流程文案。
- Evidence/Timeline：已有 attachments/events/verifications 数组，但当前 GET 以多个默认隔离级别 SQL 读取，不能证明同一 snapshot。

```text
GET /api/v1/publication-works/{work_id}/workspace-context
query key: ["publication", "workspace-context", workId]
transaction: REPEATABLE READ
```

### 1.3 建议 DTO

```text
PublicationWorkspaceContext
├── work: PublicationWork
├── content: PublicationWorkspaceContent
│   ├── id / task_id / version / status
│   ├── title / summary / body_markdown / tags / content_hash
├── platform: PublicationWorkspacePlatform
│   ├── id? / name / website_url?
├── eligible_accounts: PublicationWorkspaceAccountOption[]
│   ├── id / label / account_identifier
└── switch_candidate: PublicationWorkspaceVersionCandidate?
    ├── id / version / title / summary / content_hash
```

- `work.events/verifications/attachments` 继续复用既有 canonical schema，避免第二套历史类型。
- `eligible_accounts` 是工作台专用窄 option，只包含与 work 平台匹配且当前 active 的账号；当 preparation action 不适用时返回空列表，不携带账号管理动作或删除投影。
- `switch_candidate` 只在 task current pointer 指向另一个可合法切换的批准版本时返回；候选最多一个，不返回全部版本历史。
- `platform.id` 允许为空以支持配置已删除但历史 work 仍保留名称 snapshot；不猜 website。
- Context 不含 Publication Package 的 `body_html/body_text`，也不含 instruction、Target Section 或未消费配置。
- 查询保持固定数量：一个 base identity/content/platform/candidate query，加 events、verifications、attachments、eligible accounts 四个有界查询；全部位于同一只读 `REPEATABLE READ` 请求。

### 1.4 错误矩阵

| Boundary | 401 | 403 | 404 | 409 | 422 |
| --- | --- | --- | --- | --- | --- |
| Workspace Context / Work GET | session | password/account restriction | work missing | broken lineage/context | invalid UUID/path |
| Publication Package | session | password/account restriction | content missing | not currently publishable | invalid UUID/path |
| preparation/platform-review/result/close | session | account type | work/account/file missing | revision/state/domain/evidence conflict | body/path validation |
| verification/switch-version | session | account type | work/version missing | revision/state/current pointer/eligibility conflict | body/path validation |

OpenAPI 只登记实际可发生的结构化错误；前端继续通过统一 `ErrorEnvelope` 展示 message 与 `request_id`。

## 2. 状态与交互设计

### 2.1 Canonical URL 与章节

Canonical route 为 `/publishing/work/$workId#<section>`；缺失或未知 hash 在 Context 请求前 replace 为 `#summary`。批准的 hash 如下：

```text
summary | preparation | result | verification | content-version | close
```

这些值保留现有 Publication Work List handoff。章节链接使用原生锚点，当前链接使用 `aria-current="location"`。Hash 仅是视图状态，业务状态和草稿不进入 URL。

当前 `DirtyGuard` 只比较 `pathname`，同路由 hash 导航可能丢弃表单。Core 将共享 guard 改为比较完整目标 URL（path/search/hash）并增加一个聚焦回归测试，不增加页面局部 blocker。

### 2.2 组件层级

```text
$workId route (parse params/hash, preload one Context)
└── PublicationWorkspacePage
    ├── PageHeader (breadcrumb, work identity, StatusTag)
    ├── WorkspaceShell
    │   ├── context
    │   │   ├── WorkContextPanel (product, platform, account, stage, revision)
    │   │   └── PublicationSectionNav (native anchors)
    │   ├── main
    │   │   ├── ApprovedContentSection + MarkdownPreview
    │   │   ├── PreparationSection
    │   │   ├── ResultEvidenceSection
    │   │   └── VerificationSection
    │   └── reference
    │       ├── PublishingInstruction (fixed procedural copy)
    │       ├── AttachmentList
    │       ├── EventTimeline
    │       └── VerificationTimeline
    ├── StickyActionBar (server primary/available action mapping)
    └── action Dialogs/Forms
        ├── preparation / platform review / result / close
        └── verification / switch version
```

这里只组合现有 primitives，不创建通用 workspace framework。移动端复用 `WorkspaceShell` 的 panel 行为，主操作保持可达，不产生页面级横向滚动。

### 2.3 Action mapping

- `primary_task` chooses the single high-frequency action; `available_actions` controls secondary/overflow commands.
- UI 不从 `status` 推导 commands。Status 只用于展示，并在测试中用于证明 server projection 一致。
- `SWITCH_CONTENT_VERSION` is shown only when the token exists; it is enabled only when the same server Context provides a `switch_candidate`. Candidate absence is displayed as a server-projected no-option state, not replaced by a browser version lookup.
- Package copy 是 read action，仅在点击后请求现有 Package endpoint，不变成 business mutation。
- Terminal `COMPLETED`/`CLOSED` Context 完全只读。`COMPLETED` 只显示 canonical PublishedArticle identity/handoff；article route 实现不在范围内。

### 2.4 表单、上传与冲突行为

- RHF 拥有 draft fields 与已选择的 verified file IDs；TanStack Query 拥有 Context。
- Result evidence 接受现有 `OPERATION_SCREENSHOT` contract（PNG/JPEG/WebP，服务端限制 10 MB）。Domain-local uploader 使用原生 `<input type="file">`、`crypto.subtle.digest`、`fetch` 到 signed target，再调用现有 complete endpoint；不增加 dependency 或 generic uploader。
- 对象传输失败时，在安全条件下 abort intent；complete 瞬时失败时保留 pending file ID 并提供 retry。取消 Dialog 可能留下 detached verified file，交由现有 retention cleanup；不发明不受支持的 delete call。
- Command 成功后先采用 canonical `PublicationWork` response 防止 stale actions，再失效 Context 与相关 list/summary/content projections。Command response 不伪造完整 Context。
- `409` cancels no user input and replays nothing. It keeps draft/file selections and request ID, marks actions stale, and requires explicit “load latest context”.
- 初始 Context failure 替换页面；已有 cached data 时，后台 refetch failure 保持 workspace 可见并提供 retry。

### 2.5 Cache 所有权

```text
publicationKeys.workspaceContext(workId)
publicationKeys.package(contentVersionId)       # fetched on click only
publicationKeys.workLists()
publicationKeys.summary()
contentKeys.detail/editorContext/reviewContext(taskId)
contentKeys.lists()
```

Core 命令失效 workspace Context、publication work lists/summary 和受影响的 Content projections。Verification 成功且服务端完成 ContentTask、创建 PublishedArticle 后，再失效同一组 projections。不增加 global store、event bus、轮询或临时 query key。

## 3. 任务拆分与依赖

```text
Parent: shared contract, sequence, final gate
├── Core: Context + route/shell + preparation/review/result/evidence/close
└── Verification (depends on Core): verify/fail/switch/reverify/complete
```

拆分依据是独立的 workflow endpoints 与独立 real-stack 验收。Core 明确停在服务端投影的 `AWAITING_VERIFICATION` handoff，不伪造或部分实现核验；Core 验收后由 Verification 在同一路由完成闭环。

审计后的合并范围超过约 20 个主要文件：Core 预计涉及 contract/backend/generated types、route/domain/UI/tests/E2E/docs 共约 22 个文件，Verification 再修改约 10 个已建立边界的文件。两个子任务分别拥有 Flow A 与 Flow B、独立回滚点和明确依赖，因此推荐“父任务 + 两个子任务”，而不是单任务。

## 4. 文档所有权

- `contracts/openapi.yaml`: endpoint/DTO/error authority.
- `contracts/database.md`: only update if implementation changes a persisted invariant; no schema migration is planned.
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`：删除 Target Section，并描述实际实现的 workbench surfaces。
- `.trellis/spec/backend/publication-workbench-guidelines.md`：在合同被证明后记录 Context/snapshot/query/action boundary。
- `.trellis/spec/frontend/state-management.md`：在合同被证明后记录 route hash/Context/cache/conflict boundary。

不在其他位置重复维护这些设计事实。

## 5. 风险与控制

| Risk | Control |
| --- | --- |
| Context becomes a generic aggregate | Keep it workId-scoped and return only rendered/action data; no generic builder or framework |
| Multiple SQL queries produce mixed history | One `REPEATABLE READ` request and fixed-query integration assertion |
| Client recreates account/version eligibility | Server returns eligible accounts and exact switch candidate; command revalidates under lock |
| Hash navigation bypasses dirty guard | Fix shared full-URL comparison with targeted test |
| Object upload creates orphan records | Reuse existing abort/retry/retention behavior; never invent fixed-success cleanup |
| Child 1 leaves verification unfinished | Treat `AWAITING_VERIFICATION` as explicit dependency handoff; do not call parent complete until Child 2 passes |
| Existing V1/list behavior regresses | Preserve old Work/List endpoints and schemas; generated V1 types and targeted publication integration remain in gates |
| Scope expands into article/GEO | Only show canonical handoff; route implementation and GEO remain explicit out-of-scope |

## 6. 回滚点

- 不计划 database migration。Context 是 additive GET boundary，因此 Core 可在无需数据修复的情况下回滚，现有 Work/List 与 V1 保持完整。
- 共享 DirtyGuard 变更有独立测试；若它回归无关 route，可单独 revert。
- Verification 是 Core 之后的依赖临时 branch/commit；它可以回滚，而已验收 Core route 仍能如实停在 `AWAITING_VERIFICATION`。
- 每个子任务只在自身 diff/validation 与用户批准 commit plan 后提交。临时分支仅在批准后 merge 到 `main`，随后删除；不自动 push。
