# 实施配置 IntegrityError 精确领域映射

## Goal

以已批准的 `09-04-configuration-integrity-error-contract-decision` 为不可重新解释的合同输入，在一个原子 T2 交付中完成 configuration identity constraints 的精确领域错误映射、全局自然化 Prompt 缺失语义修正、前端恢复投影以及 OpenAPI/runtime/generated/docs/spec 同步，同时保持所有未知 `IntegrityError` 的默认 500 边界。

## Approved Input and Dependencies

- 已批准输入：
  - `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/prd.md`
  - `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/design.md`
  - `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/implement.md`
- 用户已在 2026-09-04 先批准上游最终规划并授权创建本独立 T2 implementation 子任务，随后又明确批准本任务规划并授权运行 `task.py start` 后按 `implement.md` 实施。
- 前置边界修复提交为 `43c252da`，归档提交为 `a805aeeb`，session journal 提交为 `1a526da9`；开始实施前必须确认它们仍位于当前基线上。
- 本任务是父任务 `09-04-integrity-error-domain-mapping` 的独立子任务，与合同决策任务并列；合同决策任务本身不转为实施任务。

## Requirements

### R1. 精确映射六条 configuration identity unique

- AI Header、AI Model、platform type、platform profile、platform prompt、platform account 只能按已批准的 PostgreSQL `sqlstate=23505` 与精确 `diag.constraint_name` 映射领域错误。
- 映射必须返回 `design.md` 冻结的完整 HTTP status、code、message 与 details；预检路径和最终数据库路径必须完全等价。
- 未列名、diagnostics 缺失、sqlstate 不同或 constraint 不匹配的 `IntegrityError` 必须继续原抛并由默认服务端 500 边界处理，不得解析数据库文本、增加兼容别名或使用宽泛 409 兜底。

### R2. 保持事务、revision 与副作用原子性

- 更新请求必须先校验 revision，再处理 identity duplicate；同一请求同时 stale 与 duplicate 时返回 `REVISION_CONFLICT`。
- 可能失败的 identity flush 必须发生在 SUCCESS audit、模型失效和其他不可保留副作用之前。
- duplicate 或 unknown 失败不得留下第二行、部分写入、revision/test-state 漂移、SUCCESS audit 或 failed-session 残留。
- PostgreSQL 仍是并发最终权威；锁串行路径和无共享 identity owner 锁路径分别使用与其事务模型相符的真实数据库测试。

### R3. 修正全局自然化 Prompt 缺失语义

- singleton 不存在且 `expected_revision` 为整数时返回 `409 HUMANIZATION_PROMPT_MISSING`、message `自然化 Prompt 尚不存在`、details `{}`。
- singleton 不存在且 `expected_revision=null` 时保留首次创建能力；存在且 revision 不匹配时继续返回 `REVISION_CONFLICT`。
- GET 缺失 204、PUT 已有 status 集合、成功审计和 revision 行为保持既有合同；missing/stale 失败均不得写入或审计成功。

### R4. 实施前端字段投影与恢复行为

- AI Header duplicate 只按 exact code 与 `body.name` structured loc 定位字段，保留 `name/isSensitive` 并清空 secret `value`。
- AI Model duplicate 只按 exact code 与 `body.model_id` structured loc 定位 `modelId`，保留非 secret 草稿。
- platform Prompt 删除没有合法 structured loc 时仅凭 code/message 回填 `fields.name` 的 fallback；message 只用于展示。
- identity duplicate 不进入 revision conflict lock，不 reload、不自动 replay，也不触发成功后的 invalidation；所有错误都展示 request ID。

### R5. 原子同步公共合同、生成物与权威文档

- 仅为 `createAIModel` 新增公开 409 response，并同步 runtime metadata、contract tests 与 generator 生成的 client 类型。
- 不把 `ErrorDetail.code` 改成 enum，不增加第二套 code registry，不手工编辑 generated client。
- 同步 `contracts/database.md`、Frontend V2 行为文档以及三个已批准稳定 backend specs；`error-handling.md` 只允许更新 response occurrence 基线计数。

### R6. 遵守实施与交付门禁

- 未获得本任务最终规划的后续明确批准前，不运行 `task.py start`、不修改业务代码。
- 实施时只修改 `design.md` 明列的允许文件；现有其他脏文件和 artifacts 不清理、不覆盖、不纳入提交。
- Required validation 先执行定向门槛，全部通过后只运行一次正式 `make contract-check`。
- 候选必须接受一次独立只读 review 和最多一次受影响路径 targeted re-review；不得循环 review。
- 任何 commit 前必须向用户展示精确 commit plan 并获得确认；不自动 push。

## Out of Scope

- 数据库 migration、约束重命名、schema 或生产数据修改。
- AI channel `name` 唯一性及其他 content、identity、publication、GEO 领域约束映射。
- global exception handler 改造、未知 `IntegrityError -> REVISION_CONFLICT` 恢复、错误 code enum 或全局 constraint registry。
- 全局自然化 Prompt 的新前端页面、API wrapper、自动创建、自动覆盖、自动合并或自动 replay。
- 权限、核心状态机、部署配置、视觉改造以及未由证据触发的重型 full suite/E2E/release gate。

## Acceptance Criteria

- [x] 六条已批准 identity 的最终数据库路径均返回精确领域合同，且每条都有真实 PostgreSQL diagnostics 证据。
- [x] 存在预检的路径与数据库竞态路径返回完全相同的 status/code/message/details。
- [x] 未列名、diagnostics 缺失、sqlstate 或 constraint 不匹配的 `IntegrityError` 仍为默认 500，且数据库文本不泄漏。
- [x] Header/Model update 保持 stale 优先；所有 duplicate/unknown 失败无部分状态、错误审计或 session 污染。
- [x] 自然化 Prompt 四状态矩阵通过，missing 与 stale 可观察地区分，GET 204 与首次创建不回归。
- [x] Header duplicate 清除 secret 并定位 `name`；Model duplicate 定位 `modelId` 并保留草稿；两者均不 reload/replay/invalidate。
- [x] platform type/account 既有 recovery 不回归，profile/prompt 使用 canonical 字段 details，Prompt 不再按 message 推断字段。
- [x] 只有 `createAIModel` 新增 409；OpenAPI、runtime metadata 与 generated client 同步。
- [x] 数据库合同、Frontend V2 行为文档和指定 stable specs 与代码、测试一致。
- [x] 配置范围 Required validation 与一次性正式 contract gate 通过；仓库级 typecheck 仅被未修改的 publication 测试既有错误阻断，独立 review 无未解决 MEDIUM 以上问题。
- [x] 实际任务 diff 只包含批准文件且不纳入既有脏文件；非平凡 Python touched scope 已完成中文文档语言复核。
- [x] 提交前已展示 commit plan 并获得用户确认；未自动 push。

## Planning Status

- 用户所有 product、scope、UX、compatibility 与 risk 决策均由已批准的 T2-C 冻结。
- 当前不存在 blocking open question。
- 本 PRD 已完成 convergence pass：临时模板内容已移除，需求、边界和验收结果各有唯一 owner。
- 用户已批准实施，`task.py start` 已在当前 `main` same-directory checkout 运行，任务现为 `in_progress`。
