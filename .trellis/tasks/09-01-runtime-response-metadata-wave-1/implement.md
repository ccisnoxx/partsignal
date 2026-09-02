# 运行时 Response Metadata Wave 1 实施计划

## Planning State

初版规划已获批准并已运行 `task.py start`。2026-09-02 前置 `09-02-response-schema-composition-authority-repair` 已由工作提交 `7be5b979` 修正 schema authority，并由 `7f3b789b` 归档；本 Task 从修正后的展平 schema 恢复，不再实施或提交旧 success-schema composition workaround。

## Change Boundary

- 最小 gap：61 个 Wave 1 operation 的实际 HTTP 行为已经由 Phase B 冻结，但 runtime OpenAPI response metadata 尚未逐项表达相同 status/schema/media/Header。
- 权威 owner：共享 wire schema/handler 位于 `schemas/common.py` 与 `errors.py`；每个 status 的声明 owner 是对应 route decorator；CSV 的实际 media/Header owner 是两个 route 返回的 `Response`。
- 预期改动：6 个生产文件 + 1 个聚焦测试文件；只在现有 behavior sentinel 确有缺口时最小更新 `test_contract.py`。
- 明确不做：Phase D/E/X/F、integrity mapping、合同/generated、service/dependency/permission/transaction/state/error mapping。
- 行为不变证明：HTTP/service sentinels + handler wire 字段断言 + metadata-only diff review；不以 OpenAPI parity 代替真实行为测试。

## Implementation Checklist

### 1. Pre-start evidence

- [x] Task 已在前序会话获批并处于 `in_progress`；本次不创建或重新启动替代 Task。
- [x] 重新运行 `trellis-before-dev`，完整读取本 Task 三件文档、context manifests、research、backend spec，以及已归档 authority repair 的全部材料。
- [x] 确认 `main` 与所有既有 dirty paths；保存本 Task 自身 touch set，不回退、不暂存、不提交无关文件。
- [ ] 复核 `research/wave-1-operation-ownership.md` 为 61 个唯一 operation，分组计数 2/39/15/5，并与当前 Phase B matrix、冻结 OpenAPI identity/status 完全一致。

### 2. Shared ErrorEnvelope

- [ ] 在 `backend/app/schemas/common.py` 增加唯一 ErrorEnvelope wire model，外层 `error`，内层 `code/message/details/request_id` 均 required；`details` 的 runtime schema 与冻结 `default: {}` 语义一致。
- [ ] 在 `backend/app/errors.py` 让 `error_response()` 通过同一 model 生成现有 JSON content；不改变字段、status、request_id fallback、details normalization 或 handler 注册。
- [ ] 增加只接受调用方显式 status 的 metadata helper；helper 只复用 model/description，返回独立 mapping，不默认添加任何状态。
- [ ] 用最小 Pydantic schema probe 和现有 TestClient sentinel 先验证 wire/schema，再批量改 route decorator。

### 3. Foundation and routers

- [ ] `backend/app/main.py`：`getReadyHealth` 显式 503 ErrorEnvelope，`getLiveHealth` 保持 200。
- [ ] `backend/app/routers/configuration.py`：按 39 行矩阵逐 operation 添加精确 response statuses；单独核对 `discoverAIChannelModels` 502/504、`createPlatformLogoCandidate` 503、`testAIModel` 无 502/504。
- [ ] `backend/app/routers/identity.py`：按 15 行矩阵逐 operation 添加精确 responses；不触碰 login/logout Cookie 行为。
- [ ] `backend/app/routers/files.py`：按 5 行矩阵逐 operation 添加精确 responses；`completeFileUpload` 明确 503。
- [ ] 为 `exportUsers` 和 `exportPlatformProfiles` 配置仅 `text/csv` string + required `Content-Disposition` 的 200 metadata；确认 runtime 不额外生成 `application/json`。
- [ ] 对全部 route 做 touched-scope 中文文档/注释/开发者可见文本检查；只更新因本次改动失真的内容，不为显而易见 decorator 添加机械注释。

### 4. Focused tests

- [ ] 新建 `backend/tests/unit/test_runtime_response_metadata.py`，冻结精确 Wave 1 operation inventory 与 2/39/15/5 owner 数量。
- [ ] 对完整 contract/runtime 做 test-only Wave 1 projection，调用 `compare_response_contracts()`，断言 61-operation 子集零差异。
- [ ] 遍历全部 61 个 operation，逐项验证 status set；53 个有 422 的全部解析为项目 ErrorEnvelope，8 个无 422 的保持无 422。
- [ ] 添加直接断言：health 200/503、三个特殊 5xx owner、`testAIModel` 无 502/504、两个 CSV media/Header。
- [ ] 为 research 指出的 route-test 缺口补最小 HTTP sentinel：humanization、prompt CRUD 与 files 选择能证明 decorator/handler refactor 未改变 route 行为的真实边界；不为 61 个 metadata 行机械复制 61 个 E2E。
- [ ] 复用并运行现有 route/service sentinels；仅当 behavior-preserving handler refactor 缺少必要断言时最小更新 `backend/tests/unit/test_contract.py`，不复制 inventory 或 comparator。
- [ ] 不修改 `backend/app/tools/contract_check.py`，不新增 filter/allowlist/baseline/overlay。

### 4.1 Authority repair handoff

- [x] `7be5b979` 已修正不可满足的 schema composition，并删除旧 custom-hook 方向；Wave 1 不重复该工作。
- [ ] 确认聚焦测试直接要求 Wave 1 全部 failure 为空，不按 status/media/Header/schema kind 过滤。
- [ ] 确认 runtime schema 继续为默认展平、closed schema，且当前 diff 无 custom hook、私有 Pydantic API、硬编码 ref 或冻结合同 overlay。

