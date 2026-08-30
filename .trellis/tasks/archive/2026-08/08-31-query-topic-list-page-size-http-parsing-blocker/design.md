# Query Topic page_size HTTP 解析修复设计

## 1. 问题与不变量

问题只发生在 HTTP 查询字符串到 Python 类型的 FastAPI 参数绑定阶段。业务不变量是：客户端允许显式请求的 page size 只有整数 `10`、`20`、`50`，省略时为整数 `20`；任何其他值必须在进入 service 前以统一 `422 VALIDATION_ERROR` 拒绝。

权威所有者保持不变：

1. `contracts/openapi.yaml` 冻结 HTTP 参数和 `QueryTopicListPage` 响应 shape。
2. `QueryTopicPageSize = Literal[10, 20, 50]` 冻结 Python 枚举与响应模型约束。
3. FastAPI router 负责把不可信的 HTTP 字符串解析为该 Python 类型。
4. service 只接收已完成边界解析的 `QueryTopicPageSize`，不增加兼容或二次校验层。

## 2. 最小改动

在 `backend/app/routers/planning.py:list_query_topic_items` 的现有参数上增加已导入的 Pydantic 元数据：

```python
page_size: Annotated[QueryTopicPageSize, BeforeValidator(int), Query()] = 20
```

绑定顺序为：HTTP 查询字符串转成 `int`，再由 `Literal[10, 20, 50]` 校验，然后进入 router 与现有 service。省略参数不经过字符串转换，继续使用 Python 整数默认值 `20`。

该设计复用 `backend/app/routers/observation.py` 和同一 `planning.py` 中已经运行的模式，不新增 import、helper、wrapper、schema 或第二个 page-size 类型。由于最终 JSON Schema 仍由相同 `Literal`、默认值和 `Query()` 生成，runtime OpenAPI 应继续与冻结合同一致。

## 3. HTTP 边界测试

测试放在 `backend/tests/unit/test_contract.py`，与现有 GEO Observation query-string parser 回归相邻，直接使用全局 FastAPI `app`：

- monkeypatch `app.routers.planning.list_query_topic_items_query`，使 collaborator 记录 `page_size` 的值和运行时类型，并返回合法空 `QueryTopicListPage` payload。
- override `get_db` 与 `get_current_session`，只隔离数据库和认证；请求仍进入真实 app、依赖解析、router 参数绑定和 response model 序列化。
- 在 `finally` 中清空 `app.dependency_overrides`，避免污染其他测试。

用三个可独立诊断的行为测试关闭边界：

1. 参数化显式值 `10`、`20`、`50`：逐个断言 200、collaborator 收到同值 Python `int`、JSON 中 `page_size` 相同。
2. 省略参数：断言 200，collaborator 收到 Python `int` 20。
3. 非枚举值 `30`：断言 422、`error.code == "VALIDATION_ERROR"`、`details.errors` 含 `loc == ["query", "page_size"]`，并断言 collaborator 未调用。

测试不需要真实 PostgreSQL，因为唯一待证事实是 router binding；现有 PostgreSQL integration 已覆盖 service 分页和响应业务投影。反之，仅扩展 service integration 无法捕获查询字符串类型问题。

## 4. 合同与兼容性

- 不改变 endpoint path、operationId、参数名、required 状态、默认值、枚举或响应 schema。
- 不修改 `contracts/openapi.yaml`，也不重新生成或编辑 frontend client。
- `backend/tests/unit/test_contract.py:test_runtime_openapi_matches_frozen_operations` 与 `make contract-check` 共同验证 runtime/frozen 以及 frontend generated 同步。
- 非枚举值仍由现有 `validation_error_handler` 进入统一 `ErrorEnvelope`，不新增错误类型或 fallback。

## 5. 风险与回滚

主要风险是测试只断言 200 而没有证明 service 收到整数，或非法值在错误地进入 collaborator 后才失败。设计通过记录运行时类型与非法分支零调用同时关闭这两个缺口。

变更无数据库、状态、迁移或数据回填风险。若定向回归或 runtime contract check 发现漂移，停止交付并回滚 router 单行绑定和对应新测试；不得修改静态合同或前端来适配错误实现。

## 6. 部署后只读复验

生产部署不属于本轮规划或默认实施授权。只有另获明确部署授权后，才在同一个 canonical Frontend V2 `/geo/topics` URL 执行：

1. 首次加载，记录底层 `/api/v1/query-topics/list-items?sort=QUESTION_ASC&page=1&page_size=20` 的状态与 request ID。
2. 在同页执行一次显式重试，记录同形请求的状态与 request ID。

两次请求都必须不再返回 422；合法列表与合法空态均可接受。复验只读，不创建、更新或删除 Query Topic。
