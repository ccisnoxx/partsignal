# Frontend V2 AppShell Product Detail loader 测试修复

## Goal

关闭阻塞 Frontend V2 Phase 3 exit gate 的唯一已知测试缺口：让 AppShell metadata/navigation 测试以受控、合法、最小的 Product Detail 响应完成真实 route loader 与页面加载，并在全量质量门禁通过后将 Phase 3 exit gate 从 `NOT_MET` 重判为 `MET`。

## 背景与已确认事实

- `frontend-v2/src/app/layout/app-shell.test.tsx:70-79` 访问 Product Detail route，但没有为 detail GET 提供响应。
- `frontend-v2/src/routes/_app/products/$productId.tsx:12-16` 会调用 `productDetailQueryOptions` 并 prefetch；`frontend-v2/src/domains/product/product-detail-page.tsx:71-74` 随后通过同一 query options 等待详情数据。
- `frontend-v2/src/domains/product/product.api.ts:71-85` 的唯一详情请求为 `GET /api/v1/products/{product_id}/detail`，无响应时不能完成详情页加载。
- 2026-08-11 的 targeted 复现结果为 `1 failed / 4 passed`，失败测试无法找到预期 heading；完整记录见 `research/failure-reproduction.md`。
- Product Detail 加载成功后的 `h1` 是产品型号；“产品详情”是页面 eyebrow 与 route breadcrumb。测试应使用受控 fixture 的产品型号证明页面已完成加载，同时继续断言面包屑中的“产品详情”。
- `frontend-v2/src/domains/product/product-detail-page.test.tsx` 已证明本项目使用 generated `ProductDetail` 类型约束 fixture，并通过 mock `api.GET` 返回 `{ data, response }`。
- `docs/frontend-v2/07-migration-plan.md` 当前保留已归档 `frontend-v2-content-abstraction-review` 的 `NOT_MET` 结论；历史任务产物不得改写。

## In Scope

- 仅在 `app-shell.test.tsx` 为 metadata/navigation 用例增加 generated `ProductDetail` 约束的最小局部 fixture。
- 在同一用例 mock `api.GET`，返回合法 detail 响应，并断言只调用一次精确 detail endpoint 与 path 参数。
- 使用 fixture 的产品型号 heading 证明 Product Detail route 已完成加载。
- 保留并通过现有父级“产品”导航激活与“产品 / 产品详情”面包屑断言。
- 在全部 required validation 通过后，向迁移计划追加 blocker 已关闭、验证证据与 Phase 3 `MET` 结论。

## Out of Scope

- Product Detail production code、route loader、Router mock、共享 fixture framework、测试依赖或 API 合同变更。
- backend、database、generated schema、V1、Publishing、Product route 的 `RouteError` 迁移。
- 跳过、删除、降级或改写 metadata/navigation 测试目标。
- pending Promise、静默 catch、错误页面或固定失败路径。
- 改写已归档 Content Task 的结论或历史验证记录。

## Requirements

1. Fixture 必须由 generated `components['schemas']['ProductDetail']` 约束，使用合法 UUID，并只包含详情页渲染所需的完整最小结构。
2. API 替身仅作用于目标测试；其他 AppShell 用例继续保持各自最小 mock 作用域。
3. 目标测试必须证明：
   - Product Detail route 完成加载并渲染 fixture 产品型号；
   - 主导航“产品”具有 `aria-current="page"`；
   - 面包屑包含“产品”和“产品详情”；
   - detail GET 只发生一次，endpoint 与 `product_id` 精确匹配；
   - Vitest 没有未处理 rejection，测试不访问真实网络。
4. 只修复可归因于当前测试缺口的失败；同一失败在代码或环境没有相关变化时不重复运行。
5. 只有 `make verify` 全部通过后才允许更新 Phase 3 当前 gate 状态。

## Acceptance Criteria

- [x] Targeted `app-shell.test.tsx` 全部通过，且目标用例完成真实 Product Detail route loader/query/page 渲染。
- [x] 测试通过 generated-type 最小 fixture 和局部 `api.GET` mock 隔离真实网络。
- [x] 精确 detail endpoint、path 参数与单次请求断言通过，没有意外请求或未处理 rejection。
- [x] “产品”导航激活及“产品 / 产品详情”面包屑断言保持通过。
- [ ] Frontend V2 typecheck、lint、`make verify` 与 `git diff --check` 全部通过。
- [ ] 全量通过后，迁移计划追加 blocker 关闭证据并把 Phase 3 当前 exit gate 判为 `MET`；已归档历史结论原样保留。
- [x] 没有修改 production code、route loader、合同、backend、database、generated schema、V1 或 Publishing。

## Phase 3 Gate 重判规则

- `MET`：上述验收标准全部满足，特别是 `make verify` 零失败，最终 diff 与任务范围一致，迁移计划已记录本 Task 的关闭证据。
- `NOT_MET`：任一 required validation 未通过，或出现未解决的意外网络请求、未处理 rejection、范围漂移；此时不得修改当前 gate 状态。

## Blocking Open Questions

无。用户目标、范围、验收、分支与 gate 算法均已明确。
