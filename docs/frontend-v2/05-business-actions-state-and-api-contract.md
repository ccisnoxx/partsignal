# PartSignal V2 业务动作、状态与 API Contract

## 1. 核心原则

PartSignal 领域状态复杂，V2 前端不能再从 status、role、分页数据或页面作者自己的判断重新构造“用户现在能做什么”。

业务文档已经确定：有业务推进含义的资源由服务端返回 typed `workflow_stage` 和唯一 `primary_task`；前端只负责显示映射。`available_actions` 表达可尝试的具体命令，写入入口服务端继续重新校验。

## 2. 三个概念

### `workflow_stage`

回答：“这个对象现在处于用户可理解的哪个业务阶段？”不是数据库所有状态字段的简单拼接。

### `primary_task`

回答：“对当前用户来说，这个对象最应该做的下一件事是什么？”每个业务对象只允许 0 或 1 个。

### `available_actions`

回答：“当前可以尝试哪些具体命令？”适合 overflow、workspace secondary actions、管理员低频命令。Mutation 时服务端必须重新校验。

## 3. 前端 Action Registry

禁止：

```ts
if (status === "PENDING_REVIEW" && role === "ADMIN") {
  // infer action
}
```

建立 `domains/<domain>/actions/`：

```ts
interface ResolvedBusinessAction {
  key: string
  label: string
  intent: "primary" | "secondary" | "danger"
  presentation: "row" | "overflow" | "toolbar"
  href?: string
  command?: string
  disabledReason?: string
  confirmation?: {
    title: string
    description: string
  }
}
```

## 4. 映射职责

服务端：

```json
{
  "workflow_stage": "PENDING_REVIEW",
  "primary_task": "REVIEW_CONTENT",
  "available_actions": ["REVIEW_CONTENT", "ABANDON_DRAFT"]
}
```

Domain Registry：

```ts
const actionRegistry = {
  REVIEW_CONTENT: {
    label: "审核",
    intent: "primary",
    href: ({ id }) => `/content/tasks/${id}/review`,
  },
  ABANDON_DRAFT: {
    label: "放弃草稿",
    intent: "danger",
    command: "abandonDraft",
  },
}
```

Design System：`<RowActions actions={resolvedActions} />`。

三层职责不能混。

## 5. Action Presentation

Primary 来源 `primary_task`，显示在 Table row、Workspace StickyActionBar、Workbench Inbox。Overflow 来源 `available_actions - primary_task`。

新建产品/创建任务/新建观测属于 page-level create action，不属于 existing row 的 `primary_task`。

## 6. Product Action 示例

可能 token：`ENTER_FACTS`、`REVIEW_FACT`、`REVISE_FACT`、`CREATE_CONTENT_TASK`。

事实历史查看不是 row primary action，应该通过对象详情/历史 section 访问。

## 7. Content Action 示例

可能 token：`CREATE_DRAFT`、`GENERATE_CONTENT`、`EDIT_CONTENT`、`REVIEW_CONTENT`、`REVISE_CONTENT`、`START_PUBLICATION`、`VIEW_RESULT`。

UI 不再从 task/generation/content/publication 多个 status 自己组合业务阶段。

## 8. Publication Action 示例

可能包括：`START_PUBLICATION`、`COPY_PUBLICATION_PACKAGE`、`REGISTER_RESULT`、`VERIFY_PUBLICATION`、`REVERIFY_PUBLICATION`、`SWITCH_APPROVED_VERSION`、`CLOSE_PUBLICATION_WORK`。

`PublicationWork` 阶段以服务端契约为准，例如 PREPARING / PLATFORM_REVIEW / AWAITING_VERIFICATION / ACTION_REQUIRED / COMPLETED / CLOSED。

## 9. Published Content Issue

`CREATE_REPAIR_TASK`、`RESOLVE_ISSUE` 是独立动作。修复任务创建成功不等于 issue 已解决，前端不能本地自动推导 resolved。

## 10. Content Version 单主线

业务规则：`ContentTask.current_content_version_id` 是当前内容主线权威指针。AI 草稿、旧版本、被退回版本、已审核版本按领域规则保持只读；当前未审核人工 DRAFT 在允许窗口内可按 revision 保存；被退回版本创建新修订。

因此主编辑 URL 是 `/content/tasks/:taskId/editor`，历史版本 `/content/versions/:versionId` 只读。

## 11. Optimistic Concurrency

核心可变资源使用 revision / expected_revision。冲突 UI：

```text
该对象在你编辑期间已经发生变化。
[查看最新版本] [重新加载]
```

禁止静默覆盖。

## 12. Mutation 规范

Mutation wrapper 不直接操作页面 UI；toast/dialog 由调用层决定；cache invalidation 最小化；服务端返回 canonical object 时优先写回 cache。

## 13. UI-oriented Read Model

不要把数据库模型原样暴露给列表。

### ProductListItem

至少包含 id/model/brand/category/workflow_stage/primary_task/fact summary/updated_at。

### ContentTaskListItem

至少包含 id/identifier/product/platform/workflow_stage/primary_task/current content summary/updated_at。

### PublicationWorkListItem

至少包含 content/product/platform/account/workflow_stage/primary_task/latest event/updated_at。

### GeoObservationListItem

直接返回 compact result facts、关联成果数量、证据摘要和 recorder，不让客户端再抓多个 detail。

## 14. Workspace Read Model

复杂 Workspace 应有专用 endpoint/context，例如 `GET /content/tasks/{id}/review-context` 一次返回：task、current immutable version、diff、fact snapshot、generation snapshot、quality issues、review history、primary_task、available_actions。

这样避免 6–10 个 API waterfall 和 snapshot 不一致。

## 15. Workbench Aggregate

首页应有专用 aggregate read model，返回 fact_reviews/content_reviews/publication_verifications/publication_actions/content_issues/geo_accuracy_issues，以及 workflow health、geo summary、recent attention items。

不要在浏览器通过多个分页 list endpoint 计算 dashboard。

## 16. Status Registry

状态 token → label/tone/icon/help text。Status Registry 只负责显示，不负责动作资格。

## 17. Error Contract

推荐稳定错误结构至少表达：`code`、`message`、`request_id`、`field_errors`、`details`。

前端基于 `code` 做 UX，禁止解析任意英文 message 判断业务。

## 18. 权限

服务端负责最终授权和 action eligibility；前端根据 capability 改善体验、隐藏不相关入口，但不把隐藏 UI 当权限边界。

## 19. Contract-First 流程

```text
Domain design
  ↓
OpenAPI / database contract
  ↓
Backend & Frontend parallel
  ↓
openapi-typescript
  ↓
Typecheck
```

V2 不手写与 OpenAPI 重复的 API DTO 类型；允许独立 form schema、UI view model 和 resolved action type。

## 20. 验收检查

每个有业务推进的 list endpoint：

- [ ] `workflow_stage`
- [ ] `primary_task`
- [ ] `available_actions`（若列表需要）
- [ ] 不需要客户端拼多个 endpoint 才能画一行

每个 mutation：

- [ ] 服务端重新校验 action
- [ ] revision/expected_revision（若需要）
- [ ] stable error code
- [ ] audit
- [ ] canonical response

参考业务设计：
https://github.com/ccisnoxx/partsignal/blob/main/docs/GEO%E5%A4%9A%E5%B9%B3%E5%8F%B0%E5%86%85%E5%AE%B9%E8%BF%90%E8%90%A5%E7%B3%BB%E7%BB%9F%E6%96%B9%E6%A1%88%E8%AE%BE%E8%AE%A1.md
