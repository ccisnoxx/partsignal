# Content Version review state IntegrityError mapping

## 目标

在唯一的 `review.transition_content_version` command owner 内，为 Content Version review state 的两条 partial unique 约束建立不同且可证明的失败语义：仅把精确的 pending 约束冲突映射为已批准的 `CONTENT_REVIEW_PENDING` 409；approved 约束冲突以及任何无法精确证明的 `IntegrityError` 继续保留 unknown/default 500。同时证明 submit-review、approve 的事务原子性、既有业务 precheck 优先级，以及对应的前端恢复行为。

本 Task 当前只完成 planning convergence，不运行 `task.py start`，不修改 production/test/spec/docs，不实施、不提交、不归档、不 push。实施必须等待后续明确批准。

## 依赖与单一 review 目标

- 父任务：`.trellis/tasks/09-04-integrity-error-domain-mapping`，继续保持 `planning`。
- 合同决策 owner：`.trellis/tasks/09-05-content-integrity-error-contract-decision`，其最终合同已由本次请求明确批准，但任务状态继续保持 `planning`。
- 已完成前置实现：`generation-job-idempotency-integrity-mapping`、`content-task-idempotency-integrity-mapping`、`content-version-identity-integrity-boundary`。
- 最近完成的 I3 提交：工作 `82227d66`、归档 `0ce872c4`、journal `53191a5f`。
- 本 Task 只有一个可 review 目标：同一 Content Version review transition command 的 pending/approved partial unique 诊断边界、事务回滚及其前端恢复合同。不得混入 ContentVersion identity、Fact Version、publication/GEO 或其他 IntegrityError 类别。

## 已确认事实

- `backend/app/services/review.py` 的 `transition_content_version` 在 flush/commit 前完成 revision、current version、状态转换和质量门禁等 service precheck；权限由现有 router/dependency 边界在 command 调用前拒绝。approve 还会先 flush 原 approved version 的 `SUPERSEDED` 更新。
- `uq_content_versions_one_pending_per_task` 与 `uq_content_versions_one_approved_per_task` 均由 ContentVersion 模型声明，但来自不同 schema/migration 阶段；实施必须在 current-head PostgreSQL 中复核真实 catalog 定义和 `diag.constraint_name`。
- `submitContentVersion` 与 `approveContentVersion` 已声明 409，`ErrorDetail.code` 是开放 string；现有 OpenAPI、router metadata 和 generated client 足以承载 `CONTENT_REVIEW_PENDING`，无需公共 schema 变更。
- pending 的实际前端 consumer 是 Content Editor 的“提交审核”Dialog。Content Review Page 只负责 approve/request-changes，现有 5xx 路径原则上已是 generic failure。

## 允许与只读 owner

实施阶段默认允许修改：

- Backend：`backend/app/services/review.py`、`backend/tests/integration/test_content_review.py`。
- Frontend：`frontend/src/domains/content/content-editor-page.tsx`、`content-editor-page.test.tsx`、`content-editor.model.ts`、`content-editor.model.test.ts`、`content-review-page.test.tsx`；只有测试证明现有 generic 5xx 不满足合同时，才允许最小修改 `content-review-page.tsx`。
- 稳定文档/spec：`.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`。

实施阶段只读且必须零 diff：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/app/routers/production.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- 数据库模型/schema/migration

## 冻结需求

### R1. 精确 diagnostics classifier

只有结构化 PostgreSQL diagnostics 同时满足以下条件，才可识别 pending 冲突：

```text
sqlstate == "23505"
constraint_name == "uq_content_versions_one_pending_per_task"
```

分类只读取结构化 diagnostics，不解析 `str(error)`、数据库 message、SQL 文本或 substring，不回查 winner，不执行业务恢复。`orig`、`diag`、`sqlstate` 或 `constraint_name` 缺失，非 `23505`，其他 constraint/index，以及 CHECK、FK、NOT NULL、trigger failure 都必须原样重新抛出原始 `IntegrityError`。

### R2. pending partial unique 的唯一映射

只有 `submit-review` 动作命中 R1 的 exact pair 时，在完整 root transaction rollback 后返回：

- HTTP status：409
- code：`CONTENT_REVIEW_PENDING`
- message：`该任务已有待审核内容版本`
- details：`{}`
- `error.request_id` 与响应头 `X-Request-ID` 完全相同

不得复用 `REVISION_CONFLICT`、`INVALID_STATE_TRANSITION` 或任何模糊通用冲突 code。

### R3. approved partial unique 保持 unknown

`uq_content_versions_one_approved_per_task` 即使同时精确命中 `23505`，也必须重新抛出原始 `IntegrityError`，由现有 unknown/default 500 边界处理。不得：

- 返回“已有批准版本”409；
- 返回 `REVISION_CONFLICT` 或其他业务冲突码；
- 自动选择 winner、自动 supersede、reload 或 replay approve；
- 冻结默认 500 的 JSON body、code 或 media type 为新的公共合同。

unknown 500 不得泄漏 SQL、表名、constraint、driver message 或 stack。

### R4. submit-review 事务原子性

pending exact conflict 必须回滚目标 ContentVersion 的 status/revision、待新增的 ContentReviewRecord 和同事务其他写入。失败不得改变 ContentTask 的 `current_content_version_id`/revision、其他 ContentVersion、AuditLog 或 dispatch。rollback 后同一个 request Session 必须可以继续查询。

### R5. approve 事务原子性

approved exact constraint failure 必须整体回滚：原 approved version 的 `SUPERSEDED` 状态/revision、目标 version 的 `APPROVED` 状态/revision、新增 ContentReviewRecord、SUCCESS AuditLog 及同事务其他写入。失败后两条 version 和 ContentTask pointer/revision 保持原值，request Session rollback 后可继续查询。

