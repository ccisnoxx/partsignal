# Research: contract checker 测试边界与 mutation matrix

- Query: 审计完整 response comparator 的现有纯测试、默认 `check()`/CLI 接线缺口，并提出不复制 comparator 实现的精确测试 touch set。
- Scope: mixed（backend checker 与测试代码、Trellis 规划和本地 HTTP 行为）
- Date: 2026-09-03

## Findings

### 1. 当前实现与测试基线

父任务的设计要求把 document-level comparator 做成纯层，所有 response status（包括多个 2xx、非 2xx、204、media/header/schema）走同一路径；最终 `check()` 才接入该纯层（父任务 `design.md:20-34, 156-176`，`implement.md:179-195`）。当前代码仍处于 Phase A 形态：

- `compare_response_contracts()` 是公开的纯入口，要求两个已解析 document，不访问 app、不读文件（`backend/app/tools/contract_check.py:1363-1373`）。
- 纯 comparator 已按规范化 status set 遍历共同 operation（`backend/app/tools/contract_check.py:1311-1360`），并对共同 status 比较 response、content、header 和 schema（`backend/app/tools/contract_check.py:1139-1289`）。因此 mutation 测试应调用这个公开入口，不应复制 `_status_key`、schema canonicalization 或 header resolver。
- 默认 `check()` 仍只调用旧 `successful_response()`；该 helper 返回迭代到的首个 `2xx`（`backend/app/tools/contract_check.py:149-154, 1420-1429`）。它不会发现第二个/后续 2xx，也不会比较非 2xx status、body/media/header 或完整 schema。
- CLI 默认分支仍调用旧 `check()`，而 `--response-report` 才调用完整 comparator（`backend/app/tools/contract_check.py:1437-1468`）。现有 `test_cli_report_positional_path_invalid_document_and_default_gate()` 在 `backend/tests/unit/test_contract_check.py:664-762` 的最后一段甚至 monkeypatch `compare_response_contracts` 为必失败函数，并断言默认 gate 仍不调用它（`:754-762`）；该断言必须在 Phase F 被反转或拆出。

五个指定测试文件的当前定向命令实际通过（exit code 0）：

```text
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py -q
```

这只能证明当前实现和现有断言一致，不能证明默认 gate 已执行完整 comparator。

### 2. 已有纯 comparator 覆盖与边界

`backend/tests/unit/test_contract_check.py` 已经是主要 mutation seam，现有覆盖如下：

