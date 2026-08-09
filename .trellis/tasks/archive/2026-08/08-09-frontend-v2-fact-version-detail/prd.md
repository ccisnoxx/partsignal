# Frontend V2 Fact Version readonly Detail

## 目标

实现 `/products/$productId/facts/versions/$versionId`，让用户从 Product Detail 或深链接安全查看单个不可变事实版本，并清楚理解它是只读 snapshot。

## 已确认事实

- Product Detail 的 approved/pending fact 与 FactVersion Activity 已生成目标详情链接，当前缺少目标路由。
- 页面只消费 `GET /api/v1/fact-versions/{fact_version_id}`；现有 `FactVersion` 已包含本页所需正文、状态、数据级别、摘要、revision、`product_id`、创建/审批 UUID 与时间。
- endpoint 不提供人员显示名、产品摘要、Diff 或 Review History；本 Task 不通过额外请求拼接这些信息。
- FactVersion payload 在数据库中不可变；修改事实必须形成新版本。
- Fact History 蓝图没有明确列表路由、数据入口或 owner，属于独立文档 gap。

## 需求

1. 页面采用 readonly Detail Pattern，展示版本号、状态、不可变 Markdown、数据级别、change summary、revision、FactVersion/Product UUID、创建人/时间，以及存在时的审批人/时间。
2. 页面必须明确显示“只读 / 不可变快照”语义，Markdown 不得进入表单、CodeMirror、DirtyGuard、保存或自动保存状态。
3. 页面不展示 APPROVE、REQUEST_CHANGES、RETIRE、DELETE，不消费 `primary_task`/`available_actions` 形成命令，也不从 status 推导动作。
4. 提供返回产品详情与事实工作台的导航。
5. 处理 loading、404、403、通用错误与 retry；已有 canonical data 的后台刷新失败不得卸载快照。
6. 成功响应必须先校验 URL `productId` 与 `FactVersion.product_id`。UUID 只做大小写不敏感的精确比较；不一致时不展示任何版本内容，显示“该版本不存在或不属于当前产品”的确定性 not-found 状态。
7. 补齐 `getFactVersion` 现有运行时 `401/403/404/422` OpenAPI 错误响应声明并同步 generated types，不改变 endpoint、200 payload、权限或后端行为。
8. 使用现有 DetailSection、MarkdownPreview、Timeline、Badge、Skeleton、状态 registry 和时间格式化能力；不新增依赖或通用页面框架。
9. 覆盖组件测试和 production-artifact Playwright，验证 direct/refresh、Product Detail 入口、状态、错误、retry、一致性、keyboard、375/768/1024/1440 与运行时错误审计。

## 验收标准

- [x] Product Detail 现有版本链接与 direct URL 均可进入 FactVersion 详情，refresh 后保持可用。
- [x] 页面只请求 exact FactVersion endpoint，不请求 Product Detail、Facts、Review Context 或版本列表拼接数据。
- [x] Markdown 经 sanitized readonly Preview 展示，不存在可编辑控件、表单状态或命令入口。
- [x] `APPROVED`、`PENDING_REVIEW`、`CHANGES_REQUESTED` 状态和全部必要 metadata 正确展示；缺失审批 metadata 时不伪造值。
- [x] `productId` 不一致时正文、状态和 metadata 均不渲染，用户获得明确恢复导航。
- [x] loading、404、403、通用错误/request ID/retry 与 background refresh failure 行为可验证。
- [x] 375/768/1024/1440 无页面级横向溢出；仅键盘可进入、阅读与返回，焦点可见且顺序合理。
- [x] OpenAPI、两套 generated TypeScript 类型、contract test、目标组件测试、lint、typecheck、build、目标 Playwright 与 `git diff --check` 通过。
- [x] 直接相关蓝图与测试规范更新，Fact History 列表 gap 被显式记录但未实现。

## 排除项

- Fact History 列表路由、列表 API、分页或入口设计。
- Product Facts 完整真实后端 E2E、Phase 2.8 与 vertical slice 抽象回顾。
- 新 read model、重复 endpoint、人员名称补全、产品 summary、Diff、Review History 或客户端 join。
- Fact Review、Fact Workspace、Product Detail 的业务能力变化。
- 新依赖、数据库迁移、权限变化、通用 Detail/Snapshot framework。

## 阻塞项

无。人员名称与 Fact History 列表归属作为后续独立需求处理。
