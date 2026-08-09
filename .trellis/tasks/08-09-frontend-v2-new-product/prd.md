# Frontend V2 Phase 2.3 — New Product

## 目标

实现独立的 `/products/new` 产品创建页面，并在 `/products` 页面标题区提供唯一 page-level Primary“新建产品”。创建流程以服务端验证、唯一约束和 canonical `Product` 响应为权威，不提前实现 Product Detail 或 Fact Workspace。

## 已确认事实

- 实施基线是干净本地 `main` 的 `a3f44cead73175c65b2126ad9c437ee55af4de02`；本地领先 `origin/main` 22 个提交，不 reset、回退、自动 pull 或 push。
- 实施分支为 `codex/frontend-v2-new-product`，base branch 为 `main`。
- Products List 与其抽象回顾已合并归档，对应旧临时分支已删除。
- `/products/new` 已在批准信息架构中定义为 Form；`/products/$productId` 是已存在的 canonical resource route。
- 现有 Form Kit 已提供 `FormField`、`FormSection`、`FormActions`、`ErrorSummary` 与 `DirtyGuard`；本 Task 不修改其 API。
- 当前 `ProductCreate` 在 OpenAPI/Pydantic 仅有最短长度 1，数据库三个业务字段实际为 `VARCHAR(160)`；纯空白和 161 字符当前都能通过请求 Schema。
- 产品身份由规范化 brand + part number 唯一约束 `uq_products_normalized_brand` 保证；当前唯一冲突会被全局 handler 错误报告为 `REVISION_CONFLICT`。
- POST `/api/v1/products` 当前只声明 `201`，缺少 `401/403/409/422 ErrorResponse`；duplicate 也没有稳定业务错误码和字段定位。
- 既有 `ErrorEnvelope.details.errors` 可以表达 `loc/msg/type`，无需增加全局字段或新错误框架。

## 需求

1. `/products/new` 只包含 `part_number`、`brand`、`category` 三个必填字段，中文标签分别为“产品型号”“品牌”“类别”。
2. 表单使用 React Hook Form + Zod，并复用现有 Form Kit 与 DirtyGuard。
3. Form schema 是 UI 输入 schema；POST body 由 generated `ProductCreate` 类型约束，不手写 API DTO。
4. 客户端提交前 trim 三字段，拒绝空字符串、纯空白和超过 160 个字符的输入；服务端执行同一边界并继续作为最终权威。
5. pending 时禁用输入、Cancel、submit 和重复提交；浏览器返回等离开动作继续由 DirtyGuard 阻断。
6. 客户端字段错误同时关联 label、description、field error 和 ErrorSummary，summary 可聚焦对应字段。
7. 服务端 `details.errors[].loc` 中可定位到三个批准字段的错误写入对应 RHF field；其他错误进入 form-level ErrorSummary。
8. 所有服务端错误显示 `request_id`；不得解析任意 `message` 推导业务逻辑。
9. duplicate product 返回稳定 `409 PRODUCT_ALREADY_EXISTS`，并同时定位 `brand` 与 `part_number`。
10. service 仅捕获真实唯一约束名处理竞态；不以预检查代替数据库约束，不解析数据库英文错误文本。
11. mutation wrapper 只发送请求并返回 generated `Product`，不直接导航、toast、Dialog 或写缓存。
12. 成功后失效 Products list query，不把 `Product` 伪装成 `ProductListItem` 写入 list cache。
13. 成功导航使用 canonical `Product.id` 前往 `/products/$productId`；先清除 dirty，再导航，不进入未实现 Fact Workspace。
14. Cancel 固定返回 `/products`；dirty 时提示，成功提交后不得再阻拦导航。
15. `/products` 标题区增加唯一“新建产品” Primary，链接 `/products/new`；行级 Primary/overflow 保持不变。
16. direct URL、refresh、breadcrumb 和 sidebar active state 由 route hierarchy/metadata 支持。
17. 不根据 `account_type/role` 猜测创建资格；服务端继续执行认证、CSRF、权限和最终验证。
18. 页面覆盖 default、client validation、server validation、duplicate、forbidden、pending、success、dirty cancel、dirty browser/back、retry，以及 375/768/1024/1440、keyboard-only 和 visible focus。

## 验收标准

- [x] OpenAPI、Pydantic 与数据库现有长度契约一致；空白和超长请求在服务端边界被拒绝。
- [x] POST 声明 `401/403/409/422 ErrorResponse`；duplicate 返回 `PRODUCT_ALREADY_EXISTS` 和两个字段位置。
- [x] 三字段 form schema、trim、generated ProductCreate body、CSRF header 和单次 pending POST 均有测试证明。
- [x] 客户端/服务端字段错误、form-level error 和 request ID 通过同一 ErrorSummary 可访问呈现。
- [x] 成功后 list query 被失效，跳转 `/products/$productId`，DirtyGuard 不再阻拦；未向 list cache 写入错误形状。
- [x] `/products` 只有一个 page-level Primary，且 `/products/new` 的 direct URL、refresh、breadcrumb、sidebar active 均正确。
- [x] dirty Cancel、确认/取消离开、浏览器返回与 pending 状态行为通过。
- [x] typed production-artifact Playwright fixture 拒绝未声明 API，覆盖 375/768/1024/1440、键盘、焦点和运行时错误审计。
- [x] 必需 contract、backend、frontend、build 和 Playwright 验证全部通过。
- [x] 最终 diff 不包含 Product Detail 业务、Fact Workspace、通用 CRUD/Form/Error framework、数据库迁移、部署或 V1 UI 改造。

## 明确非目标

- 编辑现有产品、Product Detail 业务、Fact Workspace/Review/Version、创建后自动写事实。
- autosave、draft persistence、optimistic create、通用 CRUD Form、通用 API Error framework。
- 新 UI/表单库、Content/GEO 表单抽象、数据库迁移、部署修改或 V1 切换。
- commit、merge、push、archive 或开始 Product Detail。
