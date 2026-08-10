# Frontend V2 Content Review

## Goal

实现 `/content/tasks/$taskId/review` 的完整 Content Review vertical slice。页面围绕 `ContentTask.current_content_version_id` 读取单个一致审核快照，以不可编辑 Markdown 和服务端事实/生成/审核证据支持人工决策，并仅按服务端 `available_actions` 暴露“退回修改”和“批准内容”。

## In Scope

- 新增 task-scoped Content Review Context，使 direct URL、刷新和浏览器历史导航只凭 `taskId` 即可读取当前主线审核快照。
- 一次一致加载当前 `ContentVersion`、canonical diff、quality issues、锁定 `FactVersion` Markdown、冻结 generation/humanization snapshot、累计 review timeline 和 `available_actions`。
- 实现只读 Review Workspace：canonical Markdown、blocking issues、warnings、事实一致性依据、平台适配依据和审核时间线。
- 仅消费服务端 `APPROVE` / `REQUEST_CHANGES` token 渲染底部动作；已批准、已退回、无 token 或其他不可审核状态保持只读。
- 接通既有 approve / request-changes 命令；服务端继续在事务锁内重新校验账号类型、当前主线、状态、事实资格和 `expected_revision`。
- request changes 前端与服务端都拒绝空白意见；mutation 成功后重新读取 canonical Review Context。
- `409` 不自动重放命令，保留退回意见，显示结构化错误与 `request_id`，并重新读取 canonical state。
- 覆盖 fixture Playwright、后端集成测试和两条独立 real-stack 审核流程。
- 同步维护 OpenAPI 和直接受影响的测试/基础设施说明。

## Out of Scope

- Content Version Detail、Content History、Publishing Workspace、Editor 内容修改。
- 修改 `ContentVersion`、generation snapshot 或历史 `ContentReviewRecord`；本任务只读取不可变历史并追加审核记录。
- 根据 `status`、账号类型或其他客户端字段推导 `APPROVE` / `REQUEST_CHANGES` 资格。
- 通过 Task Detail、Editor Context 或多个资源接口在浏览器 waterfall 拼接 Review Context。
- 新建通用 Review framework、workflow engine、跨 domain 业务组件或第二套 Review Context DTO。
- 为 fact consistency / platform adaptation 发明服务端未提供的自动通过结论；页面展示可审核依据与明确的“无快照”状态。
- 新依赖、`frontend/` V1 运行时代码或 UI 行为变更、Git push。随唯一 OpenAPI 合同同步更新 `frontend/src/shared/api/schema.d.ts` 生成文件是已确认的唯一例外。

## Business Invariants

- `ContentTask.current_content_version_id` 是当前内容主线唯一权威；禁止以最大版本号或缓存中的旧版本代替。
- task-scoped read model 必须在一个 PostgreSQL `REPEATABLE READ` 请求中解析当前指针并装配完整快照。
- `ContentVersion`、generation snapshot 和保留中的 `ContentReviewRecord` 不可原地修改。
- 客户端动作只来自 canonical Review Context 的 `available_actions`；命令端仍独立执行最终授权与状态校验。
- request changes 意见 trim 后必须非空。
- mutation 成功或发生 canonical conflict 后都重新读取上下文；失败命令从不自动重放。
- 未知或不完整追溯事实必须显式失败，不猜测、补零或使用兼容 fallback。

## Acceptance Criteria

- [x] direct URL、refresh、Back、Forward 均能只凭 `taskId` 恢复同一 canonical Review Workspace。
- [x] 浏览器对首屏 Review Context 只发起一个 task-scoped read-model 请求，不请求 Task Detail、Editor Context、FactVersion、ContentVersion、GenerationJob 或 Review 列表自行 join。
- [x] 主区域展示不可编辑 canonical Markdown；Review Panel 展示 canonical diff、blocking issues、warnings、事实 Markdown、平台/生成依据和累计 review timeline。
- [x] `REVIEW_PENDING` 且服务端返回动作 token 时显示对应动作；`APPROVED`、`CHANGES_REQUESTED`、无权限/tokenless 以及其他不可审核状态只读。
- [x] APPROVE 使用当前 `content.id` 和 `content.revision`，携带 CSRF；服务端成功后页面重新读取并显示 APPROVED canonical state。
- [x] REQUEST_CHANGES 在客户端和服务端拒绝空白意见；成功后重新读取并显示 CHANGES_REQUESTED canonical state。
- [x] 403、CSRF、字段校验、`expected_revision`、409 与其他结构化错误显示明确反馈；有 `request_id` 时可见。
- [x] 409 保留 Dialog 中的用户意见、刷新 canonical context、不给命令自动重放机会。
- [x] loading、error、retry、缓存陈旧提示和恢复路径可访问且不会渲染伪成功状态。
- [x] 375 / 768 / 1024 / 1440 宽度无关键内容或动作遮挡；窄屏沿用 WorkspaceShell tab 模式。
- [x] 键盘可完成审核流程；Dialog 关闭后焦点回到触发按钮；无非预期 `console.error`、`pageerror`、`requestfailed`。
- [x] 独立 real-stack approve 与 request-changes 流程通过真实 API、PostgreSQL、CSRF、权限、revision 和 canonical refetch。
- [x] 相关 backend、frontend-v2、contract 与 focused Playwright 校验通过。

## Notes

- 用户已确认最终规划与仅同步 `frontend/src/shared/api/schema.d.ts` 生成文件的例外；不得修改其他 V1 源码或 UI。
- 规划确认后，从最新且干净的 `main` 创建 `codex/frontend-v2-content-review`。
- 提交前展示 commit plan 并等待确认；不 push。
