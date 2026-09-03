# 跨切面 Request Context Metadata 实施计划

## Planning State

用户已批准实施并运行 `task.py start`，当前 status 为 `in_progress`。

## 精确 Touch Set

- `backend/app/main.py`
- `contracts/openapi.yaml`
- `frontend/src/shared/api/generated/schema.d.ts`（仅 `api:generate`）
- `backend/tests/unit/test_request_context.py`
- `backend/tests/unit/test_identity_response_headers.py`（新建）
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`（研究后确认的必要额外 test touch）
- `backend/tests/unit/test_contract_check.py` 只回归；当前证据表明无需修改
- 本 Task artifacts 与父任务 `task.json` child 记录

不修改 `errors.py`、`schemas/common.py`、routers、services、frontend 业务、Makefile/CI、数据库或其他 tasks。若证明需要额外生产文件，先停止并报告 owner/原因/最小范围。

## Ordered Checklist

1. 保存 index binary diff 与 staged NUL 路径清单到任务专用 `mktemp`；确认 current pointer 不变。
2. 在 `main.py` 建立常量/custom OpenAPI builder；middleware 只替换对应字面量为常量。
3. 扩充 request-context 测试并新增 Cookie raw-occurrence sentinel。
4. 建立 162-operation raw→augmented non-interference 与三波 shared-metadata 断言。
5. static 添加 components、162 Parameter/400、全部 response Header；全量 static 断言。
6. 仅运行 `npm --prefix frontend run api:generate` 生成 schema；审查 Header optional、400/ErrorResponse、response Header required。
7. targeted checks 全绿后运行一次 formal full-scope gate；失败遵守最多两次 causal repair→targeted re-check，同根因/第二轮仍失败即停止。
8. 独立只读 reviewer 一次 full review，修复后最多一次 targeted re-review；检查实际 diff/index，不实施 Phase F。

## Required Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_contract_check.py \
  backend/tests/unit/test_runtime_response_metadata.py

make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/main.py backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app/main.py

npm --prefix frontend run api:generate
npm --prefix frontend run api:check
npm --prefix frontend run typecheck
npm --prefix frontend run test -- \
  src/shared/api/file-transfer.test.ts \
  src/domains/audit/audit.model.test.ts \
  src/domains/product/products-list.model.test.ts \
  src/domains/geo/geo-observation-list.model.test.ts \
  src/domains/publication/publication-work.model.test.ts

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-02-cross-cutting-request-context-metadata
git diff --check -- \
  contracts/openapi.yaml backend/app/main.py backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  frontend/src/shared/api/generated/schema.d.ts \
  .trellis/tasks/09-02-cross-cutting-request-context-metadata \
  .trellis/tasks/08-31-non-2xx-contract-check/task.json
git diff --cached --binary | cmp - "$PHASE_X_INDEX_BASELINE"
git diff --cached --name-only -z | cmp - "$PHASE_X_INDEX_PATHS_BASELINE"
git status --short
```

report 必须无 filter、无 failure JSONL、退出 0。contract/runtime tests 必须断言 162 request/400、1023 response Header、原 861 response 非干扰、CSV/204 和 61/58/43 三波。

若列出的 targeted frontend test 在实施前核对不存在，只删除不存在路径并记录原因；不得为凑命令新建无价值 frontend tests。full typecheck 始终是全部 generated consumer 的 required gate。

## Independent Read-only Review

Reviewer 只读检查批准 diff/基线，必须回答：owner 是否唯一且不读 static；middleware behavior 是否不变；162/1023 是否无抽样/filter；OpenAPI 语义是否精确；CSV/204/operation-specific metadata 是否保持；Cookie 是否独立且未声明；generated 是否 canonical/optional；dirty/index/并行 task 是否未触碰。

一次 full review；若明确 in-scope 修复，最多一次 targeted re-review。新或残留 MEDIUM 以上、同根因复现、或需要扩大生产范围时停止并回报。

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run build
```

不默认运行 DB integration、Playwright、Docker/E2E：本 Task 不改变业务 body、权限、数据库或 UI；若 targeted 证据显示真实 ASGI/依赖集成差异，先报告再扩大。

## Commit / Rollback

用户另行批准提交后，单个原子工作提交同时包含 runtime、static、generated、tests、Task/spec artifacts，使用显式 pathspec/`git commit --only`，不消费现有 staged artifacts；归档/journal 为后续 bookkeeping commits，不 push。回滚该工作提交即可整体恢复；禁止只回滚 static 或 runtime 一侧。
