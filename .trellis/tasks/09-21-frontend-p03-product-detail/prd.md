# P03 产品详情

## Goal

完成清单 P03：验收单一 Product Detail read model、跨域摘要、服务端动作、revision 更新与删除边界，并修正本轮发现的内部 token 展示。

## Requirements

- 前置 P01 本轮完成。权威：`docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.3 节、`05-business-actions-state-and-api-contract.md` ProductDetail、`08-testing-quality-and-acceptance.md` P03 段、`contracts/openapi.yaml` ProductDetail/ProductUpdate。
- 首屏只请求 `GET /api/v1/products/{product_id}/detail`，按 Header → Summary → Metadata → Facts → Content → Publishing → GEO → Activity 展示服务器统一快照；事实正文不在 Detail 内编辑，空摘要明确显示“暂无”。
- `primary_task`/`available_actions` 只决定入口资格，页面显示解析后的业务文案；不向用户显示原始 API token。更新只编辑四个允许字段并带 `expected_revision`，冲突显示服务端错误与 request ID 后刷新 canonical Detail；删除消费服务端 blockers/revision。
- 生产 artifact 需覆盖入口、direct/refresh/Back/Forward、状态与动作、错误、四档宽度及键盘焦点；严格 fixture 与真实栈区分。

## Acceptance Criteria

- [x] 产品详情组件/model 与生产预览浏览器场景证明单一 read model、状态、动作、更新/删除与错误。
- [x] 摘要使用面向用户的标签和值，不暴露 `primary_task`/`available_actions` 原始 token。
- [x] 记录实际代码、验收证据、未覆盖项及 P04/P06 下一步。

## Scope

拥有 Product Detail Domain 与直接测试；不改 API、服务端资格或其他 Domain。需要共享组件改动时先重新判断所有消费者。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`product-detail-page.tsx` 将摘要中的 `Workflow stage`、`Primary task`、`Available actions` 和 `Revision` 改为面向用户的「工作阶段」「下一步」「其他操作」「修订号」。下一步和其他操作复用既有服务端 token 解析结果，删除入口、更新 payload、资格、query 与状态归属不变。组件与浏览器测试补充不暴露原始 token 的断言。
- `product-detail-page.test.tsx` 与 `product-detail.model.test.ts` 10/10 通过，覆盖单次 Detail GET、摘要/Activity、404/403/retry、revision 更新、`IMMUTABLE_VERSION` 映射及删除条件。
- 当前候选生产构建预览的 `product-detail.spec.ts` 两个 Playwright project 12/12 通过，覆盖 List→Detail/direct/refresh/Back/Forward、服务端已排序 Activity、空摘要、token 动作、UPDATE/DELETE 冲突和 375/768/1024/1440 无页面根溢出与键盘焦点。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 浏览器使用严格 Product fixture，只证明前端消费单一 read model；真实 PostgreSQL 快照一致性、权限和服务端最终裁决不由本项前端测试替代。下一步 P04 事实工作区；P06 事实历史列表在 P03/F05 前置后也已可进入。
