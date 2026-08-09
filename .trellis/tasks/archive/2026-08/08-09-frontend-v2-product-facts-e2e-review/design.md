# 技术设计

## 1. 设计判断

本 Task 不引入新的 E2E framework、Playwright config、page-object hierarchy 或业务 DSL。复用 `deploy/scripts/e2e-local.sh` 作为唯一真实栈 orchestration，在其独立 PostgreSQL 生命周期内增加 V2 production artifact，并用一个原生 Playwright spec 覆盖两条跨页面 flow。

```text
deploy/scripts/e2e-local.sh
├── 独立 PostgreSQL：create → migrate → seed → drop
├── 真实 FastAPI :8000
├── 现有本地服务替身与 V1 E2E
└── V2 production artifact
    ├── VITE_API_BASE_URL=http://127.0.0.1:8000 npm run build
    ├── vite preview :4174
    └── product-facts-real-stack.spec.ts
        ├── Flow A：approve → immutable version → CREATE_CONTENT_TASK
        └── Flow B：request changes → revise → new version history isolation
```

业务主流程只操作 V2 页面。测试 API 仅用于登录和最终只读断言，不参与 save、submit review、request changes、resubmit 或 approve。

## 2. 当前覆盖与职责分界

覆盖矩阵详见 `research/e2e-coverage-and-harness.md`。现有 32 个 Product fixture-based 用例继续负责单页面 request contract、loading/error、URL 导航、DirtyGuard、keyboard、四档响应式和未声明 API 审计；新增真实栈 spec 只负责跨页面状态推进、真实数据库不可变版本、审核历史归属和批准后的服务端投影。

新增真实栈用例不重复 404、四档响应式或每个 pending/error 分支。默认 `npm --prefix frontend-v2 run e2e` 仍可独立运行 fixture suite；real-stack spec 只在脚本传入显式开关时启用。

## 3. Harness 调整

### `deploy/scripts/e2e-local.sh`

- 保留现有唯一数据库名、migration、seed、临时存储、进程管理和 trap cleanup。
- FastAPI CORS origins 增加 `http://127.0.0.1:4174`，继续保留 V1 `http://127.0.0.1:5173`。
- 以 `VITE_API_BASE_URL=http://127.0.0.1:8000` 构建 V2，实际运行 `frontend-v2/dist` 的 `vite preview`，不用 Vite dev server。
- 为 V2 preview 登记独立 PID、readiness probe 和 cleanup。
- 在同一真实栈生命周期内，显式运行目标 spec 的 desktop project，避免 mobile/desktop 重复执行两条有状态 workflow。

### `frontend-v2/playwright.config.ts`

- 默认保持当前 build + preview 行为。
- 当环境变量提供 external V2 base URL 时使用该 URL，并省略内置 `webServer`，避免与脚本启动的 4174 preview 端口冲突。
- 不增加第二份 config。

### `product-facts-real-stack.spec.ts`

- 直接使用 `@playwright/test`，不导入 `products.fixture.ts`，不注册 `page.route`。
- 缺少 real-stack 开关时 skip，因此默认 fixture 门禁不依赖后端。
- 用 `page.request` 调用真实登录 endpoint；其 cookie 与同一 browser context 的页面请求共享。
- 用 `randomUUID()` 构造唯一型号、Markdown、summary 与退回意见；不写逐记录清理器。

Makefile 不修改：`make e2e` 已进入 `e2e-local.sh`，`make verify` 已依赖 `e2e`。

## 4. Flow A 详细步骤与断言

1. 测试 API 以 seed admin 登录；打开 V2 `/products/new`，确认真实 session 生效。
2. UI 创建唯一产品 `PF-A-<uuid>`；断言 canonical URL 为 `/products/{productId}`。
3. 点击服务端 primary action“录入事实”进入 workspace。
4. UI 输入唯一 Markdown、选择 `PUBLIC`、保存；断言 revision 前进且 dirty 清除。
5. UI 提交审核并填写唯一 change summary；断言提交动作消失。
6. 回 Products List，用唯一型号搜索；断言 primary action 为“审核”并打开 Fact Review。
7. 断言 snapshot、版本号、summary 和 submit history；UI 批准，断言审核动作消失。
8. 返回列表并打开 Product Detail；断言 primary“创建内容”的 href 精确为 `/content/tasks/new?productId=<encoded productId>`，不点击未实现页面。
9. 从“当前批准事实”打开 Fact Version Detail；断言 `APPROVED`、原始 Markdown、只读语义，且没有编辑、保存或审核命令。
10. 真实 API 读取 Product detail/projection，断言 `primary_task=CREATE_CONTENT_TASK`；同时断言 FactVersion 的 `product_id` 与批准状态。

