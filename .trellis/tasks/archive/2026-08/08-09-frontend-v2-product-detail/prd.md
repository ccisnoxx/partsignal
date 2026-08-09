# Frontend V2 Phase 2.4 — Product Detail

## 目标

实现 `/products/$productId` Product Detail：通过一个服务端 read model 展示产品基础信息、事实摘要、内容任务摘要、发布成果摘要、GEO 指标、最近 Activity 和服务端动作，并在该 canonical detail surface 内完成产品基本信息 UPDATE UX；不承担事实正文编辑。

## 已确认事实

- 实施基线是本地干净 `main` 的 `199ef05d8cd13c0b3771d91091495d0c5fb27e48`；本地领先 `origin/main` 25 个提交，不 reset、回退、自动 pull 或 push。
- 实施分支为 `codex/frontend-v2-product-detail`，只承载本 Task。
- Products List、抽象回顾与 New Product 已合并归档，旧临时分支已删除。
- 当前 `GET /api/v1/products/{product_id}` 只返回基础 `Product`；事实、内容、发布、GEO 与 Activity 没有单一产品详情投影。
- 现有多个列表接口会造成客户端 join、waterfall 和跨请求 snapshot 不一致；PublicationWork/PublishedArticle 还没有完整 product filter。
- Product 自身现有 `workflow_stage`、六种 `primary_task`、`available_actions` 与 deletion projection 已完整，不新增动作 token。
- AuditLog 只保存成功白名单动作，不能单独代表 Product Activity；事实/内容审核、发布事件与 GEO 记录有各自追加式权威来源。
- Product Detail 是批准的信息架构中的 canonical resource route；没有获批 `/edit` route，`ProductUpdate` 已包含 `expected_revision`。

## 需求

1. 新增独立 `GET /api/v1/products/{product_id}/detail`，保留既有 Product GET/POST/PATCH wire shape，不把跨域摘要加入 Product 或 ProductListItem。
2. 页面只请求一个 Product Detail read model，不请求 Facts、Content、Publication、GEO 或 Audit 接口在浏览器拼装。
3. 页面顺序固定为 Header → Summary → Metadata → Facts → Content → Publishing → GEO → Activity。
4. 展示型号、品牌、类别、产品状态、workflow stage、服务端 `primary_task`、`available_actions` 与 deletion projection。
5. approved/pending fact 只返回并显示 compact metadata，不返回 Markdown、review comment 或完整 FactVersion。
6. Content、Publishing、GEO 只返回页面实际消费的 count/latest/rate compact summary 和必要 link id，不返回内部对象。
7. Activity 由服务端从权威追加式记录汇总、映射 typed kind/label 并稳定排序；前端不合并、不排序、不从 `updated_at` 猜事件。
8. 空摘要和空 Activity 显示“暂无”；null rate 显示“暂无”，不补零或伪造成功数据。
9. TanStack Query 管理 detail server state；route 只负责 params、prefetch、metadata、错误兜底、导航注入和 composition。
10. loading 保留标题、Product ID 与完整 section skeleton；404、403、普通错误+retry 分开呈现。
11. Primary 只消费 generated `primary_task` 且最多一个；`available_actions` 进入 overflow；未知 token 显式失败。
12. Products List 的 UPDATE 改为进入 Product Detail；Detail UPDATE 使用短 Dialog，只编辑 `part_number/brand/category/status`。
13. UPDATE 使用 generated `ProductUpdate` 与当前 `expected_revision`；不根据事实、角色或关联数量猜字段可编辑性。
14. `IMMUTABLE_VERSION`、`REVISION_CONFLICT` 必须 code-aware 展示并刷新 canonical detail；duplicate/validation 精确映射字段。
15. DELETE 继续消费服务端 deletion projection、当前 revision、CSRF、二次确认和写入时重新校验；成功后不得重新 GET 已删除详情。
16. Product query keys、primary/available action mapping、status presentation、API error mapping和时间格式化只在出现第二消费者时提升到 Product domain 稳定模块。
17. Product domain 不导入 Fact/Content/Publication/GEO 内部组件；通过 generated compact summary 自己展示。
18. 375/768/1024/1440 无页面级横向溢出；keyboard、visible focus、heading、section、list/timeline、link、menu 与 dialog 语义可访问。

## 验收标准

- [x] Product Detail schema 只含批准字段，OpenAPI、FastAPI 与两套 generated types 一致。
- [x] 一个 detail 请求完整绘制页面，fixture 对任何客户端跨域 join 显式失败。
- [x] backend 在同一 repeatable-read snapshot 中形成固定次数批量 projection，1 条与 N 条关联记录查询数相同。
- [x] approved/pending fact、content、publishing、GEO 有数据与空态均通过测试。
- [x] Activity source、typed kind、中文 label、actor/target、limit 和稳定排序通过集成与前端测试。
- [x] Primary/overflow 只随服务端 token 变化，未知 token 不回退。
- [x] UPDATE Dialog、canonical refresh、immutable/revision/duplicate/validation 流程通过。
- [x] DELETE blocker、确认、revision failure、成功导航与缓存失效通过。
- [x] List → Detail、New Product → 真实 Detail、direct URL、refresh、Back/Forward、breadcrumb/sidebar 通过。
- [x] 404、403、error+retry、375/768/1024/1440、keyboard/focus 和 console/pageerror/requestfailed 审计通过。
- [x] 必需 contract、backend、frontend、build 和 production-artifact Playwright 验证全部通过。
- [x] 最终 diff 不包含 Fact Workspace/Review/Version Detail、其他 domain 页面、数据库迁移、缓存或通用 read-model framework。

## 明确非目标

- Fact Workspace、Fact Review、Fact Version readonly Detail、事实 Markdown 编辑。
- Content Task 详情、Publication/GEO 独立页面、完整 Product Facts E2E。
- 通用跨域 Dashboard/read-model/detail/CRUD framework、跨 domain registry。
- 数据库迁移、缓存、物化视图、Workspace context、新依赖或 Design System 大改。
- commit、merge、push、archive 或开始 Fact Workspace。
