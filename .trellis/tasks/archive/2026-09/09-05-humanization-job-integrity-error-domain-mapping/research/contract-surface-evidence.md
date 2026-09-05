# Research: Humanization Job IntegrityError Contract Surface

- Query: 审计 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 的既有 OpenAPI、数据库合同、Frontend V2 行为和 generated client surface，判断将两个已存在的 PostgreSQL 约束精确映射为既有 409 领域错误时是否需要扩大公共合同或前端范围。
- Scope: mixed（仓库合同/规范/前端 generated surface；数据库约束的迁移与 ORM 定义作辅助证据）
- Date: 2026-09-05

## Findings

### 1. 两条 HTTP command surface 已完整存在，409 不需要新增 operation

- `POST /api/v1/content-versions/{content_version_id}/humanization-jobs` 的 operationId 是 `createHumanizationJob`（`contracts/openapi.yaml:2264-2267`）。它要求 `content_version_id`、CSRF、`Idempotency-Key` 和可选 request ID header，body 仅为 `HumanizationJobCreate`（`contracts/openapi.yaml:2268-2277`）；成功仍返回 `202 GenerationJob`，描述已经包含“已创建或返回幂等自然化作业”（`contracts/openapi.yaml:2279-2285`），并已声明 `409 ErrorResponse`（`contracts/openapi.yaml:2286-2291`）。
- `POST /api/v1/generation-jobs/{generation_job_id}/retry` 的 operationId 是 `retryGenerationJob`（`contracts/openapi.yaml:2310-2313`）。它要求原 job path、CSRF、`Idempotency-Key` 和可选 request ID header，不携带 body（`contracts/openapi.yaml:2314-2319`）；成功返回 `202 GenerationJob`（`contracts/openapi.yaml:2320-2326`），并已声明 `409 ErrorResponse`（`contracts/openapi.yaml:2327-2332`）。同一 operation 同时服务 GENERATE/HUMANIZE，窄切片只约束其 HUMANIZE 分支，不需要新增 route 或改变 status。
- 两个 path 也已经在 generated `paths` surface 中分别绑定 `operations["createHumanizationJob"]` 和 `operations["retryGenerationJob"]`（`frontend/src/shared/api/generated/schema.d.ts:1193-1208`、`1225-1240`）。
- `Idempotency-Key` 是既有必需 header，值域为 8–128 字符（`contracts/openapi.yaml:4114-4118`）；不存在需要为本切片扩展的 header 或 request body 字段。

### 2. ErrorEnvelope 对 code 开放，两个领域错误属于既有 wire contract

- 所有业务/校验错误统一复用 `ErrorResponse -> ErrorEnvelope`（`contracts/openapi.yaml:4163-4169`）。`ErrorEnvelope` 只要求 `error`，`ErrorDetail` 要求 `code`、`message`、`details`、`request_id`，其中 `code` 是普通 `string`，`details` 是可扩展 object，并没有 code enum（`contracts/openapi.yaml:4192-4206`）。因此 `IDEMPOTENCY_CONFLICT` 与 `HUMANIZATION_ALREADY_ACTIVE` 可以作为既有错误信封中的运行时领域值，不需要改 OpenAPI schema。
- generated client 对应 operation 的 `409` 均仅引用 `components["responses"]["ErrorResponse"]`（`frontend/src/shared/api/generated/schema.d.ts:8812-8817`、`8875-8880`）；generated `ErrorDetail.code` 也是 `string`（`frontend/src/shared/api/generated/schema.d.ts:2106-2120`）。重新生成不会产生新的类型成员或 union 分支。
- 同一资源的原始生成 endpoint 也已有 `202` 和 `409 ErrorResponse`（`contracts/openapi.yaml:2192-2218`），说明这两个命令的冲突状态集合已经是既有 API 设计，而非本切片新增 status。

### 3. 数据库合同允许精确映射，但正文未冻结两个 generation constraint 名称

