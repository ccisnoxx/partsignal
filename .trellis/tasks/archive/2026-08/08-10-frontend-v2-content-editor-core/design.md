# 设计：Frontend V2 Content Editor Core

## 公共合同

新增 `GET /api/v1/content-tasks/{content_task_id}/editor-context`，返回：

```text
ContentEditorContext
├── task: id/identifier/status/workflow_stage/primary_task/available_actions/revision/timestamps
├── product: compact identity
├── platform: compact identity | null
├── locked_fact_version: id/version/status/classification/body_markdown
├── current_content: ContentVersion | null
├── comparison_content: compact ContentVersion | null
├── diff: ContentDiff | null
├── latest_generation: existing ContentTaskDetailGeneration | null
├── current_lineage: existing compact ContentAiLineage | null
└── source: existing ContentTaskDetailSource | null
```

读取使用同一 REPEATABLE READ snapshot。current pointer 缺失返回 no-content；pointer 指向不存在或其他任务版本时返回显式错误，不回退到最新版本。共享 lineage resolver 批量预取版本和作业，保持既有输出。

## 状态矩阵

| current | 文档模式 | 生产动作 |
| --- | --- | --- |
| null + CREATE_MANUAL_VERSION | 空白人工首稿 | CREATE_MANUAL_VERSION |
| HUMAN DRAFT + SAVE | 原地编辑 | SAVE、SUBMIT_REVIEW、DELETE，以 token 为准 |
| AI DRAFT | 只读源；显式进入 revision form | CREATE_REVISION、SUBMIT_REVIEW、ABANDON |
| CHANGES_REQUESTED | 只读源；默认 revision form | CREATE_REVISION、ABANDON |
| PENDING_REVIEW/APPROVED/后续状态 | 只读 | 只显示仍属于编辑 surface 的 token |

`APPROVE`、`REQUEST_CHANGES` 和 publication token 即使存在也不进入 Editor action bar。

## 前端结构

```text
route
└── ContentEditorPage
    ├── EditorHeader
    ├── FormProvider
    │   └── WorkspaceShell
    │       ├── ContextPanel
    │       ├── ContentDocumentForm
    │       └── ReferencePanel
    ├── StickyActionBar
    ├── DirtyGuard
    └── submit/delete/abandon dialogs
```

Route 只负责 loader/prefetch 和 composition。TanStack Query 持有 context；RHF 持有文档；React local state 持有 tab/mode/dialog。仅给现有 `MarkdownEditor` 增加被真实页面需要的 Split mode；Diff 留在 content domain。

## Payload 与 mutation

- Manual/revision：从同一 RHF 值构造 `ContentRevisionCreate`，包含 change_summary。
- Save：从同一 RHF 值构造 `ContentDraftUpdate`，包含 expected_revision，不含 change_summary。
- 成功响应用于 reset form baseline；需要 pointer/diff/action 变化的 mutation 随后 refetch Editor Context。
- 409 不 reset form；显式 reload 才采用服务端值。
- 不在页面拼 query key，不把 canonical ContentVersion 写入错误的 context shape。

## 响应式与离开保护

- 1440 三栏；1024 主编辑区优先并折叠 Reference；768 Workspace tabs；375 单栏且 StickyActionBar 不遮挡正文。
- DirtyGuard 只拦截真实离开、Back/Forward、refresh/close；tab 和 mode 切换不触发。

## 兼容与回滚

- OpenAPI 为 additive endpoint；既有 V1 endpoints 和 response 保持不变。
- 无数据库迁移、无新依赖。
- 合同、backend、generated types、domain、route 分阶段落地，每阶段 targeted test 通过后进入下一阶段。
