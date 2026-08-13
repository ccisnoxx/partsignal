# Frontend V2 Phase 5 GEO 完整真实栈 E2E — 技术设计

## 1. 设计结论

新增 `frontend-v2/tests/e2e/geo-real-stack.spec.ts`，包含两个串行、数据独立的测试；在
`deploy/scripts/e2e-local.sh` 的现有 fixed V2 spec list 中追加该文件。没有现存 GEO real-stack
spec 可自然承载这两条 flow；扩展 Publication spec 会混淆 domain ownership，因此独立单文件是
文件数和所有权都最小的方案。

```text
Flow A
API non-target prerequisites
  → V2 New Observation + evidence 1
  → response ID Detail
  → server CORRECT action
  → V2 Correction + evidence 2
  → response ID tail Detail
  → List tail-only + original readonly Detail
  → final authoritative Detail/list-items assertions

Flow B
API non-target prerequisites + six deterministic observation samples
  → V2 Insights server projection
  → non-null optimization action
  → on-demand creation options
  → V2 optimization POST
  → response ID Content Task Detail
  → final immutable GEO source assertion
```

初始设计不修改 production runtime、API contract、database、Playwright config、Makefile 或 backend
tests。真实栈随后验证出 GEO List 将合法 `page_size=20` 拒为 422；用户已批准只在 FastAPI router
复用现有 `BeforeValidator(int)` query parsing 模式，并用 TestClient 冻结该 HTTP 边界。OpenAPI、
service 类型、database 与 generated types 均不变化。

## 2. 文件内测试结构

沿用现有 real-stack spec 的窄模式：

- generated OpenAPI `components['schemas']` 作为测试类型来源；
- `realStackEnabled`、`apiBaseUrl`、seed admin password、`test.skip`；
- `responseBody<T>()` 对非 2xx 显式失败；
- `login()` 使用真实 `POST /auth/login`，同一 browser context 保留 cookie；
- `createGeoPrerequisites()` 是唯一文件内共享前置函数，只有 Flow A/B 两个当前消费者；
- 不提取跨 spec helper，不创建 builder class、options framework、fixture 或 page object。

`test.beforeEach/afterEach` 直接维护当前 page 的 runtime error 列表：收集非预期
`console.error`、全部 `pageerror` 与 `requestfailed`，afterEach 断言为空。这样即使业务断言提前失败，
Playwright 报告仍包含已收集的浏览器证据。

## 3. 共同最小前置数据

`seed-demo` 只提供真实账号，因此每条 flow 使用唯一 suffix 依次通过 API 创建：

1. `POST /platform-types`；
2. `POST /platform-profiles`，使用唯一 `.example.invalid` domain；
3. `POST /platform-accounts`；
4. `POST /products`；
5. `GET/PUT /products/{id}/facts` → submit → approve，得到非空 `APPROVED` FactVersion；
6. `POST /content-tasks` → manual version → submit → approve；
7. `POST /publication-works` → `PUT .../result` → `POST .../verifications` with `PASSED`，得到
   同 ID PublishedArticle；
8. `POST /query-topics`。

Platform Profile 同时是 PublishedArticle 的冻结内容平台和 Flow B 优化任务 target；FactVersion
同时满足 GEO Optimization creation options。该路径直接复用
`publication-workspace-real-stack.spec.ts` 的现有数据构造顺序，不复制发布 UI Flow，也不需要新的
production seed。

每条 flow 独立调用前置函数并使用不同 suffix，不共享 Product、Article、Topic、Fact 或 Platform。

## 4. Flow A 设计

### 4.1 New Observation

1. 进入 `/geo/observations/new`；在 Product 搜索框输入唯一 part number 并提交搜索，避免同一
   real-stack 运行中其他 spec 的 Product 污染首屏 20 条。
2. 选择真实 Product、Query Topic，等待真实 candidate endpoint 返回唯一 PublishedArticle。
3. 填写唯一 GEO platform/search query、root `tested_at`、notes；对候选显式选择
   `discovered=true`、`mentioned=false`、`accuracy=PARTIAL`。
4. 用 `setInputFiles` 选择唯一 PNG；页面现有 `GeoEvidenceUpload` 负责 upload intent、真实 signed
   transfer 和 complete。只等待文件名/完成状态，不直接调用 File API。
