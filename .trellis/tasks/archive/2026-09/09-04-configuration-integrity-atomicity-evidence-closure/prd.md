# 配置 IntegrityError 原子性证据收口

## Goal

在不改变任何生产行为或公共合同的前提下，为父任务 `09-04-configuration-integrity-error-domain-mapping` 中 Header create/update、Model update 和 Platform Prompt duplicate 补齐失败原子性与 Session 清理的最小真实 PostgreSQL 证据，关闭 targeted re-review 留下的唯一 MEDIUM 问题。

## Background and Authority

- 本任务是 `09-04-configuration-integrity-error-domain-mapping` 的独立子任务；父任务仍为 `in_progress`。
- 父任务的生产实现、OpenAPI/runtime/generated、前端投影、权威文档和稳定 specs 已完成，现有 targeted tests 全绿。
- 父任务 targeted re-review 已确认六条 identity 并发证据充分；本任务不重新设计或扩展并发 harness。
- 仅剩的 MEDIUM 是若干 duplicate 路径只断言 HTTP status/code/loc，未在失败后从新 Session 核对完整持久状态与 SUCCESS audit。
- 本任务不豁免或改写父任务的 R2/Acceptance Criteria，只补足其验证证据。

## Requirements

### R1. AI Header create duplicate 失败原子性

- 复用 `test_ai_channel_api_enforces_permissions_contract_and_secret_redaction` 中现有 duplicate create 请求，不新建 API setup。
- 提交前记录 channel revision、Header identity/行数以及用于检测失效副作用的模型状态；失败后用新 Session 证明它们不变。
- 为失败请求使用稳定 `X-Request-ID`，断言不存在 `ai_channel_header.created` SUCCESS audit。

### R2. AI Header update duplicate 失败原子性

- 失败后证明目标 Header 仍保持原 name/normalized identity、敏感性与存储值形态，channel revision 和 Header 行数不变。
- 如涉及模型失效分支，断言用于监测的 model revision/enabled/test state 不变。
- 断言不存在该 request ID 的 `ai_channel_header.updated` SUCCESS audit，且后续新 Session 查询可用。

### R3. AI Model update duplicate 失败原子性

- 失败前后用新 Session 核对目标 Model 的 display name、model identity、request parameters、revision、enabled、test status/time/error summary 及同渠道模型行数均不变。
- 断言不存在该 request ID 的 `ai_model.updated` SUCCESS audit，且后续查询可用。

### R4. Platform Prompt duplicate 失败原子性

- 复用现有 precheck/constraint 等价测试，不新建第二套 Prompt graph。
- 失败后从新 Session 断言只有原 Prompt，其 id/name/Markdown/revision 不变，没有 duplicate request ID 对应的 `platform_prompt.created` SUCCESS audit。
- precheck 与绕过预检后的真实 constraint 路径至少各覆盖一次失败后事务可清理性；不重复完整 ErrorEnvelope 断言。

### R5. 边界与成本

- 只允许修改 `backend/tests/integration/test_ai_channel_management.py` 和 `backend/tests/integration/test_platform_workspace.py`。
- 不修改 production/runtime、unit tests、schemas、contracts、generated client、frontend、stable specs、数据库或其他父任务 dirty 文件。
- 新增证据优先合并到现有测试，不创建新并发 helper/framework；本子任务净增测试目标不超过 120 行，硬上限 150 行。
- 不运行 `make contract-check`；该一次性正式 gate 仍由父任务在本子任务通过后执行。

## Acceptance Criteria

- [x] Header create duplicate 失败后，Header 行数/identity、channel revision 和可适用的 model state 不变，无 SUCCESS audit，新 Session 可查询。
- [x] Header update duplicate 失败后，目标 Header 全部持久字段、channel revision、行数和可适用的 model state 不变，无 SUCCESS audit。
- [x] Model update duplicate 失败后，identity/configuration/revision/enabled/test state 和行数不变，无 SUCCESS audit，新 Session 可查询。
- [x] Prompt precheck/constraint duplicate 失败后只有原行且 id/name/Markdown/revision 不变，无 SUCCESS audit，Session 可继续使用。
- [x] 两个批准测试文件的 targeted PostgreSQL tests、Ruff 和 `git diff --check` 通过，无 warning/noqa/filter。
- [x] 一次新的独立 `trellis-check` 无 MEDIUM 或更高问题；仅在此后返回父任务执行一次性 `make contract-check`。
- [x] 相对 `research/dirty-baseline.md` 记录的父任务基线，子任务增量只触及批准的两个测试文件和本子任务 artifacts，未改写其他已有 dirty 文件。

## Out of Scope

- 修改生产 mapper、事务 owner、revision 优先级、审计逻辑或任何公共错误合同。
- 新增或重写六条 identity 并发测试、unknown 500 sentinel、humanization 四状态或前端测试。
- 修复未修改的 frontend publication typecheck 错误。
- 处理无法归因且已排除的 `backend/app/schemas/configuration.py` 格式化差异。
- 运行正式 contract gate、最终跨层 review、commit、archive 或 push。

## Planning Status

- 已有证据足以确定文件、失败路径、观测字段和验证命令，无 blocking open question。
- 本 PRD 已完成 convergence pass：每项持久副作用只在一个 requirement 中定义，验收条件可观测且无临时模板内容。
- 用户已在阅读最终规划摘要后明确批准实施；子任务已通过 `task.py start` 进入 `in_progress`。
