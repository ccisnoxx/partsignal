# Backend 错误处理契约

## Scenario：修复不可满足的 response schema composition

### 1. Scope / Trigger

- 当公共 OpenAPI 使用 `allOf` 从 `additionalProperties: false` 的基础对象增加派生字段，或 comparator 两侧一致但真实 payload 仍被标准 validator 拒绝时触发。

### 2. Signatures

- 公共派生 response 使用完整 `type: object`、合并后的 `properties` / `required` 与 `additionalProperties: false`。
- Runtime owner 优先使用 `ContractModel(extra="forbid")` 的默认 Pydantic JSON Schema。

### 3. Contracts

- `contracts/openapi.yaml` 是可编辑 authority；generated client 只能由合同生成。
- 展平时派生层同名字段覆盖基础层，字段约束必须与真实 validation/serialization owner 一致。
- 不得用 `__get_pydantic_json_schema__`、Pydantic 私有 handler、硬编码 ref、runtime overlay 或 comparator filter 镜像不可满足合同。
- 修订 schema composition 不得改变实际 payload、status、media type、Header、权限、service、事务或 error-domain mapping。

### 4. Validation & Error Matrix

| 条件 | 必需证据 | 处理 |
|---|---|---|
| Static/runtime schema 形状相同 | production comparator | 仍需 instance validation，不把“两侧相同”视为可满足 |
| 真实 model dump 被任一侧拒绝 | Draft 2020-12 errors | 修订 authority 与 runtime owner，禁止 baseline/allowlist |
| 派生层重定义同名字段 | runtime model field | 展平后保留派生层定义 |
| 真实 dump 双端通过 | unknown-field 负例也双端拒绝 | composition 修订可验收 |

### 5. Good / Base / Bad Cases

- Good：完整 inventory 的真实 `model_dump(mode="json")` 在 static/runtime 两侧均通过，且 unknown field 两侧均拒绝。
- Base：没有同名覆盖的单层继承直接合并 properties/required，并保持所有字段约束。
- Bad：只让 comparator 返回空列表；开放基础对象；依赖 private schema hook；过滤 schema drift。

### 6. Tests Required

- Contract：逐 component 断言无缺失字段、required 并集、关闭对象和原字段约束。
- Instance：使用标准 Draft 2020-12 validator 验证真实 Pydantic dump 的双端正例和 unknown-field 负例。
- Operation：投影完整受影响 success operation 集合，直接断言生产 comparator 的完整 failure list 为 `[]`。
- Generated：运行 canonical generator、generated check、frontend typecheck 与受影响 consumer tests。

### 7. Wrong vs Correct

```yaml
# Wrong：closed base 会拒绝 derived_field
allOf:
  - $ref: '#/components/schemas/ClosedBase'
  - type: object
    properties: {derived_field: {type: string}}

# Correct：完整派生对象统一拥有 closure
type: object
additionalProperties: false
required: [base_field, derived_field]
properties:
  base_field: {type: string}
  derived_field: {type: string}
```

## Scenario：将数据库唯一约束映射为稳定字段错误

### 1. Scope / Trigger

- 适用于创建或更新命令由 PostgreSQL 唯一约束提供最终竞态保护，且前端必须把冲突定位到具体字段的场景。
- PostgreSQL 是最终权威；可选预检查不能代替 `flush` 时的约束处理。

### 2. Signatures

- 服务函数接收 `Session` 和 Pydantic request schema，在业务边界执行 `db.flush()`。
- 对可预期冲突抛出 `AppError(code, message, 409, details)`。
- API 继续返回冻结的 `ErrorEnvelope`：`{error: {code, message, details, request_id}}`。

### 3. Contracts

- 只读取驱动已确认的 `error.orig.diag.constraint_name`，不得解析数据库英文错误文本。
- `details.errors[]` 使用与 FastAPI validation error 一致的结构：`loc`、`msg`、`type`。
- 可定位请求字段的 `loc` 固定为 `["body", "<field>"]`；未知约束必须原样上抛，交给框架默认 server-error boundary。
- 例：产品 normalized brand + part number 的约束 `uq_products_normalized_brand` 映射为 `409 PRODUCT_ALREADY_EXISTS`，并分别定位 `part_number` 与 `brand`。

### 4. Validation & Error Matrix

