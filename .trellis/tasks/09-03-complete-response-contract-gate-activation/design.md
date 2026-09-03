# 完整 Response Contract 默认门禁激活设计

## 1. 问题与最小边界

当前 response comparator 已完成并对全部 162 个 operation 零漂移；缺口不是 comparator 算法或 metadata，而是默认 I/O 路径仍绕过它。行为 owner 位于 `backend/app/tools/contract_check.py::check()` 和 `main()`，测试 owner 位于 `backend/tests/unit/test_contract_check.py`。

最小修改只做三件事：让 `check()` 调用唯一完整 comparator、删除旧 response shortcut、删除阶段性 report-only CLI。其他 request/security 检查继续由现有逻辑负责。

## 2. 当前与目标数据流

### 2.1 当前双路径

```text
make contract-check / default CLI
  -> main()
  -> check(contract_path)
  -> security + operationId + parameter + security + requestBody
  -> successful_response() 仅取首个 2xx
  -> legacy compare_shape() 仅比较 truthy application/json schema

manual --response-report
  -> main()
  -> load static + deepcopy(runtime)
  -> compare_response_contracts()
  -> 完整 status / response / media / schema / Header
```

这两条路径让完整能力停留在诊断入口，正式门禁无法捕获第二个 2xx、非 2xx、media 或 response Header drift。

### 2.2 目标单一默认门禁

```text
make contract-check / default CLI
  -> main()
  -> check(contract_path)
       -> load static + deepcopy(runtime)
       -> 既有非 response 检查
       -> compare_response_contracts() 唯一 response owner
       -> 稳定排序后的失败文本
  -> rc 0 / 1；不可解析文档 rc 2
  -> 成功后继续 frontend api:check

tests / future diagnostics
  -> compare_response_contracts(contract_document, runtime_document)
```

删除 `--response-report` 后不再存在“report 与默认 gate 语义不同”的生产 CLI 分支；纯 comparator 仍是可复用诊断 seam。

## 3. `check()` 集成设计

1. YAML 读取后取得 `copy.deepcopy(app.openapi())`，把 static/runtime 作为独立输入。
2. 构建 operation map，继续执行 security scheme、operationId、parameter、security、requestBody 检查。
3. 删除旧的 operation set 聚合字符串，由 `compare_response_contracts()` 的 `missing_operation` / `extra_operation` 统一拥有 operation 身份漂移；非 response 检查只遍历交集。
4. 删除 `successful_response()` 调用块，调用一次 `compare_response_contracts(contract, runtime)`。
5. 将 comparator failure 逐条用现有 `ensure_ascii=False`、`sort_keys=True`、紧凑 separators 序列化为字符串，与既有非 response failures 合并后稳定排序返回。

该设计不改变 `check()` 的 `list[str]` 返回边界，因此 `test_contract.py` 和现有调用方无需修改；同时没有解析 JSON 再判断、二次比较或隐藏 failure。

`compare_response_contracts()` 内部已经按 `(pointer, kind, direction, message)` 排序。它对一个无效 machine object 可能输出多个 side/class-specific fail-closed failure，这些不是默认路径重复执行造成的同一 failure，不在 Phase F 去重。Phase F 只消除旧 path/response 与完整 comparator 的重复 owner；不改已验收 comparator core。

## 4. `successful_response()` 删除影响

- 定义：`backend/app/tools/contract_check.py::successful_response()`。
- 唯一生产调用方：`check()` 的旧 response shortcut。
- 全仓库无其他调用者，测试也不直接依赖该 helper。
- `json_schema()`、`resolve_schema()`、`compare_shape()` 仍服务 requestBody 和其他既有检查，不能因名字相邻而删除。

删除该函数和调用块不会改变 request/security 行为；唯一行为变化是默认 gate 开始覆盖所有 response。

## 5. `--response-report` 去留

结论：删除。

依据：

- 父任务 Phase F 明确要求删除仅供过渡的 report-only 入口。
- Makefile、CI、console script 与生产代码均未消费该 flag。
- Phase B–X 的无 filter 诊断任务已经完成，当前 comparator failure 为 `[]`。
- 保留 flag 会继续暴露两个 CLI 语义，违背“默认 gate 是唯一正式 response 门禁”的目标。

