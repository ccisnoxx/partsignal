# Request Context Authority 与 162-operation 覆盖审计

## 当前基线

2026-09-02 重算：static/runtime 均为 162 operation、162 unique operationId、861 response occurrence；operation key 与 operationId 集合相同。两侧均有 0 个 `X-Request-ID` request Parameter、0 个 response Header、0 个 400。`compare_response_contracts()` failure 为 0；无 filter CLI report 退出 0。

status occurrence：200×120、201×21、202×3、204×20、401×160、403×158、404×119、409×106、422×149、502×1、503×3、504×1。每 operation 新增 400 后为 1023 response occurrence。三波测试持有互斥的 61/58/43 operationId，合计 162。

## middleware 权威与精确 schema

`backend/app/main.py::request_context` 的实际语义：Header 名 `X-Request-ID`；缺失时生成 UUID；提供值须长度 1–100、`isascii()`、`isprintable()`；非法值返回 400 `VALIDATION_ERROR` 与既有 `ErrorEnvelope`；全部正常/错误 response 写回 Header。

精确 OpenAPI schema：

```yaml
type: string
minLength: 1
maxLength: 100
pattern: '^[\x20-\x7E]+$'
```

request Parameter `required: false`；response Header `required: true`。

## Owner 决策

选择 `backend/app/main.py` 的 custom OpenAPI builder：先使用 FastAPI 官方 `get_openapi(...)` 生成原始 route schema，再只合并跨切面 metadata。它与 middleware 具有相同覆盖面，不需修改 162 个 endpoint，不介入 dispatch/依赖/serialization，且可用 raw/augmented schema全量证明非干扰。builder 只使用 runtime 常量与 `ErrorEnvelope` ref，不读取 static contract。

常量持有 Header 名、min/max/pattern；middleware 复用名称和长度，保留 UUID、`isascii()`/`isprintable()`、文案、日志、`request.state` 与控制流。遇到既有同名 Parameter/Header 或 400 时只接受等价机器语义，否则显式失败；当前基线无冲突。

## Static 同步

static 新增 component request Parameter、component response Header。每个 operation 引用 Parameter 并新增 `400 ErrorResponse`。现有 `ErrorResponse`、`FactVersionResponse`、`ContentVersionResponse` 与 156 个 inline success response 增加 Header ref：697 个 ErrorResponse ref + 162 个新 400 + 3 FactVersion + 5 ContentVersion + 156 inline = 1023。

## 全量证明

测试对两侧各构建 162-operation map，断言每个 request/400/response Header。runtime 另用官方 `get_openapi()` 生成 raw document；从 augmented 剥离 Phase X 字段后逐 operation 深比较，证明原 status/schema/media/Header 不变。另断言两个 CSV 保留 `Content-Disposition`/`text/csv`，20 个 204 无 content。production parameter gate与完整 response comparator 已覆盖这些机器字段，无需修改 production checker。
