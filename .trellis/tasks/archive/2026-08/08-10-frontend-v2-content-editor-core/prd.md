# Frontend V2 Content Editor Core

## 目标

交付 `/content/tasks/$taskId/editor` 的同步人工编辑 Workspace：用一次一致的 Editor Context 读取当前主线，支持人工首稿、人工 revision、当前 HUMAN DRAFT 保存、预览/服务端 Diff、提交审核和服务端允许的 delete/abandon。

## 范围内需求

### Editor Context

- 新增 Task 级 Editor Context，一次返回 task/product/platform/locked fact/current content/comparison/diff/quality/latest generation compact/current lineage/source。
- `current_content` 只能通过 `current_content_version_id` 加载；无 pointer 返回 `null`，无效 pointer 显式失败。
- comparison 由服务端选择：优先 `based_on_id`，否则同任务前一版本；无基线返回 `null`。
- 固定查询次数，不随版本或作业历史增长产生 N+1。
- 不包含 Review/Publication context、全部版本历史、全部作业历史或完整 generation snapshot。

### 可编辑边界

- 无 current 且有 `CREATE_MANUAL_VERSION` 时可创建人工首稿。
- 当前 HUMAN DRAFT 只有服务端返回 `SAVE` 时可原地保存，并携带 `expected_revision`。
- AI DRAFT、已提交审核、已批准、已发布和 `CHANGES_REQUESTED` 版本保持不可变。
- 对 AI DRAFT、`CHANGES_REQUESTED` 或服务端允许修订的当前版本，只能 POST 新 HUMAN DRAFT revision，并由服务端设置 `based_on_id` 和 pointer。
- 历史版本永不成为 Editor 可编辑目标。

### Workspace

- 复用 `WorkspaceShell`、`WorkspacePane`、`WorkspaceTabs`、`StickyActionBar`、`MarkdownEditor`、`MarkdownPreview`、Form Kit、DirtyGuard、StatusBadge。
- 左侧 Context、中间 Document、右侧 Reference；支持 1440/1024/768/375。
- Document 字段：title、summary、body_markdown、tags；人工首稿/revision 额外要求 change_summary。
- tags 使用每行一个标签，trim 并丢弃空行；逗号不作为分隔符；字段错误关联输入。
- Edit/Split/Preview 使用当前 form Markdown；Diff 只显示服务端 canonical diff，不修改 form/dirty。

### Mutation

- Manual：POST `/content-tasks/{taskId}/manual-versions`，失败保留输入，成功 refetch canonical context/detail/list。
- Revision：POST `/content-versions/{versionId}/revisions`，提交完整 `ContentRevisionCreate`，源版本不变。
- Save：PUT `/content-versions/{versionId}`，只发送 `ContentDraftUpdate`；409 保留输入并仅允许显式 reload。
- Submit：dirty 时要求先保存；使用 canonical revision 和 `CommandRequest`；成功后留在只读 REVIEW_PENDING 或返回 Task Detail。
- Delete/Abandon：只按各自 token 显示；成功后 pointer 只以服务端 context 为准。
- Ctrl/Cmd+S 仅在 SAVE 可用且 dirty 时触发。

### Action surface

- 消费 task/version 的 typed `primary_task` 和 `available_actions`，不按 status 推断资格。
- Editor 只处理人工编辑 surface；不实现 APPROVE、REQUEST_CHANGES、publication actions。

## 范围外

- AI generation 创建、generation-options、轮询、failure/retry、humanization。
- Content Review、Content Version Detail、Publication Workspace、Content History。
- 通用 Editor/workflow framework、新状态库、新依赖和无关 Task Detail 重构。

## 验收标准

- [x] 单一 Editor Context 能绘制 no-current、HUMAN DRAFT、AI DRAFT、CHANGES_REQUESTED、REVIEW_PENDING 和 APPROVED readonly 状态。
- [x] higher version/created_at 不能覆盖 `current_content_version_id` 指针。
- [x] 人工首稿不创建 GenerationJob；revision 新建 HUMAN DRAFT 并保持源不可变。
- [x] Save payload 不包含 change_summary；manual/revision payload 必须包含 change_summary。
- [x] stale revision 保留本地输入、显示 request ID、不自动覆盖。
- [x] Preview/Split/Diff、quality/reference、DirtyGuard 和响应式/键盘行为通过组件及 fixture 测试。
- [x] Human real-stack 独立完成 `创建任务 -> Editor -> manual -> save -> submit`。
- [x] 未实现 AI/Humanization、Review approval/request-changes 或通用框架，V1 Content Editor 定向回归通过。
