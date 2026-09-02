# 运行时响应元数据 Wave 3：技术设计

## 1. Scope 与不变量

本 Task 只负责 43 个 Wave 3 operation 的 FastAPI operation-specific response metadata。成功实施后的生产文件必须仅为：

- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/workbench.py`

测试文件优先只扩展 `backend/tests/unit/test_runtime_response_metadata.py`；既有行为 sentinels 以运行而非修改为默认。任何必须触碰 `backend/app/schemas/geo_files.py` 的修复属于前置 schema identity authority，不得暗中并入本 Task。

不可变行为包括实际 status/body/Header、endpoint signature/body、dependencies、认证/角色/CSRF、service 调用、PostgreSQL 事务与锁、publication/GEO 状态转换、error code/details 与 handler mapping。metadata 不得成为 runtime behavior owner。

## 2. Inventory 构造与 authority

inventory 以四个独立事实源联结：

1. `publication.router.routes`、`observation.router.routes`、`workbench.router.routes` 中实际注册的 `APIRoute`；
2. `app.openapi()` 中的当前 runtime operation；
3. `contracts/openapi.yaml` 中当前冻结 operation 与 success response；
4. Phase B `final-response-authority-matrix.jsonl` 的 `phase_b_statuses`、逐 status evidence、validation source 与 Phase X 字段。

四方按 `(path, method, operationId)` 精确联结，不按 tag、文件名猜测 ownership。结果是 43 个唯一 operation，完整表在 `research/wave-3-operation-ownership.md`。测试代码保留显式 operationId tuple/group/status mapping，不能运行时读取 research matrix 形成自证。

Status authority 只来自 Phase B 逐调用链结论；冻结合同用于 success/schema/media/Header 目标与一致性复核，不被当作实际行为证明。共同 runtime owner：

- 401：`deps.py::_resolve_current_session`；
- 403：认证临时密码 gate，以及相应 route 的 `assert_account_types` / `CsrfProtected`；
- 422：FastAPI/Pydantic path/query/header/body 解析与 router filter validation，经 `errors.py::validation_error_handler` 转换为唯一 ErrorEnvelope；
- 404/409：matrix 每行列出的 route/service owner；
- success：现有 decorator `response_model` / `status_code` 与 endpoint/service 返回路径。

## 3. Decorator metadata 方案

三个 router 各新增 `from app.errors import error_responses`，每个 decorator显式传入该行全部 non-success status，例如：

```python
responses=error_responses(401, 403, 404, 409, 422)
```

不同 operation 即使集合相同也各自写明，禁止 router 级共享字典、按 method/dependency 计算、相邻复制推断或 helper 默认状态。4 个 no-422 operation 只写其 matrix 状态：三个为 `401, 403`，`getWorkbench` 为 `401, 403, 409`。

既有 `response_model`、201/204 `status_code`、dependencies 与函数体不改。三个 204 仍由原 decorator 拥有且无 body。`error_responses` 每次返回新 mapping，只把调用方提供的状态绑定到唯一 `ErrorEnvelope`；不增 error code、description 分支或实际 handler。

## 4. GEO success schema identity 前置缺口

前置修复前 comparator 的 42 条 schema drift 分解为：

- 39 条自动 422 `HTTPValidationError` → 项目 `ErrorEnvelope`，属于本 Wave 正常 metadata 工作；
- `listGeoObservations` 200、`getGeoObservation` 200、`createGeoObservation` 201 三条 discriminator mapping URI drift。

后三条不是 schema shape/composition 问题，而是公共 component identity 不一致。冻结合同使用 `LegacyGeoObservation` / `ManualGeoObservation`，runtime Pydantic class 名为 `LegacyGeoObservationOut` / `ManualGeoObservationOut`。生产 comparator 递归解析后仍比较 discriminator mapping，故三条必须在 Wave 3 零漂移之前解决。

本设计拒绝以下伪修复：

- route-local duplicate Pydantic model；
- `openapi_extra` 硬编码不存在或重复的 component URI；
- comparator 忽略 discriminator mapping；
- baseline、allowlist、filter、overlay 或排除三个 operation；
- 修改冻结合同/generated client 以追随未经批准的 runtime 命名。

独立 Task `09-02-geo-response-schema-identity-repair` 已由 commit `89245be8` 在 schema owner 对齐 class identity，同时保留现有 `*Out` import alias 与真实 validation/serialization，并已完成验证和归档。Wave 3 启动基线只剩 39 条自动 422 schema drift，不暗中接管 schema 文件。

## 5. Test-only projection

扩展 Wave 1/2 已建立的测试模式：

- `WAVE_3_OPERATION_IDS` 精确列出 43 个 ID；
- `WAVE_3_GROUPS` 精确断言 30/12/1，union 与 tuple 完全相同；
- `WAVE_3_EXPECTED_STATUSES` 逐 operation 写死 Phase B set；
- static/runtime 均必须存在每个 operation，且 Wave 1/2/3 三组互斥、union 为全 162 operation；
- 逐 operation 比较 frozen/runtime status set；
- 逐 error status 断言 runtime `application/json` schema 为 `#/components/schemas/ErrorEnvelope`；
- 对 4 个 no-422 operation 显式断言无 422/`4XX`/`default`；
- 对 success occurrence、media、schema、Header、204 no-body 和无 5xx 做完整断言；
- 三个 wave 分别投影、保留完整 components，并分别把两份文档交给 production `compare_response_contracts()`，完整 failure list 必须为 `[]`。