5. 在点击“创建 Observation”前注册 `waitForResponse`，读取真实 POST body，记录 root ID；断言
   canonical URL 与该 ID 一致。

### 4.2 Detail 与 Correction

1. Root Detail 断言 Product、Topic、platform、search query、结果、Article、第一份 evidence、notes、
   recorder 与时间。
2. 只打开 Detail 的“更多操作”，点击服务端投影的“更正”；断言 canonical correction URL 使用
   root/tail ID。
3. Workspace 断言 Product、非空 Topic、platform 与 search query 只读冻结，无对应 textbox。
4. 填写新的 `tested_at`、notes，将 article result 改为
   `discovered=false`、`mentioned=false`、`accuracy=UNJUDGEABLE`，并通过同一真实对象存储上传第二
   个唯一 PNG。
5. 捕获 Correction POST response，记录 tail ID；断言 response `supersedes_id == rootId`，并按
   response ID 进入新 Detail。

### 4.3 UI 与权威 API 双层不可变断言

UI：

- tail Detail 出现“原记录”和“更正 1”，且两份 evidence 分属不同节点；
- root 节点继续显示原时间、原 article facts、原 notes 与原 recorder；tail 显示新 facts/notes/time；
- `/geo/observations?productId=<id>&page=1&pageSize=20` 只出现 tail canonical link；
- 直接访问 `/geo/observations/<rootId>` 仍以历史原记录身份显示 root 原始字段，不变成 tail 数据。

最终只读 API：

```text
GET /api/v1/geo-observations/{rootId}/detail
GET /api/v1/geo-observations/{tailId}/detail
GET /api/v1/geo-observations/list-items?product_id=<productId>&page=1&page_size=20
```

- 两个 Detail 都返回同一 `chain_root_id/rootId` 与 `chain_tail_id/tailId`，history 顺序精确为
  `[rootId, tailId]`；
- root history node 与创建 POST snapshot 比较 ID、tested_at、article_results、notes、
  attachment IDs、recorder；
- root direct evidence 只含 evidence 1，tail direct evidence 只含 evidence 2；
- tail `supersedes_id == rootId`；
- list-items 对该 Product 精确只含 tail，不含 root。

不比较会合法派生变化的 tail action 或 signed evidence URL；比较稳定 ID、文件身份与业务字段。

## 5. Flow B 设计

### 5.1 确定性 anomaly

选择后端 integration 已验证的 `CONTENT_DECLINE`，而不是 stale race 或长未提及启发式：

- Insights 周期固定 `2026-07-01` 至 `2026-07-31`；上一周期由服务端推导；
- API 创建 3 个 `2026-06-10..12` root observations，唯一 Article 均
  `discovered=true/mentioned=true/accuracy=ACCURATE`；
- API 创建 3 个 `2026-07-10..12` root observations，同一 Article 均
  `discovered=false/mentioned=false/accuracy=ACCURATE`；
- 所有 observation 使用同一唯一 Product、Topic 与 `Perplexity`，完整提交当前唯一候选集合。

这恰好满足每周期至少 3 个 observation、discovery/mention 从 1.0 降到 0.0 且下降值大于 0.1；
没有 sleep、时钟竞态、残留依赖或额外样本。Observation POST 在 Flow B 中只是非目标 anomaly
precondition，目标 workflow 从 Insights UI 开始。

### 5.2 Insights → Optimization Task

1. 进入带 `from/to/productId/contentPlatformId/publishedArticleId` 的 canonical Insights URL，等待真实
   GET；断言 decline row、`CONTENT_DECLINE` 展示语义和“创建优化任务”。
2. 在点击按钮前确认没有 creation-options 请求；打开 Dialog 后等待一次真实 options GET。
3. Product 与目标 Platform 应由服务端 action identity 预选；显式选择 approved FactVersion。
4. 对“创建任务”双击或快速重复触发，断言 pending guard 只产生一个 POST；捕获非空
   `Idempotency-Key`、request body 与 response task ID。
5. 断言页面直接进入 `/content/tasks/{response.id}`；UI“来源上下文”显示 GEO Optimization、
   内容表现下降、周期及对应 Article/platform 摘要。
6. 最终 `GET /content-tasks/{id}/detail` 断言 task Product/Platform/Fact、
   `source.geo_optimization.rule_code/date_from/date_to/published_article_id/basis` 与服务端 action 一致。