| 条件 | 服务行为 | API |
|---|---|---|
| 请求 schema 校验失败 | 不进入命令 | `422 VALIDATION_ERROR` + 原始字段 `loc` |
| 已确认唯一约束冲突 | `rollback()` 后抛稳定 `AppError` | `409` + 业务 code + 字段 errors |
| 其他 `IntegrityError` | 不改写、不吞掉 | 由框架默认 server-error boundary 返回 500 |
| 成功 | commit canonical row | 对应成功 response schema |

### 5. Good / Base / Bad Cases

- Good：真实 PostgreSQL 测试用等价 normalized 输入触发约束，断言 code、两个字段位置和事务回滚。
- Base：请求边界测试空白、长度与结构化 `422`，OpenAPI 声明对应非 2xx `ErrorResponse`。
- Bad：仅预检查重复、把所有 `IntegrityError` 改写成同一业务 code、解析 `str(error)`、返回兼容字段或固定成功。

### 6. Tests Required

- Contract：冻结 request schema 边界和 operation 非 2xx responses，并执行 runtime/generated contract check。
- Backend integration：使用真实 PostgreSQL 触发精确 constraint；断言稳定 code/details、原记录仍存在且重复记录未提交。
- Frontend：只按精确 `details.errors[].loc` 定位字段，无法定位的错误进入 form summary，并显示 `request_id`。

### 7. Wrong vs Correct

```python
# Wrong：吞掉约束身份并误报为 revision 冲突
except IntegrityError:
    raise AppError("REVISION_CONFLICT", "数据约束冲突", 409)

# Correct：只处理已确认约束，其他错误保留原语义
except IntegrityError as error:
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    if constraint != "uq_products_normalized_brand":
        raise
    db.rollback()
    raise AppError("PRODUCT_ALREADY_EXISTS", message, 409, details) from error
```

## Scenario：生成作业的唯一约束领域映射

### 1. Scope / Trigger

- `createGenerationJob`、`createHumanizationJob` 与 `retryGenerationJob` 的 `GENERATE | HUMANIZE` 分支经由 `content_production._create_job` 写入 `generation_jobs` 时适用。
- 预检查只提供快速路径；PostgreSQL `flush()` 的唯一性 enforcement 仍是最终权威。本规则是 service owner 的局部映射，不建立全局 constraint registry。

### 2. Contracts

- 只有 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name` 精确等于下列名称时才允许映射：
  - `uq_generation_jobs_idempotency_key`：由 caller root `rollback()` 后按 key 加载 winner；先确认 canonical identity 字段可验证，再用同一冻结 identity 比较。同身份 replay 既有作业，可证明异身份抛 `IDEMPOTENCY_CONFLICT`（409，`幂等键已用于另一生成请求`，`details={}`）。winner 缺失或 identity 无法验证时原样上抛原 `IntegrityError`。
  - `uq_generation_jobs_active_humanization_source`：只允许 Humanization caller 接管；caller root `rollback()` 后直接抛 `HUMANIZATION_ALREADY_ACTIVE`（409，`该源版本已有活动自然化作业`，`details={}`），不得回查幂等键或用查询结果反推约束。GENERATE caller 遇到该约束必须原抛。
- canonical identity 必须在 flush 前冻结为标量，正常 replay 和竞态恢复共用同一比较规则；actor 与 request ID 不属于 identity。原始 GENERATE winner 的 `input_snapshot.platform_prompt.id/revision` 缺失、损坏或类型无法解释时属于不可验证，不得降格为可证明的异身份冲突；该完整性检查只用于 rollback 后恢复，不改变普通 lookup 与 Humanization 既有语义。
- GENERATE 与 HUMANIZE retry 都必须先验证旧作业存在、快照合同有效、状态为 `FAILED` 且父任务为 `OPEN`，随后冻结 identity 并做 key replay/conflict；只有新 key 才继续 latest 和当前新建资格检查。different key 不得绕过 latest-job 规则。
- 成功仍由 caller `commit()` 后 dispatch；已知冲突和未知异常不得 commit、dispatch 或留下 generation/content/review/audit/task revision 副作用。

### 3. Validation & Error Matrix

| 条件 | 服务行为 | API |
|---|---|---|
| `23505` + `uq_generation_jobs_idempotency_key` | caller rollback；先验证 canonical winner identity；同身份 replay，可证明异身份抛既有冲突；winner 缺失或不可验证时原抛 | `202` replay 或 `409 IDEMPOTENCY_CONFLICT` |
| Humanization：`23505` + `uq_generation_jobs_active_humanization_source` | caller rollback；不回查，抛既有 active 错误 | `409 HUMANIZATION_ALREADY_ACTIVE` |
| GENERATE：`23505` + `uq_generation_jobs_active_humanization_source` | 原样上抛，不 rollback 后回查或改写 | 默认 unknown `500` |
| 缺 diagnostics、名称未知、SQLSTATE 非 `23505` 或其他 `IntegrityError` | 原样上抛；不得按 key/source 查询分类 | 默认 unknown `500`，由请求 Session cleanup |
| 新作业成功 | caller commit 后 dispatch | 既有 `202` |

### 4. Good / Base / Bad Cases

- Good：各 caller 只依赖 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name` 的精确组合；idempotency winner 先检查可验证性再使用冻结 canonical matcher，active 命中不查询。
- Base：同 key 同 identity replay 不重复创建或 dispatch，同 key 异 identity 保持既有 409。
- Bad：解析 `str(error)`、`message_primary`、替代 diagnostics 位置或英文数据库文本；未知异常先回查再猜 active；将任意 `23505` 改写为两个业务错误之一；把损坏 winner 当成异身份；在 classifier 内 rollback。

