# Query Topic page_size HTTP 绑定证据

研究日期：2026-08-31（Asia/Shanghai）。

## 1. 根因与权威类型

- `backend/app/schemas/configuration.py:75`：`QueryTopicPageSize = Literal[10, 20, 50]`。
- `backend/app/schemas/configuration.py:120-124`：`QueryTopicListPage.page_size` 复用该枚举类型。
- `backend/app/routers/planning.py:105-121`：V2 list router 的 `page_size` 当前缺少字符串到整数的 pre-validation 转换。
- `backend/app/services/content_planning.py:119-185`：service 接收 `QueryTopicPageSize`，执行分页并构造 `QueryTopicListPage`；HTTP 解析不属于该层。
- 父 Task `research/route-conformance-matrix.md` 8.1–8.2 已记录本地与已部署只读复现：省略参数为 200，显式 10/20/50 为 422，错误位置为 `query/page_size`。

## 2. 既有正确模式

- `backend/app/routers/observation.py:224-230`：`GeoObservationPageSize` 使用 `BeforeValidator(int)` 后再由 `Query()` 绑定。
- `backend/app/routers/planning.py:192-217`：Platform Profile 的可选数值 `Literal` page size 使用相同模式。
- `backend/app/routers/planning.py:236-268`：Content Task 的可选数值 `Literal` page size 使用相同模式。
- `backend/app/routers/planning.py:8` 已导入 `BeforeValidator`，本修复无需新增依赖或 import。

## 3. 现有测试缺口与可复用边界

- `backend/tests/integration/test_query_topic_list.py:27-147` 直接调用 service 并传入 Python 整数，覆盖数据库搜索、分页、引用投影和语句数量，不覆盖 FastAPI query-string binding。
- `backend/tests/unit/test_contract.py:154-181` 的 GEO Observation 回归使用 `TestClient(app)`、dependency override 和 router collaborator monkeypatch，能够证明真实 HTTP 绑定且不要求数据库。
- `backend/tests/unit/test_contract.py:184-215` 只检查冻结 Query Topic OpenAPI shape，不能证明 runtime query parsing。
- `backend/tests/unit/test_contract.py:921-959` 经过真实 Query Topic DELETE router，但只覆盖认证、权限、CSRF 与 revision 边界，不覆盖 list GET page size。
- `backend/app/routers/planning.py:52-55` 将 service 导入为 `list_query_topic_items_query`；HTTP 测试应 monkeypatch 该 router alias，避免错误地 patch 原 service 符号。

## 4. 合同与错误信封

- `contracts/openapi.yaml:606-627`：`page_size` 是 integer enum `[10, 20, 50]`，default `20`；200 response 是 `QueryTopicListPage`。
- `backend/tests/unit/test_contract.py:20-22`：`test_runtime_openapi_matches_frozen_operations` 调用 runtime/frozen checker。
- `backend/app/tools/contract_check.py:190-254`：checker 比较参数 required、类型约束、默认值、枚举及成功响应 shape。
- `backend/app/errors.py:51-62`：FastAPI `RequestValidationError` 统一转换为 `422 VALIDATION_ERROR`，保留 `details.errors[].loc`。
- `Makefile:16-18`：`make contract-check` 同时检查 backend runtime OpenAPI 与 frontend generated API。

## 5. 结论

最小正确 owner 是 `backend/app/routers/planning.py:list_query_topic_items` 的参数元数据；最小回归 owner 是 `backend/tests/unit/test_contract.py` 的真实 `TestClient` HTTP 边界。Schema、service、integration DB 行为、OpenAPI、generated client、frontend 与 database 均无需变更。
