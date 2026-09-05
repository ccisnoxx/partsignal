# Implement Plan: Content/Generation IntegrityError 合同决策

## 1. 本任务执行范围

本任务是planning-only。执行内容仅为研究、合同矩阵、PRD/设计/实施拆分、context manifests和独立review；不运行`task.py start`，不修改生产代码、contracts、generated client、stable specs、测试、数据库或生产数据，不提交、不归档、不push。

## 2. Planning工作项

### P1 — 权威输入与当前状态

- [x] 完整读取AGENTS、Trellis workflow、父任务PRD/design/implement及四份父research。
- [x] 读取backend error/database specs、OpenAPI、database contract、Frontend V2合同。
- [x] 核对T1后无全局IntegrityError handler和unknown default500。
- [x] 核对提交`ded73ab5`的Humanization exact mapper、rollback/replay与tests。
- [x] 确认primary workspace在`main`，记录并保护既有`.gitignore`、artifacts和其他脏变更。

### P2 — Authoritative owner审计

- [x] 审计指定services/routers/tests、frontend content目录与generated schema。
- [x] 修正父research的事实偏差：FactVersion INSERT owner是`submit_fact_review`，不是`replace_product_facts`；worker也写`uq_content_versions_task_id`。
- [x] 识别ContentTask key的GEO交叉writer，但保持T5-C生产边界。

### P3 — 九项合同冻结

- [x] 完成`research/contract-decision-matrix.md`。
- [x] 决定map/replay/unknown/worker FAILED/T5-C deferred。
- [x] 冻结新公共码`CONTENT_REVIEW_PENDING`与准确前端恢复。
- [x] 冻结所有transaction、pointer/revision、version、review、AuditLog和dispatch原子性。
- [x] 冻结OpenAPI/runtime/generated/docs/specs/tests同步责任。

### P4 — 后续实施拆分

- [x] 按稳定owner拆为五个implementation Task。
- [x] 给出依赖顺序、推荐首项和精确验收。
- [x] 填写`implement.jsonl`与`check.jsonl`真实上下文。

### P5 — Planning validation与独立review

- [x] 运行Trellis task validation、JSONL parse与task-scoped diff check。
- [x] 核对child与parent均保持`planning`。
- [x] 由独立只读reviewer检查九项完整性、公共合同、原子性、T5边界和后续Task可执行性。
- [x] 完成一次针对性修订与一次targeted re-review；复审无仍阻碍批准的material finding。

## 3. 后续 implementation Task计划

这些Task只作为本决策的后续计划，不在本次创建或启动。每项均需独立Trellis planning、review与批准。

### I1 — `generation-job-idempotency-integrity-mapping`（推荐首项）

**单一目标**：修正GENERATE retry的幂等lookup顺序，并把`uq_generation_jobs_idempotency_key`的exact race合同扩展到GENERATE create/retry；保持Humanization现有映射不变。

**允许owner**：`backend/app/services/content_production.py`、对应unit/integration tests、必要stable error spec。不得修改worker、ContentVersion review、FactVersion、publication/GEO、OpenAPI/generated/frontend。

**Required validation**：

```bash
cd backend && uv run pytest tests/unit/test_generation.py -q
cd backend && uv run pytest tests/integration/test_generation_reliability.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
```

integration文件较大时可先用精确`-k`运行目标case，修复后再按上面required文件级gate运行一次。full backend suite optional；未运行需记录风险。

**精确验收**：见`research/contract-decision-matrix.md`第5节，九项必须全部满足。尤其区分：同previous/key顺序replay；同Task并发经锁后lookup replay；跨Taskdifferent identity真实PG race；test-only same-identity exact-constraint sentinel。

### I2 — `content-task-idempotency-integrity-mapping`

**单一目标**：普通`createContentTask`在exact unique race后按ordinary canonical identity replay或返回既有`IDEMPOTENCY_CONFLICT`；不得把GEO task当普通winner。

**边界**：不改`createGeoOptimizationContentTask`；若实现必须改GEO incoming/shared contract，停止并转T5-C。

**Required validation**：

```bash
cd backend && uv run pytest tests/integration/test_content_task_creation.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
cd frontend && npm test -- --run src/domains/content/new-content-task-page.test.tsx
```

还必须有真实PG exact diagnostics、普通same/different identity、GEO winner负例、恰一task、rollback/session复用和request ID断言。`contracts/database.md:37`的ordinary canonical identity文字澄清属于required文档同步，但不得修改GEO incoming policy。

### I3 — `content-version-identity-integrity-boundary`

**单一目标**：验证并冻结ContentVersion identity：provider前source-job replay保持，post-flush `source_job_id`冲突worker FAILED；`task_id,version`在HTTP为unknown、worker FAILED；不新增mapper/revision code。

**允许owner**：`generation.py`、`content_production.py`及generation/content draft tests；生产代码仅在证据证明当前行为不能满足已冻结边界时做最小修正。

**Required validation**：

