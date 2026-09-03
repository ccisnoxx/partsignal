# 跨切面 Request Context Metadata 设计

## 1. 数据流与不变量

```text
middleware constants + actual predicates
                │
FastAPI routes ─┴─ get_openapi() ── metadata merge ── app.openapi()
                                                        │
contracts/openapi.yaml ── api:generate ── schema.d.ts   │
              └──────────── contract gates ─────────────┘
```

runtime 代码决定实际 request-id 行为；static contract 是公共可编辑 authority；二者同 Task 同步但互不反向读取。metadata 不参与 request dispatch、权限、service、事务或 response serialization。

## 2. Runtime owner

唯一 owner 位于 `backend/app/main.py`：常量持有 Header 名、min/max/pattern；middleware 只复用名称/长度常量，保留 `isascii()`、`isprintable()`、UUID、日志、错误文案、`request.state` 和响应顺序。自定义 builder 调用 FastAPI 官方 `get_openapi(title=app.title, version=app.version, routes=app.routes)`，集中合并 metadata 后写 `app.openapi_schema`。

不选择 route decorator：需要修改 162 个 endpoint 或重建依赖，扩大范围且难证明无行为变化。不选择 comparator/overlay：会让 runtime document 继续错误并形成第二 authority。

## 3. Merge 规则

runtime/static 都定义同形 component request Parameter 与 response Header：

```yaml
type: string
minLength: 1
maxLength: 100
pattern: '^[\x20-\x7E]+$'
```

request Parameter：`name: X-Request-ID`、`in: header`、`required: false`。response Header：`required: true`。

每个 operation：

1. 追加 request Parameter ref。
2. 新增精确 400，content 为 `application/json` + `#/components/schemas/ErrorEnvelope`。
3. 给合并后的每个 response 追加 Header ref，保留原 Header mapping。

同名 Parameter/Header/400 冲突必须验证等价或显式失败，不能静默覆盖。当前基线无冲突，不需要兼容 fallback、`4XX` 或 `default`。

## 4. Static/runtime 同步与非干扰

static 对全部 162 operation 添加 Parameter/400；`ErrorResponse`、`FactVersionResponse`、`ContentVersionResponse` 和 156 个 inline response 添加 Header。一次工作提交同时包含 runtime、static、generated、tests，禁止任何提交点只同步一侧。

测试构造 `raw=get_openapi(app.routes)` 与 `augmented=app.openapi()`。从 augmented 移除 X-Request-ID Parameter、400 与 X-Request-ID response Header 后，逐 operation 深比较 Parameter/responses，必须与 raw 完全相同。额外断言：

- 162 operation/1023 response occurrence 完整覆盖。
- 两个 CSV 仍仅 `text/csv`，同时保留 `Content-Disposition`。
- 20 个 204 仍无 content。
- 三波 operation-specific status 在排除 shared 400 后保持原矩阵；旧“无 headers”断言改为“除 shared Header 外无新增”。

因此 `backend/tests/unit/test_runtime_response_metadata.py` 是研究后确认的必要额外测试 touch，不是额外生产范围。

## 5. Behavior sentinels

`test_request_context.py` 覆盖缺失 UUID、1/100、空/101、raw non-ASCII byte、控制字符/DEL、400 envelope/header request_id 一致、live 200 与 login body 422 都写回 supplied valid ID。

新 `test_identity_response_headers.py` 读取 raw Header occurrence，分别解析 login/logout 两个 Cookie，锁定当前名称、值/删除、Path、SameSite、Secure、HttpOnly、Max-Age。它不连接数据库、不修改 handler、不将 Cookie 复制到 OpenAPI。

## 6. Generated client

static 完成后只运行 canonical `api:generate`。预期所有 operation Header 参数新增 optional string，新增 400 response，每个 response Header 暴露 required string；现有调用不需传参。`api:check`、full typecheck 与 direct generated consumers 证明兼容。

## 7. Review、回滚与 Phase F

独立只读 Review 覆盖 runtime owner、不反向读取 contract、162/1023、schema 精度、request optionality、CSV/204、Cookie 多实例、generated diff、dirty isolation。一次完整 Review；修复后最多一次 targeted re-review；新/残留 MEDIUM 以上即停止。

工作提交采用单个原子提交，回滚同一提交即可同步恢复 runtime/static/generated/tests，无数据迁移。Phase F 必须等待本 Task 完成、归档且无 filter response report 为 0；Phase X 不修改默认 `check()` 或 `successful_response()`。
