# Frontend V2 Publication Workspace Core — Design

## 1. Backend 边界

新增一个窄路由：

```text
GET /api/v1/publication-works/{work_id}/workspace-context
200 PublicationWorkspaceContext
401 ErrorEnvelope
403 ErrorEnvelope
404 ErrorEnvelope
409 ErrorEnvelope
422 ErrorEnvelope
```

Router 复用现有 publication GET 的认证边界，并使用仓库既有 repeatable-read dependency。Service 一次解析 work 身份和当前绑定内容，再在同一 snapshot 内读取 events、verifications、attachments 与 account options；不调用其他 HTTP endpoints，也不序列化全局 Platform 对象。

### DTOs

```text
PublicationWorkspaceContent
  id, task_id, version, status, title, summary,
  body_markdown, tags, content_hash

PublicationWorkspacePlatform
  id?, name, website_url?

PublicationWorkspaceAccountOption
  id, label, account_identifier

PublicationWorkspaceVersionCandidate
  id, version, title, summary, content_hash

PublicationWorkspaceContext
  work: PublicationWork
  content: PublicationWorkspaceContent
  platform: PublicationWorkspacePlatform
  eligible_accounts: PublicationWorkspaceAccountOption[]
  switch_candidate: PublicationWorkspaceVersionCandidate?
```

Candidate 现在进入 Context，是因为它属于一致性边界；Core 只渲染后续 handoff 状态，切换交互由 Verification 拥有。现有 Work/List response shape 不变。

### Fixed-query 合同

1. Base work + content task/product + bound content + platform snapshot/live website + legal candidate。
2. Work events。
3. Work verifications。
4. 关联的 verified attachment records。
5. 同一平台的窄 eligible active account options；update preparation 不可用时返回空列表。

Integration test 断言固定查询数和 snapshot identity；history 或 account 数量增长时不允许出现 N+1。

## 2. Frontend 边界

### Route

`frontend-v2/src/routes/_app/publishing/work/$workId.tsx` is thin: UUID param, canonical hash, Context preload, auth/CSRF and projection invalidation callbacks. It renders a route-keyed page so another work ID cannot inherit form state.

### 页面组合

```text
PublicationWorkspacePage
├── PageHeader + StatusTag
├── WorkspaceShell
│   ├── Work context + native section nav
│   ├── Approved Markdown / preparation / result
│   └── instruction / attachment / event / verification timelines
├── StickyActionBar
└── CoreActionDialog
    ├── PreparationForm
    ├── PlatformReviewConfirm
    ├── ResultForm + PublicationEvidenceUpload
    └── CloseForm
```

一个 domain-local action component 可以组合四个小表单；不得创建只转发 props 的单文件 wrappers。`PublicationEvidenceUpload` 单独存在，因为它拥有真实 browser/object-storage 状态机和聚焦测试。

### Query/mutation 规则

- `publicationKeys.workspaceContext(workId)` owns the only first-load query.
- `publicationKeys.package(contentVersionId)` is invoked via `fetchQuery` on click; no route preload.
- Mutation 成功时取消 in-flight Context，只用 canonical response 设置 `work` 成员而不发明其他字段，禁用 stale actions，再失效 Context、work lists、summary 和相关 Content projections。
- 409 时保留 RHF values 和 verified/pending file IDs，显示 request ID，并要求显式 reload；不 replay mutation。
- Cached Context 在后台 refetch error 时继续可用；初始 401/403/404/409 使用 full-page typed failure。

### Evidence 流程

```text
native file input
→ SHA-256 via crypto.subtle
→ POST upload-intents (OPERATION_SCREENSHOT)
→ signed object-storage request via fetch
→ POST files/{id}/complete
→ append verified file id to result form
→ result command binds ids atomically
```

Uploader 复用现有 API contract 和 browser APIs。瞬时 API 失败后支持 complete retry，仅在对象传输明确失败时 abort intent；Attachment download 在点击时请求 signed URL。二进制不经过 FastAPI。

## 3. Error 与 action 行为

- OpenAPI 为 Context、Work GET、Package、preparation、platform review、result 和 close 增加真实 errors。GET 403 覆盖现有 password/account restriction boundary；command 403 还覆盖 account type 与 CSRF。
- Form 422 映射到 fields/ErrorSummary，并保持 Dialog 打开。
- 403 displays the server message; UI visibility is not treated as authorization.
- Platform/account/file not-found 与 domain/evidence conflicts 保持 structured；不使用 default account、zero values 或 guessed URL。
- `primary_task` chooses the one main action; core `available_actions` map to secondary/close actions exhaustively. Status only labels the workspace.

## 4. 文档

- 更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 5.2：删除 Target Section，改用 Platform/Account、approved Markdown、actual result URL、evidence 与 history。
- 在 backend publication workbench spec 中记录 Context/snapshot/fixed-query/account-choice rules。
- 在 frontend state-management spec 中记录 single Context、hash、mutation/409 与 on-demand Package rules。
- `contracts/database.md` needs no edit because no persisted schema/invariant changes are planned; closeout must state this explicitly.

## 5. 已知 handoff

Core 结束时，`AWAITING_VERIFICATION` work 是合法服务端状态，但 V2 尚未实现其 VERIFY command。页面显示 state/history 和简洁的“核验能力由下一子任务交付” handoff，不用 disabled fake button 或 success path 掩盖依赖。Verification 替换此 handoff 前，父任务不得完成。
