# Frontend V2 Phase 3.2 — New Content Task

## 目标

实现独立、可 review 的 `/content/tasks/new` Form，让用户从内容任务列表或 Product Facts 批准后的 handoff 中，只用活动 Product、该产品的非空 APPROVED FactVersion 和活动 PlatformProfile 创建普通 ContentTask，并返回内容任务列表确认结果。

## 已确认事实

- `ContentTaskCreate` 的唯一权威字段是 `product_id`、`fact_version_id`、`platform_profile_id`。
- POST `/api/v1/content-tasks` 已使用 `Idempotency-Key`，同 key 同载荷返回原任务，同 key 异载荷返回 `IDEMPOTENCY_CONFLICT`。
- 现有 Product、FactVersion、Platform API 不能用一次稳定响应给出全部创建资格；V1 的逐产品 waterfall 仅作为行为证据。
- `/content/tasks` Page Primary 和 Product `CREATE_CONTENT_TASK` 已分别指向 `/content/tasks/new` 与 `/content/tasks/new?productId=...`，但 route 尚未实现。

## 需求

1. 表单只包含 Product、Approved Fact Version、Target Platform、创建和取消；不得出现 Topic/GEO Source、Content Intent、audience、angle、conversion goal、format、length、generation/manual mode、notes、Prompt 或 AI model。
2. 可选 Product 必须活动且至少拥有一个正文非空的 APPROVED FactVersion；Fact 下拉只显示当前 Product 的全部合格版本，Product 改变后立即清除旧 `fact_version_id`。
3. Fact label 至少显示版本和数据级别；Platform 只显示活动具体平台，Prompt 不完整不得阻止创建。
4. 页面通过一个 Content creation-options read model 稳定获得 Product/Fact/Platform 选择范围，不使用逐产品 waterfall，不在浏览器从 raw status 推导最终资格。
5. 可选 `productId` 必须保留在 URL。合法且合格时预选；空白、非法、不存在、停用或无 approved facts 时显示明确状态，不静默改选；用户可显式选择其他合格 Product。
6. 用户显式选择 Product 后写入新的 URL 历史项，refresh 保持，Back/Forward 恢复 Product；只清除依赖的 FactVersion，不重建整个表单，URL 初始预选不计 dirty。
7. DirtyGuard 覆盖应用内导航、浏览器 Back 和 refresh/close；pending 时禁用字段、取消和创建并阻止重复提交。
8. 每次有效提交使用浏览器原生 `crypto.randomUUID()`。同一 payload 的失败重试复用 key；payload 改变后使用新 key；rerender 不换 key；成功和 `IDEMPOTENCY_CONFLICT` 后不复用旧 key。
9. 成功后失效 Content Task List queries、清除 dirty/key、返回 canonical `/content/tasks`、显示一次性可验证成功反馈并重新获取列表；不得创建或跳转 Task Detail 占位页。
10. 客户端必填、服务端字段 validation、`FACT_NOT_APPROVED`、产品停用、Fact/Product 不一致、Platform 不存在或停用、`IDEMPOTENCY_CONFLICT`、403/404/409、request ID、options loading/error/retry 均有明确反馈；提交失败保留用户选择。
11. 完整复用 Content domain API/query keys/error mapping、Form Kit、Select、Button、DirtyGuard、ErrorSummary 和反馈 primitive；依赖方向保持 `routes -> domains/content -> design-system/shared`。
12. 不新增依赖、Form engine、dependent-select framework、repository、service wrapper、creation context 或其他 Domain 内部组件导入。
13. 375/768/1024/1440 不产生页面级横向溢出；label、description、field error、ErrorSummary、keyboard 和 focus 完整。
14. V1 保持可运行；只同步 generated OpenAPI types，不重构 V1 页面。

## 验收标准

- [x] OpenAPI/Pydantic/生成类型继续冻结严格三字段 `ContentTaskCreate`，旧字段不可达。
- [x] Creation options 只返回活动 Product、其非空 APPROVED facts 和活动 Platform，稳定排序且无 N+1。
- [x] POST 在幂等锁内锁定并重新校验 Platform、Product、Fact，options 过期后仍拒绝不合格创建。
- [x] `/content/tasks/new` 从列表、Product handoff、direct URL 和 refresh 均可用，非法或失效 handoff 不静默改选。
- [x] dependent Product/Fact、三字段 payload、Idempotency-Key 生命周期、DirtyGuard、pending、错误映射和成功返回均有 component/Playwright 证据。
- [x] Product Facts real-stack Flow A 通过 V2 UI 创建真实 ContentTask，返回列表看到任务，不进入 Task Detail。
- [x] Contract/backend、component、fixture Playwright、real-stack、lint/typecheck/build required validation 全部通过。

## 排除项

- `/content/tasks/$taskId`、Content Editor、Generation Job、Manual Draft、Content Review、Publication、GEO Optimization、Content History。
- 通用 Form/Options framework、未来页面 context、无关 V1 重构、第二套 real-stack orchestration。
