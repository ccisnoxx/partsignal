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
