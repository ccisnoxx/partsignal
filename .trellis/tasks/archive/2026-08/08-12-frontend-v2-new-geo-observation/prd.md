# Frontend V2 New GEO Observation

## 状态

- 阶段：实施
- 实现：已完成，待提交审批
- 审批：最终规划已批准

## 目标

在 `frontend-v2/` 实现 `/geo/observations/new` canonical route，让 `ADMIN` 与 `ENGINEER` 可依据服务端权威候选创建人工 GEO Observation。页面必须沿用现有 Form Kit、`WorkspaceShell`、`DirtyGuard`、上传、结构化错误和 query invalidation 模式，不实现 Observation Detail、Correction Workspace 或其他 GEO 页面。

## 已确认合同

- `GeoObservationCreate` 当前包含 `product_id`、`query_topic_id`、`search_platform`、`search_query`、`tested_at`、至少一项 `article_results`、可选 `attachment_file_ids`、`notes` 与 correction 专用 `supersedes_id`。
- `GeoArticleResultCreate` 当前仅包含 `published_article_id`、独立的 `discovered`、`mentioned` 与可空 `accuracy`。
- 后端创建事务会锁定 Product 和当时的权威 Published Article 候选，要求提交集合与候选集合完全相等；候选变化返回 `409 GEO_PUBLICATIONS_CHANGED`。
- 附件只接受已完成验证且类别为 `OPERATION_SCREENSHOT` 的文件。
- 新建页面必须省略 `supersedes_id`，不得读取或修改既有 Observation，也不得实现 correction 分支。
- 用户已选择方案 A：保持当前权威合同，recommendation/citation 作为旧人工表单遗留行为移出本 Task，不增加数据库迁移或兼容字段。

## 范围

### 包含

- `/geo/observations/new` canonical route 与现有 Observation List 的创建入口。
- Product 服务端搜索、Query Topic 候选、自由文本 GEO platform、搜索问题与 observed/tested time。
- 对每个权威 Published Article 候选显式填写独立事实，不以默认 `false` 代替用户选择。
- 关联 Published Articles、evidence attachments、notes。
- 客户端必要字段校验、服务端结构化错误映射、请求级错误摘要和 `request_id`。
- pending 期间的单次提交保护；不增加未被后端支持的客户端重试。
- `DirtyGuard`、Cancel、Back/Forward、刷新与离开确认。
- 成功后的 canonical cache invalidation 与明确 handoff。
- loading、empty、error、retry；375/768/1024/1440 响应式；键盘、焦点与基础可访问性。
- generated-type fixture Playwright E2E。
- 与本行为直接相关的 OpenAPI、生成类型和 Frontend V2 文档同步。

### 排除

- `/geo/observations/$observationId`、Correction Workspace、Topics、Insights、Print。
- recommendation/citation 的录入、存储、恢复迁移或兼容投影。
- GEO 完整 real-stack 闭环、抽象回顾、旧 `frontend/` 业务 UI 修改。
- 新万能 Form、Upload、Workspace 或 DataTable framework。
- 浏览器跨多个分页接口 join、客户端推导 Published Article 资格、静默兼容字段或自动重提。
- 在没有已批准合同变更时增加数据库迁移。

## 功能要求

### 1. 权威读取

- Product 使用 `GET /api/v1/products` 的服务端分页与搜索，不把全量 Product 拉到浏览器。
- Query Topic 使用 `GET /api/v1/query-topics`。
- Published Article 必须使用 `GET /api/v1/geo-observation-publications?product_id=...`，不得用通用 `/published-articles` 自行推导资格。
- 选择 Product 后再读取其 Published Article 候选；这是合同要求的依赖读取，不新增单一 creation-options read model。
- GEO platform 没有权威候选接口，按当前合同使用必填自由文本。

### 2. Workspace 与表单

- 复用 `WorkspaceShell`、Form Kit、`StickyActionBar` 和现有视觉 token。
- 宽屏显示 context/main/reference 三段；窄屏沿用 `WorkspaceShell` tabs，主表单始终可达。
- Published Article 事实使用页面内响应式字段组，不引入表格框架；窄屏不得产生 document-level 横向滚动。
- `discovered`、`mentioned` 必须逐项显式选择；`accuracy` 允许按合同留空。
- `notes` 遵循服务端当前字符串合同，不擅自收紧为非空业务规则。

