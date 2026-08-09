# 技术设计

## 边界与组件层级

```text
FactVersionDetailRoute
└── FactVersionDetailPage
    ├── Detail Header：vN、状态、只读快照语义、返回导航
    ├── DetailSection：MarkdownPreview
    ├── DetailSection：版本 metadata
    └── DetailSection：Timeline（创建、可选审批）
```

- Route 只负责 params、metadata、loader/prefetch、unexpected error composition。
- Domain page 持有 query 状态、一致性判断、错误恢复和展示；不新增 model 文件或万能 renderer。
- 复用 `productFactStatusRegistry` 映射显示语义，但不根据 status 产生动作。

## API 与数据流

1. `factVersionQueryOptions(versionId)` 使用 query key `['products', 'fact-version', versionId]`。
2. query 仅请求 `GET /api/v1/fact-versions/{fact_version_id}`，返回 generated `FactVersion`。
3. 页面在成功响应后比较 `productId.toLowerCase()` 与 `data.product_id.toLowerCase()`。
4. 匹配才渲染 snapshot；不匹配返回专用 not-found，且不泄漏实际版本内容。
5. 初始无 data 时分别处理 loading、404、403、generic；generic 提供 retry。已有 data 的 refetch error 显示 banner 并保留 canonical snapshot。

query key 只包含 `versionId`，因为服务端资源身份是 FactVersion；`productId` 是路由所属关系校验，不是 endpoint 参数。切换 URL 产品时页面仍重新执行一致性判断。

## 合同变化

- `getFactVersion.responses` 从仅 `200` 补齐现有运行时 `401/403/404/422 ErrorResponse`。
- `FactVersion` schema、endpoint path、后端投影和权限不变。
- 同步 V1/V2 generated TypeScript 类型，并在 backend contract test 冻结响应集合及关键 required fields。

## 展示与可访问性

- Header 使用 `FactVersion vN` 为唯一 h1，状态与“只读快照”均有文字。
- `MarkdownPreview` 继续负责 sanitization、禁止 raw HTML/image 与可聚焦阅读区。
- metadata 使用 `dl/dt/dd`，时间使用 `time[dateTime]`，UUID 使用 mono + break-all。
- Timeline 始终包含创建事件；仅当审批人和审批时间均存在时增加审批事件，不推测 changes-requested 时间或审核人。
- 页面不渲染 `primary_task`、`available_actions`、`deletion`，也不显示任何命令按钮。
- deterministic mismatch 无 retry；404/403 提供返回导航；generic error 显示 request ID（若有）并允许 retry。

## 响应式与性能

- 使用现有 Detail 容器、grid/flex 与断点；375 纵向堆叠，768/1024/1440 逐步扩展 metadata 列数。
- 所有容器 `min-w-0`，长 UUID/摘要/Markdown 局部换行或滚动，不制造页面级横向滚动。
- 单请求、无客户端 join、无新依赖、无全局状态、无 memo/config framework；页面按 route chunk 自动分割。

## 文档判断

- 更新 `03-page-and-workflow-blueprint.md`：修正重复编号，补充详情页边界并明确 Fact History 列表尚无 owner/route。
- 更新 `08-testing-quality-and-acceptance.md`：增加 Phase 2.7 production-artifact Playwright 约束。
- `02/04/05/06/07/09` 与 `contracts/database.md` 已准确描述 route、readonly Detail、Phase 顺序和不可变约束，不修改。

## 回滚

本 Task 无数据库或运行时后端变更。若失败，回退新增 route/page/tests、query wrapper、OpenAPI 错误声明及对应 generated files/docs 即可；Product Detail 现有链接保持原样。