| 合同面 | 现有测试与行号 | 当前有效覆盖 | 仍缺的证明 |
|---|---|---|---|
| status 缺失/多余 | `test_status_and_schema_mutations_are_reported()` `:54-70` | 对单一 `200` 删除/新增可报告 `missing_status`/`extra_status` | 没有证明非 2xx 和第二个 2xx 不会被跳过；默认 `check()` 仍会漏报 |
| 全 status 与 no-body | `test_all_statuses_are_compared_including_non_2xx_and_no_body_protocol()` `:72-89` | 同时有 `204`、`404`；runtime 给 204 加 body 会得 `invalid_no_body`，404 schema 会得 drift | 404 只用空 schema/object 的通用差异，没有 ErrorEnvelope required/type 的专门 mutation |
| media 与 header | `test_media_and_header_sets_and_header_serialization_are_compared()` `:92-107` | `text/csv`↔`application/json` 的 media set、`X-Trace.required` 漂移 | 没有专门的 `X-Request-ID` 或 CSV `Content-Disposition` header mutation；真实 header authority 只在其他文件静态断言 |
| response/schema ref | `test_refs_pointer_escape_and_schema_composition_semantics()` `:109-122`、`test_schema_ref_machine_siblings_and_recursive_refs_are_safe()` `:187-260`、`test_response_refs_links_and_body_presence_are_fail_closed()` `:314-378` | local ref、`~0/~1`、ref siblings、response ref chain、body/schema presence、links fail-closed | 无需另写 resolver；只需把默认 gate 黑盒接线纳入测试 |
| composition/nullability | `test_composition_nullability_and_oneof_multiplicity()` `:124-143`、`test_all_of_with_closed_branches_is_not_unsafely_flattened()` `:151-184`、`test_outer_constraints_are_preserved_when_normalizing_compositions()` `:263-311` | `anyOf`/`oneOf`、null、重复 `oneOf` 分支、allOf/外层约束 | 现有纯测试已覆盖要求中的组合 mutation，不要在 wave 测试再复制实现细节 |
| default/range/status 合法性 | `test_invalid_status_direction_is_explicit()` `:380-387`、`test_valid_default_ranges_are_independent_and_no_body_statuses_are_checked()` `:389-402`、`test_status_collision_reports_the_invalid_document_side()` `:765-784` | 非法 status、`default`/`1XX`/`205`/`304`、大小写/整数碰撞与方向 | 充分；只需保持稳定 `kind`、`pointer`、`direction` 断言 |
| header ref/非法组合 | `test_header_inline_and_ref_forms_are_equivalent_and_null_is_invalid()` `:404-425`、`test_schema_constraints_and_header_ref_chain_are_compared()` `:787-802`、`test_bad_ref_unknown_machine_field_and_header_collision_fail_closed()` `:900-916` | inline/ref 等价、header ref chain、schema/content 互斥、未知字段、大小写碰撞 | 充分；新增测试不应另造 Header Object 解析 helper |
| FastAPI 自动 422 | `test_fastapi_auto_422_covers_all_request_parameter_kinds()` `:805-856`、`test_fastapi_explicit_validation_responses_suppress_auto_422()` `:858-879`、`test_custom_validation_handler_does_not_change_openapi_metadata()` `:881-898` | path/query/header/cookie/body 的 422 生成与 `responses`/`4XX`/`default` 抑制条件，handler 不改变 metadata | 这是 metadata 行为 sentinel，不替代 response comparator mutation |

`test_const_and_enum_are_conjunctive_and_comparator_is_pure()`（`:620-628`）还证明输入 document 不被纯 comparator 修改；这一断言应保留。

### 3. 运行时 metadata、冻结合同和 HTTP sentinel 的职责边界

- `backend/tests/unit/test_runtime_response_metadata.py` 的 wave comparator 测试已经用 `_wave_projection()` 对 Wave 1/2/3 的全部 response 做零差异比较（`test_wave_response_comparator_has_no_differences()` `:857-862`、`test_wave_2_response_comparator_has_no_differences()` `:865-870`、`test_wave_3_response_comparator_has_no_differences()` `:767-772`）。这些是 zero-drift 集成样本，但没有 mutation，也没有调用默认 `check()`。
- 同文件的 `_success_wave_projection()` `:596-609` 会显式保留 `str(status).startswith("2")` 的响应；它只被 `test_geo_success_schema_identity_and_alias_compatibility()` `:960-964` 使用。这是测试层残留的“只看成功响应”路径，容易使 GEO 测试对非 2xx drift 假绿。Phase F 应删除 helper，并让该测试使用 `_wave_projection()` 的完整 response 集合；GEO success schema 仍可单独断言，但 comparator 不应再使用 2xx 投影。
- `test_contract.py:37-40` 的 `test_runtime_openapi_matches_frozen_operations()` 调用真实 `check(contract)`，适合保留为最终全量 zero-drift gate；但在当前实现它只证明旧 checker 全绿。需要另一个 synthetic black-box test 证明 default `check()` 对 mutation 失败，不能仅依赖这一个成功样本。
- 静态 request-context authority 在 `test_contract.py:42-98` 和 runtime metadata authority 在 `test_runtime_response_metadata.py:636-679` 分别断言 162 个 operation、400、`X-Request-ID` request/response Header 与 ErrorResponse 组件。这些断言各自读取一份来源，不能证明两份来源之间的 comparator 会报告 header drift。
- `test_contract.py:1348-1424` 锁定 `ErrorDetail.details` required、health nullable、GEO discriminator、generation unions、两个 CSV 的 `text/csv` 与 `Content-Disposition`。应继续作为静态 authority test，不要把它改造成 schema normalization 的第二实现。
- `test_csv_export_routes_return_downloadable_csv()`（`backend/tests/unit/test_contract.py:1650-1683`）是实际 HTTP sentinel，检查 `text/csv`、非空 attachment filename 和响应 body；`test_request_context.py:11-78` 检查 request ID 生成、边界长度、非法输入 400、endpoint validation 422 以及 response header 回写；`test_identity_response_headers.py:65-130` 检查 login/logout 的两个独立 `Set-Cookie` occurrence 和安全属性。三者已经覆盖行为 authority，Phase F 不应复制它们到 comparator tests，也不应把 `Set-Cookie` 伪装成单值 OpenAPI header。