### R6. precheck 优先级不变

真正 stale 的 `expected_revision`、非当前版本、非法状态转换及质量门禁失败必须继续由 service 在数据库 flush 前返回各自既有 code/message/details/status；权限拒绝必须继续由现有 router/dependency 在调用 command 前返回既有 403。新增 catch 不得把它们改写成约束冲突，不得把权限逻辑下沉或复制到 service，也不得削弱 Task/Version 锁。

### R7. Content Editor pending blocker

Content Editor 必须依据精确的结构化 `code`，而非 message 文本，把 `CONTENT_REVIEW_PENDING` 投影为独立 pending blocker，并满足：

- 保留用户填写的审核备注、原始 error code 和 request ID；
- Dialog 保持打开；
- 用户显式 reload 前禁止再次 POST，不自动 replay submit；
- blocker 存续时暂停背景 canonical context 自动采用；
- reload 失败继续保留备注、错误、code 和 request ID；
- reload 成功后才采用新的 canonical editor context；
- 不显示成 revision conflict；
- malformed details、其他 code 或缺 request ID 安全退回既有 generic failure，不猜测类型。

### R8. Content Review Page 的 approved unknown 行为

Content Review Page 对 approved unknown 5xx 必须使用 generic server failure，不进入 revision reload 专用分支，不自动再次 approve，不自动选择或采用其他 approved version。若现有 production 行为已满足，仅添加回归测试，不修改页面实现。

### R9. 公共合同与稳定语义同步

- `contracts/openapi.yaml`、router response metadata、generated client、`contracts/database.md` 和 migration/schema 必须保持零 diff。
- 不新增全局 error code enum、稳定 500 response、全局 `IntegrityError` mapper、第二套 error registry/type system。
- 仅在允许的三份稳定 spec 与一份 Frontend V2 文档中同步 exact diagnostics、transaction owner、pending blocker 与 approved generic 5xx 的必要语义。

### R10. 验证和独立复核

实施必须完成用户指定的 PostgreSQL、backend、frontend、一致性验证及一次独立只读 review。每个 validation/review gate 最多两轮 `repair -> targeted re-check`；独立 review 为一次 full pass，若修复 material finding，最多一次 targeted re-review。full backend/frontend suite 与完整 build 为 optional，未运行时必须记录替代证据和残余风险。

## 验收标准

- [ ] AC1：classifier exact/negative matrix 证明只有 `23505` + exact pending constraint 可映射；diagnostics 缺失、其他 sqlstate/constraint、CHECK/FK/NOT NULL/trigger-like failure 均原抛。
- [ ] AC2：current-head PostgreSQL catalog 证明两个 partial unique index 的真实名称、唯一性、列和 predicate，并以真实冲突证明 diagnostics；若不一致则 scope stop。
- [ ] AC3：pending exact 23505 经完整 rollback 后返回 409 `CONTENT_REVIEW_PENDING`、固定 message、`{}`，且 body/header request ID 相同。
- [ ] AC4：approved exact 23505 与所有 unknown IntegrityError 保持 default 500/no-leak，不固化 500 body/code/media type。
- [ ] AC5：submit-review 失败后目标 status/revision、ReviewRecord 和其他同事务写入回到基线，Task pointer/revision、其他 versions、AuditLog、dispatch 均未改变，同一 Session 可继续查询。
- [ ] AC6：approve 失败后原 approved、目标 version、ReviewRecord、SUCCESS AuditLog、Task pointer/revision 和其他同事务写入全部回到基线，同一 Session 可继续查询。
- [ ] AC7：成功 submit-review、成功 approve 回归通过；stale revision、current version、invalid state 和 quality gate 的 service 合同与 flush 前优先级不变；权限仍由 router/dependency 返回既有 403，且拒绝时 command/flush/commit 未执行。
- [ ] AC8：Content Editor model 只按 exact `CONTENT_REVIEW_PENDING` 产生独立 pending blocker；malformed details、其他 code、缺 request ID 均按既有 generic fallback 处理。
- [ ] AC9：pending blocker 下 Dialog 备注/code/request ID 保留且保持打开，背景 canonical 不采用，reload 失败保持现场，reload 成功后才采用 canonical context。
- [ ] AC10：pending 后 submit POST 恰一次，不自动 replay；其 UI 不使用 revision conflict 文案或恢复分支。
- [ ] AC11：Content Review Page 的 approved unknown 5xx 走 generic server failure，不进入 revision reload、不自动 approve/replay、不采用其他 approved version。
- [ ] AC12：指定 backend integration/unit、Ruff、backend app mypy、相关 Vitest、frontend typecheck 和受影响文件 ESLint 全部通过，或按失败归因规则准确记录环境/无关失败。
- [ ] AC13：`git diff --check`、Trellis task validation 和公共合同/router/generated/database/migration 零 diff gate 通过。
- [ ] AC14：稳定 spec/Frontend V2 文档与实际实现、测试一致；若某允许文档无需修改，closeout 说明原因。
- [ ] AC15：完成一次独立只读 review；若修复 material finding，仅做一次 targeted re-review，并记录残余风险。

## 范围外与停止条件

范围外包括：公共 status/ErrorDetail/OpenAPI/generated client 变更、数据库 schema/migration、权限模型、ContentVersion 状态机、全局错误映射、视觉重做、无关重构、ContentVersion identity、Fact Version、publication/GEO。

若 current-head 数据库与已冻结的 index identity/definition 不符，或实现必须改变上述公共合同、schema、权限/状态机、锁语义，或只能依靠 message parser、宽泛 `23505`、winner inference、自动 replay 才能完成，则立即停止并报告证据，不扩大本 Task。