- 数据库合同把 `generation_jobs` 归入 Content Production，并确认其 `idempotency_key` 唯一、Redis 只承载 job UUID、worker 在执行前后复核业务状态（`contracts/database.md:39-43`）。
- `GenerationJob` 状态机明确适用于 GENERATE 和 HUMANIZE：`PENDING -> RUNNING -> SUCCEEDED | FAILED`（`contracts/database.md:394-406`）。因此将最终数据库竞态错误映射为 409 不需要改变状态机或 Redis 语义。
- 自然化沿用现有 `generation_jobs`，使用不可变 `humanization-markdown-v2` snapshot；历史 v1 snapshot 只读且不能重试（`contracts/database.md:229-237`、`289-291` 附近的自然化说明）。这支持 retry 只创建新 job、复制既有快照，不要求新增 snapshot contract。
- 当前头 ORM 将 `generation_jobs.idempotency_key` 声明为非空 `unique=True`（`backend/app/models/ai_generation.py:179-189`）。项目 naming convention 为 `uq_%(table_name)s_%(column_0_name)s`（`backend/app/db.py:14-24`），故预期真实唯一约束名为 `uq_generation_jobs_idempotency_key`；这不是数据库合同正文的显式文字，应由 current-head catalog 证明后才能作为实现依据。
- 自然化 active-source 约束在迁移和 ORM 中明确为唯一 partial index `uq_generation_jobs_active_humanization_source`，键是 `source_content_version_id`，谓词为 `job_type = 'HUMANIZE' AND status IN ('PENDING', 'RUNNING')`（`backend/alembic/versions/0017_content_humanization.py:65-70`；`backend/app/models/ai_generation.py:166-176`）。它是 index 而不是 table-level `UniqueConstraint`，实现捕获仍应只看 PostgreSQL diagnostics 的 `constraint_name`。
- 数据库合同的 Required Constraints 只明写 `content_tasks.idempotency_key` 的唯一性和任务创建重放规则（`contracts/database.md:411-415`），没有出现 `uq_generation_jobs_idempotency_key` 或 `uq_generation_jobs_active_humanization_source`。因此合同层可保持零变更，但实现计划必须把真实 current-head catalog/diagnostics 作为 required validation，而不能仅依据 ORM 推断。

### 4. 前端和 generated client 已能消费两个 409，不需要前端行为扩展

