# Frontend V2 Phase 2.5 — Fact Workspace Design

## 边界与最小设计

- 扩展现有 `GET/PUT /api/v1/products/{product_id}/facts` 的 `ProductFactsDraft`，不新增 endpoint 或第二套 read model。
- 新增紧凑 `ProductFactsProductContext`：`id`、`part_number`、`brand`、`category`、`status`、`workflow_stage`。
- `ProductFactsDraft` 增加 required `product`、`approved_fact`、`pending_fact`；摘要复用 `ProductFactSummary`。
- GET 在 `REPEATABLE READ` 内投影完整工作台。Products list 与 Workspace 共用一个小型 workflow-stage 纯函数，不创建通用 projection framework。
- RETIRED 动作投影为空；保存服务增加同一最终门禁。ACTIVE 始终可保存，正文非空且无 pending 时可提交。
- `change_summary` 拒绝空白字符串但保留合法原文。无数据库迁移。

## 数据流

1. route loader 和 Page 共用 Facts query option，浏览器只请求一个 read model。
2. response 初始化 React Hook Form 的 Markdown/classification；Product Context、revision、版本摘要和 actions 保留为 server state。
3. PUT 发送当前表单和 `expected_revision`；成功后用 canonical response 更新 cache 并 reset 表单。
4. POST 仅在表单 clean 且服务端提供 `SUBMIT_REVIEW` 时开放；返回 FactVersion 后展示成功，再 refetch Facts read model。
5. 背景 refetch 只更新上下文与动作；dirty 表单不 reset。409 conflict 保留本地值，显式 reload 才替换。

## 前端结构

```text
FactWorkspaceRoute
└── FactWorkspacePage
    ├── Header / Product status / workflow stage
    ├── WorkspaceShell
    │   ├── Product Context pane
    │   ├── Markdown + Form Kit pane
    │   └── Classification / snapshot / revision pane
    ├── StickyActionBar
    ├── SubmitReviewDialog
    └── DirtyGuard
```

- 新 route 使用 TanStack Router non-nested 文件名 `$productId_.facts.tsx`，避免把现有 Product Detail 改为 layout。
- `<1280px` 复用 WorkspaceTabs 的 Main-first 模式；1440 使用三栏。375 下 action bar 纵向排列并保留 safe area。
- `MarkdownEditor` 只补 `id`、`aria-describedby`、`aria-invalid`，供 FormField 关联；change summary 直接使用原生 `<textarea>`。
- Fact action 使用 generated token 的穷尽 switch；本地 dirty/validation/pending 只控制可执行性，不创造业务资格。

## 错误与兼容

- 422 按精确 body field location 映射；未知字段进入 ErrorSummary，不解析 message。
- `REVISION_CONFLICT` 显示 request ID 和显式 reload；`FACT_REVIEW_PENDING`、`INVALID_STATE_TRANSITION` 刷新 server context 但不覆盖 dirty 表单。
- 403/404 使用专门状态；网络/5xx 可重试。
- 保留现有 `product_id`，机械更新 V1/V2 generated schema；V1 仅修复 required 类型影响，不改页面架构。
- 提交后停留当前页面；Fact Review route 不在本 Task 创建。

## 回滚

- 无迁移、缓存、数据回填或新依赖。回滚为整体撤销本 Task contract/backend/frontend/tests/docs。
- 不保留 feature flag、wrapper、可选兼容字段或第二 DTO。
