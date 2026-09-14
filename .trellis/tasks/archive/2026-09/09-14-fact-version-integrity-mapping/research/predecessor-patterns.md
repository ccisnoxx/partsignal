# Research: FactVersion 完整性映射前置任务模式

- Query: 从父任务、Content/Generation IntegrityError 合同决策 owner 及四个已完成 implementation Task 中提炼本 I5 planning 应继承的任务结构、FactVersion constraint classifier、事务回滚、Product 锁并发、前端恢复、validation 命令和文件边界；核对并排除父任务中把 FactVersion owner 写成 `replaceProductFactsDraft` 的过时研究。
- Scope: mixed（内部任务工件、稳定规范、current-head 代码、ORM/migration、合同和测试模式；无外部网页资料）
- Date: 2026-09-14

## Findings

### 1. 继承的规划结构

本 I5 与四个前置实现任务都是高风险持久化/并发边界，不能只写轻量 PRD。应保持以下结构，并在本任务目录内完成收敛：

- `prd.md`：只写目标、依赖、已确认事实、两个约束的硬性需求、非目标、允许/只读边界、可测试验收标准；不把技术步骤或执行命令塞进需求章节。
- `design.md`：写唯一 command owner、当前 precheck/lock/flush/commit 数据流、exact diagnostics 分类、两条约束不同的领域结果、rollback/Session 复用、正常并发与旁路 sentinel 的区别、公共合同/前端投影、停止条件和取舍。FactVersion identity 与 pending 的共同 owner 可以放在一份设计中，但必须逐项给出不同结果。
- `implement.md`：按“实施前门禁 → backend 测试/最小实现 → frontend 证据（如有必要）→ 稳定文档同步 → zero-diff/独立 review”排序；分开 required 与 optional validation，写出最多两轮 repair→targeted re-check、一次独立 review/一次 targeted re-review、停止和可回退边界。明确本轮不执行 `task.py start`，不提交、不归档、不 push。
- `research/`：保留 current-head/owner/测试证据，尤其是 current-head PostgreSQL catalog 与实际 diagnostics 必须作为 implementation 期证据，不以命名约定替代。
- `implement.jsonl` 与 `check.jsonl`：只注入稳定 spec 和 research，不注入 production/test 文件路径作为 JSONL 的“代码上下文”，也不保留 `_example` 模板；implement/check 各自应有 backend 入口、错误与数据库规范、前端状态规范、合同决策和本 I5 research。

前置模板的可复用顺序证据：

- `archive/2026-09/09-06-generation-job-idempotency-integrity-mapping/implement.md:1-143` 以实施前置条件、允许/零 diff、分阶段实施、required/optional、停止/回退、完成定义组织；`implement.jsonl`/`check.jsonl` 各 6 行，均为真实 spec/research 引用。
- `archive/2026-09/09-06-content-task-idempotency-integrity-mapping/implement.md:1-130` 将 identity、正常 advisory-lock 并发、旁路 exact-constraint sentinel、HTTP、原子性和文档同步分别列出；其 planning review 明确要求有界同步和真实 PostgreSQL 用例不得被 skip 冒充通过（`research/planning-review.md:1-28`）。
- `archive/2026-09/09-07-content-version-identity-integrity-boundary/implement.md:1-72` 进一步把 worker 与 HTTP 两个 transaction owner 分开，要求 current-head catalog、晚期失败、Session 复用及 protected zero-diff gate；`research/execution-results.md:1-68` 记录了失败归因、修复次数和最终 file-level gate，表明实施计划必须预先写清停止规则和证据成本。
- `archive/2026-09/09-14-content-version-review-state-integrity-mapping/implement.md:1-118` 把 backend command、frontend recovery、stable spec 和独立 review 作为独立阶段；其 `research/planning-review.md:1-32` 说明了 planning review 如何纠正 zero-diff owner 遗漏与权限 owner 误写，适合作为 I5 planning review 的门槛模式。

### 2. current-head FactVersion owner 与约束事实

唯一的 FactVersion INSERT owner 是 `product_facts.submit_fact_review`，不是 workspace save command：