### 4. 建议的最小 mutation matrix

下表是建议的精确 touch set。所有纯 mutation 都基于现有 `_document()`、`_json_response()`、`deepcopy()` 和 `_failures()`（`test_contract_check.py:23-44`），只调用公开 `compare_response_contracts()`；不导入或重写 comparator 私有函数。

| Mutation | 建议测试函数/位置 | synthetic 变异 | 必须断言 |
|---|---|---|---|
| 缺失非 2xx status | 新增 `test_complete_status_set_mutations_cover_non_2xx_and_multiple_2xx()`，紧接 `:72` | baseline responses 为 `200`、`201`、`404`；删除 runtime `404` | 存在 `kind == "missing_status"`，`direction == "missing_in_runtime"`，pointer 以 `/responses/404` 结束 |
| 多余非 2xx status | 同上 | 在 runtime 加 `409` | `kind == "extra_status"`、`direction == "missing_in_contract"`、pointer 以 `/responses/409` 结束；不要只断言 failure 非空 |
| 缺失第二个 2xx | 同上 | 删除 runtime `201` | `missing_status` pointer 以 `/responses/201` 结束；该 case 在旧 `check()` 下会假绿 |
| 第二个 2xx shape drift | 同上或新增 `test_subsequent_success_response_shape_is_compared()` | 保留 200，将 201 JSON schema 的 `type` 从 `string` 改为 `integer` | `kind == "schema_drift"`，pointer 精确到 `/responses/201/content/application~1json/schema/type`；证明 comparator 没有 `successful_response()` 式首项捷径 |
| 非 2xx ErrorEnvelope schema | 新增 `test_non_2xx_error_schema_required_mutation_is_reported()`，紧接 status matrix | 404 或 422 使用最小 object schema，含 `error` property，其 required 为 `code/message/details/request_id`；runtime 删除 `details` 或改变 `request_id` type | `kind == "schema_drift"`；pointer 应落在 `/responses/404/content/application~1json/schema/...`，同时检查 `contract`/`runtime` 方向值。不要依赖真实 `ErrorEnvelope` 组件名，否则测试会把静态合同当成 comparator oracle |
| response body/media | 可扩展现有 `test_media_and_header_sets_and_header_serialization_are_compared()` `:92-107`，或新增 `test_response_media_presence_and_schema_mutations_are_reported()` | 对共同 200 response 分别删除 content、删除共同 media 的 schema、把 `text/csv` 改为 `application/json` | `missing_media`/`extra_media` 或 `schema_presence`/`schema_drift`，并断言 `/content/...` pointer；保持 `{}` schema 与缺失 schema 的差异被断言 |
| CSV `Content-Disposition` | 新增 `test_response_header_mutations_cover_request_id_and_csv_disposition()`，紧接 media test | baseline 同时声明 `text/csv` 和 `Content-Disposition`；runtime 改 `required` 或 header schema type | `kind == "header_drift"`，pointer 以 `/responses/200/headers/content-disposition` 结束；另用一例仅改变 header key 大小写，断言通过，证明大小写不敏感而不是把大小写差异误报为 drift |
| `X-Request-ID` response Header | 同上参数化第二行 | 同样 mutation `required`/schema type，header 名为 `X-Request-ID` | `header_drift`，pointer 以 `/headers/x-request-id` 结束；这与 `test_request_context.py` 的真实回写行为互补，不重复 HTTP 调用 |
| 204 body | 保留现有 `test_all_statuses_are_compared_including_non_2xx_and_no_body_protocol()` `:72-89` | runtime 204 增加 JSON content | 明确 `invalid_no_body` 且 pointer 以 `/responses/204/content` 结束；同时保留双方均无 body 的正例 |
| unsupported links | 保留 `test_response_refs_links_and_body_presence_are_fail_closed()` `:360-363` | 任一 response 出现 `links`（包括空 mapping） | `kind == "unsupported"`，pointer 指向该 response；不要把 links 静默过滤，也不需要实现 link graph comparator |
| zero drift | 保留 wave 全量 comparator 正例；修改 GEO 测试 `:960-964` 使用 `_wave_projection()`，删除 `_success_wave_projection()` `:596-609` | 不变异真实 contract/runtime | `compare_response_contracts(...) == []`；GEO 与 wave 正例都应比较完整 status set |

