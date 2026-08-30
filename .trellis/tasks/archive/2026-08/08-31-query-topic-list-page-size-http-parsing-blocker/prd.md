# Query Topic 列表 page_size HTTP 解析阻塞

## Goal

关闭 Frontend V2 `/geo/topics` 首屏所依赖的 Query Topic 列表接口在显式传入合法 `page_size` 时返回 `422 VALIDATION_ERROR` 的 HTTP 绑定阻塞。修复必须位于 FastAPI router 参数边界，保持现有枚举、默认值、服务层、静态 OpenAPI、generated client 和数据库行为不变。

## Background

- 父 Task 的一致性矩阵已将本 Task 排为后续实施顺序第 2 项，并在 `research/route-conformance-matrix.md` 8.1–8.3 冻结根因、运行证据和独立验收标准。
- `backend/app/schemas/configuration.py:75` 将 `QueryTopicPageSize` 定义为 `Literal[10, 20, 50]`；`QueryTopicListPage.page_size` 复用该类型。枚举本身正确，不得放宽。
- `backend/app/routers/planning.py:105-121` 的 `list_query_topic_items` 目前仅声明 `Annotated[QueryTopicPageSize, Query()]`。HTTP 查询字符串在进入数值 `Literal` 校验前没有转成整数，导致显式合法值被拒绝；省略参数时 Python 整数默认值 `20` 可正常进入 service。
- 同一 router 已导入 `BeforeValidator`，并在 Platform Profile 与 Content Task 分页参数中使用 `BeforeValidator(int)`；`backend/app/routers/observation.py:224-230` 对同形的 GEO Observation `Literal` page size 采用相同模式。
- `backend/app/services/content_planning.py:119-185` 已接收 `QueryTopicPageSize` 并返回 `QueryTopicListPage`，不拥有 HTTP 字符串解析职责。`backend/tests/integration/test_query_topic_list.py` 直接以 Python `int` 调 service，因此不能覆盖当前 HTTP blocker。
- `contracts/openapi.yaml:606-627` 已将该参数冻结为 `integer`、枚举 `[10, 20, 50]`、默认值 `20`，响应为 `QueryTopicListPage`；合同不需要修改。

## Requirements

1. 只在 `backend/app/routers/planning.py` 的 Query Topic 列表参数绑定处复用项目既有 `BeforeValidator(int)` 模式，使 HTTP 查询字符串先转为 Python `int`，再进入 `QueryTopicPageSize` 的 `Literal` 校验。
2. 新增真实 FastAPI HTTP 边界回归。测试必须通过 `TestClient(app)` 请求 `/api/v1/query-topics/list-items`，并可覆盖数据库、认证或 router 已导入的 service collaborator；不得直接调用 service 冒充 HTTP 覆盖。
3. 对显式 `page_size=10`、`20`、`50` 分别证明：响应为 200、service 收到与请求一致的 Python `int`、响应符合 `QueryTopicListPage`。
4. 对省略 `page_size` 证明：service 收到 Python 整数默认值 `20`，响应为 200。
5. 对非枚举值（至少 `page_size=30`）证明：响应仍为 `422 VALIDATION_ERROR`，错误位置保持在 `query/page_size`，且 service collaborator 不被调用。
6. 保持 runtime OpenAPI 与冻结静态合同一致；`contracts/openapi.yaml` 和 frontend generated 文件不得产生 Task diff。
7. 通过定向 HTTP 回归、相关 Ruff、backend mypy 与 contract check。失败只修复可归因于本 Task 的问题；无关或既有失败单独报告。
8. 实施完成后先提交 commit 计划并等待确认；不自动 push、不自动部署。
9. 生产部署必须另行获得明确授权。获准部署后，只读打开同一个 canonical `/geo/topics` URL，记录首次加载及一次显式重试所发出的同形 Query Topic list 请求，确认两次均不再返回 422。

## Scope

允许修改：

- `backend/app/routers/planning.py` 中 `list_query_topic_items` 的 `page_size` 参数绑定。
- `backend/tests/unit/test_contract.py` 中对应真实 FastAPI HTTP 边界回归。
- 本 Task 的 Trellis 规划、研究和上下文清单。

## Out of Scope

- 不修改 `contracts/openapi.yaml`、frontend generated client、任何 frontend 文件或 `/geo/topics` 请求构造。
- 不修改 Query Topic schema、service、database、migration、部署配置或生产数据。
- 不通过让前端省略 `page_size`、增加兼容字段、wrapper、第二套类型、silent fallback 或放宽枚举规避问题。
- 不夹带 Query Topic 409 reload、Dialog live projection、其他 GEO/Content Task 分页、错误合同或测试清理 Task。
- 本轮规划不运行 `task.py start`，不实施代码，不执行生产部署或生产写请求。

## Acceptance Criteria

- [ ] `page_size=10`、`20`、`50` 均经真实 FastAPI router 解析为对应 Python `int`，返回 200 `QueryTopicListPage`。
- [ ] 省略 `page_size` 时继续使用 Python 整数默认值 `20` 并返回 200。
- [ ] 非枚举值继续返回 `422 VALIDATION_ERROR`，错误定位为 `query/page_size`，且不进入 service collaborator。
- [ ] router 复用 `BeforeValidator(int)`；`QueryTopicPageSize = Literal[10, 20, 50]` 保持不变，无 wrapper、兼容字段或第二套类型。
- [ ] 新回归通过 `TestClient(app)` 进入真实 router binding；没有用 service 直调替代 HTTP 证明。
- [ ] runtime OpenAPI 与冻结合同检查通过；OpenAPI 与 generated 文件无 Task diff。
- [ ] 定向 Query Topic HTTP 回归、Ruff、backend mypy 和 `make contract-check` 通过。
- [ ] 最终 diff 仅包含允许范围内的 router、真实 HTTP 测试与本 Task 文档；其他任务未提交修改保持不动。
- [ ] 本地完成后先提交 commit 计划并获得确认；没有自动 push 或部署。
- [ ] 若后续另获生产部署授权，同一 canonical `/geo/topics` URL 的首次加载及一次显式重试均不再收到 Query Topic list 422，并保留只读复验证据。

## Blocking Questions

无。范围、合同、验收、部署授权边界和关闭证据均已由用户请求与仓库权威材料确定。