- `backend/app/services/product_facts.py:633-657` 的 `replace_product_facts` 只锁 `Product`、校验 `facts_revision`、更新 `products.facts_body_markdown`/`facts_classification` 并递增 `facts_revision`；它不构造或插入 `FactVersion`。
- `backend/app/services/product_facts.py:660-715` 的 `submit_fact_review` 锁 `Product`（`:673` 附近）、按既有顺序检查 active/revision/body/pending（`:668-684`）、以 `max(FactVersion.version)+1` 分配版本（`:685-695`），插入 `PENDING_REVIEW` `FactVersion`（`:696-706`），再追加 `FactReviewRecord` 并在 `:707-715` commit。这是两个 constraint 的共同 command/事务 owner。
- `backend/app/routers/product_facts.py:287-310` 将该 command 暴露为 `POST /api/v1/products/{product_id}/fact-review-submissions`、operationId `submitProductFactReview`，保留既有 201/409/422 等 response metadata；`replaceProductFactsDraft` 的 router owner 在 `:220-244`，只调用 workspace update。
- 当前 ORM `backend/app/models/product_facts.py:60-79` 声明 `(product_id, version)` 未显式命名的 `UniqueConstraint`、`uq_fact_versions_one_pending_per_product` partial unique index（`product_id`，`status = 'PENDING_REVIEW'`）及相关 status/classification CHECK。
- 冻结 bootstrap model `backend/app/migration_schema_v1.py:304-314` 保留 `(product_id, version)` unique；`backend/alembic/versions/0035_business_workflow_primary_tasks.py:174-185` 显式创建 pending partial unique index。`contracts/database.md:413-423` 只冻结 owner 内版本号唯一、owner lock、workspace revision、每产品至多一个 pending 的持久化不变量。

### 3. 必须纠正的过时 owner 研究

父任务的历史矩阵仍有事实偏差，不能复制进 I5：

- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/database-constraint-matrix.md:102` 将 `uq_fact_versions_product_id` 写成“审核/版本创建”但未明确正确 command；更明确的错误在 `.trellis/tasks/09-04-integrity-error-domain-mapping/research/database-constraint-companion.csv:171`，把 `uq_fact_versions_one_pending_per_product` owner 写成 `product_facts.replace_product_facts` / `replaceProductFactsDraft`。同一 companion 的 version row（邻近行）也曾把事实约束归入 workspace owner。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/research/database-constraint-audit.md:33-34,43,58-63` 和 `research/public-contract-frontend-impact.md:39-40,109` 已依据 current-head code 明确纠正：两个 FactVersion INSERT constraint 都归 `submit_fact_review`；`replace_product_facts` 只更新 Product workspace，不能成为 FactVersion sentinel/mapper owner。
- 因此 I5 只允许修改 `backend/app/services/product_facts.py` 的 submit command 及用户指定的 product-facts integration/test 文件；不得为了“修正历史 research”改写父任务、合同决策 owner 或把 `replaceProductFactsDraft` 纳入实现。新计划应在 dependency/notes 与 manifests 中显式写 `submit_fact_review` owner，防止旧矩阵回流。

### 4. classifier 与两条失败语义的继承模式

前置任务共同冻结的技术边界是“结构化 diagnostics 只做窄分类，caller 拥有 rollback 和领域转换”：

- classifier 只读取 `error.orig.sqlstate` 和 `error.orig.diag.constraint_name`；只有 `sqlstate == "23505"` 与精确名称同时匹配才是 known。不得读取 `str(error)`、`message_primary`、SQL 文本、列值、模糊前缀或 rollback 后查询来猜约束。
- classifier 无副作用：不 rollback、不查询、不构造 HTTP envelope、不 dispatch、不吞掉 unknown。业务 command 在自己拥有的 flush/commit 边界捕获，并在分类后先 root `db.rollback()`。
- `archive/2026-09/09-06-generation-job-idempotency-integrity-mapping/research/current-head-generation-idempotency.md:50-75` 与 `implement.md:1-143` 规定了 caller-owned rollback/requery，但这是幂等 identity 的特殊模式；I5 的 version identity 不能从 unique 约束推导 winner，不得套用 Generation Job replay。
- `archive/2026-09/09-06-content-task-idempotency-integrity-mapping/design.md:4-8`、`research/current-head-content-task-idempotency.md:45-89` 将正常锁并发与绕过锁的 unique sentinel 分离，并要求 exact constraint 后 rollback、验证 winner；这可借鉴测试分层，但 I5 的 `uq_fact_versions_product_id` 结果必须是原始 `IntegrityError` unknown。
- `archive/2026-09/09-14-content-version-review-state-integrity-mapping/research/backend-review-integrity-evidence.md:68-83,100-123` 给出最接近的状态约束模式：known pending 才在 command root rollback 后转 AppError，approved/unknown 原抛；I5 应采用同样的 action-local allowlist，但 pending 已有 `FACT_REVIEW_PENDING`，不新增 code。

