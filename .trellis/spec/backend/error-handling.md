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
- 可定位请求字段的 `loc` 固定为 `["body", "<field>"]`；未知约束必须原样上抛，交给既有全局处理。
- 例：产品 normalized brand + part number 的约束 `uq_products_normalized_brand` 映射为 `409 PRODUCT_ALREADY_EXISTS`，并分别定位 `part_number` 与 `brand`。

### 4. Validation & Error Matrix

| 条件 | 服务行为 | API |
|---|---|---|
| 请求 schema 校验失败 | 不进入命令 | `422 VALIDATION_ERROR` + 原始字段 `loc` |
| 已确认唯一约束冲突 | `rollback()` 后抛稳定 `AppError` | `409` + 业务 code + 字段 errors |
| 其他 `IntegrityError` | 不改写、不吞掉 | 由既有全局边界显式失败 |
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

- Good：static/runtime operation 集合精确一致；当前 162 个 operation、1023 个 response occurrence 全量覆盖，完整无 filter response report 退出 0，generated request Header 仍为 optional。
- Base：新增 operation 自动继承同一 runtime metadata；static contract、全量计数与 generated client 在同一 Task 显式同步。
- Bad：逐 route 复制 request-id metadata；runtime 从 `openapi.yaml` 做 overlay；只抽样若干 endpoint；把多个 Cookie 合并；先发布 raw cache 再原地 merge；用 comparator filter 隐藏漂移。

### 6. Tests Required

- Request boundary：覆盖缺失 UUID、1/100、空/101、raw non-ASCII、控制字符/DEL，以及正常 response 和 endpoint 422 都回写 Header。
- Error identity：非法值的 `ErrorEnvelope.error.request_id` 必须与 response Header 一致。
- Full inventory：static/runtime operationId 唯一且集合相同；当前断言 162 个 request Parameter、162 个显式 400、1023 个 required response Header，无 `default`/`4XX`。
- Non-interference：raw 与 augmented 剥离 Phase X metadata 后逐 operation 深比较；当前原始 response occurrence 为 861，两个 CSV 保留 `Content-Disposition`，20 个 204 无 content。
- Cookie：逐 raw Header occurrence 锁定 login/logout 各两个 Cookie 的名称、值或删除语义、Path、SameSite、Secure、HttpOnly 与 Max-Age；递归断言 OpenAPI 不含 `Set-Cookie`。
- Cache：强制 merge 抛错，断言 merge 内及异常后 `app.openapi_schema is None`，并恢复测试前 cache。
- Generated / gates：运行 canonical generator、`api:check`、frontend typecheck、受影响 consumers、`make contract-check` 与无 filter response report。

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