stale 拒绝不在该 flow 中人为制造。现有 unit test 已确定性移除 anomaly 后断言
`GEO_INSIGHT_STALE`，fixture 已验证前端保留表单且不 replay；integration 已验证同 key 并发唯一。
重复这些证据只会增加运行时间和 flaky surface。

## 6. Orchestration、时间预算与 cleanup

`deploy/scripts/e2e-local.sh` 只增加：

```text
tests/e2e/geo-real-stack.spec.ts
```

它与现有五个文件共用同一数据库、服务、端口、production preview 和 storage 生命周期；新 spec
排在已有真实栈 specs 之后、`--project=foundation-desktop` 之前。`playwright.config.ts` 已固定
`workers=1`、`fullyParallel=false`，无需修改。

- 新增 2 个测试；每个沿用 `test.setTimeout(90_000)`，串行最坏增量 180 秒。
- Flow A 只有一次 root/correction UI mutation，Flow B 的六个样本由 API 快速准备；90 秒单测上限
  与现有 real-stack specs 一致。实际耗时以首次 required gate 记录为准，不预先声称性能结果。
- required gate 仍只运行一次；修复迭代先用 lint/typecheck/shell syntax/diff check，只有代码或环境
  发生能影响真实栈结果的变化才重新运行。

运行前只读确认 5173、4173、4174、8000、9001 与 storage port 未被未知 listener 占用，并确认
Redis logical DB 独占且为空。脚本负责停止本次进程、drop allowlisted database、删除临时 storage；
调用方在进程停止后只清理已确认属于本次 Celery 的 binding keys，再断言独占 Redis 为空。不得
使用 `FLUSHDB` 或终止未知进程。

完整 stdout/stderr 先 `tee` 到 `mktemp` 日志；随后把命令、退出码、Flow A/B Playwright 结果、
database/storage cleanup 行和事后只读检查写入 Task `research/validation.md`，再删除临时原始日志。

## 7. 精确文件范围

### 计划修改

- `frontend-v2/tests/e2e/geo-real-stack.spec.ts`
- `deploy/scripts/e2e-local.sh`
- `docs/frontend-v2/07-migration-plan.md`（仅 required gate 通过后）
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`（仅 required gate 通过后）
- `.trellis/spec/infra/e2e-isolation.md`（仅 required gate 通过后）
- 当前 Task 的规划与 `research/validation.md`
- `backend/app/routers/observation.py`（已批准的 `page_size` query parsing 修复）
- `backend/tests/unit/test_contract.py`（`page_size=20` 实际 HTTP 回归）

### 计划不修改

- `frontend-v2/playwright.config.ts`、Makefile、package manifests/lockfiles；
- GEO generated-type fixtures/specs 与其他 real-stack specs；
- frontend production runtime、OpenAPI、database contract/migration、generated types；
- backend service 与 integration tests（修复由窄 TestClient 回归覆盖）。

## 8. 风险、停止条件与回滚

| 首个失败 | 处理 |
| --- | --- |
| API prerequisite 不再成立 | 对照现有 Publication real-stack 合同；若为既有/环境失败则停止，不改产品 |
| New/Correction UI 与真实 API 分歧 | 保留 response、runtime error 与最终数据库投影；报告已验证缺口，不放宽测试 |
| append-only、evidence 或 list tail 不成立 | 数据完整性缺陷；立即停止，不通过局部 selector patch 掩盖 |
| Insights 无 action 或命令 stale | 核对六个样本和筛选；样本错误只修测试，真实服务分歧则停止 |
| 其他既有 real-stack/V1 spec 失败 | 先确认目标 GEO 两 flow 结果；记录归因，不修无关代码、不无变化重跑 |
| cleanup 不完整 | 整个 gate 失败；完成精确资源清理并报告，不宣称验收完成 |

代码回滚点是审批后从最新 `main` HEAD 创建临时分支前记录的 commit；此时工作区仅允许已知的 Task
规划文件，它们随临时分支带入而不在 `main` 预先提交。测试、脚本一行与证据文档可作为一个
无 migration 的原子提交整体回滚。运行时回滚由现有 allowlisted database/storage/process cleanup
与已确认独占 Redis 的精确清理组成。