I5 的精确分类矩阵应冻结为：

| 输入 | `uq_fact_versions_product_id` | `uq_fact_versions_one_pending_per_product` |
|---|---|---|
| `23505` + 精确目标名称 | 原始 `IntegrityError` unknown/default 500；不改号、不 replay、不返回 pending/revision | root rollback 后 `AppError("FACT_REVIEW_PENDING", "该产品已有待审核事实版本", 409, {})` |
| `23505` + 另一条目标名称 | 原始 `IntegrityError` | 原始 `IntegrityError` |
| 非 `23505`、缺 `orig`/`diag`/name、CHECK/FK/NOT NULL/trigger-like 或近似名称 | 原始 `IntegrityError` | 原始 `IntegrityError` |

pending 的 precheck（现有 `product_facts.py:678-684`）与 exact partial-index race 必须除当前 request ID 外产生完全相同的 409 合同；不得把任意 `23505` 归入 pending。version identity 即使精确命中，也代表 Product lock/version allocator 不变量被绕过或数据异常，不能根据数据库错误或后查询猜 canonical winner。

### 5. 事务、回滚和并发测试模式

#### 5.1 正常 Product 锁对照

- 生产行为必须保持 `submit_fact_review` 先锁 Product（`backend/app/services/product_facts.py:667-684` 的 `FOR UPDATE` 查询及后续 precheck），再查询 pending 和 `max(version)+1`；不得为了使 race 测试可达而移除或削弱锁。
- 两个正常同 Product 提交应以独立 Session/连接、event/barrier 和有界 timeout 证明串行：先取得锁并提交的请求创建唯一 pending；后到请求取得锁后命中现有 pending precheck，返回 `FACT_REVIEW_PENDING`，而不是依赖 unique violation。测试名称和说明要将这个生产锁对照与旁路 sentinel 分开。
- 预检查与数据库最终约束都只是同一个业务结果的两条入口：precheck 读取既有 pending，最终 partial index 是旁路/窗口下的数据库 authority。I5 不应把正常锁失败描述成 database race，也不应让测试绕过生产 Product lock。

#### 5.2 两类最终失败与原子性快照

- version identity sentinel/race：在 Product lock/普通 lookup 后由 test-only 独立连接制造候选插入真实 `23505 + uq_fact_versions_product_id`；service 捕获后不得创建第二个版本、不得再查 winner、不得改 `version`、不得 replay。root rollback 后调用方 Session 应可继续查询。
- pending sentinel/race：在 submit 已通过非空/revision/无 pending precheck 后，以 test-only 独立连接或受控事件提交另一个 pending，让候选 INSERT 真实命中 `uq_fact_versions_one_pending_per_product`；service rollback 后抛现有 `FACT_REVIEW_PENDING`。race 完成后数据库最多一条 pending FactVersion 和对应一条 FactReviewRecord，不得有候选的部分 ReviewRecord。
- 对两类失败都应在调用前后比较：候选 `FactVersion` 行数；候选 `FactReviewRecord` 行数；Product `facts_body_markdown`、`facts_classification`、`facts_revision`；已存在 pending FactVersion 的正文、状态、revision；ContentTask pointer；ContentVersion；成功 `AuditLog`；dispatch 计数/调用（该 command 当前没有 broker dispatch，但仍应通过 owner 证据明确“无此副作用”）。
- known pending、unknown version identity 和其他 unknown 失败都必须在 Session rollback 后继续执行查询；独立 Session 再核对持久化快照。失败 candidate 不应污染 success audit；Fact review submit 当前直接追加 `FactReviewRecord`，没有成功 AuditLog 或 broker dispatch，测试应基于真实 owner 不伪造不存在的副作用。
- SQLAlchemy flush/commit 失败后 Session 进入 failed state，先 rollback 才能继续查询；不能把 rollback 藏进 classifier。若 implementation 在 flush 失败后需要保持 pending 状态但无法根回滚，应停止并报告，不引入 savepoint 或第二个事务 owner。