### 3. 附件

- 沿用 upload intent → 对象存储传输 → complete 的三阶段协议和 `OPERATION_SCREENSHOT` 类别。
- 传输失败时 abort；complete 失败时保留 intent 并允许仅重试 complete。
- GEO 域内实现最窄的上传组件，不从 publication 域导入内部组件，也不抽取万能上传框架。

### 4. 提交与错误

- 同步防重由提交锁与 mutation pending 状态共同保证，只产生一个 POST。
- 本 Task 不新增 `Idempotency-Key`：当前 create contract、数据库与同类同步创建命令均无幂等存储；浏览器不得伪造一个服务端不消费的 header。
- 已知字段错误映射到对应 FormField；未知字段或请求级问题保留在 ErrorSummary。
- `409 GEO_PUBLICATIONS_CHANGED` 不自动重提；明确提示并允许重新读取候选。重新读取时只按 Published Article ID 保留仍存在的已填值，新候选保持未选择，移除失效候选。

### 5. 导航与成功交接

- 表单变脏后启用 `DirtyGuard`；确认离开时丢弃本地草稿，取消离开时恢复焦点。
- Cancel 返回 canonical `/geo/observations?page=1&pageSize=20`，有未保存内容时走同一 guard。
- 成功后先清除 dirty 状态，再 invalidates GEO lists 和受影响 Product detail，然后导航到已实现的 canonical Observation List。
- Observation Detail 未实现，禁止创建占位成功页或导航到 `/geo/observations/$observationId`。

### 6. 状态、响应式与可访问性

- Product、Query Topic 与 Published Article 候选分别提供真实 loading/error/retry/empty 状态。
- 候选为空时解释无法创建，并可引导至已实现的 Published Articles 列表；Query Topic 为空时阻止提交，但不得链接到未实现的 GEO Topics V2 页面。
- 覆盖 375/768/1024/1440；pending、上传状态和错误变化可被辅助技术感知。
- 所有控件有可见 label、键盘可达、可见焦点；ErrorSummary 可将焦点带到对应字段。

## 验收标准

- [x] `/geo/observations/new` 可直接访问、刷新，并从 Observation List 进入。
- [x] Product 与 Query Topic 来自权威接口；Published Article 候选只来自 GEO eligibility 接口。
- [x] 候选 loading/error/retry/empty 状态真实且可恢复，不做浏览器分页 join。
- [x] 每个候选的当前合同字段均需显式填写或按合同留空，且提交集合完整。
- [x] evidence attachments 完成三阶段上传，并只把已验证文件 ID 放入创建命令。
- [x] 客户端必要字段错误、422 字段错误、403/404/409 与未知请求错误均有明确反馈。
- [x] pending 期间无法重复提交；失败后保留可恢复输入；不会自动重放 mutation。
- [x] DirtyGuard 覆盖 Cancel、Back/Forward 与刷新；确认与取消行为可预测。
- [x] 创建成功 invalidates GEO list 与受影响 Product detail，并交接到 canonical Observation List。
- [x] 不注册 Observation Detail 占位 route，不发送 `supersedes_id`，不修改原 Observation。
- [x] 375/768/1024/1440 无页面级横向滚动，键盘与基础可访问性验收通过。
- [x] generated-type fixture Playwright E2E 覆盖成功、校验/结构化错误、候选刷新和离开保护的关键路径。
- [x] OpenAPI、生成类型、实现、测试与 Frontend V2 文档一致。

## 风险与延后项

- 当前非 logo 文件 complete 后没有“取消表单即删除未引用 VERIFIED 文件”的现成生命周期；本 Task 沿用已批准上传协议，不扩展共享文件生命周期。若观察到孤儿文件积累，应单独修复权威文件清理边界。
- 没有服务端幂等键时，提交已成功但响应丢失后由用户手工重试可能产生第二条 append-only Observation；若该场景成为产品要求，需要独立的幂等合同与持久化设计。
