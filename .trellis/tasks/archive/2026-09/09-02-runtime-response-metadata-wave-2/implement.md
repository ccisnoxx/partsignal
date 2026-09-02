# 运行时响应元数据 Wave 2 实施计划

## Execution State

Phase 1 规划已获批准，Phase 2 实施、required validation 与独立只读 Review 已完成，实际命令结果见 `research/validation-results.md`。当前只修正尚未 push 的工作提交范围：保留四个产品/测试 blob，纳入本 Task artifacts 与父任务 child 记录，并把 `.gitignore`、artifacts 删除和 `backend/app/schemas/configuration.py` 留作未提交的范围外状态。修正后不归档、不记录 session journal、不 push，也不开始 Phase E。

## Change Boundary

- 最小 gap：58 个 Wave 2 operation 缺少 201 个明确错误 status，57 个 422 仍为 `HTTPValidationError` metadata；success metadata 已正确。
- 权威 owner：三个 router 的 route decorator；共享 ErrorEnvelope/helper 已由 Wave 1 完成且本 Task 只读复用。
- 精确 production touch set：`product_facts.py`、`planning.py`、`production.py`。
- 精确测试 touch set：优先只扩展 `test_runtime_response_metadata.py`；只有真实 behavior sentinel 缺口才最小修改 `test_contract.py`。
- 明确排除：合同/generated/shared owner/service/deps/permission/transaction/state/error mapping、Phase E/X/F、integrity mapping 与无关 dirty files。

## 1. Pre-start Gate

- [x] 用户明确批准本版 PRD、design、implement 与 58-operation ownership matrix。
- [x] 仅批准后运行：

```bash
python3 ./.trellis/scripts/task.py start \
  .trellis/tasks/09-02-runtime-response-metadata-wave-2
```

- [x] 再次运行 `trellis-before-dev`，读取本 Task 三件文档、context manifests、research 与 backend specs。
- [x] 确认主目录仍在 `main`，记录完整 `git status --short --untracked-files=all`；不恢复、删除、格式化、暂存或提交无关文件/artifacts。
- [x] 从三个实际 `APIRouter.routes` 与 `app.openapi()` 重新核对 58 个 operation 和 18/19/21 分组；与 Phase B matrix 身份/status 不一致时停止。

## 2. Route Metadata

- [x] `product_facts.py` import `error_responses`，按 ownership matrix 为 18 个 decorator 显式加入精确错误 status。
- [x] `planning.py` 同步 19 个 operation；单独检查 `listQueryTopics` 只有 401/403、无 422。
- [x] `production.py` 同步 21 个 operation；保留 3 个 202、2 个 201、1 个 204 及所有既有 response model。
- [x] 全局核对 58×401、58×403、50×404、35×409、57×422；不得出现任何 5xx、`4XX` 或 `default`。
- [x] 确认 decorator 清楚列出自身 status，没有公共 tuple/template、共享可变 mapping、contract overlay 或 runtime 推断。
- [x] touched-scope 中文文档检查：本 Task 预计只新增 decorator 参数，无需机械注释/docstring；若附近说明因改动失真才更新。

## 3. Focused Tests

- [x] 在 `test_runtime_response_metadata.py` 新增显式 `WAVE_2_OPERATION_IDS` 与 `WAVE_2_GROUPS`，冻结 58 个唯一 operation 和 18/19/21 分组。
- [x] 最小参数化 test-only projection helper；保留 Wave 1 61-operation 独立投影，不合并成一个不可定位的总测试。
- [x] 对 Wave 2 全部 58 个 operation 逐项断言 runtime status set 等于冻结合同。
- [x] 对 57 个 422 逐项断言项目 ErrorEnvelope；对 `listQueryTopics` 断言无 422/`4XX`/`default`。
- [x] 对所有错误 response 断言 ErrorEnvelope；直接断言 success occurrence `200=42/201=7/202=3/204=6`、204 no-body、无 5xx、无 operation-specific Header。
- [x] 对 Wave 2 投影调用 production `compare_response_contracts()`，直接断言完整 failures 为 `[]`。
- [x] 保留 Wave 1 inventory/status/comparator/ErrorEnvelope/health/CSV/特殊 5xx 全部断言。
- [x] 不修改 `contract_check.py`，不从 research/matrix 在测试运行时读取产品期望，不增加 filter/baseline/allowlist/overlay。

## 4. Behavior Regression

- [x] 运行既有轻量 TestClient sentinel，证明 anonymous/permission/CSRF、path/query/body validation 和 ErrorEnvelope 未变。
- [x] diff 审查证明 service/deps/permission/transaction/state/error mapping 文件零 Task diff。
- [x] 现有轻量 sentinel 已覆盖 metadata-only 风险，无需补测试；没有为 58 个 metadata operation 复制 E2E。
- [x] PostgreSQL integration 深度回归保持 optional；production diff 未越过 decorator，无需回到 planning。

## 5. Required Validation

### 5.1 Wave 1 + Wave 2 全量 metadata 回归

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_runtime_response_metadata.py
```

该命令必须覆盖 Wave 1 的 61 个 operation 与 Wave 2 的 58 个 operation；Wave 2 投影必须零差异，Wave 1 不得回归。

### 5.2 既有 HTTP behavior sentinels

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_query_topic_delete_rejects_non_admin_and_missing_csrf \
  backend/tests/unit/test_contract.py::test_query_topic_delete_rejects_anonymous_request \
  backend/tests/unit/test_contract.py::test_product_delete_requires_valid_revision_before_business_command \
  backend/tests/unit/test_contract.py::test_content_revision_routes_reject_invalid_tags \
  backend/tests/unit/test_contract.py::test_content_draft_update_rejects_empty_tags_before_business_command
```

