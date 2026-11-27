# P02 新建产品

## Goal

完成清单 P02：验收 `/products/new` 三字段创建表单、校验、DirtyGuard、pending 防重、结构化错误与响应 ID 导航。

## Requirements

- 前置 P01、F06 本轮完成。权威：`docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.2 节、`08-testing-quality-and-acceptance.md` P02 段、`contracts/openapi.yaml` 的 `ProductCreate/Product`。
- 仅型号、品牌、类别三字段；trim 后必填且最长 160。RHF/Zod 管表单，服务端仍裁决唯一性与权限。POST 带 CSRF，pending 禁止重复提交和造成状态丢失的操作。
- 字段错误关联 FormField/ErrorSummary，其他错误与 request ID 显示；成功失效产品列表 query，采用响应 canonical Product.id 进入详情，不把 Product 写成列表 DTO cache。
- 直接 URL/刷新、面包屑、取消与 Back 的 DirtyGuard、375/1440、键盘焦点与严格 fixture API 边界需有本轮证据。

## Acceptance Criteria

- [x] Model/component 与生产预览浏览器场景覆盖上述合同。
- [x] 记录实际代码、验证、fixture 限制和 P03 下一步。

## Scope

拥有 Product 新建页 Domain、thin Route 及其直接测试；现有实现满足时可复用，发现明确缺口再修改。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`new-product-page.tsx`、`new-product.model.ts`、`new-product.api.ts` 与 thin Route 已满足本轮合同，未修改生产代码。客户端仅处理 ProductCreate 三字段，成功使用响应 `Product.id` 导航并失效列表 query。
- `new-product-page.test.tsx` 与 `new-product.model.test.ts`：11/11 通过，覆盖 trim/160 字符边界、generated DTO/CSRF、结构化字段错误与 request ID、pending 防重及 DirtyGuard。
- 当前候选生产构建预览的 `new-product.spec.ts` 在移动与桌面两个 Playwright project 12/12 通过，包含列表入口/direct/refresh、面包屑、空白错误、重复/403、pending 单 POST、取消/Back、响应 ID 详情、375/1440 无根级溢出与键盘焦点。严格 fixture 不代表真实后端的唯一性、权限或跨服务业务闭环。
- P01 之后未更改 P02 代码、配置或测试；当前候选类型检查、lint、API generated 合同及生产构建由前置验收和该 Playwright 构建继续证明。下一步 P03 产品详情，核对单一 read model、动作、删除与跨域摘要。