## 5. Flow B 详细步骤与断言

1. UI 创建唯一产品 `PF-B-<uuid>`，进入 workspace。
2. 保存 `PUBLIC` Markdown v1，以 `flow-b-v1-<uuid>` 提交。
3. 从列表“审核”进入 review，断言目标为 `FactVersion v1`，且 history 只含 v1 submit。
4. UI“退回修改”，填写 `flow-b-return-v1-<uuid>`；断言状态为 `CHANGES_REQUESTED` 且审核动作消失。
5. 从列表“修订”回 workspace；修改 Markdown 并保存，断言 revision 前进。
6. 以 `flow-b-v2-<uuid>` 重新提交；从列表进入新的 review target。
7. 断言目标为 `FactVersion v2`；当前 history 包含 v2 submit summary，不包含 v1 summary 或 v1 退回意见。
8. UI 批准 v2；刷新后 history 包含 v2 submit + approve，仍不含 v1 记录。
9. 真实 API 读取 review context，断言每条 `review_history.target_id` 都等于 v2 ID。

## 6. 产品缺口处理

### CREATE_CONTENT_TASK UI

V2 没有 `/content/tasks/new` route。本 Task 只验证服务端 token 与正确 href，不点击、不加占位页面。已有 V1 真实栈通过真实 API 证明批准事实可创建 ContentTask；该证据只代表后端能力，完整 V2 UI 仍保留到 Phase 3。

### Fact History 列表

OpenAPI 已有版本列表 endpoint，但 V2 没有 query、route 或 page；Product Detail 只显示 approved/pending 摘要，不能替代历史扫描。该能力不满足现行蓝图，记录为明确 Product Facts gap。建议独立后续 Task `frontend-v2-fact-history` 决定 URL、owner 和 read model；本 Task 不创建或实现它。

## 7. Vertical slice 抽象结论

- Query keys、generated DTO、API error mapping 和 Product primary action registry 均已有单一来源。
- 页面未从 status、数量或正文推导服务端业务资格；Design System 未混入 Product token、权限或状态机。
- 现有 `TableShell`、`WorkspaceShell`、`DetailSection` 等已覆盖稳定纯 UI pattern；不再叠加万能 Table/Workspace/Review/VersionDetail framework。
- 唯一允许的小型去重：把 `Confidentiality` label registry 从 detail-specific model 移到现有 `product.model.ts`，让 Detail、Workspace、Review、Version Detail 共用，并删除 Review 的重复 mapping。
- 不提取 StatusBadge wrapper、Metadata、FailurePage，不拆 query-key factory/repository/service，不为 Content domain 预建任何抽象。

完整证据见 `research/vertical-slice-abstraction-review.md`。

## 8. 文档与合同

- 更新 `07-migration-plan.md`，把 Phase 2 的 Content 条件澄清为批准后 handoff token/href；完整 New Content Task UI 仍属于 Phase 3。
- 更新 `08-testing-quality-and-acceptance.md`，记录 Product Facts 真实栈 gate、production artifact 和 fixture/real-stack 边界。
- OpenAPI、数据库合同和后端行为无需修改；若真实 flow 暴露合同内 Product Facts 缺陷，必须先建立直接证据再提出最小修复，不增加兼容字段或第二类型系统。

## 9. 回滚与失败语义

Harness 失败必须保留原始退出码并执行 trap cleanup；不能用固定成功路径或 silent fallback。回滚只需移除真实栈 spec、V2 preview 启动段和一项 mapping 去重；数据库 schema、API 合同和 V1 页面不变。