### 5. Tests Required

- Unit：覆盖两个精确组合及 diagnostics 缺失、替代位置、未知约束、非 `23505`、CHECK/NOT NULL/FK/trigger-like SQLSTATE；覆盖 GENERATE create/retry 的 winner 同身份、可证明异身份、缺失和不可验证，断言 unknown 原抛且 rollback/query 由 caller 控制。
- Backend integration：从 current-head PostgreSQL catalog 与真实异常捕获两个 constraint diagnostics；create 与 GENERATE retry 分别覆盖跨 Task 异身份 race，create 另有受控同身份 exact-constraint sentinel；断言 HTTP envelope/request ID 及失败无新增作业、内容、审核、审计、任务 revision 或 dispatch 副作用。
- Regression：同 Task并发由 Task lock 串行并在第二请求普通 lookup replay；Humanization create/retry、active-source、worker 独立 Session、commit-before-dispatch、Broker 失败保留 `PENDING` 与既有错误信封保持不变。

## 场景：ContentVersion identity 的最终失败边界

- `uq_content_versions_source_job_id` 只属于 `process_generation_job` 的内容 INSERT；`uq_content_versions_task_id` 属于人工首稿、人工修订及 worker 的版本号分配。约束可识别不代表它具有可恢复的 HTTP 业务含义，不新增 mapper。
- worker 在 provider 前按 `source_job_id` 查到既有版本时，沿用同一 Job 的 `SUCCEEDED` 收敛且不调用 provider；正常重复消息由 Job 锁和状态门禁吸收。
- final transaction 真实命中任一 identity 唯一约束时，worker 先 root rollback，再将同一 Job 提交为 `FAILED`，`error_code=GENERATION_FAILED`、`error_summary=生成作业执行失败`，设置失败完成时间并清 lease。不在错误后查询或猜测 winner，不 replay、不改号、不再次调用 provider 或 dispatch。
- 人工首稿与修订的 `23505 + uq_content_versions_task_id` 保持原始 `IntegrityError`，由 request Session rollback 后进入默认 unknown 500；不得映射 `REVISION_CONFLICT`。只有真实 `expected_revision` 比较失败继续返回原有 409。

| 入口与触发点 | 结果 | 事务边界 |
|---|---|---|
| worker provider 前已有 source version | 同 Job `SUCCEEDED`，零 provider 调用 | 沿用已有版本身份 |
| worker final flush 的两个精确 identity 约束之一 | `FAILED/GENERATION_FAILED`，固定安全摘要 | 回滚整个 final transaction，随后只提交 Job 失败字段 |
| manual/revision 的 task/version 精确唯一约束 | 默认 unknown 500 | request Session 回滚，正文不 replay、版本不改号 |

必需证据：current-head PostgreSQL catalog 与真实 `23505/diag.constraint_name`；正常重复 worker；两个精确约束 sentinel；HTTP 500 正文与响应头不泄漏 SQL、表名、约束、数据库 message 或堆栈；独立 stale revision 409。HTTP 与 worker 均须观测原 Session 在真实 rollback 后可查询，独立连接查询只作为持久化原子性的补充。不得把默认 500 的 body/code/header 固化成新的公共错误信封。

