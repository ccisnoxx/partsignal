# Frontend V2 Phase 5 GEO 完整真实栈 E2E

## Goal

在现有唯一隔离 E2E 栈中补齐 Frontend V2 Phase 5 GEO 的连续验收证据：通过真实
production UI 完成人工 Observation 创建与 append-only Correction，并通过真实 Insights
投影创建 GEO Optimization ContentTask；最终由 PostgreSQL-backed read model 证明历史不可变、
链尾列表和不可变优化来源快照。

## 用户价值

- 将已经分别通过的 GEO List、New、Detail、Correction、Topics、Insights 与 Print 页面证据，
  收束为可重复运行的完整真实业务闭环。
- 防止 fixture、API 直写或客户端推导掩盖真实 UI、FastAPI、PostgreSQL 和对象存储之间的合同缺口。
- 证明更正不会原地覆盖历史，优化任务也不会保存客户端猜测的异常来源。

## 已确认事实

- `docs/frontend-v2/07-migration-plan.md` 的 Phase 5 顺序明确包含“完整 E2E”，且当前状态仍为
  `NOT_MET`；本 Task 不包含后续抽象回顾或 Phase Exit Gate。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:79` 将
  `new observation → detail → correction → original remains immutable` 定义为 GEO 核心 E2E；
  同文档 `:93` 将 `insight anomaly → server revalidate → create optimization task` 定义为
  GEO Optimization 核心 E2E。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:275` 明确 Insights strict fixture 不替代
  完整 GEO real-stack E2E。因此 Flow B 属于本 Task 的 required acceptance。
- `backend/tests/unit/test_geo_insights.py:206` 已证明服务端复算并冻结 source snapshot，`:298`
  已证明 stale anomaly 返回 `GEO_INSIGHT_STALE`；
  `backend/tests/integration/test_geo_insights.py:117` 已证明同 key 并发唯一与完整 payload 比较。
  real-stack 不再重复制造 stale 竞态。
- `backend/tests/integration/test_geo_observation_correction.py:95` 已证明 append-only、冻结字段、
  新旧 evidence 分离与冲突无半成品；`:385` 已证明查询次数不随链长增长。
- `deploy/scripts/e2e-local.sh` 已唯一拥有临时 PostgreSQL、FastAPI、Worker/Beat、fake AI、
  V1/V2 preview、临时对象存储和 EXIT cleanup；`seed-demo` 只创建 `admin` 与
  `content_editor`，不提供 Product、Fact、Platform、Published Article 或 Query Topic。

## Requirements

### R1 — 单一真实栈与隔离

- 只复用 `deploy/scripts/e2e-local.sh`，不得新增 runner、Docker 编排、数据库生命周期、
  storage mock、seed 或逐记录 cleanup。
- 每条 flow 使用 `randomUUID()` 派生的唯一业务数据，不依赖执行顺序、seed 业务对象或残留。
- 使用真实 PostgreSQL、FastAPI、V2 production preview 和脚本已有的对象存储协议替身。
- 测试成功、失败或信号退出都必须保留原始退出码并执行既有 database/storage cleanup；
  cleanup 失败必须使 required gate 失败。

### R2 — Flow A 前置数据与 UI 边界

- API 只建立 GEO workflow 之外的最小前置数据：真实登录、Platform Type/Profile/Account、
  Product、approved FactVersion、approved ContentVersion、PASSED PublishedArticle 和 Query Topic。
- PublishedArticle 沿用现有 Publication real-stack 的最短 API 构造：approved Fact/Content →
  PublicationWork → result → PASSED verification；不复制发布 UI Flow。
- Observation root 与 Correction 的全部目标业务步骤必须通过 V2 UI 完成，不调用 command API、
  不导入 fixture、不使用 `page.route` 或 `route.fulfill`。
- 两次 evidence 都必须通过页面现有 upload-intent → signed transfer → complete 流程写入脚本的
  临时对象存储。

### R3 — Flow A 可观察结果

- `/geo/observations/new` 真实读取 Product、Query Topic 与完整 PublishedArticle candidates；
  用户显式填写每篇文章的 `discovered`、`mentioned` 和 `accuracy`，并提交第一份 evidence。
- 测试捕获创建 POST response ID，并证明页面直接进入该 ID 的 canonical Detail，不搜索 List。
- Detail 展示 Product、非空 Query Topic、GEO platform、search query、逐篇结果、PublishedArticle、
  direct evidence、notes、recorder 和时间。
- 仅从 Detail 的服务端 `CORRECT` 动作进入 canonical Correction Workspace；Product、Query Topic、
  GEO platform 与 search query 以只读事实冻结。
- Correction 通过 UI 填写新的 `tested_at`、article results、notes 和第二份 evidence；提交后使用
  POST response ID 进入新链尾 Detail。
- 新 Detail 按 root → tail 展示完整 history；新节点 `supersedes_id` 指向原尾，只关联新 evidence，
  不复用原 evidence。
- 原节点的 ID、`tested_at`、article results、notes、direct evidence 与 recorder 全部保持不变。
- Observation List 的 UI 与 `list-items` 权威响应都只返回新链尾；直接访问原 ID Detail 仍展示其
  只读历史身份和原始数据。

### R4 — Flow B required acceptance

