# Backend 错误处理契约

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
