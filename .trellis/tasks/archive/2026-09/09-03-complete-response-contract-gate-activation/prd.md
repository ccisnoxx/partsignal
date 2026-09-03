# 完整 Response Contract 默认门禁激活

## Goal

将已经验证为零漂移的 `compare_response_contracts()` 接入 backend contract checker 的默认 `check()` 路径，使 `make contract-check` 默认验证全部 operation 的完整 response status、schema、media type 和 Header；删除旧的“首个成功响应”检查路径和仅供过渡的 `--response-report` 入口，同时保留纯 comparator 作为唯一 response 比较实现和单元测试边界。

本任务是父任务 `08-31-non-2xx-contract-check` 的 Phase F，也是最后一个独立实施子任务。本轮只完成规划，不运行 `task.py start`，不实施、不提交、不归档任何任务。

## Confirmed Facts

- 静态合同与生产 `app.openapi()` 均为 128 个 path、162 个 operation，operation key 与 operationId 集合一致。
- 两侧均有 1023 个 response occurrence；status、media、schema 与 Header 的生产 comparator 结果为 `[]`。
- 两侧 1023/1023 response 均声明 required `X-Request-ID`；两个 CSV response 均保留 `text/csv` 与 `Content-Disposition`；Response Object `links` occurrence 为 0。
- 无 filter 的 `--response-report` 当前退出 0；本轮规划期间再次运行的 `make contract-check` 也退出 0。
- 默认 `check()` 尚未调用完整 comparator。它通过 `successful_response()` 按 mapping 插入顺序取得首个字符串以 `2` 开头的 response，只在两侧均存在 truthy `application/json` schema 时调用旧 `compare_shape()`。
- `successful_response()` 的唯一生产调用方就是 `check()` 的旧 response shortcut；全仓库没有其他合法调用者。
- `compare_response_contracts()` 已覆盖每个共享 operation 的完整 status key 集合、所有共有 status 的 Response Object、body/media/schema/header、local response/schema/header ref、组合 schema、nullable、no-body status，并对未知机器字段、坏/外部引用和 Response Object `links` fail closed。它忽略既定 annotation 字段，但不忽略未知机器字段。
- `Makefile` 的 `contract-check` 先运行默认 backend checker，再运行 canonical frontend `api:check`；`.github/workflows/ci.yml` 只通过一次 `make contract-check` 使用该入口，没有独立 report gate。
- `--response-report` 没有 Makefile、CI 或其他生产调用方，是 Phase A 为 metadata 收敛提供的阶段性诊断入口。父任务 Phase F 明确要求删除它。
- 所有前置提交均可由 Git 解析：`4ccd6ea7`、`8dffb1ac`、`377570a9`、`eb22dc68`、`89245be8`、`562d2bce`、`cbb39f87`、`7e539c88`、`8f29f329`。
- 规划基线位于 `main`，相对 `origin/main` ahead 25。创建本任务前已有 543 个 staged 删除和两个任务外 unstaged 修改（`.gitignore`、`backend/app/schemas/configuration.py`）；创建后新增父任务 child 记录和本任务目录。当前 Trellis 指针仍是 `08-30-v2-live-readonly-acceptance`。

## Requirements

