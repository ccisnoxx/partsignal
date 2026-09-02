# 运行时响应元数据 Wave 3：实施计划

> 用户已批准并已运行 `task.py start`；前置任务已完成并归档，当前进入 Wave 3 实施。

## 0. Pre-start Decision Gate

- [x] 用户批准独立前置 Task `09-02-geo-response-schema-identity-repair`；在其零差异并完成验证前不启动 Wave 3。
- [x] 用户批准按观察证据修正旧预期：Wave 3 完成后退出 0，Phase X static/runtime 同步完成后继续为 0。
- [x] 重新运行 `trellis-start`、`trellis-before-dev`，完整读取本 Task 三件套、context manifests、相关 specs 和前置 Task 最终验证记录。
- [x] 确认 primary working directory仍为 `main`；记录 HEAD、完整 status、out-of-scope hash与四个候选产品/测试文件的初始 diff。
- [x] 不运行或修改 `.trellis/tasks/08-30-v2-live-readonly-acceptance`，不清理任何既有 dirty file。

任一前置未满足即停止；不得以扩大 Wave 3、忽略 comparator failure 或单边 Phase X metadata 继续。

## 1. Tests First

- [x] 在 `test_runtime_response_metadata.py` 显式新增 43 个 Wave 3 operationId、30/12/1 groups 与逐 operation status set；不从 runtime/matrix/research动态生成期望。
- [x] 证明 Wave 1/2/3 集合各自唯一、互斥，总数 `61 + 58 + 43 = 162`，且 static/runtime 各完整覆盖。
- [x] 新增 Wave 3 逐 operation status、ErrorEnvelope、39/4 的 422 分界、success occurrence/media/Header、204 no-body、无 5xx/`4XX`/`default` 断言。
- [x] 新增 Wave 3 完整 projection comparator 零差异断言；保留并同轮运行 Wave 1 61 与 Wave 2 58 的独立零差异断言。
- [x] 先运行 Wave 3 targeted tests，记录当前预期红灯：155 missing status、39 个 422 schema drift；前置完成后不得仍含三个 GEO success drift。

## 2. Router Metadata

- [x] `publication.py`：导入现有 `error_responses`，按 matrix 为 30 个 decorator 各自显式声明 non-success statuses。
- [x] `observation.py`：同样处理 12 个 decorator；`getDashboardSummary` 不得出现 422，`listGeoObservationPublications` 不得出现 409，`getGeoMetrics` 不得出现 404/409。
- [x] `workbench.py`：`getWorkbench` 精确声明 `401,403,409`，不得加入 422。
- [x] 保留 6 个 201、3 个 204 与其 schema/media/body；不改 response model、endpoint signature/body、dependency 或 service call。
- [x] 检查 diff 只含三个 import 和 43 个 route decorator metadata；若出现 schema/service/permission/transaction/state/error mapping 变化，停止。

## 3. Required Validation

以下命令在 candidate 完成后各运行一次；先 targeted，再正式 gate。命令从仓库根目录执行。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_runtime_response_metadata.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string \
  backend/tests/unit/test_contract.py::test_error_envelope_without_details_keeps_empty_wire_object

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_publication_verification_final_authority_rejects_awaiting_switch_over_http \
  backend/tests/integration/test_geo_observation_list.py::test_geo_observation_list_is_compact_server_filtered_and_actor_projected \
  backend/tests/integration/test_geo_insights.py::test_geo_optimization_same_key_is_atomic_and_compares_full_payload \
  backend/tests/integration/test_workbench.py::test_workbench_endpoint_is_authenticated_role_shared_and_repeatable_read

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py

UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  contracts/openapi.yaml

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/routers/publication.py \
  backend/app/routers/observation.py \
  backend/app/routers/workbench.py \
  backend/tests/unit/test_runtime_response_metadata.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/routers/publication.py \
  backend/app/routers/observation.py \
  backend/app/routers/workbench.py

git diff --check -- \
  backend/app/routers/publication.py \
  backend/app/routers/observation.py \
  backend/app/routers/workbench.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  .trellis/tasks/09-02-runtime-response-metadata-wave-3

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-02-runtime-response-metadata-wave-3
```

首次正式 gate 实测：metadata `337 passed`、轻量 HTTP/handler `2 passed`、contract-check `48 passed`；静态 contract check、ruff、mypy、diff-check 与 Trellis validate 均通过。四个 PostgreSQL sentinels 首次因未设置测试数据库而 skip；改用项目已运行的开发 PostgreSQL 后为 `3 passed / 1 failed`。唯一失败是 `test_publication_verification_final_authority_rejects_awaiting_switch_over_http` 在发起 HTTP 请求前比较 PostgreSQL `now()` 与应用进程 `datetime.now(UTC)`，两时钟相差约 11ms；该调用链和测试均不在本 Task diff，因此按失败归因和 scope 规则停止，没有在 Wave 3 内修改或重跑该时序断言。

阻塞修复已由独立提交 `562d2bce` 在 publication event writer 的权威 owner 完成，并由 `b2f80c3a` 归档、`08cec203` 记录 session journal。Wave 3 在当前 HEAD `08cec203` 恢复后，四个真实 PostgreSQL sentinels 的唯一正式重跑结果为 `4 passed in 6.07s`。随后按顺序重新执行本节 required gate：metadata `337 passed in 2.54s`、轻量 HTTP/handler `2 passed in 0.65s`、contract-check `48 passed in 0.57s`；静态 contract check、ruff、mypy、diff-check 与 Trellis validate 均通过。Trellis validate 仅报告 authority matrix 超过 context injection 大小的既有截断 warning，两个 manifest 本身分别以 10/7 entries 通过。

`test_runtime_response_metadata.py` 是三波联合 required gate：其中 Wave 1=61、Wave 2=58、Wave 3=43 必须分别调用 production comparator 并返回 `[]`，不能只验证 Wave 3。

## 4. Unfiltered Global Diagnostic

```bash
set +e
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
wave_3_response_report_rc=$?
set -e
test "$wave_3_response_report_rc" -eq 0
```

预期剩余差异为 0、退出码为 0。不得保存输出为 baseline/allowlist，不得添加 filter/overlay/ignored operation/status/path。退出 1 表示仍有未解决 response drift，必须逐项归因并停止；退出 2 表示文档或机器语义无效，直接阻断。

该结论由启动基线直接证明：前置完成后的全局 194 条 failure 与 Wave 3 投影完全相同，且 Phase X 的 400/response Header 当前两侧均不存在。用户已批准并已同步修正父任务实施计划。当前 HEAD 上的唯一无 filter 正式诊断退出码为 `0`，无剩余 response difference 输出。

## 5. Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py \
  backend/tests/integration/test_geo_observation_list.py \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/integration/test_workbench.py
npm --prefix frontend run api:check
make typecheck
```

