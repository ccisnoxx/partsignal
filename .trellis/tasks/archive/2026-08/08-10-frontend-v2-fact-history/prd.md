# Frontend V2 Product Facts — Fact History

## 目标

为 Frontend V2 增加产品事实版本历史列表，使用户能够从 canonical URL 扫描完整历史并进入现有 readonly Fact Version Detail，从而关闭 Phase 2 Product Facts 的最后一个已知缺口。

## 已确认事实

- V2 已有 `/products/$productId/facts/versions/$versionId` readonly Detail，但没有历史列表 query、route 或 page。
- `VIEW_FACT_HISTORY` 当前进入 Product Detail；详情只展示 approved/pending 摘要，不能扫描完整历史。
- 既有 `GET /api/v1/products/{product_id}/fact-versions` 无分页且返回完整 `FactVersion`，包含 Markdown、动作与删除投影；V1 Product Facts、Content Tasks、GEO 仍依赖其全量详情语义。
- 事实版本号在 Product 内唯一，服务端当前按 `version DESC` 返回；前端不得重新推导业务顺序。
- 已归档 `frontend-v2-product-facts-e2e-review` 已证明 Flow A/B 真实闭环通过，但 Fact History gap 关闭前 Phase 2 exit gate 为 `NOT_MET`。

## 需求

- 正式 URL 为 `/products/$productId/facts/versions?page=1&pageSize=20`；使用分页时 `page`、`pageSize` 必须进入并可由 URL 恢复。
- route 只负责 URL validation、loader、metadata 与 composition；query、model 和 page 归 Product domain。
- 页面标题展示 Product identity，但浏览器不得请求 Product Detail 拼接。
- 历史表格严格包含：版本、状态、数据级别、变更摘要、提交人、提交时间；没有操作列。
- 版本单元格提供明确、键盘可达的链接，进入 `/products/$productId/facts/versions/$versionId`。
- 不展示或推导 APPROVE、REQUEST_CHANGES、RETIRE、DELETE，不允许编辑事实版本。
- 页面提供 loading、empty、404、403、通用错误和 retry；支持 direct navigation、refresh、Back/Forward。
- 覆盖 keyboard、focus、screen-reader label 和 375/768/1024/1440 响应式；document 不得横向溢出。
- `VIEW_FACT_HISTORY`、Product Detail 全历史入口与 Fact Version Detail 返回历史入口统一指向 canonical route。
- 只关闭 Fact History；不进入 Content domain，不实现命令，不创建通用 History framework，不新增依赖。

## 验收标准

- [x] OpenAPI 与真实 backend 提供一次请求可绘制、分页、包含 Product context 的窄 history read model；旧 `listFactVersions` 行为保持不变。
- [x] V2 query key 包含 `productId/page/pageSize`，URL search 与 API `page/page_size` 显式映射。
- [x] 返回的 Product 与每个 item 的 `product_id` 必须匹配 URL `productId`；不匹配时阻断全部数据。
- [x] Table 直接组合现有 Table primitives，严格六列、无操作列、无搜索/筛选/排序/批量/列配置。
- [x] component/unit 覆盖列、状态、链接、empty/error、canonical action route 与产品边界。
- [x] fixture Playwright 覆盖 canonical navigation、direct/refresh/Back/Forward、服务端顺序、readonly detail、错误矩阵、无命令、四档宽度、keyboard/focus 与运行时错误审计。
- [x] 既有 real-stack Flow B 扩展为通过真实 UI 打开历史列表，断言 v2/v1 同时出现且顺序正确，并进入目标 readonly Detail；不新增独立 flow。
- [x] contracts、backend tests、generated V1/V2 types、frontend、tests 和权威文档一致，required validation 全部通过。
- [x] 完成后重新判断 Phase 2 exit gate；本缺口关闭且既有条件仍成立，标记 `MET`。

## 排除项

- Content Task List、New Content Task 或其他 Content 页面。
- Fact Version 编辑、审核、退回、停用、删除命令。
- V1 页面重写或改变既有 `listFactVersions` 合同语义。
- Product Facts 全域重构、通用 History/VersionList/Table framework、repository、service wrapper 或配置驱动列表。
- 无关质量修复、依赖新增、数据库模型或不可变性规则变更。