1. 默认 `check(contract_path)` 必须调用现有 `compare_response_contracts(contract, runtime)`，不得复制 status/schema/media/Header comparator 逻辑或建立第二套 response checker。
2. 删除 `successful_response()` 及 `check()` 中首个 2xx shortcut；`json_schema()`、`compare_shape()` 等仍被 requestBody 检查使用的旧函数不得误删。
3. 删除 `--response-report` CLI 参数及仅为该参数存在的分支；保留纯 `compare_response_contracts()`，供 mutation tests、未来只读诊断和调用方复用。
4. 默认 gate 必须继续保留既有 security scheme、operationId、parameter、security 和 requestBody 检查；完整 response comparator 只替换旧 response shortcut，不削弱其他合同检查。
5. operation 集合漂移由完整 comparator 的 `missing_operation` / `extra_operation` 诊断统一拥有；默认路径不得再并行输出旧“路径漂移”和 comparator operation failure，避免同一根因重复报告。
6. runtime document 在交给检查逻辑前使用 `deepcopy(app.openapi())`，保持 FastAPI cache 与两个独立输入不被检查过程修改。
7. response failures 继续使用 comparator 已定义的稳定 JSON 结构、RFC 6901 pointer、方向字段和确定性排序。默认 `check()` 的整体字符串结果也必须稳定排序；不为减少 fail-closed 信息而增加 allowlist、filter、baseline 或模糊去重。
8. CLI 退出合同固定为：无 failure 退出 0；可比较的 contract drift（包括结构化 `unsupported` / `invalid_in_*` failure）输出到 stderr 并退出 1；文件读取、YAML 解析或顶层文档无法交给 comparator 安全解释时输出明确 `contract-check error` 并退出 2。不得吞异常、silent success 或 fallback 到旧 response checker。
9. 成功输出和触及的 docstring 必须更新为“默认完整门禁”的当前事实，删除旧 gate/report-only 过渡描述；机器字段、failure kind、CLI 参数和 JSON 输出保持所需英文标识。
10. mutation tests 必须通过默认 `check()` 或无 flag CLI 证明接线，而不只是再次直接测试纯 comparator；复用最小 synthetic documents 和生产 comparator，不读取持久化 baseline，不复制 normalization/resolver。
11. mutation matrix 至少覆盖：缺失 non-2xx status、多余 status、第二个或后续 2xx 漂移、error response schema、media type、`X-Request-ID` response Header、CSV `Content-Disposition` Header、unsupported links，以及无漂移成功。
12. 现有纯 comparator mutation tests 保持为算法边界；真实全量 `test_contract.py::test_runtime_openapi_matches_frozen_operations` 保持默认 gate 的零漂移正例。
13. `make contract-check` 必须继续先执行 backend 默认完整门禁，再执行 canonical frontend generated check；CI 继续只调用同一 Make target。本任务不修改 Makefile、CI 或 frontend scripts。
14. Phase F 不承担任何 metadata、OpenAPI、generated client 或业务行为修复。若完整默认 gate 暴露非零漂移，停止并报告权威 owner，不在本任务加入兼容字段、overlay、filter、allowlist 或业务修复。
15. 任务外 staged artifacts 和脏文件必须全程保持原状态；不得恢复、删除、格式化、暂存或提交它们，也不得切换、结束、归档或修改 `v2-live-readonly-acceptance`。

## Acceptance Criteria

- [ ] `check()` 恰好调用同一个 `compare_response_contracts()` response owner，并继续执行既有非 response 合同检查。
- [ ] `successful_response()`、首个 2xx shortcut、`--response-report` 参数和 report-only 分支均不存在。
- [ ] 缺失/多余 status、第二个或后续 2xx、error schema、media、`X-Request-ID`、`Content-Disposition` 和 unsupported links 均能使默认 `check()` 或无 flag CLI 非零退出，并输出精确 kind/direction/pointer。
- [ ] 无漂移时默认 `check()` 返回空列表，CLI 与 `make contract-check` 退出 0。
- [ ] operation 集合漂移不由旧 path check 与完整 comparator 重复输出；整体诊断顺序确定且可定位。
- [ ] 文件/YAML/顶层文档错误显式输出到 stderr 并退出 2；没有异常吞并、旧 checker fallback 或 silent success。
- [ ] 纯 comparator seam 和既有 mutation coverage 保留，不建立第二实现、不读取持久化 baseline。
- [ ] 当前 162 个 operation、1023 个 response occurrence 的完整 comparator 继续零差异；`X-Request-ID`、CSV Header、no-body 与 links 边界不变。
- [ ] `make contract-check` 仍按 backend → frontend `api:check` 顺序运行；CI 仍只复用该 Make target。
- [ ] 产品代码 diff 仅包含 `backend/app/tools/contract_check.py` 与 `backend/tests/unit/test_contract_check.py`。
- [ ] `contracts/openapi.yaml`、generated client、runtime metadata、router、其他指定测试、Makefile 与 CI 为零修改。
- [ ] 独立质量检查和只读 Review 通过，且任务外 543 个 staged artifacts 删除、`.gitignore`、`backend/app/schemas/configuration.py` 与当前并行任务未进入本任务 diff/commit。

## Out of Scope

- 修改 `contracts/openapi.yaml` 或重新生成/修改 generated client。
- 修改 FastAPI runtime OpenAPI metadata、operation-specific status/schema/media/Header、`X-Request-ID` middleware、Cookie、`ErrorEnvelope`、router、service、permission、transaction、状态转换或 error-domain mapping。
- 修改 `backend/tests/unit/test_contract.py`、`test_runtime_response_metadata.py`、`test_request_context.py`、`test_identity_response_headers.py`；其中 GEO success-only helper 是专用 schema identity 测试，不属于默认 gate 激活。
- 修改 Makefile、`.github/workflows/ci.yml`、frontend package/scripts 或业务实现。
- baseline、allowlist、filter、overlay、ignored operation/status/path、第二套 comparator 或长期 report-only 模式。
- 归档父任务、归档或修改 `frontend-v2-functional-contract-conformance-baseline`、修改 `v2-live-readonly-acceptance`、生产数据写入、无关重构、push。

## Open Questions

无。用户已明确冻结目标、范围、`--response-report` 删除条件、验证命令与等待批准门禁；仓库审计未发现需要追加的产品决定。
