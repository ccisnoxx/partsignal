> 2026-09-07：用户已明确批准最新规划实施。以下 planning-only 文字记录上一轮授权；当前允许按本计划实施与验证，提交/归档/push 仍未授权。

# ContentVersion identity 数据库最终边界

## 目标与价值

验证并冻结 ContentVersion identity 的数据库最终边界，使正常重复投递、合法版本分配和真实约束故障有可复核的不同结果。只有一个 review 目标：两条 identity 约束在 HTTP/worker 的失败与原子性合同。当前实现若已正确，交付可主要是测试及必要规范证据，不以生产代码 diff 为完成条件。

## 决策与依赖

- 父任务：`.trellis/tasks/09-04-integrity-error-domain-mapping`。
- 合同 owner：`.trellis/tasks/09-05-content-integrity-error-contract-decision`，其最终 matrix §3.4–3.5 为决策依据；用户已批准该决策。
- 前置 I1：`.trellis/tasks/archive/2026-09/09-06-generation-job-idempotency-integrity-mapping`。
- 前置 I2：`.trellis/tasks/archive/2026-09/09-06-content-task-idempotency-integrity-mapping`。
- I1、I2 当前 metadata 均为 completed。实施前仍须核对其交付已在当前 main；依赖不由父子树位置推断。
- 本轮仅创建 planning 文档、research、两份 JSONL 和必要 task metadata/父子关联；不 start、不改代码/测试/spec/合同，不提交、归档或 push。父任务与合同 owner 继续 planning。

## 已确认事实

当前静态证据与代码锚点见 `research/current-boundary.md`。现有控制流具备目标锁及回滚结构，已有重复 worker 测试；本任务需补齐两条精确约束和完整失败原子性的直接证据，静态阅读不作为 PostgreSQL gate 通过依据。

## 冻结要求与验收

| ID | 可观察验收标准 |
|---|---|
| AC1 | 临时 PostgreSQL 数据库迁移至实施时 current head；catalog 精确证明 `uq_content_versions_source_job_id` 的列为 source_job_id，`uq_content_versions_task_id` 的列为 task_id/version，均为有效唯一约束；记录真实 23505 与两个精确 constraint_name。 |
| AC2 | 正常重复/并发投递同一 Job：provider 合计一次，恰一个 ContentVersion，同一 Job SUCCEEDED；另证明 PENDING Job 已有 source 版本时 provider 前 lookup 收敛 SUCCEEDED，provider 零次调用。 |
| AC3 | worker final INSERT/flush 真实命中 23505 + source_job constraint：不回查猜 winner、不 post-error replay、不再次调用 provider；同一 Job FAILED，error_code=GENERATION_FAILED，error_summary=生成作业执行失败，lease 清空，失败状态提交。 |
| AC4 | manual、revision、worker 三条路径继续持 ContentTask 行锁后 max(version)+1；正常双 Session 竞争有数据库等待证据，按主线资格串行成功或拒绝，不依赖 unique violation。 |
| AC5 | manual 与 revision 各自真实命中 23505 + task/version constraint：HTTP 默认 unknown 500；worker 命中该约束为 FAILED/GENERATION_FAILED 和同一安全摘要；不改号、不 replay 正文、不返回 REVISION_CONFLICT。 |
| AC6 | 每个 HTTP 故障相对基线不留下候选 ContentVersion，task current_content_version_id/revision、既存版本载荷与 revision 不变，无新增 ContentReviewRecord、AuditLog 或 dispatch。预置的对照行不算失败残留。 |
| AC7 | worker 可保留已提交 RUNNING/attempt/start 状态；final transaction 的候选 ContentVersion、task pointer/revision、Job SUCCEEDED/content_version_id/finished_at/全部 provider metadata 整体 rollback。失败事务只提交同一 Job 的 FAILED、错误字段、finished_at 和清 lease；不生成其他业务记录/dispatch。 |
| AC8 | HTTP request Session 与 worker Session 各自 rollback 后，在同一 Session 可成功查询；独立连接另证明持久化结果。不能仅以新 Session 查询通过充当复用证据。 |
| AC9 | debug=False、raise_server_exceptions=False 的 HTTP unknown 500 响应正文及响应头不泄露 SQL、表名、constraint、数据库 message、stack；不冻结默认 body/code/header/media type/request ID 为新公共合同。 |
| AC10 | 独立真实 expected_revision 过期对照仍是既有 409 REVISION_CONFLICT；人工创建接口不凭空增加 expected_revision 字段。 |
| AC11 | 五个指定测试文件、Ruff、mypy、diff check、零 diff gate 通过；真实 PG 用例 skip 或零收集均不算通过。full backend suite optional，未运行需列替代证据及残余风险。 |
| AC12 | 生产代码仅在新证据证明现有边界不满足上述合同时最小修正；规范仅同步 allocator/worker failure；独立只读 review 检查原子性、约束证据、范围与零 diff。 |

## 精确范围

后续允许修改仅限：

- `backend/app/services/generation.py`：仅上述 worker identity/final failure owner，且须先有失败证据。
- `backend/app/services/content_production.py`：仅人工 allocator/HTTP 失败边界，且须先有失败证据。
- `backend/tests/unit/test_generation.py`。
- `backend/tests/integration/test_generation_reliability.py`。
- `backend/tests/integration/test_content_draft_lifecycle.py`。
- `.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`：仅必要 allocator/worker failure 同步。
- 本任务 planning/research/manifests/metadata；父 task.json 只允许工具产生的关联。

必须保持零 diff：`contracts/openapi.yaml`、`contracts/database.md`、`backend/app/routers/production.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`frontend/src/shared/api/generated/schema.d.ts`、`frontend/src/domains/content/`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、数据库 schema/models 与 migrations。contracts/database.md 无本任务语义修订需求，作为只读证据保留。

## 排除与风险

不新增 HTTP mapper、status/error code、revision 语义、post-error replay、自动改号/canonical 猜测；不修改 provider 业务行为，不把 HTTP request policy 用于 worker；不新增全局 mapper/registry/repository/第二类型系统；不混入 pending/approved review、Fact Version、publication/GEO。

当前无阻塞性产品决策。真实 PG 精确名称、sentinel 可达性和事务行为留到明确批准后的实施验证；发现不符时停止并报告，不靠放松锁/schema、错误文本解析或猜测兜底使测试通过。既有 `.gitignore`、artifacts、configuration.py 等无关脏变更全部保留。