前置实现的测试设计可直接继承：真实 PG fixture + 参数化 diagnostics negative matrix + 独立连接/屏障 + HTTP sentinel + no-leak + file-level tests。`archive/2026-09/09-06-content-task-idempotency-integrity-mapping/research/validation-closeout.md:19-39` 还提示：PostgreSQL fixture 曾 skip 时不能算通过，必须记录真实容器中 0 skipped 的结果；`archive/2026-09-14-content-version-review-state-integrity-mapping/research/execution-results.md:8-31` 提示 HTTP exact failure 必须绑定到第二次真实 constraint，listener/override 必须用 `try/finally` 清理，避免假阳性和资源泄漏。

### 6. 前端恢复模式与 I5 最小边界

现有 facts workspace 已基本满足 pending 恢复，但 planning 必须把证据补全为 exact-code 行为：

- `frontend/src/domains/product/fact-workspace-page.tsx:164-208` 的 `submitReview` 目前只对 `REVISION_CONFLICT` 设置 conflict；对 `FACT_REVIEW_PENDING` 或 `INVALID_STATE_TRANSITION` 调用 `onReload()`。`onReload` 是显式 query refetch；提交 catch 不会自动再次调用 `submitProductFactReview`。
- `frontend/src/domains/product/fact-workspace.model.ts:49-65` 的 `mapFactReviewError` 保留结构化 `code` 与 `requestId`；`factWorkspaceErrorKind` 不根据 message 判断。`fact-workspace-page.tsx:223-230` 将 request ID 放入 ErrorSummary；`resolveFactWorkspaceActions`（model `:72-123`）以服务器 `available_actions` 为动作来源。
- `frontend/src/domains/product/fact-workspace-page.test.tsx:148-207` 已覆盖 revision conflict 保留本地正文、request ID 和显式 reload；`:236-308` 已覆盖提交成功后 refetch/read model 收敛、隐藏重复提交；这些是 I5 回归基线，不应改成版本 identity 失败的 reload/replay。
- I5 required frontend cases应补/确认：exact `FACT_REVIEW_PENDING` 显示服务端 message 与 request ID、保留安全工作区输入、只显式刷新 canonical workspace、刷新失败保留错误和 request ID、刷新成功依据服务器 `available_actions` 移除提交动作；不得自动 replay。unknown version identity 500 必须走 generic server failure，不自动 reload、不自动 replay、不猜 version。
- malformed `details`、其他 code 或缺 request ID 必须进入安全 summary fallback；不能用错误 message 文本作类型判断。若现有 model/page 无法把缺 request ID 与 malformed code 安全投影出来，才允许在 `fact-workspace.model.ts`/page 中作最小纯错误投影修正；不得视觉重做或引入全局错误类型 registry。

前端稳定合同依据：`.trellis/spec/frontend/state-management.md:165-190` 已将 `FACT_REVIEW_PENDING` 定义为 409 并要求刷新服务端动作、不本地推导；`:231-237` 要求 dirty 表单保留且只显式 reload；`docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161` 已冻结 `available_actions`、workspace revision、提交成功后 read model 收敛。故 I5 默认只需测试和必要最小补强，不应把 `fact-workspace-page.tsx` 或 model 当成必改文件。

### 7. 文件边界、合同边界和停止条件

建议 I5 的允许文件与只读 owner如下：

允许修改：

- `backend/app/services/product_facts.py`：仅 `submit_fact_review` 的两个 exact diagnostics 分支、root rollback 和必要中文说明；不得修改 `replace_product_facts`。
- `backend/tests/integration/test_publication_workflow.py`：沿用已有事实提交/待审核回归（现有 submit/pending 入口在 `:2777-2868`），补真实 PG catalog/diagnostics、Product lock 对照、两条 failure path、HTTP envelope/no-leak/rollback/Session 复用。
- `backend/tests/integration/test_product_detail.py`：沿用 facts workspace/stale/retired/snapshot 回归（`submit_fact_review`/`replace_product_facts` 证据在 `:529-675`、`:740-830`），只在需要时补 workspace 不变与前端 read-model 对照。
- `.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`：只补稳定 exact mapping、Product-lock/rollback、facts pending/no-replay/unknown generic 500 语义；不写 test-only 技巧，不重复完整测试矩阵。
- `frontend/src/domains/product/fact-workspace-page.tsx`、`fact-workspace.model.ts`、`fact-workspace-page.test.tsx`、`fact-workspace.model.test.ts`：仅在当前恢复证据不足时最小修改；默认 production frontend 与 model 可保持零 diff，必须由测试证明缺口后再动。

