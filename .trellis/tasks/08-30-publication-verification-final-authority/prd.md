# 发布核验最终权威

## Goal

确保 PublicationWork 切换 `content_version_id` 后，旧页面结果不能用于核验新内容版本。服务端 read model 与 verification command 必须共享同一个动作资格 owner；只有重新登记真实发布结果后才能恢复 `VERIFY`，从而阻止错误血缘进入不可变 `PublicationVerification` 与 `PublishedArticle`。

## Background

- `backend/app/services/publication_queries.py:88-134` 的 `publication_work_actions` 在 `ACTION_REQUIRED + CONTENT_VERSION_CHANGED` 时撤回 `VERIFY`，但 `AWAITING_VERIFICATION` 仍按 status 公开 `VERIFY`。
- `backend/app/services/publication.py:544-592` 的换版命令只更新版本、hash、revision 并追加 `CONTENT_VERSION_CHANGED`；按稳定规范，它不清除旧结果字段。
- `backend/app/services/publication.py:702-770` 的核验命令只校验 status 与结果字段，不复核最新事件或当前服务端动作资格，因而可以组合新 `content_version_id` 与旧 `actual_title/final_url/published_at`。
- `PASSED` 路径会在同一事务创建不可变 Verification、同 ID PublishedArticle，并完成 Work 与 ContentTask；错误组合一旦成功，需要高成本历史删除例外才能纠正。
- `.trellis/spec/backend/publication-workbench-guidelines.md:330-359` 已规定换版后必须重新登记结果，旧页面结果不得用于证明新内容已登记。
- `backend/tests/integration/test_publication_workflow.py:1247-1596` 只覆盖安全路径“失败→换版→read model无VERIFY→重新登记→核验”，没有在换版后直接调用核验命令并断言拒绝。

## Requirements

### R1. 单一动作资格 owner

`publication_work_actions(status, latest_event_action)` 继续是发布工作动作资格的唯一业务 owner。`AWAITING_VERIFICATION` 和 `ACTION_REQUIRED` 中，只要最新事件为 `CONTENT_VERSION_CHANGED`，都必须撤回 `VERIFY` 并把 `primary_task` 设为 `REGISTER_RESULT`。

### R2. 命令最终守卫

`verify_publication_work` 必须先锁定 Work 并校验 revision，再读取锁后可见的最新 WorkEvent，并复用 R1 的动作资格。同一 Work 的事件时间必须按 Work 锁内命令顺序严格单调，不能依赖 PostgreSQL 事务起始时间 `now()`。最新事件缺失时明确返回 `409 PUBLICATION_CONTEXT_INCOMPLETE`；动作资格不含 `VERIFY` 时返回 `409 INVALID_STATE_TRANSITION`。前端是否隐藏按钮不参与授权。

### R3. 拒绝路径零副作用

被拒绝的核验不得新增 Verification、WorkEvent、PublishedArticle 或 AuditLog，不得改变 Work/ContentTask status、revision、版本指针、结果字段或 current pointer。旧结果字段继续保留供工作区显示和历史追踪，不能通过清空字段代替动作守卫。

### R4. 合法恢复路径不变

`register_publication_result` 继续覆盖当前结果字段、追加 `RESULT_REGISTERED`、进入 `AWAITING_VERIFICATION` 并恢复 `VERIFY`。随后针对当前版本和新结果的 PASSED/FAILED 核验保持现有 append-only、原子完成和错误合同。

### R5. 合同与兼容边界

不改变 URL、request/response schema、typed token、数据库表、迁移或 generated client。拒绝继续使用现有 `ErrorEnvelope` 与 `INVALID_STATE_TRANSITION`；不新增兼容字段、第二状态字段、客户端 workaround 或自动重放。

### R6. 稳定规范与测试

将 `.trellis/spec/backend/publication-workbench-guidelines.md` 的换版不变量明确扩展到 `AWAITING_VERIFICATION`，并用 unit、真实 PostgreSQL service integration 与至少一条真实 FastAPI HTTP 命令回归证明 read/write 对称和零副作用。

## In Scope

- `backend/app/services/publication_queries.py` 的 PublicationWork 动作投影。
- `backend/app/services/publication.py` 的 verification command 最终守卫。
- `backend/tests/unit/test_security_and_publication.py` 的动作矩阵。
- `backend/tests/integration/test_publication_workflow.py` 的 PostgreSQL 与 HTTP 回归。
- `.trellis/spec/backend/publication-workbench-guidelines.md` 的最小稳定不变量澄清。

## Out of Scope

- 不修改 Frontend、OpenAPI、generated client、数据库 schema/migration 或生产数据。
- 不清空换版前结果字段，不新增 result-version 外键或第二套状态机。
- 不处理 Publication Workspace raw-status 文案、cached refetch error、Article 能力冲突、永久删除或 GEO。
- 不处理全局 IntegrityError、contract checker 非 2xx 或 `/geo/topics`。
- 不增加部署、生产复验或全仓重构。

## Acceptance Criteria

- [x] `publication_work_actions("AWAITING_VERIFICATION", "CONTENT_VERSION_CHANGED")` 与 `ACTION_REQUIRED` 同态：无 `VERIFY`，`primary_task == "REGISTER_RESULT"`；原有其他状态/事件矩阵不变。
- [x] verification command 在 Work 行锁和 revision 校验后读取最新事件，并复用 `publication_work_actions`；不存在另一份 status/event eligibility 分支。
- [x] 先开始事务、后取得 Work 锁的换版命令仍产生排序在结果登记之后的 `CONTENT_VERSION_CHANGED`；read model 与command都不得因事务起始时间倒置而恢复 `VERIFY`。
- [x] 换版后直接核验，即使旧结果字段完整，也返回 `409 INVALID_STATE_TRANSITION`，结构化响应包含 `request_id`。
- [x] 最新事件缺失时返回 `409 PUBLICATION_CONTEXT_INCOMPLETE`，不得按 status 猜测放行。
- [x] 拒绝前后的 Verification、WorkEvent、PublishedArticle、AuditLog 数量以及 Work/Task业务字段完全一致。
- [x] `AWAITING_VERIFICATION` 与 `ACTION_REQUIRED` 两种换版场景都有真实 PostgreSQL 回归；至少一条通过 FastAPI + CSRF +真实router/service路径提交核验。
- [x] 重新登记后恢复 `VERIFY`，随后当前版本核验成功仍原子创建正确 Verification/PublishedArticle并完成 Work/Task；现有重复FAILED append-only行为不变。
- [x] 定向 unit/integration、ruff、mypy和contract check通过；OpenAPI、generated schema、数据库合同和migration无diff。
- [x] 最终diff不包含Frontend、Article、GEO、缓存错误或无关重构；新改中文注释/docstring/错误文本符合项目规范。

## Review Gate

本 PRD、`design.md` 与 `implement.md` 通过人工 review 后才允许 `task.py start`。创建本 Task 和批准优先级不等于实施授权。
