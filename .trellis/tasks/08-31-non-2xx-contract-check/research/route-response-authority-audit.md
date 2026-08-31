# Route Response Authority Audit

审计日期：2026-08-31（Asia/Shanghai）。

范围：`backend/app/main.py`、`backend/app/errors.py`、`backend/app/deps.py`、`backend/app/routers/**/*.py` 及路由直接调用、会影响 HTTP status 的 service 分支。本文件只记录静态调用链与本地 OpenAPI 事实，不把“声明缺失”解释成业务实现错误。

## 1. Operation 与 decorator 基线

- 共 162 个 FastAPI operation：configuration 39、files 5、identity 15、observation 12、planning 19、product_facts 18、production 21、publication 30、workbench 1、health 2。
- 142 个 operation 显式声明 `response_model`，42 个声明主成功 `status_code`，22 个使用额外 snapshot dependency，87 个写 operation 使用 `CsrfProtected`。
- 只有两个 operation 声明 `responses=`：`getCurrentUser` 的 204（`backend/app/routers/identity.py:139`）与 `getContentHumanizationPrompt` 的 204（`backend/app/routers/configuration.py:302`）。没有 route 显式声明项目错误 response。
- `app.add_exception_handler(...)` 只决定实际错误编码，不会修改 operation OpenAPI metadata（`backend/app/main.py:48`）。实际 `AppError` 与 validation error 都由 `backend/app/errors.py:31` 起编码为 `ErrorEnvelope`。

## 2. 权威错误来源

| Status | 权威来源 | 当前冻结合同的明确缺口 | 结论 |
|---|---|---:|---|
| 401 | `_resolve_current_session` 的缺失/失效/停用会话；login/change-password 的凭据失败（`backend/app/deps.py:31`、`backend/app/services/identity.py:331`） | 至少 35 个受保护 operation | 由认证依赖或 operation 自身声明，不得按 router 统一猜测。 |
| 403 | 临时密码 gate、CSRF、`assert_account_types`/角色依赖（`backend/app/deps.py:47,96,108`） | 至少 43 个 operation | 由实际依赖链证明；前端隐藏动作不是权限合同。 |
| 404 | 统一 `not_found()` 及 service 调用链（`backend/app/errors.py:70`） | 至少 32 个 operation | 只有可逃逸的显式路径才声明。 |
| 409 | revision/state/idempotency/context、`in_use()` 与已确认的 `IntegrityError` 路径 | 至少 10 个 operation | 不能因“会访问数据库”就给所有 operation 补 409。 |
| 422 | FastAPI/Pydantic 参数或 body 解析；route/service 主动 validation；实际均由 `validation_error_handler` 输出 `ErrorEnvelope` | runtime 自动生成 149 个，合同只有 80 个；至少 13 个 operation 另有明确业务 422 | 必须同时修正 status 集合与 runtime `HTTPValidationError` shape。 |
| 502/504 | provider/transport 错误只在没有被 operation 捕获转换时逃逸 | `discoverAIChannelModels` 可逃逸；`testAIModel` 不可逃逸 | `testAIModel` 当前合同的 502/504 应按实际 200 失败投影修正，不能反过来改变业务行为。 |
| 503 | ready health、platform logo candidate、file complete 的依赖不可用路径 | `completeFileUpload` 漏 503 | 三个 owner 都有明确实现证据。 |

完整缺口分组和 156 行当前集合差异见 `research/response-drift-classification.md`。

## 3. 明确语义冲突

### 3.1 `testAIModel`

`backend/app/services/ai_configuration.py:924` 起捕获 provider `AppError`，写入 `test_status="FAILED"` 与安全错误摘要，随后以 200 返回模型投影；因此冻结合同在 `contracts/openapi.yaml:1406` 附近声明的 502/504 不是实际同步 HTTP 行为。默认修正方向是删除这两个冻结 status，而不是改变现有业务命令。

### 3.2 `completeFileUpload`

`backend/app/services/file_records.py:117` 起可返回 404、409、422、503，路由还受认证、权限与 CSRF 依赖约束；当前合同只列 200/422。现有“合同与 runtime status 集相等”是双方同样不完整，不能作为正确样本。

### 3.3 全局 `X-Request-ID` 400

`backend/app/main.py:53` 起的 middleware 会在 header 非 1–100 个可打印 ASCII 字符时，在进入 route 前返回 400 `ErrorEnvelope`，并在所有正常/错误响应写入 `X-Request-ID`（`:76`）。OpenAPI 没有原生全局 response 应用点；最终门禁若覆盖稳定 operation response，就必须在独立、可审查的跨切面 metadata 边界中同时建模 request Header、400 与 response Header。runtime metadata owner 必须来自 middleware 常量/行为，不能从冻结合同反向复制。

### 3.4 实际 response Header 与 ErrorEnvelope

- login 通过两次 `Response.set_cookie()` 写入 session/CSRF 两个 `Set-Cookie`，logout 通过两次 `delete_cookie()` 写入删除 Cookie（`backend/app/routers/identity.py:103-136`）。`Set-Cookie` 不能按普通逗号列表安全合并，OpenAPI Header Object 也无法精确冻结两个实例的各自属性；应由 HTTP behavior sentinel 保持，不用失真的单值 schema 伪装 parity。
- 两个 CSV export 的 `Content-Disposition` 已在冻结合同声明，但 runtime metadata 缺失；这是可由 OpenAPI 精确表示的 operation response Header，应进入 parity。
- `error_response()` 始终写出 `code`、`message`、`details` 与 `request_id`（`backend/app/errors.py:31-43`），但冻结 `ErrorDetail.required` 只有 `code/message/request_id`（`contracts/openapi.yaml:3369-3377`）。authority reconciliation 必须先把 `details` 的实际必填语义冻结，再创建 runtime metadata model；不能让两份 metadata 共同复制当前较宽松 schema 后假绿。

普通未处理异常产生的 500 没有稳定业务 code/shape，不在本 Task 中统一补默认 `ErrorResponse`；如要把平台级 500 纳入公共合同，应先另行冻结实际错误边界。

## 4. Runtime metadata 推荐边界

- `AppError`、`error_response` 继续是唯一运行时业务错误与信封编码 owner。
- 新增与冻结 `ErrorEnvelope` 一致的 Pydantic wire schema，只服务 OpenAPI response model；它不是第二套业务 error code 或 exception hierarchy。
- 可复用 `error_responses(...)` 一类纯 metadata helper 来复用 shape；每个 operation 仍显式拥有经证据确认的 status 集合。禁止统一给所有 operation 套 401/403/404/409。
- 推荐把真正全局的 middleware 400 纳入本 Task；应由 runtime 代码自身的 OpenAPI metadata owner 生成，不读取 `contracts/openapi.yaml` 反向覆盖 `app.openapi()`。
- 全局 `X-Request-ID` 与 CSV `Content-Disposition` 进入 response Header parity；login/logout 多实例 `Set-Cookie` 留在 HTTP sentinel。
- 共享 shape 可以复用，status 集合不能从 frozen contract 在运行时注入，也不能由 service 文本搜索自动生成。

## 5. 限制

- 本审计没有执行真实数据库、provider 或公网请求；“可达”来自显式依赖、route 和 service 调用链。
- 全局 `IntegrityError` handler 不足以证明每个数据库 operation 都稳定返回 409。
- 普通异常、第三方内部异常和理论上的 500 未被猜测性加入 operation 合同。