事务分配及晚期失败证明见 [数据库开发规范](./database-guidelines.md#场景contentversion-版本分配与-final-transaction)。错误做法是在 source unique 失败后查询并采用某一版本；正确做法是保留 provider 前 lookup，final exception 交给 worker 自己的 rollback/FAILED owner。

## Scenario：未知 IntegrityError 的默认 server-error boundary

### 1. Scope / Trigger

- 当 PostgreSQL 约束失败未被服务层以已确认的 constraint identity 显式映射时触发。
- 该边界只负责避免错误领域伪装；未知数据库异常不属于稳定的公共业务错误协议。

### 2. Contracts

- 应用不得注册全局 SQLAlchemy `IntegrityError` handler，也不得把未知约束转换为 `409 REVISION_CONFLICT` 或其他猜测的业务 code。
- 未知 `IntegrityError` 原样向上抛出，由 FastAPI/Starlette 默认 server-error boundary 返回 HTTP 500；依赖层仍负责请求 Session 的 rollback/close。
- 默认 500 的 body、code、Header 和 media type 不构成冻结的 `ErrorEnvelope` 公共合同；不得据此新增 OpenAPI 500 response、generated 类型或前端分支。
- 既有服务层对真实 revision conflict、状态冲突和已确认约束的 `AppError` mapper 不受该边界影响，继续返回对应 ErrorEnvelope。

### 3. Validation & Error Matrix

| 条件 | 服务行为 | API |
|---|---|---|
| 已确认约束 identity | 在最窄事务边界 rollback 后抛稳定 `AppError` | 既有 409 business code/details |
| 未知 `IntegrityError` | 不读取或解析数据库错误文本，不吞掉、不重写 | 默认 server-error boundary 返回 500 |
| 失败请求结束 | 由请求 Session 依赖 rollback/close | 后续独立查询可继续执行 |

### 4. Good / Base / Bad Cases

- Good：真实 PostgreSQL duplicate AI Model HTTP sentinel 使用 `debug=False` 和 `raise_server_exceptions=False`，验证 500、无 SQL/表名/约束/stack 泄漏、无第二条模型和成功审计，且 revision 与后续独立查询不变。
- Base：只断言默认 500 状态和非泄漏，不冻结框架默认错误 body。
- Bad：重新注册全局 `IntegrityError` handler、将所有数据库错误返回 `REVISION_CONFLICT`、把默认 500 body 填入 OpenAPI 或解析 `str(error)` 分类。

### 5. Tests Required

- Runtime unit：断言应用 exception handler 集合保留 `AppError` 与 `RequestValidationError`，不包含 SQLAlchemy `IntegrityError`。
- Backend integration：用真实 PostgreSQL 唯一约束触发 HTTP sentinel，并在新 Session 中检查业务行、模型计数、revision、成功审计及后续查询。
- Regression：真实 revision conflict 与既有已确认 constraint mapper 继续通过原有 status/code/details 测试。

## Scenario：同步运行时 OpenAPI 错误响应 metadata

### 1. Scope / Trigger

- 当冻结 OpenAPI 已按逐 operation 证据确定错误状态，而 FastAPI runtime document 仍缺少状态、错误 schema、media type、Header 或准确的 schema composition 时触发。
- 这一工作只同步声明层；不得借 metadata 修改权限、校验入口、service、事务、状态转换或 error-domain mapping。

### 2. Signatures

- 唯一 wire model：`ErrorEnvelope(error: ErrorDetail)`。
- `ErrorDetail` 必须要求 `code: str`、`message: str`、`details: dict[str, Any]`、`request_id: str`。
- metadata helper：`error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]`；调用方必须显式传入本 operation 的全部状态。
- response schema composition 遵循前述 authority 场景；本节只定义 operation metadata 的复用边界。

### 3. Contracts

- `error_response()` 与 runtime OpenAPI 必须复用同一个 `ErrorEnvelope` owner；不得维护第二套错误层级、code registry 或 status mapping。
- 显式 422 metadata 必须引用项目 `ErrorEnvelope`，但 `RequestValidationError` 的产生、Pydantic 校验和 handler 实际 422 行为保持不变。
- helper 只能复用 schema/description 等声明结构，不得按 router、method、dependency 或“常见错误”自动附加 401/403/404/409/422/5xx。
- route 不得粘贴完整 response schema、运行时读取冻结合同做 overlay，或在 comparator 中增加 baseline、allowlist、filter。

### 4. Validation & Error Matrix

| 条件 | Runtime metadata | 实际 HTTP 行为 |
|---|---|---|
| operation 有真实 path/query/header/cookie/body 校验 | 显式声明 `422 ErrorEnvelope` | 继续由 FastAPI/Pydantic 产生 `RequestValidationError` |
| operation 没有真实校验入口 | 不声明猜测的 422、`4XX` 或 `default` | 保持原 handler 与依赖行为 |
| service/dependency 有已证明可逃逸的业务错误 | route 显式传入对应状态 | 继续由既有 `AppError` owner 决定 status/code |
| 成功响应是 CSV 等非 JSON media | 精确声明 media schema 和必要 Header | 实际 `Response` bytes、media type、文件名不变 |
| Pydantic schema 与冻结 composition 不同 | 按前述 authority 场景修订，再复用模型 owner | `model_validate()` / `model_dump()` 与 response serialization 不变 |

### 5. Good / Base / Bad Cases

- Good：逐 operation 对照权威矩阵调用 `error_responses(401, 403, 404, 422)`；完整 domain projection comparator 返回空列表，同时真实非法输入和错误 handler sentinel 通过。
- Base：只需单个 503 的 readiness route 显式调用 `error_responses(503)`；无校验入口的 route 保持无 422。
- Bad：共享 `COMMON_ERRORS` 给所有 operation 套同一状态集合；用 `HTTPValidationError` 代替项目错误信封；只过滤 `schema_drift` 让测试变绿；在 route 复制完整冻结 response schema。

### 6. Tests Required

- Inventory：冻结当前 Task 拥有的完整 operationId 集合和分组数量，不得只抽样代表路由。
- Contract：分别投影冻结 document 与 `app.openapi()`，保留各自 components，调用生产 `compare_response_contracts()` 并直接断言 failures 为空。
- Error metadata：逐 operation 断言精确 status set；有 422 时引用 `ErrorEnvelope`，无 422 时不得出现自动 `HTTPValidationError` 替代。
- Behavior：保留 handler wire、非法输入、权限/业务错误、health 和非 JSON response 的真实 HTTP sentinel。
- Schema authority：执行前述 composition 场景的 contract、instance、operation 与 generated 门禁。

### 7. Wrong vs Correct

```python
# Wrong：helper 猜测所有 operation 都有同一错误集合
COMMON_ERRORS = error_responses(401, 403, 404, 409, 422)

@router.get("/items", responses=COMMON_ERRORS)
def list_items() -> ItemList: ...

# Correct：状态由 operation 的已审计调用链显式拥有
@router.get("/items", responses=error_responses(401, 403))
def list_items() -> ItemList: ...
```

## Scenario：同步跨切面 Request Context Metadata

### 1. Scope / Trigger

- 当 HTTP middleware 对全部 API operation 统一接收、生成、校验或回写 request ID，而 FastAPI runtime OpenAPI、冻结合同与 generated client 需要同步表达这一既有行为时触发。
- 该同步只增加跨切面声明；不得改变 middleware、Cookie、业务错误、权限、事务、状态转换、router 或 service 行为。

### 2. Signatures

- Runtime owner 位于 `backend/app/main.py`：`REQUEST_ID_HEADER_NAME`、`REQUEST_ID_MIN_LENGTH`、`REQUEST_ID_MAX_LENGTH`、`REQUEST_ID_PATTERN`。
- Runtime merge：`_merge_request_context_metadata(document: dict[str, Any]) -> None`；它只接收 FastAPI 生成的内存 document，不读取冻结合同。
- Request component：`#/components/parameters/RequestIdHeader`。
- Response Header component：`#/components/headers/RequestIdResponseHeader`。
- 非法输入 response：`400 -> #/components/responses/ErrorResponse -> ErrorEnvelope`。

### 3. Contracts

- Request Header 名为 `X-Request-ID`，`in: header`、`required: false`；schema 固定为 `type: string`、`minLength: 1`、`maxLength: 100`、`pattern: '^[\x20-\x7E]+$'`。
- Header 缺失时服务端生成 UUID；合法调用方值原样写回。空值、超过 100 字符、non-ASCII 或不可打印字符在进入 endpoint 前返回 `400 ErrorEnvelope`。
- 每个 operation 必须显式声明该 request Parameter 和 400；不得使用 `default`、`4XX`、filter、allowlist 或按 method/router 猜测其他业务状态。
- 每个已声明 response（含 204、CSV、成功、业务错误和新增 400）必须声明 required `X-Request-ID` response Header，schema 与 request 值域相同。
- Merge 只能追加上述 metadata。剥离 Parameter、400 和 response Header 后，原 operation status/schema/media/Header 必须与 FastAPI raw document 完全相同；CSV 的 `Content-Disposition` 与 204 no-body 语义不得改变。
- login/logout 的多个 `Set-Cookie` occurrence 由独立 HTTP sentinel 逐项验证，不得合并为逗号值，也不得伪装为 OpenAPI 单值 Header Object。
- `contracts/openapi.yaml` 是可编辑 static authority；runtime owner 不得反向读取它。`schema.d.ts` 只能运行 `npm --prefix frontend run api:generate` 生成，optional request Header 不得迫使现有调用方传参。
- Custom OpenAPI 必须先在局部 document 完成 merge，再一次性写入 `app.openapi_schema`；merge 冲突时 cache 保持未发布，后续调用不得静默返回 raw 或 partial document。

### 4. Validation & Error Matrix

| 条件 | 实际 HTTP 行为 | OpenAPI / cache 行为 |
|---|---|---|
| Header 缺失 | 生成 UUID，并在正常或错误 response 回写 | request Parameter 保持 optional |
| 1 或 100 个可打印 ASCII 字符 | 接受并原样回写 | request/response schema 接受 |
| 空值、101 字符、non-ASCII、控制字符或 DEL | endpoint 前返回 `400 VALIDATION_ERROR`；envelope `request_id` 与 response Header 一致 | 每个 operation 显式引用 `400 ErrorResponse` |
| 正常、业务错误或 validation error response | middleware 都写回 `X-Request-ID` | 每个已声明 response 都有 required Header |
| CSV 或 204 | CSV bytes/media/文件名不变；204 仍无 body | 保留 `Content-Disposition`；不得给 204 增加 content |
| component、同名 Header 或 400 冲突 | 不改变业务处理 | merge 显式失败，`app.openapi_schema` 不得缓存 partial document |
| login/logout 多 Cookie | 保留多个独立 `Set-Cookie` occurrence 及当前安全属性 | OpenAPI 不声明 `Set-Cookie` |

### 5. Good / Base / Bad Cases

- Good：static/runtime operation 集合精确一致；当前 162 个 operation、1024 个 response occurrence 由默认完整契约门禁全量覆盖并退出 0，generated request Header 仍为 optional。
- Base：新增 operation 自动继承同一 runtime metadata；static contract、全量计数与 generated client 在同一 Task 显式同步。
- Bad：逐 route 复制 request-id metadata；runtime 从 `openapi.yaml` 做 overlay；只抽样若干 endpoint；把多个 Cookie 合并；先发布 raw cache 再原地 merge；用 comparator filter 隐藏漂移。

### 6. Tests Required

- Request boundary：覆盖缺失 UUID、1/100、空/101、raw non-ASCII、控制字符/DEL，以及正常 response 和 endpoint 422 都回写 Header。
- Error identity：非法值的 `ErrorEnvelope.error.request_id` 必须与 response Header 一致。
- Full inventory：static/runtime operationId 唯一且集合相同；当前断言 162 个 request Parameter、162 个显式 400、1024 个 required response Header，无 `default`/`4XX`。
- Non-interference：raw 与 augmented 剥离 Phase X metadata 后逐 operation 深比较；当前原始 response occurrence 为 862，两个 CSV 保留 `Content-Disposition`，20 个 204 无 content。
- Cookie：逐 raw Header occurrence 锁定 login/logout 各两个 Cookie 的名称、值或删除语义、Path、SameSite、Secure、HttpOnly 与 Max-Age；递归断言 OpenAPI 不含 `Set-Cookie`。
- Cache：强制 merge 抛错，断言 merge 内及异常后 `app.openapi_schema is None`，并恢复测试前 cache。
- Generated / gates：运行 canonical generator、`api:check`、frontend typecheck、受影响 consumers 与默认执行完整响应比较的 `make contract-check`。

### 7. Wrong vs Correct

```python
# Wrong：raw document 先进入共享 cache，merge 失败或并发读取会暴露 partial schema
app.openapi_schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
_merge_request_context_metadata(app.openapi_schema)

# Correct：局部 document 完整合并成功后再原子发布
schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
_merge_request_context_metadata(schema)
app.openapi_schema = schema
```

## Scenario：默认执行完整 OpenAPI response 契约门禁

### 1. Scope / Trigger

- 当 `contracts/openapi.yaml`、FastAPI runtime OpenAPI 或契约检查入口变化时触发；默认门禁必须覆盖全部 operation 的全部 response，不提供只检查部分 response 的兼容开关。

### 2. Signatures

- CLI：`python -m app.tools.contract_check [contract_path]`；`contract_path` 省略时读取仓库的 `contracts/openapi.yaml`。
- 纯比较器：`compare_response_contracts(contract_document, runtime_document) -> list[dict[str, Any]]`。
- 默认门禁：`check(contract_path: Path) -> list[str]`；它只调用一次完整 response 比较器，并继续执行 security scheme、operationId、parameter、security 与 requestBody 检查。
- Operation 方法集合：`get`、`put`、`post`、`delete`、`options`、`head`、`patch`、`trace`。

### 3. Contracts

- `check()` 必须对 `app.openapi()` 的深拷贝执行比较，不得修改或污染共享 OpenAPI cache。
- 完整 response 比较器唯一拥有 operation/status 集合，以及 schema、media type、Header、Link 和 local reference 的漂移诊断；旧的首个 2xx 特判、重复 path 检查和 `--response-report` 不得恢复。
- operation 枚举必须覆盖上述八种 OpenAPI 方法；不得因当前路由只使用其中一部分而静默忽略其他合法方法。Path Item 的 `summary`、`description`、`servers`、`parameters` 等非 operation 固定字段不作为 operation，其中 shared `parameters` 继续合并到各 operation。
- 诊断必须按稳定键排序；response 诊断使用稳定 JSON 序列化，保留 `kind`、`pointer`、`direction`、`message` 与必要的两侧证据。
- OpenAPI `paths` 下的 `x-*` Specification Extension 可包含任意 JSON 值并被忽略；其他 path key 必须以 `/` 开头且 Path Item 必须是 mapping，无法解释的输入必须显式失败。

### 4. Validation & Error Matrix

| 条件 | CLI exit code | 输出 |
|---|---:|---|
| 完整 static/runtime 契约一致 | 0 | 成功信息写 stdout |
| 可比较的 operation/status/schema/media/Header/Link 漂移，或比较器报告 unsupported | 1 | 稳定排序诊断写 stderr |
| 文件读取、编码、YAML 或顶层/section 结构无法解释 | 2 | `contract-check error: ...` 写 stderr |

### 5. Good / Base / Bad Cases

- Good：later 2xx、非 2xx、CSV Header、request ID Header 与 Link 任一 mutation 都由默认命令阻断，并给出准确 direction。
- Base：完整一致文档直接运行默认命令退出 0；不需要额外 flag。
- Bad：只比较第一个 2xx；保留 opt-in response flag；把非法文档当成空 mapping；重复报告同一个缺失 operation。

### 6. Tests Required

- 单元 mutation：覆盖缺失/新增 status、later 2xx 与错误 schema、media type、`X-Request-ID`、`Content-Disposition`、Link；另通过默认 `check()` 参数化覆盖 contract-only/runtime-only 的 `HEAD`、`OPTIONS`、`TRACE` operation，并断言 pointer、kind 和 direction。
- 调用链：断言默认 `check()` 恰好调用一次 `compare_response_contracts()`，缺失 operation 不出现旧 path 文本重复诊断。
- CLI：覆盖默认/显式路径的 0、漂移与 unsupported 的 1、文件/YAML/无法解释结构的 2，以及 `paths.x-*` 任意 JSON 值。
- 集成：`make contract-check` 与 frontend `api:check` 必须保持通过。

### 7. Wrong vs Correct

```python
# Wrong：完整响应检查需要调用方显式 opt in，默认路径仍可能漏过非首个 2xx 或错误响应。
if args.response_report:
    failures = compare_response_contracts(contract, runtime)

# Correct：默认检查只有一条完整响应比较路径。
response_failures = compare_response_contracts(contract, runtime)
```
