# Products List 抽象回顾 Technical Design

## 审查方法

以当前实现和调用方为权威，逐项记录：`severity / file:line / evidence / ownership / decision / change trigger / resolution`。文件长度、未来 Content/GEO 可能复用或架构外观不构成抽象证据。

## Evidence-backed Findings

| Severity | Evidence | Finding | Decision | Resolution |
|---|---|---|---|---|
| P2 | `products-list-page.tsx:246-249` | 删除条件 refetch 后无条件清空目标，阻断仍存在时弹窗也关闭。 | 删除无条件清理；保持目标 ID，由最新 query data 决定是否关闭。 | 已修复并增加“阻断更新后保持、清除后关闭”回归。 |
| P3 | `app-shell.test.tsx:67-72,138-143` | 共享 AppShell suite 全局 mock Products GET，并重复 Product search normalization。 | mock 收窄到实际访问 `/products` 的测试；删除重复 normalization 用例。 | 已收窄 mock 并删除重复用例。 |
| P3 | `products-list-page.test.tsx:136-159`、`products-list.spec.ts:78-91,150-157` | URL/action/long-text 在 unit/component/E2E 多层重复，E2E 还进入未实施业务的详情占位页。 | 保留 model 穷尽映射；component 删除完整 URL 重复；E2E 保留代表性 token 并合并长文本断言。 | 已按测试所有权简化，相关验证通过。 |

## 归属矩阵

| 分类 | 内容 |
|---|---|
| Keep in Product Domain | Search schema/canonicalization、URL→API mapping、query keys/options、DELETE mutation、Product action/status registry、current fact/time formatter、筛选 Select、删除条件弹窗、列定义与页面 composition。 |
| Keep in Design System/shared | TableShell、ColumnHeader、FilterBar、Pagination、RowActions 及 resolved action types；generated API client/types；Auth CSRF session capability；Foundation App Shell smoke。 |
| Simplify locally | blocker refetch 行为；AppShell test mock 作用域；跨 unit/component/E2E 的重复断言。 |
| Promote only after second consumer | Date formatter、Filter Select、ErrorEnvelope parser、server-list hook、DataTable wrapper、通用 action/status/filter registry。当前均不提升。 |
| Confirmed defects requiring change | blocker 仍存在时“重新检查”错误关闭弹窗。 |
| Deferred product/UX decisions | `UPDATE` disabled blocker；等待独立 Product 编辑 UX/route 决策。 |

## 边界与数据流

```text
route search schema / canonical redirect / prefetch / composition
  -> Product search + URL/API mapping + query options
  -> generated ProductListItem projection
  -> Product status/action/view mapping
  -> TanStack Table engine state + composable Table Kit
```

- 依赖方向保持 `route -> product domain -> design-system/shared`。
- Router 是可恢复 URL state 的唯一所有者；Table state 由 canonical search 投影，不复制本地 page/filter/sort。
- Query 只拥有 server state；query key 继续为 Product domain 内最小 prefix/list params 组合，DELETE 成功或失败刷新 Products projection。
- Design System 只消费 resolved actions 和 presentation，不 import Product token、status 或 route。
- API/generated/ErrorEnvelope 在 Product API 边界转换为页面可展示错误；UI 不读取 raw envelope。

## 允许触发重构的证据门槛

- 当前代码可复现的行为缺陷，或实现与权威 spec/批准 UX 明确冲突。
- 至少两个真实消费者具有相同语义、稳定所有权和相同失败边界；相似语法或未来预测不算。
- 局部提取必须减少真实重复或形成明确测试边界；不得只转发参数、重命名函数或因文件较长而拆文件。
- shared/Design System 提升必须保持 domain-token agnostic，且不能要求兼容旧行为或新增配置开关。

## Compatibility 与 Rollback

- 不改变 public API、generated types、Design System props、route contract、query wire shape 或业务行为；无迁移和兼容层。
- 回滚点为实施分支创建时的干净 `main` SHA：`afa347c92a83deb27fcfd77f07c033bbdbf9ee9a`。若实施前 main 改变，必须重新核对差异并更新基线。
- 回滚仅撤销本 Task 的既有代码/测试文件，不保留 wrapper、feature flag 或临时 fallback。