不默认运行 frontend full test/build、Playwright、provider/storage、生产调用或 `make verify`：产品候选应只改 decorator metadata。若 diff 触及 schema/public contract/shared owner 或 required integration 暴露当前改动相关行为差异，重新评估验证范围，不把 optional failure 自动纳入修复。

## 6. Independent Read-only Review

- [x] `trellis-check` 核对 specs、三件套、required validation、实际 diff 与 dirty-tree boundary。
- [x] 独立 reviewer 完整读取 43 行 ownership matrix、Phase B 对应行、三个 router、测试与实际 diff，逐 operation 检查 method/path/operationId、success status/schema/media/Header、完整 status set、39/4 的 422 分界、32 个 404、37 个 409、无 5xx、实际 behavior owner 与 Phase X 排除。
- [x] reviewer 用 AST/结构对比证明：剥离新增 `error_responses` import、decorator `responses` keyword 后，三个生产 router 与实施前相同；endpoint body/dependency/service/permission/transaction/state/error mapping 未变。
- [x] reviewer 复核 Wave 1/2/3 comparator tests 无 self-derived expectation、filter、baseline、allowlist、overlay 或忽略项。
- [x] 只进行一次完整 review 和最多一次受影响路径复核；若复核出现新 MEDIUM 及以上问题、同一问题仍在或需要触碰 scope 外 owner，报告并停止，不开启第三轮。

## 7. Documentation / Contract / Generated Decision

- `contracts/openapi.yaml`：不修改。Phase B 已冻结 operation-specific目标；Wave 3 是 runtime metadata 同步。
- generated client：不修改。公共合同不变，无生成依据；只可运行 `api:check` 作为 optional evidence。
- `.trellis/spec/`：预计不修改；本 Task 应用既有 error-handling/publication-workbench/quality规则，不形成新稳定 contract。若 schema identity prerequisite 产生新约定，由其独立 Task 决定 spec 更新。
- `contracts/database.md` 与业务设计文档：不修改；无数据模型、事务、权限或业务流程变化。
- 本 Task artifacts：记录 inventory、验证和 review 结果；不复制为 production configuration。

## 8. Exact Commit Scope

在 prerequisite 已提交 parent child metadata 后，最终 Wave 3 commit 默认精确为下列 12 个文件：

```text
backend/app/routers/publication.py
backend/app/routers/observation.py
backend/app/routers/workbench.py
backend/tests/unit/test_runtime_response_metadata.py
.trellis/tasks/09-02-runtime-response-metadata-wave-3/task.json
.trellis/tasks/09-02-runtime-response-metadata-wave-3/prd.md
.trellis/tasks/09-02-runtime-response-metadata-wave-3/design.md
.trellis/tasks/09-02-runtime-response-metadata-wave-3/implement.md
.trellis/tasks/09-02-runtime-response-metadata-wave-3/implement.jsonl
.trellis/tasks/09-02-runtime-response-metadata-wave-3/check.jsonl
.trellis/tasks/09-02-runtime-response-metadata-wave-3/research/wave-3-operation-ownership.md
.trellis/tasks/09-02-runtime-response-metadata-wave-3/research/baseline-touch-set.md
```

若实施/验证需新增 `research/validation-results.md`，先更新精确列表并重新请用户确认。提交前显式 `git add --` 上述获批文件，随后要求 `git diff --cached --name-only` 与准确清单相等。`.gitignore`、`artifacts/**`、`backend/app/schemas/configuration.py`、`backend/app/schemas/geo_files.py`、parent task files、任何其他 router/schema/service/test、并行 Task 均不得进入 index。展示 commit plan 并取得用户确认后方可提交；不自动 push、archive 或开始 Phase X。

## 9. Completion / Rollback Boundary

- [x] 记录三波 operation counts、status occurrence、所有 required 命令结果、全局 report退出码和独立 review 结论。
- [x] 记录生产 comments/docstrings/developer-visible text 是否变化；正常实现应仅改 metadata，因此应明确为“未改”。
- [x] 回滚仅撤销本 Wave 三个 router metadata 与 test Wave 3 hunk；共享 ErrorEnvelope/helper、前置 schema identity、合同/generated 与既有行为不动。
- [x] 完成后先向用户汇报并等待提交批准；不在同一动作中 archive、commit、push 或启动 Phase X/F。