必须保持零 diff/只读：

- `backend/app/routers/product_facts.py`（已有 `submitProductFactReview` 的 409 metadata 和 request ID 传递，不需要改）。
- `contracts/openapi.yaml`、`frontend/src/shared/api/generated/schema.d.ts`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`。现有 submit operation 已声明 409，`ErrorDetail.code` 为开放 string；本 I5 不新增 code/status/500 response。
- `contracts/database.md`、模型/schema/migration、`backend/app/services/review.py`、ContentVersion/ContentTask/Generation Job/publication/GEO owner。FactVersion schema/约束已存在，不应通过 migration 或模型改名来“修复”诊断。

若实现发现以下任一情况，必须停止并向主 agent 报告，而不是猜测或扩 scope：

1. current-head PostgreSQL catalog 或真实异常不是预期两个名称/列/predicate；不能用 ORM 命名约定、message parser、alias 或 migration 补救。
2. `uq_fact_versions_product_id` 需要 winner 查询、自动改号、replay 或改变 FactVersion 状态机才能得出用户结果。
3. pending exact pair 无法复用既有 409 `FACT_REVIEW_PENDING`，或需要改变 OpenAPI、router metadata、generated schema、ErrorDetail enum、status/media type。
4. 正常 Product `FOR UPDATE` 无法保持，或测试只能依赖 sleep、无界等待、削弱生产锁、SQLite/mock-only diagnostics。
5. rollback 后无法同时证明 FactVersion/FactReviewRecord、workspace、既有 pending、ContentTask/ContentVersion、AuditLog/dispatch 无部分副作用，或 request Session 不能继续查询。
6. 前端需跨出 product facts workspace、修改公共错误类型、自动 POST/replay、根据 message 判断、把 unknown 500 变成稳定 JSON 合同。

### 8. 建议注入 implement/check JSONL 的 spec/research

`implement.jsonl` 建议按以下顺序注入（reason 应保留中文且说明用途）：

1. `.trellis/spec/backend/index.md`：backend 入口与质量门禁。
2. `.trellis/spec/backend/error-handling.md`：exact `sqlstate + diag.constraint_name`、known/unknown、rollback、ErrorEnvelope 和 no-leak。
3. `.trellis/spec/backend/database-guidelines.md`：Product lock、FactVersion immutable/pending、Session 原子性和副作用规则。
4. `.trellis/spec/frontend/state-management.md`：facts workspace local/server state、pending 409、explicit reload/no replay、available_actions。
5. `.trellis/tasks/09-05-content-integrity-error-contract-decision/research/contract-decision-matrix.md`：I5 两条约束的最终分类、既有 `FACT_REVIEW_PENDING`、零 diff 合同和 owner。
6. `.trellis/tasks/09-14-fact-version-integrity-mapping/research/predecessor-patterns.md`：本 research 汇总的前置模式、过时 owner 纠正和 I5 边界。

`check.jsonl` 应注入相同 backend/frontend stable specs 和最终 decision matrix，并至少加入：

- `.trellis/spec/backend/quality-guidelines.md`：真实 PostgreSQL fixture、bounded concurrency、targeted validation 规则；
- 本 I5 research：检查 owner 不回退到 `replaceProductFactsDraft`、unknown/replay/pending 语义不漂移；
- 如后续另建 current-head 研究，应替换本条或与本条并列，提供 catalog/diagnostics 和现有测试资产的可复核行号。

JSONL 中不得注入 `contracts/openapi.yaml`、router、generated schema 或 production/test 文件作为 spec/research manifest；它们应在 implement.md 中列为 read-only/zero-diff validation targets。若 native context 对大型 `database-guidelines.md` 产生 32 KiB 截断 warning，child implement/check 必须自行分段完整读取，不能把本摘要当第二权威来源。

### 9. 建议的 required validation 命令与前置任务经验

实现计划至少应保留以下命令，具体容器/环境前缀以当前仓库可用 PostgreSQL 配置为准：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_product_detail.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/product_facts.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_product_detail.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run test -- src/domains/product/fact-workspace-page.test.tsx src/domains/product/fact-workspace.model.test.ts
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/product/fact-workspace-page.tsx frontend/src/domains/product/fact-workspace-page.test.tsx frontend/src/domains/product/fact-workspace.model.ts frontend/src/domains/product/fact-workspace.model.test.ts
git diff --check
python3 .trellis/scripts/task.py validate 09-14-fact-version-integrity-mapping
```

