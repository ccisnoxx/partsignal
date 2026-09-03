# Frontend V2 功能合同一致性审计设计

## 1. 审计对象与权威顺序

本审计以 37 条 canonical V2 路由为观察入口，但不把浏览器页面当业务规则 owner。判定顺序如下：

1. `contracts/database.md`：持久化状态、immutable/append-only、删除与历史保留规则。
2. `contracts/openapi.yaml`：HTTP 路径、请求、响应和 read model shape。
3. backend service/router：权限、状态转换、锁、revision、idempotency 和命令最终裁决。
4. Frontend V2 文档：页面业务目标、Pattern、URL、交互和验收表面。
5. generated client 与 frontend domain：是否直接消费合同、是否重建资格或拼接业务快照。
6. tests：证明哪些边界已执行，哪些只有静态、mock、fixture 或 service-level 覆盖。

若页面蓝图与 OpenAPI/数据库合同冲突，记录为合同决策 Task，不由前端自行补按钮或隐藏能力。

## 2. 每条路由的判定字段

矩阵对每条路由记录以下合同：

- 路由和 Pattern：List、Form、Detail、Workspace、Analytics、Print 等。
- 业务目标：页面要帮助用户完成的唯一高层任务。
- 当前实现与 read model：是否存在单一首屏 owner，按需 secondary query 是否被文档允许。
- 业务阶段和动作来源：直接来自服务端 `workflow_stage`、`primary_task`、`available_actions`，或该 read model 明确没有这些字段。
- 前端推导/拼接：区分展示映射、允许的 options query、客户端业务资格推导和跨快照 join。
- URL 与状态表面：canonical search/hash、direct/refresh/Back/Forward、loading、empty、error、409、403/404。
- immutable/permission：readonly snapshot、Markdown 单一正文源、ADMIN UX boundary 与服务端最终权限。
- 测试：组件/模型、fixture E2E、真实栈、backend HTTP/service；没有把后两者混为一谈。
- 差距、严重度和后续独立 Task。

## 3. 否定结论边界

“未发现前端业务推导”仅表示在指定 route/domain/API owner 中，动作资格未按 status、role、关联集合或分页结果重建；展示 label、URL canonicalization 和 typed action token 到 UI 命令的映射不算业务推导。

“无接口拼接”表示首屏业务快照来自一个专用 read model。文档明确允许的 creation-options、filter options、active tab secondary query、打开 Dialog 后的 options query不算违规。AI Channel Workspace 当前四个独立面板是否必须同快照仍是合同决策，不直接判成实现错误。

“符合”是本轮静态和已有测试证据下未发现实质偏差，不替代运行时、并发或生产验收。

## 4. 高风险专项

### 4.1 服务端最终权威

对每个写流程同时检查 read model action projection 和 command guard。若 UI 隐藏动作但命令仍接受，则以命令实际副作用定级。发布换版后核验能够组合新内容版本与旧登记结果并形成不可变核验/PublishedArticle，故为 P0。

### 4.2 并发与 snapshot

只在已有规范要求锁内复算或命令会持久化来源快照时判定并发缺口。GEO optimization 在默认 `READ COMMITTED` 下先复算后进入 Product 锁域，存在写入 stale basis 的窗口，故为 P1；该结论要求真实 PostgreSQL 并发测试关闭。

### 4.3 HTTP 与 generated contract

OpenAPI/schema 同步不能证明 FastAPI query binding 正确。`/geo/topics` 的 `Literal` page_size 在 HTTP 字符串边界缺少 `BeforeValidator(int)`，合法显式值返回 422；必须由 TestClient 真实路由绑定测试证明修复。

### 4.4 跨标签 deletion projection

服务端返回的 `deletion` 和 `available_actions` 是动态 projection。窗口重新聚焦后，Dialog 若继续保存点击时完整对象快照，就会违反当前稳定状态所有权规范。相关后续 Task 以“ID 本地状态 + 最新 query 派生”为一个结构不变量，不引入轮询或全局 store。

## 5. Task 拆分原则

- 一个 Task 只修一个业务不变量或一个合同决策。
- P0/P1 服务端权威修复不夹带前端文案、缓存体验或广泛测试清理。
- 合同决策 Task 先冻结权威语义，再派生 backend/OpenAPI/frontend 实现 Task。
- 测试收口 Task 在功能修复稳定后执行，避免先把错误行为写成更牢固的 fixture。
- 部署后复验属于对应修复 Task 的关闭证据，不在本审计 Task 发起生产写请求。

## 6. 交付形式

完整证据和逐路由结论写入 `research/route-conformance-matrix.md`。聊天只汇报关键结论、优先顺序、首个实施 Task 和验证限制，避免复制 37 行长表。

## 7. 最终集成与归档边界

原始矩阵继续作为 2026-08-30 时点的审计快照，不回写成“从未存在缺口”。最终状态通过矩阵顶部的处置台账表达，区分三类事实：

1. 已由独立 Task、工作提交、定向验证和 Review 关闭的缺口；
2. 已完成规划但仍需独立合同决策或实现的后续项；
3. 线上验收中的 `FAIL`、`NOT_RUN` 或 `BLOCKED` 结果，不因代码随后修复或父 Task 归档而篡改。

父 Task 不承载产品修复。最终收尾只核对归档关系、提交 ancestry、37 路由闭集、完整 response contract gate 和 generated client 同步，并更新自身文档。若核对要求修改产品代码、OpenAPI、generated client、测试、数据库合同或业务设计文档，应停止归档并转入独立 Task；本次核对未出现该情况。

`integrity-error-domain-mapping` 与 Article、AI operation history 等合同决策继续保持独立边界。父 Task 的归档既不授权这些工作，也不把未决语义解释为已符合。
