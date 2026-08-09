# Frontend V2 Phase 2.6 — Fact Review

## Goal

实现 `/products/$productId/facts/review` 事实审核工作台：浏览器通过一次产品级请求获得唯一审核目标及不可变上下文，并只执行服务端授权的 `APPROVE` / `REQUEST_CHANGES`。

## Requirements

- 新增产品级 Fact Review read-model endpoint；浏览器不得通过 Product Detail、Facts、Versions 或精确版本 context 拼接、猜测审核目标。
- 产品存在但没有事实版本时返回可渲染的 empty context；有 `PENDING_REVIEW` 时选中唯一待审核版本，否则选中该产品最新 FactVersion。
- 展示只读 Markdown snapshot、classification、version、status、change summary、revision、服务端 diff 与目标 FactVersion 自身的追加式 Review History。
- Diff 基线为同产品中版本号紧邻目标版本之前的 FactVersion；首版本没有 diff。Diff 仅是服务端派生 read model，不持久化。
- 页面动作完全由服务端 `available_actions` 驱动，不根据 status 推导；本页面只接受 `APPROVE` 和 `REQUEST_CHANGES`。
- `REQUEST_CHANGES` 意见必须非空；客户端提供即时反馈，服务端继续最终校验。
- 两个命令都携带 CSRF 与 `expected_revision`；成功消费 canonical FactVersion 并刷新产品级 context，409 不自动重试。
- 覆盖 loading、empty、404、403、409、通用错误和刷新失败；审核后留在当前 route，不跳转到未实现页面。
- 复用现有 `WorkspaceShell`、`WorkspacePane`、`MarkdownPreview`、`Timeline`、`StickyActionBar`、`FormField`、`Dialog` 和 feedback primitives。
- 满足键盘、焦点恢复、Dialog、语义标签、错误关联、aria-live，以及 375/768/1024/1440 响应式无页面横向溢出。
- 合同、后端集成、Frontend V2 单元/组件和 Playwright 均提供针对性覆盖。

## Authoritative Model Decisions

- Markdown 是事实正文唯一来源；不得恢复 Evidence URL、Evidence 表或第二套事实来源。
- 当前事实模型没有 Blocking Issues；不实现固定成功、空壳或页面本地质量规则，并修正文档冲突。
- 当前业务要求需要 Diff；由 review service/projection 基于不可变 FactVersion 生成，不创建前端 diff 引擎。
- 审核历史严格按目标 `fact_version_id` 过滤，不混入兄弟版本。
- 不改变既有 V1 exact-version review endpoint 的用途；必要的合同字段同步保持其类型可用。

## Out of Scope

- Fact History、Fact Version readonly Detail、New Content Task、Content Review。
- Fact 编辑、重新提交、`RETIRE`、`DELETE` 或审核完成后的新导航。
- 通用 `ReviewWorkspace`、review plugin、配置驱动审核框架或 Content Review 抽象。
- 数据库迁移、新依赖、Evidence、Blocking Issues、客户端状态机或 V1 架构复制。

## Acceptance Criteria

- [x] `GET /api/v1/products/{product_id}/fact-review-context` 在一致读事务内返回产品上下文和 `review | null`，并按已确认规则稳定定位目标 FactVersion。
- [x] OpenAPI、runtime schema、后端实现和 V1/V2 generated clients 一致；review GET/commands 声明实际的 401/403/404/409/422 errors。
- [x] 页面首次渲染只请求产品级 review context；直接导航和刷新均可独立工作。
- [x] Markdown 使用不可编辑、安全的 `MarkdownPreview` 展示，不存在 CodeMirror、textbox、contenteditable 或第二事实源。
- [x] metadata、服务端 diff、精确版本 history 与 `available_actions` 正确渲染；空 actions 不出现审核按钮。
- [x] Approve 与 Request Changes 发送 CSRF、目标 FactVersion ID 和 `expected_revision`，成功后显示 canonical 结果并刷新 context。
- [x] 空白退回意见不会发送请求；服务端仍拒绝空白意见。
- [x] 409 展示 request ID、禁用陈旧动作并刷新 canonical context，不自动重放命令。
- [x] loading、empty、404、403、通用错误、retry 与成功后刷新失败均有不造假的可恢复状态。
- [x] 375/768/1024/1440 无页面横向溢出；键盘、Dialog 焦点、Esc 和焦点恢复通过测试。
- [x] Playwright 审计 console、pageerror、requestfailed 与 unexpected API，并覆盖本任务要求的关键路径。
- [x] 必要验证和 `trellis-check` 通过；diff 自审未发现越界实现或无关改动。

## Notes

- 本 Task 是独立 vertical slice，合同顺序固定为 OpenAPI → backend → generated client → frontend。
- 临时分支 `codex/frontend-v2-fact-review`；提交、归档、合并、删分支前单独请求用户确认，不自动 push。