required integration run必须确认 PG 用例实际执行且无 skip；无法使用本机 UV 连接时应按前置任务惯例使用：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_publication_workflow.py tests/integration/test_product_detail.py -q -ra
```

前置任务的 validation 结论不可直接复制为本 I5 通过证据：

- Content Task 收尾记录 `research/validation-closeout.md:19-39` 有 13 个真实 PG 用例、0 skip、HTTP known/unknown、合同/runtime、Ruff、mypy、frontend 回归和零 diff；它同时明确曾经 skip 的本机运行不算通过。
- ContentVersion identity 收尾 `research/execution-results.md:17-68` 展示了必须记录真实失败归因、修复轮次、最终 69-case full-scope 结果及 optional suite 未运行风险；I5 不得宣称继承这些数值。
- ContentVersion review state `research/execution-results.md:8-31` 的 19 个 backend PG、31 个 frontend Vitest、Ruff/mypy/zero diff 只证明 I4 自身；其 frontend typecheck 被未修改 `frontend/src/domains/publication/publication-work-page.test.tsx:351` 的 TS2345 阻断，I5 若复现同一错误应精确记录并不修改 publication 文件。

### 10. Related specs and internal references

- `.trellis/spec/backend/error-handling.md:76-100,155-187`：structured diagnostics allowlist、unknown 原抛、默认 500 no-leak 且不冻结 body/code/details/media type。
- `.trellis/spec/backend/database-guidelines.md:607-668`：Product facts workspace、FactVersion immutable、review record 与成功审计/事务边界；`:639-644` 要求成功审核同事务追加 review/audit（I5 失败路径不得留下成功记录）。
- `.trellis/spec/frontend/state-management.md:165-190,231-237`：facts 写入 operation、pending 409、local draft 保留和显式 reload。
- `contracts/database.md:380-423`：FactVersion 状态机、版本 owner lock、Product facts revision、每产品至多一个 pending。
- `contracts/openapi.yaml:619-643`、`frontend/src/shared/api/generated/schema.d.ts:6455-6489`：`submitProductFactReview` 已有 409/ErrorResponse，generated response union 无需变化。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161`：facts workspace canonical read model、`available_actions`、成功提交后 refetch/no replay。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/design.md:74-116`：SQLAlchemy failed Session、caller rollback/savepoint owner、unknown boundary。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/design.md:1-140`、`implement.md:91-129`：五个 stable owner 拆分、I5 单一目标和 required baseline。

### 11. Caveats / Not Found

- 未执行 PostgreSQL catalog 查询、真实 23505、并发、HTTP、Ruff、mypy、frontend tests；本 research 只汇总规划和 current-head 静态证据。I5 implementation 必须在当前 head 的 fresh PostgreSQL 中再次实测两条名称、定义和 diagnostics。
- 未运行 Git 命令或查看提交 diff；前置任务的执行/归档 research 只作为文件化验证记录。用户提供的最近 I4 工作/归档/journal 提交（`fc834372`、`1667376c`、`22224081`）不改变本研究得出的 owner 和边界。
- 父矩阵/companion 的旧 owner 记录仍留在历史 task 文件中，本 research 不修改历史文件；后续 I5 artifacts、manifests 和 implementation review 必须以 `submit_fact_review` 为唯一 INSERT owner。
- `contracts/database.md` 当前只描述“owner 内版本号唯一”和“每产品至多一个 pending”，不冻结未知 500 的 wire body；I5 不应为 unknown 500 增加 OpenAPI response、generated error code 或稳定 details。
- 当前事实 workspace 已有 `FACT_REVIEW_PENDING` reload 分支，但页面测试尚未证明所有用户要求的 malformed details、缺 request ID、reload failure/success 与 no-replay 细节；这是 implementation 期需补证据的缺口，不是本 research 对 frontend 必改的结论。
- 未发现需要外部文档引用的事实；PostgreSQL `23505`/psycopg diagnostics 的最终值必须以 current-head 实际运行结果为准，不能将 migration/ORM 行号当作最终 catalog 证据。
