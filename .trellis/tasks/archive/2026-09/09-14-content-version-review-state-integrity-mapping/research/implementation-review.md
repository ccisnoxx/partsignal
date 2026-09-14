# 独立 Implementation Review

- Reviewer：独立只读 `reviewer` agent
- 日期：2026-09-14
- 范围：Backend/Frontend production 与测试候选、四份稳定 spec/docs、公共 owner 零 diff和已提供的 required validation 证据。

## Full review

未发现 production 实现或稳定合同中的明确错误。确认：

- `review.transition_content_version` 只按结构化 `sqlstate` 与 `diag.constraint_name` 分类；root rollback 先于领域转换/原抛，pending 仅在 submit-review exact pair 映射，approved 和其他错误 bare re-raise。
- catch 位于业务 precheck 后并覆盖 previous supersede flush、目标状态、ReviewRecord、SUCCESS AuditLog 和最终 commit；锁、权限 owner 与成功路径未改变。
- Content Editor 的 exact-code blocker、malformed fallback、Dialog 输入/request ID、背景 canonical freeze、reload failure/success 与单次 POST符合冻结合同；Content Review Page 的 unknown 500 保持 generic/no replay。
- 四份 spec/docs 与实现一致，OpenAPI、database contract、router metadata、model/migration、unit contract owner 和 generated schema 保持零 diff。

发现两项测试证据问题：

1. approved HTTP 500 未明确绑定到第二次 exact approved constraint，可能由其他异常产生假阳性。
2. 全局 `Session.before_flush` 与 engine listener 的 `finally` 最初未覆盖 direct service 验证和前半段断言。

## 修复与唯一 targeted re-review

- direct service 验证后记录捕获基线；HTTP 后断言第二次注入发生、捕获数恰增 1，并验证新异常为 `23505 + uq_content_versions_one_approved_per_task`。
- no-leak 增加 driver/type/constraint 文本 token，但仍不冻结默认 500 的 body/code/media type。
- listener 注册后的 direct service、HTTP、diagnostics 和 rollback 断言统一纳入同一 `try/finally`，集中清理 dependency override、两个 listener、Session 和 engine。
- 定向测试、真实 PostgreSQL 文件级 integration、Ruff 与 `git diff --check` 通过。
- 唯一一次 targeted re-review 通过，无剩余 material issue或新问题。

## 残余验证说明

- Required backend PostgreSQL integration：19 passed。
- Backend contract/runtime unit、Ruff、backend app mypy：通过。
- Frontend相关 Vitest：3 files / 31 tests通过；受影响 ESLint通过。
- Frontend全量 typecheck 被未修改的 `frontend/src/domains/publication/publication-work-page.test.tsx:351` 既有 `TS2345` 阻断；该文件与本 Task diff 为零，未跨范围修复。
- Optional full backend/frontend suite 与完整 frontend build未运行；required 的文件级真实数据库、相关组件、完整 backend app mypy及受影响 lint作为替代证据。