```bash
cd backend && uv run pytest tests/unit/test_generation.py -q
cd backend && uv run pytest tests/integration/test_generation_reliability.py tests/integration/test_content_draft_lifecycle.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
```

必须覆盖真实PG两constraint names、正常duplicate worker、manual/revision allocator锁、HTTP500 no-leak、Job FAILED、pointer/revision/version/review/audit/dispatch无半写。

### I4 — `content-version-review-state-integrity-mapping`

**单一目标**：同一`transition_content_version` owner内，pending exact pair映射新`CONTENT_REVIEW_PENDING`，approved exact failure保持unknown，并证明submit/approve整笔rollback。

**Required validation**：

```bash
cd backend && uv run pytest tests/integration/test_content_review.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
cd frontend && npm test -- --run src/domains/content/content-editor-page.test.tsx src/domains/content/content-editor.model.test.ts src/domains/content/content-review-page.test.tsx
cd frontend && npm run typecheck
```

必须覆盖真实partial-index diagnostics、409准确合同/request ID、pending no replay/显式reload、approved default500/no leak、旧approved/target/review/audit完整rollback，以及真实revision409对照。pending实际owner是Content Editor提交Dialog：保留备注/code/request ID，冲突后禁止背景采用和再次POST，reload失败保留输入，成功后才采用canonical context。Review Page只承担approved unknown/no-replay回归。实施中更新stable error/database spec与Frontend V2文档；OpenAPI/generated应保持零diff，除非另行决策。

### I5 — `fact-version-integrity-mapping`

**单一目标**：`submit_fact_review`内`uq_fact_versions_product_id`保持unknown，pending partial index复用`FACT_REVIEW_PENDING`，两者共享完整rollback证据。

**Required validation**：

```bash
cd backend && uv run pytest tests/integration/test_publication_workflow.py tests/integration/test_product_detail.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
cd frontend && npm test -- --run src/domains/product/fact-workspace-page.test.tsx
cd frontend && npm run typecheck
```

必须新增真实PG exact diagnostics、Product锁串行对照、version unknown500/no leak、pending409准确合同/request ID、恰一FactVersion/ReviewRecord、workspace revision不变、frontend canonical reload/no replay。

### T5-C — publication/GEO后续决策

另行决定并实施：

- `uq_content_tasks_source_published_content_issue_id`是否把race映射为现有`REPAIR_TASK_EXISTS`；
- GEO incoming command与普通ContentTask共享idempotency key的双向source-kind identity；
- research发现的`source_published_content_issue_id` ORM `SET NULL`与migration `RESTRICT`漂移候选。

T4-C不得通过I2或其他Task偷偷实现这些范围。

## 4. 依赖顺序

推荐单分支顺序：

```text
本T4-C批准
  ├─ I1 Generation Job idempotency
  ├─ I2 Content Task idempotency
  ├─ I5 Fact Version（代码上独立）
  └─ I1 → I3 Content Version identity → I4 Content review state

T5-C publication/GEO 独立推进，不是I1/I3/I4/I5依赖；
I2若触及GEO incoming/shared contract则阻断并等待T5-C。
```

为减少同一测试文件/稳定spec冲突，推荐实际落地顺序为`I1 → I2 → I3 → I4 → I5`。这只是review顺序；I2、I5无I1业务代码硬依赖。

## 5. 本Planning Task的验证命令

Required：

```bash
python3 .trellis/scripts/task.py validate 09-05-content-integrity-error-contract-decision
python3 -m json.tool .trellis/tasks/09-05-content-integrity-error-contract-decision/task.json
python3 -c 'import json, pathlib; [json.loads(line) for name in ("implement.jsonl", "check.jsonl") for line in pathlib.Path(".trellis/tasks/09-05-content-integrity-error-contract-decision", name).read_text().splitlines() if line.strip()]'
git diff --check -- .trellis/tasks/09-05-content-integrity-error-contract-decision .trellis/tasks/09-04-integrity-error-domain-mapping/task.json
```

Review：逐项核对PRD/design/implement/final matrix、父任务边界和所有research，检查没有production文件变化或模板占位。

Optional：不运行backend/frontend测试，因为本任务不改变可执行行为；代码测试不能为planning文档提供额外行为保证。真实PG/HTTP/frontend gate已精确分配到后续implementation Tasks。

## 6. Closeout条件

- 本任务和父任务都保持`planning`；
- `task.py start`未运行；
- 独立review无未解决material finding，或完成一次targeted repair/re-review后准确报告剩余问题；
- diff只包含本子任务planning/research/manifests及Trellis自动写入的parent-child bookkeeping；
- 不触碰、不恢复、不删除、不格式化既有`.gitignore`、artifacts及其他脏变更；
- 最终回复明确“可独立review并申请批准”，而不是宣称implementation已获批准或完成。

## 7. 批准记录

- 2026-09-06：用户批准本T4-C合同决策。
- 本批准只冻结planning产物和后续Task边界；按照本任务原始授权，当前任务与父任务继续保持`planning`，不运行`task.py start`，不自动创建或实施I1。