对 status mutation 的 `direction` 语义应使用当前 comparator 的稳定字段：`_ResponseComparator.add()` 在 `contract` 有而 `runtime` 无时生成 `missing_in_runtime`，反向生成 `missing_in_contract`（`backend/app/tools/contract_check.py:334-360`）。不要只写 `assert failures`，否则会掩盖方向反转或 pointer 漂移。

### 5. 默认 `check()`/CLI 的接线测试

建议修改 `backend/tests/unit/test_contract_check.py:664-762`，把目前混合 report/default 行为的函数拆成两个职责：

1. 保留一个 report-only CLI 测试，覆盖现有 `--response-report` 的成功、extra status、unsupported、invalid document、YAML parse error（现有 `:670-749`）。如果 Phase F 删除 report-only 入口，则把这些断言迁移为默认 CLI 的同等行为；不保留一个“默认不调用 comparator”的断言。
2. 新增 `test_default_cli_uses_full_response_comparator()`（建议放在原函数位置附近），使用最小 temporary JSON/YAML contract：contract 只有 200，monkeypatch `app.openapi()` 返回相同 operation 并额外加入 201，调用 `main()` 时不带 `--response-report`。断言 exit code 为 1，stderr 同时包含 `extra_status` 和 `/paths/~1items~1{id}/get/responses/201`。这是真正黑盒地证明默认入口，未复制 status-set 实现。
3. 同一个测试可参数化一个非 2xx schema mutation（contract/runtime 都有 404，runtime 删除 ErrorEnvelope required 字段），断言 exit code 为 1 且输出包含 `/responses/404/content/application~1json/schema`。若最终 `check()` 继续返回 `list[str]`，只依赖稳定的 kind/pointer 文本；若改为结构化 failure，则断言对应字段，不要绑定中文长句。
4. 可再加一个轻量 seam `test_check_passes_independent_documents_to_response_comparator()`：monkeypatch `checker.compare_response_contracts` 记录传入对象，调用 `check(tmp_path)`，断言调用一次、传入 contract 与 runtime，且 runtime cache 在调用前后相等。该测试只证明接线和不覆盖 source，不应替代上面的真实 mutation 黑盒测试。

`backend/tests/unit/test_contract.py:37-40` 应继续保留真实全量 `check(contract) == []`，作为默认 gate 的最终 zero-drift 集成正例；不要把它改成 monkeypatch comparator，否则会重新允许“默认 gate 看起来通过但没有执行完整比较”。

### 6. 不建议修改的测试与原因