### 5.3 Comparator、默认旧门禁与静态质量

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py

UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  contracts/openapi.yaml

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/routers/product_facts.py \
  backend/app/routers/planning.py \
  backend/app/routers/production.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/tests/unit/test_contract.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/routers/product_facts.py \
  backend/app/routers/planning.py \
  backend/app/routers/production.py
```

### 5.4 Scope、Task 与 whitespace gates

```bash
git diff --exit-code -- \
  contracts/openapi.yaml \
  frontend/src/shared/api/generated/schema.d.ts \
  backend/app/errors.py \
  backend/app/schemas/common.py \
  backend/app/tools/contract_check.py

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-02-runtime-response-metadata-wave-2

! rg -n '[[:blank:]]+$' \
  .trellis/tasks/09-02-runtime-response-metadata-wave-2 \
  backend/app/routers/product_facts.py \
  backend/app/routers/planning.py \
  backend/app/routers/production.py \
  backend/tests/unit/test_runtime_response_metadata.py
```

### 5.5 无 filter 的全局中间态诊断

```bash
set +e
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
wave_2_global_report_rc=$?
set -e
test "$wave_2_global_report_rc" -eq 1
```

预期 Phase E/X 未完成，因此退出码为 1。不得保存输出为 baseline、添加 allowlist/filter 或把非零包装为成功。退出 2 阻断；退出 0 先审计是否越界提前消除了后续 Phase 差异。

## 6. Optional Full-suite Validation

深度 PostgreSQL behavior regression：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_product_detail.py::test_product_update_maps_duplicate_and_writes_audit_only_on_success \
  backend/tests/integration/test_product_detail.py::test_fact_workspace_commands_preserve_conflicts_and_immutable_snapshot \
  backend/tests/integration/test_query_topic_list.py::test_query_topic_create_update_audit_and_revision_conflict \
  backend/tests/integration/test_content_task_creation.py::test_create_content_task_revalidates_qualification_and_idempotency \
  backend/tests/integration/test_publication_workflow.py::test_content_task_delete_and_archive_permanent_delete_lifecycle \
  backend/tests/integration/test_content_draft_lifecycle.py::test_human_draft_can_be_saved_then_deleted_with_parent_pointer_restored \
  backend/tests/integration/test_content_review.py::test_content_review_commands_revalidate_and_preserve_immutable_inputs
```

其他可选全量门禁：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
make contract-check
make typecheck
```

不默认运行 frontend test/build、Playwright、完整 PostgreSQL integration、真实 provider/Redis/对象存储或生产调用：本 Task 不修改这些边界。若跳过 optional，closeout 说明 required metadata/comparator/HTTP sentinel 与 diff scope 已证明的范围和剩余风险。

## 7. Independent Read-only Review

- [x] Required validation 通过后执行一次独立只读 Review，完整检查全部 58 个 operation，不抽样。
- [x] Review 输入：实际 diff、PRD/design/implement、ownership matrix、Phase B final matrix、Wave 1 helper/test owner与 validation 输出。
- [x] Reviewer 逐项确认：18/19/21 inventory；每个 status 源于 Phase B；57/1 的 422 分界；201/202/204 success 保留；无 5xx/Header；helper 无默认/推断状态；Wave 1 未回归；无 service/permission/transaction/state/error mapping 或 Phase E/X/F 越界；测试无 filter/baseline/allowlist/overlay/self-derived expectation。
- [x] 已执行一次完整 Review且无 finding；提交范围修正不改变产品/测试 blob，不触发第二次完整 Review。
- [x] Reviewer 未发现共享 owner、公共合同或实际行为 blocker，无需退回 planning。

## 8. Diff、文档与提交边界

- [x] 最终产品 diff 精确为三个 router；测试 diff只为 `test_runtime_response_metadata.py`。
- [x] `contracts/openapi.yaml`、generated client、shared owner、comparator、services/deps、Phase E/X/F files 无 Task diff。
- [x] 文档结论：合同/generated/database/business docs 无需修改，依据是公共/业务事实均不变；Task artifacts 记录本次 runtime 声明收敛。
- [x] 非平凡 Python 变更 closeout 说明 comments/docstrings/developer-visible text 因 decorator-only 改动而有意保持不变；测试模块 docstring 已更新为 Wave 1/2。
- [x] 提交前已展示精确 commit plan并获得用户确认；不纳入无关 dirty files/artifacts，不自动 push。

## 9. Rollback

- 在 Phase E 前，可同批回滚三个 router decorator metadata 与 Wave 2 测试扩展；Wave 1 shared helper/schema 保留。
- 后续 Phase 依赖后优先 roll-forward；确需回退按 `F → X → E → D` 逆序。
- 回滚后必须让 Wave 2 comparator 真实反映 drift，不使用 filter/baseline/allowlist 维持绿灯。
- 不回滚或修改实际 service、permission、transaction、状态转换、error mapping、合同/generated 或既有 dirty artifacts。

## 10. Phase Completion Criteria

- [x] 58-operation Wave 2 projection 零差异，Wave 1 61-operation 回归零差异。
- [x] 所有 required validation 实际通过并记录；全局 report 的预期非零状态已解释。
- [x] 独立 Review 通过且停止条件未触发。
- [x] 用户已明确批准修正尚未 push 的工作提交；该批准不授权归档、session journal、push 或开始 Phase E。
