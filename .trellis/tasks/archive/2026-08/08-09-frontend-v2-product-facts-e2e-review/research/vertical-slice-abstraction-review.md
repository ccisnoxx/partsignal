# Product Facts Vertical Slice 抽象回顾

## 1. 已满足的结构边界

- 六个页面均位于 `domains/product`，routes 只做 prefetch、auth context 与 composition；未发现 route 内业务状态机。
- `product.api.ts:35-44` 是 Product domain query keys 的唯一来源；页面没有字符串 query key 第二来源。
- `product.api.ts` 统一真实 API 错误与结构化 field error；各 model 只缩窄字段和业务 code，不解析 message 推导流程。
- `product.model.ts:53-70` 的 Product primary action registry 同时供 Products List 和 Product Detail 使用；Workspace 与 Review 分别穷尽映射其窄 `available_actions` token。
- Fact Workspace 的 dirty/非空/pending 只控制服务端已返回动作的 enabled 状态；Fact Review 只消费 `APPROVE` / `REQUEST_CHANGES`。未发现从 status、数量或正文补出业务资格。
- API DTO 全部来自 `shared/api/generated/schema`；未发现手写重复 API DTO、页面级 API join 或兼容字段 fallback。
- Design System 不导入 Product domain，也未发现 Product token、权限或状态机进入 design-system。
- `TableShell/FilterBar/RowActions`、`WorkspaceShell/StickyActionBar`、`DetailSection/Timeline` 已是实际跨页面消费的纯 UI pattern；没有万能 Table、ReviewWorkspace 或 VersionDetail framework。

## 2. 有证据的小型去重

### 允许：收敛 Confidentiality label registry

证据：

- `product-detail.model.ts:12,30-34` 持有 `Confidentiality → 中文 label`。
- Fact Workspace 与 Fact Version Detail 分别从 detail-specific model 导入该 registry（`fact-workspace-page.tsx:39,73-77`；`fact-version-detail-page.tsx:11`）。
- Fact Review 又在 `fact-review-page.tsx:58-62` 维护相同第二份 mapping。

最小修改：把 `confidentialityRegistry` 移到已经承载 Product domain 共享状态/动作映射的 `product.model.ts`，四个消费者统一导入；删除 Review 的 `classificationLabels`。不新增文件、不提升到 Design System，因为 Confidentiality 仍是业务 token。

## 3. 明确不抽象

- `Metadata`：Product Detail、Workspace/Review 与 Fact Version Detail 虽同名，但布局分别是 grid block、左右 definition row 和 readonly detail block；语义尚未稳定，不提取万能组件。
- `StatusBadge`：三处一行 wrapper 重复，但抽取后只把一行换成 import，收益不足；状态 registry 继续留在 Product domain，Badge 继续是 Design System primitive。
- Loading/Failure/RefreshFailure：Workspace、Review、Version 的结构相似，但保留 dirty editor、canonical review 或 immutable snapshot 的文案与恢复语义不同；不预建通用 ErrorPage。
- Workspace skeleton：Fact Workspace 与 Fact Review 的三栏结构相似，现有 `WorkspaceShell` 已覆盖稳定层；不再增加 `ReviewWorkspace`。
- Readonly Detail：Product Detail 与 Fact Version Detail 已复用 `DetailSection/Timeline`；不创建 `VersionDetail` framework。
- API：不拆新的 query-key factory、repository、service class 或 mutation wrapper；现有 `product.api.ts` 已是单一边界。
- Tests：不新增 page-object hierarchy、业务 DSL、通用 flow runner 或第二套 Playwright config。

## 4. 边界发现但不在本 Task 修复

- `VIEW_FACT_HISTORY` 指向 Product Detail 只是过渡入口，不能替代完整 history list；由后续 `frontend-v2-fact-history` 决策。
- `/content/tasks/new` href 正确但 route 不存在；由 Phase 3 实现。
- 页面级 load/refresh error 组件存在局部重复，但当前没有足够统一恢复合同证明值得提升；先由 Content slice 提供第二个 domain 消费证据再复审。

## 5. 审查结论

当前 vertical slice 没有需要结构重写的抽象问题。实施范围仅包含一项删除第二 mapping 的 domain 内去重；真实 E2E 若发现 Product Facts 缺陷，只允许修复其权威共享位置并增加直接回归，不扩大到 Content、V1、通用状态机或新页面。