删除范围包括 argparse 参数、flag 分支和过渡 docstring/help/error prefix；`compare_response_contracts()`、其结构化 failure 与纯测试全部保留。

## 6. CLI 退出码与诊断合同

| 条件 | stdout | stderr | 退出码 |
| --- | --- | --- | ---: |
| 全部检查零差异 | 更新后的完整门禁成功文案 | 空 | 0 |
| 可比较的合同漂移 | 空 | 每行一个稳定 failure；response failure 保留 JSON kind/direction/pointer | 1 |
| 文件读取、YAML 解析、顶层 document/paths 无法解释 | 空 | `contract-check error: <明确原因>` | 2 |

Comparator 返回的 `unsupported` 或 `invalid_in_*` 是结构化、可定位的机器语义失败，默认 gate 输出后退出 1；它们不会被忽略或回退到旧 checker。只有在 comparator 无法构造顶层比较时抛出的 `_ComparatorError`、I/O 或 YAML parser error 走退出 2。

## 7. Mutation test 设计

新增/改写测试只使用现有 synthetic document helper、`deepcopy`、临时合同文件、monkeypatch 的 `app.openapi()` 和生产 `check()`/`main()`；不导入 comparator 私有成员，不复制 status/schema/Header 规则。

| Mutation | 默认 gate 证据 | 精确断言 |
| --- | --- | --- |
| 缺失 non-2xx status | runtime 删除 404 | `missing_status`、`missing_in_runtime`、pointer `/responses/404` |
| 多余 status | runtime 增加 409 | `extra_status`、`missing_in_contract`、pointer `/responses/409` |
| 第二/后续 2xx | 保留 200，修改或删除 201 | `/responses/201` 的 `missing_status` 或 `schema_drift` |
| error response schema | 修改 404/422 ErrorEnvelope 的 required/type | `schema_drift` 与 schema pointer |
| media type | `text/csv` 与 `application/json` 漂移 | `missing_media` / `extra_media` 与 content pointer |
| `X-Request-ID` Header | 修改 required 或 schema type | `header_drift` 与 `/headers/x-request-id` |
| CSV `Content-Disposition` | 修改 required 或 schema type | `header_drift` 与 `/headers/content-disposition` |
| unsupported links | 两侧相同或一侧出现 Response Object `links` | `unsupported`、精确 response pointer、默认 CLI rc 1 |
| 无漂移 | synthetic 相同文档和真实 frozen/runtime 文档 | `check() == []`、CLI/make rc 0 |

现有纯 comparator 对 no-body、ref、composition、nullable、header collision、schema/content 互斥、`oneOf` multiplicity 和 FastAPI 422 的测试继续保留，不在默认 gate 接线测试中重写算法。CLI 测试把当前“默认不调用 comparator”的反向断言改为无 flag 默认入口捕获 response drift，并保留 parse error 的显式退出合同。

## 8. 调用链与只读文件结论

- `Makefile::contract-check` 已按 backend module → frontend `api:check` 顺序执行。
- `frontend/scripts/check-openapi.mjs` 只验证根合同生成结果与 committed client 字节一致，职责独立，不应改造成 runtime comparator。
- CI verify job 仅调用一次 `make contract-check`，没有重复门禁。
- 因此 Makefile、CI、frontend package/script、OpenAPI、generated client 和 runtime metadata 均无需修改。

## 9. 兼容、文档与回滚

- 不改变公共 HTTP API、OpenAPI、generated client、runtime metadata、业务状态或权限。
- 有意删除内部过渡 CLI flag；仓库审计证明无生产调用方。纯 Python comparator API 保持不变。
- 更新 touched Python docstring 和成功/错误文案，使其描述默认完整门禁；不为明显机械代码添加注释。
- 实施前失败可用精确 inverse patch 恢复两个产品文件的 Phase F 改动；不得使用 broad checkout/reset。提交后如需回滚，另获授权后只 revert Phase F work commit。回滚不得引入 allowlist、baseline 或隐藏 fallback。
