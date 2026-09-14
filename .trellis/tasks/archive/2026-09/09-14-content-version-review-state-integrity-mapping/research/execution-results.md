# Implementation 与 Validation 结果

- 日期：2026-09-14
- Task：`content-version-review-state-integrity-mapping`
- 状态：实现与 required checks 已完成；等待 commit plan 确认，尚未提交、归档或 push。

## 实现结果

- Backend：`review.transition_content_version` 增加 command-local 结构化 classifier 与 root rollback。只有 submit-review 的 `23505 + uq_content_versions_one_pending_per_task` 映射 `CONTENT_REVIEW_PENDING`；approved exact 与所有其他 `IntegrityError` bare re-raise。
- Frontend：Content Editor 增加 code-only pending blocker，保留 Dialog 输入/code/request ID、冻结背景 canonical adoption、显式 reload 成功后恢复且不 replay；Content Review Page production 零 diff，只增加 approved unknown 500 generic/no replay 回归。
- Stable semantics：同步 backend error/database 与 frontend state specs，以及 Frontend V2 动作合同。OpenAPI、database contract、router metadata、generated schema、model/migration 保持零 diff。

## Required validation

### Backend

```text
PARTSIGNAL_TEST_DATABASE_URL=<local-dev-postgres> ... pytest backend/tests/integration/test_content_review.py -q -ra
结果：19 passed

pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
结果：全部通过

ruff check backend/app/services/review.py backend/tests/integration/test_content_review.py
结果：通过

mypy --config-file backend/pyproject.toml backend/app
结果：Success，80 source files
```

真实 PostgreSQL 用例覆盖 current-head 两条 partial unique catalog/diagnostics、pending 409/request ID、approved default 500/no-leak、两类完整 rollback、原 request Session 复用、成功 submit/approve 和 precheck/权限对照。

### Frontend

```text
Vitest：content-editor.model、content-editor-page、content-review-page
结果：3 files / 31 tests passed

受影响文件 ESLint
结果：通过

frontend typecheck
结果：失败于未修改的 frontend/src/domains/publication/publication-work-page.test.tsx:351 TS2345
```

失败归因：`publication-work-page.test.tsx` 与本 Task diff 为零，不属于允许 owner；没有跨范围修改。本 Task 修改的 Content Editor/Review files 在相关 Vitest、ESLint 与类型检查输出中没有新增错误。

### 一致性

- `git diff --check`：通过。
- Trellis task validation：通过；仅有两份大型 spec 的已知 32 KiB 注入截断提示。
- `implement.jsonl` / `check.jsonl`：有效且路径存在。
- OpenAPI、database contract、router、bootstrap schema、model/Alembic、contract/runtime unit owner、generated schema 的 tracked/untracked 零 diff gate：通过。

## Review 与修复

- Trellis check 未发现 production/contract 问题。
- 独立只读 implementation review 发现两项 approved HTTP sentinel 证据问题：HTTP 500 未绑定第二次 exact constraint，以及 listener cleanup 未覆盖前半段失败。
- 定向修复后，HTTP 断言绑定新捕获的 `23505 + exact approved constraint`，并统一 `try/finally` 清理 overrides/listeners/Session/engine。
- approved 定向测试、真实 PostgreSQL 文件级 19 tests、Ruff 与 diff check 均通过；唯一一次 targeted re-review 通过，无剩余 material issue。

## Optional gate 与残余风险

- 未运行完整 backend/frontend suite 与 frontend build；required 的真实 PostgreSQL 文件级 integration、合同 unit、相关 Vitest、完整 backend app mypy及受影响 lint作为替代证据。
- 剩余已知仓库基线问题仅为上述未修改 publication test 的 frontend typecheck 错误；本 Task 不修复。
