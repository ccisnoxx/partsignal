# 后续实施稳定合同上下文摘录

## 1. 用途

本文件为后续implementation/check context injection提供小于单文件上限的任务相关摘录。它不替代stable specs；实施和review仍以引用的current-head原文为最终权威。若摘要与原文冲突，立即停止并以原文为准。

## 2. Backend error handling

来源：`.trellis/spec/backend/error-handling.md`。

- `AppError`公共响应使用`ErrorEnvelope`，包括`code/message/details/request_id`；request ID来自request state，响应header应回显同值。
- 数据库约束只允许按结构化`sqlstate`与精确`constraint_name`分类；禁止解析驱动message、`str(error)`或SQL文本。
- command-local mapper必须有精确allowlist；unknown diagnostics重新抛出原IntegrityError。
- request Session在failed flush后必须由root owner rollback，之后才能查询canonical winner或抛领域错误。
- 已完成Humanization仅允许`uq_generation_jobs_idempotency_key`和`uq_generation_jobs_active_humanization_source`；同identity replay、异identity `IDEMPOTENCY_CONFLICT`、active source `HUMANIZATION_ALREADY_ACTIVE`、winner missing重新抛出。
- 应用没有全局IntegrityError handler；unknown继续默认500。默认500的body/code/header/media type不是稳定公共合同，不应写进OpenAPI/runtime/generated。
- `REVISION_CONFLICT`只属于真实expected revision stale或另行批准的等价快照冲突，不是unique violation兜底。

任务决策引用：`research/contract-decision-matrix.md`第1、3节。

## 3. Database ownership与原子性

来源：`.trellis/spec/backend/database-guidelines.md`相关ContentTask idempotency、版本owner锁、单pending与事务章节；结构权威为`contracts/database.md`。

- PostgreSQL是唯一业务状态源，Redis只作Celery broker。
- precheck、advisory lock和row lock用于顺序协调，不能替代数据库最终constraint。
- 幂等winner只能在rollback后按完整canonical identity验证；相同identity才replay，不同identity返回既有冲突，winner缺失不得猜测。
- 普通ContentTask key与GEO共享全表唯一性；本T4-C只批准普通incoming边界，GEO incoming/shared contract留T5-C。
- ContentVersion版本号在Task owner内唯一；FactVersion版本号在Product owner内唯一。分配前锁owner，再`max(version)+1`。
- 每个Task最多一个`PENDING_REVIEW` ContentVersion、最多一个`APPROVED` ContentVersion；每个Product最多一个`PENDING_REVIEW` FactVersion。
- ContentTask current pointer是内容主线唯一owner；constraint failure不得留下version、pointer或revision半写。
- approved切换必须原子地supersede旧版、approve目标、写ReviewRecord和成功AuditLog；任一失败全部rollback。
- Fact submit创建FactVersion与FactReviewRecord同事务；当前不写AuditLog、不dispatch、不递增facts workspace revision。
- generation worker的RUNNING/attempt在provider前提交，final ContentVersion、task pointer/revision、Job success/provider metadata同一final transaction；失败rollback后只提交Job FAILED。

任务决策引用：`research/contract-decision-matrix.md`第3节各项“原子性”。

## 4. Generation/Humanization

来源：`.trellis/spec/backend/ai-configuration-guidelines.md`。

- GenerationJob是异步状态owner，HTTP command只创建/重放Job，commit后才dispatch。
- worker只接收Job UUID，不接收HTTP Idempotency-Key或request ID。
- duplicate delivery由Job行锁/status与source lookup协调；worker不得套用HTTP 409 policy。
- AI输出只能形成草稿；失败不得推进ContentTask current pointer或伪造成功版本。
- Humanization source、snapshot和active-job唯一性语义由已完成合同控制，本任务不得弱化。

## 5. Available actions与revision

来源：`.trellis/spec/backend/available-actions-contract.md`。

- 服务端是状态转换、权限、expected revision和available actions最终authority。
- 前端隐藏按钮不是安全控制；race后的请求仍必须由service重新校验。
- `REVISION_CONFLICT`表示提交的expected revision已过期；状态blocker和数据库不变量故障不得为了统一形式复用它。
- 冲突恢复以canonical reload为准，不得自动覆盖服务端状态。

## 6. Frontend state与type safety

来源：`.trellis/spec/frontend/state-management.md`和`.trellis/spec/frontend/type-safety.md`。

- server state由query/cache与canonical API response管理；表单输入是局部state，reload与提交失败不得无条件清空。
- idempotency key在同一command signature重试间复用；精确`IDEMPOTENCY_CONFLICT`后废弃，只有用户新的显式提交才创建新key。
- 409恢复必须按operation/code决定；不能把所有409解释为revision或自动retry mutation。
- Content Editor的submit-review新增`CONTENT_REVIEW_PENDING`时，保留审核备注、原code和request ID，暂停背景canonical采用；显式reload前不能重复POST，reload失败保留输入，成功后才采用canonical editor context。Review Page不发submit请求。
- Fact workspace的`FACT_REVIEW_PENDING`继续刷新canonical workspace并禁止自动replay。
- generated OpenAPI client是wire type authority；当前`ErrorDetail.code`为开放string，不建立手写全局error-code union或第二套错误类型系统。
- OpenAPI、runtime metadata或generated schema只有在status/shape/enum改变时才同步；本决策的新增code不要求结构diff。

## 7. Required evidence

来源：`.trellis/spec/backend/quality-guidelines.md`与父任务testing strategy。

- mapper unit测试必须覆盖exact pair、non-23505、缺sqlstate、缺constraint_name、unknown name与winner missing。
- unique/index合同必须由current-head真实PostgreSQL catalog和`orig.diag.constraint_name`证明；mock-only不够。
- 并发使用两个独立Session/连接、event/barrier和有界timeout；禁止sleep定序。
- 失败路径必须断言数据库state、pointer/revision、review/audit、Job与dispatch，而不仅是HTTP status。
- required gate按稳定owner拆分；repository-wide suite是optional，除非实际改动扩大到共享contract/database/permission/release面。