该投影只是测试输入裁剪，不进入 production comparator，不允许按 failure kind/status/path 过滤。

## 6. HTTP behavior sentinels

Required 最小行为证明复用：

- `test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string`：真实 HTTP query parsing 与 200 read path；
- `test_contract.py::test_error_envelope_without_details_keeps_empty_wire_object`：唯一 ErrorEnvelope handler wire；
- `test_publication_workflow.py::test_publication_verification_final_authority_rejects_awaiting_switch_over_http`：publication verification 409、状态/事件不变；
- `test_workbench.py::test_workbench_endpoint_is_authenticated_role_shared_and_repeatable_read`：200/401、角色共享与 `REPEATABLE READ`；
- `test_geo_insights.py::test_geo_optimization_same_key_is_atomic_and_compares_full_payload`：GEO optimization idempotency/409 与事务；
- `test_geo_observation_list.py::test_geo_observation_list_is_compact_server_filtered_and_actor_projected`：GEO read model/filter/actor projection。

后三个 PostgreSQL tests 比单纯 metadata 变更更重，但本 Wave 横跨高价值 publication/GEO/workbench 状态、事务与 read snapshot；各运行一次，提供用户明确要求的实际行为保持证据。若环境无 PostgreSQL，不能伪装通过；记录环境 blocker，保留 unit metadata/HTTP 结果。

## 7. Phase X、全局 report 与 Phase F

Phase X authority 字段对 Wave 3 全部 43 行一致：optional request `X-Request-ID`、非法值 400、所有 release response 的 required `X-Request-ID` Header；`release_statuses_after_phase_x` 比 Phase B set 恰好多 400。当前 frozen/runtime OpenAPI 对这三项均未声明。

因此，operation-specific Wave 1/2/3 全部零差异后，现有 response comparator 的全局 report 应为 0。Phase X 必须同时同步 static/runtime 的 400 与 response Header，并另用 parameter gate/HTTP sentinels覆盖 request Header，完成后仍保持全局 response report 0。Phase F 最后只启用默认 gate。

不能为了维持“Phase X 前退出 1”而留下 drift。用户已批准 Wave 3 后零差异/退出 0，父任务实施计划已同步修正。

## 8. Dirty tree、touch set 与 commit boundary

基线见 `research/baseline-touch-set.md`。实现中只允许新增三个 router 和 metadata test 的 Task diff；task artifacts/父子链接是规划记录，不与生产逻辑混合推断。

提交前步骤：

1. 复核 out-of-scope baseline hash未变；
2. `git diff --` 精确检查授权生产/测试文件；
3. `git add --` 只列明确文件，不使用 `git add .`、`-A` 或目录级 broad add；
4. `git diff --cached --name-only` 必须与批准 commit scope 完全相等；
5. 特别断言 `.gitignore`、`artifacts/**`、`backend/app/schemas/configuration.py`、并行 Task 不在 index；
6. 展示 commit plan 并再次取得用户确认；不 push。

在 prerequisite 按其计划提交 parent child metadata 后，最终 Wave 3 commit scope 精确为下列 12 个文件：

- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/workbench.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/task.json`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/prd.md`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/design.md`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/implement.md`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/implement.jsonl`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/check.jsonl`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/research/wave-3-operation-ownership.md`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/research/baseline-touch-set.md`

若实施/验证需新增 `research/validation-results.md`，须在提交前先展示更新后的精确列表并重新获得用户确认；不得自动扩大为第 13 个文件。

## 9. Documentation、Contract 与 Generated Decision

- `contracts/openapi.yaml`：不修改。Phase B 已冻结 status/schema/media/Header authority，本 Wave 只使 runtime metadata 追上它；改静态合同会绕过目标。
- `frontend/src/shared/api/generated/schema.d.ts`：不修改。公共合同不变，因此没有合法生成差异。
- `.trellis/spec/`：不修改。本 Wave 复用已稳定的 ErrorEnvelope/helper、publication/workbench 与 test 规则，不形成新的长期约定；Task research 保存逐 operation 一次性证据。
- `docs/` 与 `contracts/database.md`：不修改。业务、权限、状态转换、事务、数据模型与部署行为均不变。
- GEO schema identity prerequisite：已由独立 Task `09-02-geo-response-schema-identity-repair` 完成并归档；合同/generated/spec 影响已独立审查，本 Task 不重复修改。

## 10. Rollback

Wave 3 产品回滚只撤销三个 router 中新增的 import/`responses` decorator metadata，以及 metadata test 的 Wave 3 显式常量/断言；不删除 Wave 1 共享 ErrorEnvelope/helper，不回滚合同、generated、Phase B、schema prerequisite、service 或行为测试。Phase X/F 尚未开始，无需联动回滚。