### 5. Diff and scope audit

- [ ] 检查实际产品 diff 只在 6 个授权生产文件；测试 diff 只在聚焦文件与必要的既有 sentinel。
- [ ] 确认 `contracts/openapi.yaml`、generated client、services、deps、permissions、transactions、state transitions、error mapping、Phase D/E/X/F files 无 Task diff。
- [ ] 检查没有共享可变 response dict、统一猜测状态集合、第二错误层级、隐藏 fallback、宽 `4XX/default` 或 `HTTPValidationError` 漂移。

## Required Validation

先运行最小定向门禁：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_runtime_response_metadata.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_live_health_does_not_require_external_dependencies \
  backend/tests/unit/test_contract.py::test_error_envelope_without_details_keeps_empty_wire_object \
  backend/tests/unit/test_contract.py::test_ai_model_route_projects_failed_test_as_http_200 \
  backend/tests/unit/test_contract.py::test_complete_file_upload_storage_failure_keeps_pending_state \
  backend/tests/unit/test_contract.py::test_csv_export_routes_return_downloadable_csv
```

如果实施补充独立 route sentinel，必须把其精确 pytest node id 追加到上述 required 命令；不得只依赖全量 unit suite 偶然覆盖。

再运行本 Task 的合同、静态质量与 scope gates：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py

UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  contracts/openapi.yaml

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/common.py \
  backend/app/errors.py \
  backend/app/main.py \
  backend/app/routers/configuration.py \
  backend/app/routers/identity.py \
  backend/app/routers/files.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/tests/unit/test_contract.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/schemas/common.py \
  backend/app/errors.py \
  backend/app/main.py \
  backend/app/routers/configuration.py \
  backend/app/routers/identity.py \
  backend/app/routers/files.py

git diff --exit-code -- \
  contracts/openapi.yaml \
  frontend/src/shared/api/generated/schema.d.ts

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-01-runtime-response-metadata-wave-1

! rg -n '[[:blank:]]+$' \
  .trellis/tasks/09-01-runtime-response-metadata-wave-1 \
  backend/app/schemas/common.py \
  backend/app/errors.py \
  backend/app/main.py \
  backend/app/routers/configuration.py \
  backend/app/routers/identity.py \
  backend/app/routers/files.py \
  backend/tests/unit/test_runtime_response_metadata.py
```

最后运行无 filter 的全局中间态诊断，退出码必须恰为 1：

```bash
set +e
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
wave_1_global_report_rc=$?
set -e
test "$wave_1_global_report_rc" -eq 1
```

全局 report 不保存为 baseline；测试中的 Wave 1 projection已负责证明本 Task 61 个 operation 零差异。

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
make contract-check
make typecheck
```

不默认运行 PostgreSQL integration、frontend tests/build、Playwright、provider/对象存储真实调用或 `make verify`：本 Task 不改数据库、前端、业务命令或外部服务行为。若实际 diff 越过 metadata/schema serialization 边界，停止并先调整规划，而不是自动扩大验证。

## Independent Review

1. `trellis-check` 对全部 Task diff 做一次 spec/PRD/design/implement 一致性检查，最多一轮明确的机械修复与一次定向复检。
2. 在 required validation 通过后，派发一次只读 `critical_reviewer`，原因是共享 wire schema 与 61 个 operation 的公共 runtime metadata 属于跨模块合同风险。Reviewer 必须逐项检查：
   - 61-operation inventory 与 Phase B matrix 完整一致；
   - helper 没有猜测或默认状态集合；
   - 422 全部使用项目 ErrorEnvelope 且实际校验未改；
   - health、特殊 5xx、CSV metadata 正确；
   - 无 service/permission/transaction/state/error mapping 或 Phase D/E/X/F 越界；
   - 测试没有抽样、baseline、allowlist、production filter 或自证式期望。
3. 独立 review 只允许一次完整 review 和最多一次受影响路径 re-review；若仍有 MEDIUM 及以上问题或出现新 material issue，报告并停止，不进入第三轮。

## Rollback Points

- route metadata 可按 `main → configuration → identity → files` owner 独立恢复；每次恢复后重新运行 61-operation parity，不能用忽略机制维持绿灯。
- 共享 ErrorEnvelope/helper 一旦被后续 Wave 使用，必须 roll-forward 或按 `F → X → E → D → C` 逆序回滚，不能单独删除。
- handler 序列化如出现任何 wire behavior diff，立即恢复 handler 变更并保留 schema/metadata 诊断；不得增加兼容 envelope 或 silent fallback。
- CSV metadata 回滚不得触碰实际 `Response` 下载行为。

## Resume Review Checklist

- [x] 用户确认唯一目标是 Wave 1 的 61-operation runtime metadata parity。
- [x] 用户确认共享 helper 只复用 schema/description，status 由每个 operation 显式列出。
- [x] 用户确认显式 422 使用项目 ErrorEnvelope，但实际 FastAPI/Pydantic 校验不变。
- [x] 用户确认两个 CSV 与 health/special 5xx metadata 范围。
- [x] 用户确认全局 report 可非零，而 Wave 1 子集必须零差异且禁止 baseline/allowlist/filter。
- [x] 用户确认 Phase D/E/X/F、integrity mapping、合同/generated 与业务行为全部排除。
- [x] 用户确认 authority repair 已归档后恢复现有 `in_progress` Task，不创建替代 Task。