- `backend/tests/unit/test_request_context.py:11-78`：继续只锁定真实 middleware 的 400、正常/错误 response `X-Request-ID` 和 ErrorEnvelope 行为；不增加 synthetic comparator matrix。
- `backend/tests/unit/test_identity_response_headers.py:65-130`：继续锁定 login/logout 的多实例 Cookie occurrence 和属性；OpenAPI comparator 不应为 `Set-Cookie` 建立错误的单值模型。
- `backend/tests/unit/test_contract.py:1650-1683`：继续锁定 CSV HTTP body/content-type/content-disposition；可在默认 gate failure 后作为 authority sentinel 回归，但不需要把 route command 再复制到 checker tests。
- `backend/tests/unit/test_runtime_response_metadata.py:636-679`、`:776-835`、`:968-1065`：保留逐 operation inventory、ErrorEnvelope ref、X-Request-ID 和 CSV metadata 断言；只移除 success-only projection，避免扩大 static/runtime source assertion 为第三套比较逻辑。

### 7. 关键风险判断

1. **当前默认 gate 的假绿是确定的，而非推测**：旧 `check()` 的 response 分支从 `successful_response()` 取首个 2xx（`backend/app/tools/contract_check.py:1420-1429`），所以第二个 2xx、所有非 2xx response 和 response-level header/media drift 都不可能由默认 gate 报出；现有 CLI 测试还主动锁定该行为（`backend/tests/unit/test_contract_check.py:754-762`）。
2. **波次 zero-drift 不能单独证明完整门禁**：wave tests 调用纯 comparator，且 GEO 专测通过 `_success_wave_projection()` 过滤 status；它们应作为 metadata synchronization evidence，而不是默认 `check()` activation evidence。
3. **静态 authority 断言与 comparator mutation 必须分层**：静态合同 status signature（`test_contract.py:100-357`）、runtime inventory（`test_runtime_response_metadata.py:619-679`）和 HTTP sentinel（CSV、request-id、Cookie）各自证明来源或行为；只在 `test_contract_check.py` 使用最小 synthetic mutation 才能证明 failure capability，避免从 contract/runtime 任一方复制实现作为预期值。
4. **`X-Request-ID` 与 CSV header 的 parity 目前有来源断言但缺 mutation**：静态/runtime 文件都对 header 做了正向检查（`test_contract.py:71-98, 1416-1424`；`test_runtime_response_metadata.py:651-679`），新增的两行 synthetic header mutation 足以补齐 comparator failure path。

## Related specs

- `.trellis/workflow.md`：研究材料必须持久化到 task `research/`；本支线只写该目录，不修改实现或合同。
- `.trellis/spec/backend/quality-guidelines.md`：现有可执行测试要求包含 Starlette TestClient/httpx2 依赖；本次纯 comparator mutation 不新增测试 client 依赖。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：优先复用既有 `_document()`/`_json_response()`/`_failures()` 和公开 comparator，不复制 normalization/resolver。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨层合同需区分 source metadata、runtime behavior 和 boundary sentinel；本矩阵将三者保持分层。
- `.trellis/tasks/08-31-non-2xx-contract-check/prd.md`：完整 status/response shape/header/unsupported links/zero-drift 要求与 acceptance criteria。
- `.trellis/tasks/08-31-non-2xx-contract-check/design.md:20-34, 36-88, 110-139, 156-176`：纯 comparator、status set、schema/header semantics、诊断和阶段门禁设计。
- `.trellis/tasks/08-31-non-2xx-contract-check/implement.md:179-218`：Phase F activation、required full validation 和 HTTP sentinel 组合。

## Caveats / Not Found

- 本研究执行时 `09-03` 任务的 `prd.md` 仍是初始 TBD 模板；随后已由主会话完成 `prd.md`、`design.md` 与 `implement.md` 的收敛。本文件只提供测试证据，不替代这些规划工件。
- 按 Trellis researcher 角色隔离要求，未读取或修改任何 `implement.jsonl`/`check.jsonl`；研究结论只使用已读取的父任务规划、spec、源码和测试。
- 未修改产品代码、测试、合同、配置、Git/index；仅创建本文件。测试命令依当前并行工作区执行，后续并行改动可能使行号或计数发生变化，实施时应重新定位函数而非机械套用行号。
