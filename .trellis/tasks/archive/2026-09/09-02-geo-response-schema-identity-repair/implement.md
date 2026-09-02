# GEO 响应 Schema Identity Authority 修复：实施计划

> 用户已审阅并批准本规划；本 Task 已运行 `task.py start`，实施、required validation、独立只读 Review 与精确提交计划均已获批准。

## 0. Pre-start Gate

- [x] 用户批准创建独立 prerequisite，并批准 Wave 3 后全局 report 预期为 0。
- [x] 用户审阅本 prerequisite 最终规划后，另行明确批准实施。
- [x] 重新加载 `trellis-start`、`trellis-before-dev`、本 Task 三件套、相关 specs、Phase B matrix、composition repair 与 Wave 3 ownership research。
- [x] 确认 `main`、HEAD 与完整 dirty-tree baseline；候选 schema/test 文件仍无前置 diff。
- [x] 运行 `task.py start` 后才允许编辑产品/测试代码。

## 1. Focused Test First

- [x] 在 `test_runtime_response_metadata.py` 显式列出 5 个 success operation，并建立 success-only projection。
- [x] 断言 static/runtime 各恰好包含 5 个 operation，完整 comparator 当前以 3 条 discriminator mapping drift 红灯；该预期红灯只记录一次。
- [x] 增加 canonical component key、旧 key 缺失、compatibility alias object identity 与 model validation/dump 等价断言。

## 2. Canonical Identity Repair

- [x] 在 `geo_files.py` 将两个 class definition 重命名为 `LegacyGeoObservation` / `ManualGeoObservation`。
- [x] 在 `GeoObservationOut` union 前添加两个 direct compatibility aliases；union 使用 canonical classes。
- [x] 不改字段、validator、docstring、内部 response/detail model 或 service；现有中文说明保持准确。
- [x] 审阅 diff，确认没有 custom schema hook、subclass、duplicate model、hard-coded ref 或额外 fallback。

## 3. Required Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_runtime_response_metadata.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_geo_observation_list_contract_is_compact_and_preserves_v1 \
  backend/tests/unit/test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string \
  backend/tests/unit/test_contract.py::test_geo_observation_detail_contract_is_one_readonly_generated_union \
  backend/tests/unit/test_contract.py::test_geo_observation_correction_context_reuses_detail_and_append_contract

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_response_schema_instances.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py

UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  contracts/openapi.yaml

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/geo_files.py \
  backend/tests/unit/test_runtime_response_metadata.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/schemas/geo_files.py \
  backend/app/services/geo_observation.py \
  backend/app/routers/observation.py

git diff --check -- \
  backend/app/schemas/geo_files.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  .trellis/tasks/09-02-geo-response-schema-identity-repair \
  .trellis/tasks/08-31-non-2xx-contract-check/implement.md \
  .trellis/tasks/08-31-non-2xx-contract-check/task.json

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-02-geo-response-schema-identity-repair
```

## 4. Unfiltered Global Diagnostic

```bash
set +e
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
geo_schema_identity_report_rc=$?
set -e
test "$geo_schema_identity_report_rc" -eq 1
```

报告必须精确为 194 failures：155 `missing_status` 与 39 个 422 `schema_drift`，全部属于 Wave 3；不能仍含 success schema drift。退出 0 表示越界提前完成 Wave 3，退出 2 表示文档无效，均阻断。不得保存 baseline、使用 allowlist/filter/overlay 或 ignored item。

## 5. Optional Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_observation_list.py \
  backend/tests/integration/test_geo_insights.py
npm --prefix frontend run api:check
make typecheck
```

不默认运行完整 backend integration、frontend test/build、Playwright、provider/storage、生产调用或 `make verify`。若 required test 暴露 payload/validation/service 行为变化，则升级相关 GEO integration 为 required 并回到设计审查。

## 6. Independent Read-only Review

- [x] `trellis-check` 核对 specs、三件套、required gates、actual diff 与 dirty-tree scope。
- [x] 独立 reviewer 检查 5-operation transitive closure、3 个原始 drift、canonical keys、direct alias identity、service compatibility、真实 payload/validation 不变、194 条剩余 drift 与 contract/generated零 diff。
- [x] reviewer 证明剥离两个 class rename、两个 alias 与 focused tests 后没有其他 production 行为变化。
- [x] 一次完整 review，最多一次受影响路径复核；若复核仍有 MEDIUM 及以上问题或需扩大 scope，报告并停止。

## 7. Exact Commit Scope

默认 commit 精确为下列 12 个文件：

```text
backend/app/schemas/geo_files.py
backend/tests/unit/test_runtime_response_metadata.py
.trellis/tasks/08-31-non-2xx-contract-check/task.json
.trellis/tasks/08-31-non-2xx-contract-check/implement.md
.trellis/tasks/09-02-geo-response-schema-identity-repair/task.json
.trellis/tasks/09-02-geo-response-schema-identity-repair/prd.md
.trellis/tasks/09-02-geo-response-schema-identity-repair/design.md
.trellis/tasks/09-02-geo-response-schema-identity-repair/implement.md
.trellis/tasks/09-02-geo-response-schema-identity-repair/implement.jsonl
.trellis/tasks/09-02-geo-response-schema-identity-repair/check.jsonl
.trellis/tasks/09-02-geo-response-schema-identity-repair/research/schema-identity-audit.md
.trellis/tasks/09-02-geo-response-schema-identity-repair/research/baseline-touch-set.md
```

若新增 `research/validation-results.md`，必须先展示 13-file commit plan 并重新取得批准。Wave 3 task dir、`.gitignore`、artifacts、`configuration.py`、合同/generated/router/service/comparator/并行 Task 不得暂存。使用逐文件 `git add --`，核对 `git diff --cached --name-only`，再次获得用户提交批准；不自动 commit/push/archive。

## 8. Completion / Rollback

- [x] 记录 required commands、3→0 success drift、全局 194/rc1、review 和 scope 结果。
- [x] Python touched-scope 文档检查：两个已有 class docstring 保持中文且准确；direct aliases 不添加机械注释，测试新增 docstring 使用中文。
- [x] 回滚仅撤销两个 canonical names、direct aliases 和 focused test；不改公共合同、generated 或业务路径。
- [x] 完成后停下汇报，等待 commit/归档与 Wave 3 start 的分别批准。