- Frontend V2 规定 AI Production 只消费 `CREATE_GENERATION_JOB`、`CREATE_HUMANIZATION_JOB` 和 GenerationJob `RETRY` token；create/retry/humanization 的同一命令重试复用稳定 `Idempotency-Key`，浏览器不拼 snapshot，只轮询提交后 `PENDING/RUNNING` job，terminal 后停止并失效 Editor Context（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:181-189`）。本切片只改变服务端在最终竞态处选择的既有 409 code，不改变 command、polling 或 snapshot。
- 同一文档规定 409 保留本地表单，禁止自动覆盖、合并或重放（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:187-189`）；AI 生成命令还明确同一 signature 复用 key，payload 改变、成功或 `IDEMPOTENCY_CONFLICT` 后废弃旧 key（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:382-388`）。这已覆盖 idempotency conflict 的客户端生命周期。
- content API 的 `createHumanizationJob` 和 `retryGenerationJob` 已按既有 generated path 调用，均带 CSRF 和 `Idempotency-Key`，成功返回 `GenerationJob`（`frontend/src/domains/content/content.api.ts:156-190`）。请求错误保留 HTTP status 与完整 `ErrorDetail`（包括 code/details/request_id），缺少信封时才退回通用 HTTP 文本（`frontend/src/domains/content/content.api.ts:645-670`）。因此新增/复用上述 code 不需要 API wrapper 改动。
- AI Production 仅对 `IDEMPOTENCY_CONFLICT` 做已有 key 清理；其他错误包括 active-humanization conflict 均进入当前错误展示，不触发自动 replay（`frontend/src/domains/content/content-ai-production.tsx:149-187`、`427-433`）。这与 active conflict 应等待当前作业终态、再由用户显式重新确认的约束相容，不构成必须修改 frontend 的缺口。
- generated 目录只有 `frontend/src/shared/api/generated/schema.d.ts`（由 `rg --files frontend/src/shared/api/generated frontend/src/shared/api` 观察到），未发现独立生成 runtime；该文件的 operation 和 schema surface 已与 OpenAPI 对齐，故本切片可保持 generated client 零变更。

### 5. 精确映射矩阵与零变更结论

| command/path | PostgreSQL diagnostics 必须同时满足 | 领域错误 | HTTP/wire | 事务/副作用要求 |
|---|---|---|---|---|
| `createHumanizationJob`；`HUMANIZE retryGenerationJob`，经 `_create_job` 写 `generation_jobs` | `sqlstate = 23505` 且 `diag.constraint_name == 'uq_generation_jobs_idempotency_key'` | `IDEMPOTENCY_CONFLICT` | 既有 `409 ErrorResponse` / `ErrorEnvelope`；沿用既有 message/details 约定 | rollback 后抛 `AppError`；不得留下第二 job、revision/content version/review/task pointer/AuditLog/dispatch 副作用 |
| 同上 | `sqlstate = 23505` 且 `diag.constraint_name == 'uq_generation_jobs_active_humanization_source'` | `HUMANIZATION_ALREADY_ACTIVE` | 既有 `409 ErrorResponse` / `ErrorEnvelope` | rollback 后抛 `AppError`；现有 active job、源版本及所有历史保持不变 |
| 同上 | 约束名不同、diagnostics 缺失、sqlstate 非 `23505`，或 CHECK/NOT NULL/FK/trigger failure | 不做领域映射 | 继续默认 unknown 500；不要把默认 500 body/status 写入 OpenAPI | 原异常上抛；请求 Session 负责 rollback/close，不做失败后查询猜测 |

同 key 同 payload replay 仍是现有 202 canonical `GenerationJob` 成功路径；同 key 异 payload 只能进入第一行的精确 idempotency conflict。active HUMANIZE source 冲突只能进入第二行。两种 23505 映射不能互换，不能按错误文本、请求字段、job type 或 source id 猜测。

据此，本窄切片可以保持：

- `contracts/openapi.yaml` 零变更：既有两条 operation、202/409 responses、ErrorEnvelope 和 string code 已覆盖目标行为。
- runtime/generated client 零变更：runtime operation surface 和 `schema.d.ts` 已是通用 409 错误类型；实现只改变 service error-domain mapping。
- Frontend V2 零变更：既有稳定 key、409 保留输入、无自动重放、通用 ErrorDetail 展示已覆盖两个 code。
- database schema/迁移零变更：两个目标约束已经存在；本任务只消费约束 diagnostics，不增删列、index、trigger 或业务状态。
- `.trellis/spec/backend/error-handling.md` 需要作为本任务的唯一文档边界候选，补充 generation command 的两个精确映射和 unknown 500 负例；这是开发规范更新，不是公共 API 合同扩展。

## Related specs

- `.trellis/spec/backend/error-handling.md:61-100` 已要求唯一约束 mapper 只同时匹配 `sqlstate=23505` 与精确 `diag.constraint_name`，并在其他 IntegrityError 时保持 unknown 500；`:118-150` 明确禁止全局 IntegrityError handler、错误文本分类和公共 OpenAPI 500 声明。
- `.trellis/spec/backend/database-guidelines.md:490-543` 已冻结 content production 的 snapshot、任务幂等、legacy retry 和失败矩阵，但目前没有 generation-job 两个目标 constraint 的精确 mapping 条目；实现前应由主任务决定是否由 `error-handling.md` 单一 owner 补齐，避免建立第二套全局 registry。

## External references

- 未使用外部网页或第三方 API 资料。数据库版本与唯一业务数据库约束来自 `contracts/database.md:5`（PostgreSQL 16）；约束定义辅助证据来自仓库 Alembic revision `0017_content_humanization` 和 current ORM，而非外部来源。

## Caveats / Not Found

- 本支线是合同/客户端 surface 研究，未执行 PostgreSQL catalog 查询；环境中 `pg_isready` 不可用（命令返回 `zsh: command not found: pg_isready`）。因此 `uq_generation_jobs_idempotency_key` 的真实 catalog row、partial index predicate、driver `diag.constraint_name` 和真实 `sqlstate=23505` 仍必须在实施任务的真实 PostgreSQL required validation 中确认，不能把 ORM naming convention 当作最终证据。
- 数据库合同 `contracts/database.md` 中用 `rg -n "uq_generation_jobs|active_humanization|generation_jobs.*constraint" contracts/database.md` 检索，没有找到两个具体 generation constraint 名；这里只能引用 migration/ORM 辅助定义，不能声称合同正文已冻结名称。
- OpenAPI、generated client 和 Frontend V2 文档中用 `rg -n "IDEMPOTENCY_CONFLICT|HUMANIZATION_ALREADY_ACTIVE" contracts/openapi.yaml frontend/src/shared/api/generated/schema.d.ts docs/frontend-v2/05-business-actions-state-and-api-contract.md` 检索，未找到 `HUMANIZATION_ALREADY_ACTIVE`，也未找到 OpenAPI code enum；Frontend 文档仅在 `:137`、`:345`、`:386`提到 `IDEMPOTENCY_CONFLICT`。这支持“code 是运行时开放字符串、无需 schema 变更”的结论，不代表 active code 已在 UI 文案中专门枚举。
- 若实施时发现任一约束名称与上述目标不一致、目标约束不存在、diagnostics 不能稳定提供 constraint identity，或任一现有 endpoint 的 409 status/body/detail 需要新字段、新公共 code registry、新 HTTP status、OpenAPI/generated/frontend 分支、数据库 schema/trigger 或跨 service 协议，则必须停止本任务，先规划独立的 `content-integrity-error-contract-decision`，不能扩大默认文件边界。
- 若实现需要为了 active conflict 改变前端自动重试、cache invalidation、polling、action token 或新增 error-specific UI，亦应停止并转独立前端/公共合同决策；当前证据不要求这些变更。
