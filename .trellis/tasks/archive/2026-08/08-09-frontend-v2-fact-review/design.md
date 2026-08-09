# Frontend V2 Phase 2.6 — Fact Review Design

## 最小合同

新增：

```text
GET /api/v1/products/{product_id}/fact-review-context
  -> ProductFactReviewWorkspace

ProductFactReviewWorkspace
├── product: ProductFactsProductContext
└── review: ProductFactReviewTarget | null

ProductFactReviewTarget
├── fact_version: FactVersion
├── diff: FactVersionDiff | null
├── available_actions: FactReviewDecision[]
└── review_history: ReviewRecord[]

FactReviewDecision = APPROVE | REQUEST_CHANGES
```

- 产品不存在返回 404；产品存在但无 FactVersion 返回 `review: null`。
- 优先选择该产品唯一 `PENDING_REVIEW` FactVersion；否则选择版本号最大的 FactVersion。数据库已有唯一 pending 约束，不新增表或迁移。
- 初次页面加载只调用该 endpoint。保留既有 `GET /fact-versions/{fact_version_id}/review-context` 给 V1/精确版本调用者，并给其 context 同步增加 `diff`。
- 既有 `FactReviewAction` 保留 `RETIRE` 兼容 V1；新 V2 workspace 使用更窄的 `FactReviewDecision`，避免把非本页面动作投影进 UI。

## Diff 与权威模型

- Diff 基线是同产品 `version < target.version` 中版本号最大的 FactVersion；首版本返回 `null`。
- 复用后端现有 `DiffLine` 形状和 Python 标准库 `difflib.SequenceMatcher`，新增事实正文 projection，不创建新依赖或通用 diff 框架。
- Blocking Issues 不存在于 FactVersion、事实审核记录或数据库约束中，本 Task 删除蓝图中的冲突要求而不实现占位。
- Evidence 已从权威模型和迁移中删除，本 Task 只读取 `body_markdown`，并同步修正仍暗示 Evidence 的文档。

## 后端数据流

1. 产品级 GET 在 `REPEATABLE READ` 事务内读取产品、目标 FactVersion、前序版本和目标版本 Review Records。
2. service 复用现有 action policy 和精确 `fact_version_id` history 查询；不在 router 重建业务判断。
3. Approve/Request Changes 继续调用既有版本级命令：锁定目标版本，校验 permission、state、revision 与非空 comment，追加 ReviewRecord，返回 canonical FactVersion。
4. 命令成功后前端先接收 canonical response，再 refetch 产品级 context；刷新失败不得伪装为命令失败或重发命令。

## 前端结构

```text
FactReviewRoute
└── FactReviewPage
    ├── Loading / Empty / Failure state
    └── FactReviewWorkspace
        ├── Header / product / status / workflow stage
        ├── WorkspaceShell
        │   ├── Context: classification / version / status / summary / revision
        │   ├── Main: MarkdownPreview
        │   └── Reference: FactVersionDiff / Timeline
        ├── StickyActionBar
        │   ├── Request Changes
        │   └── Approve
        ├── RequestChangesDialog
        │   └── ErrorSummary / FormField / native textarea
        └── aria-live feedback
```

- route 使用 TanStack Router 的 non-nested 文件约定，保持现有 Product Detail 不是 layout。
- 1440 使用 Workspace 三栏；1024/768/375 使用 Main-first tabs。长 diff 仅在所属 pane 内滚动，页面本身无水平溢出。
- 审核快照直接用独立 `MarkdownPreview`，不得用 editable `MarkdownEditor` 的 read-only 变体。
- Approve 复用 `StickyActionBar` 的确认 Dialog；Request Changes 使用短 Dialog 和原生 textarea。关闭、Esc、成功后均恢复到合理触发点。
- route 保持薄；query/mutation、token 映射、error 分类和 cache 更新放在 product domain model/API 文件中，不新增 Review 通用层。

## 错误与缓存

- query key：`["products", "fact-review", productId]`。
- 404、403 使用专门页面状态；网络/5xx 可 retry；背景 refetch 失败保留当前 canonical 页面并显示刷新错误。
- 409 不自动 retry：显示 request ID，禁用基于旧 revision 的动作，立即 refetch context，让用户基于新 canonical state 决策。
- 成功命令用响应更新当前 FactVersion，再刷新产品级 context；同时失效相关 products/detail/facts keys，但不触发额外页面拼接或导航。

## 兼容与回滚

- OpenAPI required 字段会机械影响两套 generated clients；V1 只修复必要 typed fixtures，不改页面架构。
- 无数据库迁移、数据回填、feature flag 或新依赖。回滚为整体撤销本 Task 的合同、服务、页面、测试与文档改动。
- 不改变多 approved 历史、retire 或 Fact Workspace 提交流程。