- API 以最少且确定的数据建立一个明确 `CONTENT_DECLINE`：同一 PublishedArticle 在上一周期 3 次
  全部发现/提及、当前周期 3 次全部未发现/未提及；不通过 UI 重复录入非目标样本。
- `/geo/insights` 通过真实 GET read model 展示服务端投影的 decline，只有 non-null
  `optimization_action` 的行显示“创建优化任务”。
- Dialog 打开前不读取 creation options；打开后读取真实 Product、Platform Profile 和 approved
  FactVersion options。
- UI 以单次、非空 `Idempotency-Key` 提交优化任务；服务端按当前数据库状态复算成功后，页面用
  response `ContentTask.id` 进入 canonical Task Detail，不搜索 Content Task List。
- Detail UI 与最终 API 同时证明目标 Product/Platform/Fact 正确，且 `source.geo_optimization`
  保存 `CONTENT_DECLINE`、周期、PublishedArticle 和服务端 basis snapshot。
- stale 拒绝、Coverage target 复算和同 key 并发不在 real-stack 重复：继续由上述现有 targeted
  backend tests 与 strict fixture 负责。

### R5 — 浏览器失败证据

- 两条 flow 都将非预期 `console.error`、`pageerror` 与 `requestfailed` 纳入 afterEach 失败证据。
- 等待只基于 UI、HTTP response、canonical URL 或 Playwright `expect.poll`，不得使用任意 sleep。
- API helper 对任何非 2xx response 输出 status、URL 与 body 后显式失败，不返回固定成功数据。

### R6 — 范围纪律

- 默认只新增一个 GEO real-stack spec、接入现有执行列表，并在 required gate 通过后更新 Phase 5
  路线、验收文档和 E2E isolation stable spec。
- 若真实栈暴露生产、OpenAPI、数据库或 backend test 缺口，先归因并停止到用户决策点；不得在
  本 Task 内自动扩张合同或修复生产代码。
- 不创建跨文件 real-stack helper framework；只有两个当前消费者共同需要时，才保留一个文件内
  前置数据函数。
- 2026-08-13 real-stack 已验证 `page_size=20` 被 FastAPI 误拒为 422；用户已批准在本 Task 内
  最小修复 GEO List query parsing，并补一条实际 HTTP 回归测试。该批准不扩张到 OpenAPI、
  service、database、generated types 或其他分页端点。

## Acceptance Criteria

- [x] AC1：新增 `geo-real-stack.spec.ts`，包含相互独立的 Flow A 与 Flow B 两条测试；默认 fixture
  运行时 skip，只由 `PARTSIGNAL_E2E_REAL_STACK=1` 开启。
- [x] AC2：Flow A 的非目标前置数据全部由 API 最小构造，Observation root 与 Correction 全部由
  V2 UI 完成，两份 evidence 真实经过三阶段对象存储协议。
- [x] AC3：Flow A 使用两次 POST response ID 进入 canonical Detail，并在 UI 和最终权威 API 两层
  证明原记录不变、新节点 append-only、新旧 evidence 分离与 root→tail history。
- [x] AC4：Flow A 的 List UI 与 `list-items` API 都只显示 correction tail；原 ID Detail 仍保持只读
  历史身份和原始字段。
- [x] AC5：Flow B 的真实 Insights GET 返回服务端 `CONTENT_DECLINE` action；Dialog 按需读取 options，
  UI 带唯一 Idempotency-Key 创建任务并按 response ID 进入 Content Task Detail。
- [x] AC6：Flow B 的 Task Detail UI/API 保存正确目标和不可变 GEO source snapshot；real-stack 不重复
  stale 或并发竞态测试。
- [x] AC7：浏览器 console/pageerror/requestfailed 审计为空，测试没有 route mock、固定成功 backend、
  任意 sleep 或执行顺序依赖。
- [x] AC8：`e2e-local.sh` 的现有 V2 fixed list 包含 GEO spec，仍只使用一个 database/storage/service
  生命周期；不修改 Playwright config、Makefile 或增加第二入口。
- [x] AC9：唯一 required real-stack gate 退出码为 0；日志记录两条 GEO flow 结果及 database/storage
  cleanup，事后 PostgreSQL、storage、端口和独占 Redis 检查通过。
- [x] AC10：只有真实 gate 通过后，`07`、`08` 与 `.trellis/spec/infra/e2e-isolation.md` 更新为实际
  已通过证据；生产代码只包含已批准的 GEO List query parsing 修复及其 backend API 回归测试，
  OpenAPI、generated types、service 与 database 保持不变。

## Out of Scope

- generated-type fixture E2E 重写或重复其 loading/error/responsive/keyboard/stale 矩阵。
- 第二套 E2E orchestration、通用 E2E framework、Page Object hierarchy 或共享业务 DSL。
- GEO vertical slice 抽象回顾、Phase 5 Exit Gate、Phase 6、Workbench、Cutover。
- 旧 `frontend/` UI、生产功能、OpenAPI、database schema/migration、generated types 或 backend
  integration tests 的无证据修改。
- 通过 Content Task List 搜索新 ID、测试级逐记录删除、生产后门或固定成功入口。

## Blocking Open Questions

无。Flow B required/optional 已由当前路线、验收文档与 backend 证据确定。
