# 配置 IntegrityError 错误合同决策

## Goal

在不修改业务代码、公共合同、generated client、稳定规范、数据库或生产数据的前提下，冻结 configuration identity constraints 后续实施任务所需的准确错误合同、前端恢复语义、文件边界与验收门槛，使该实施任务能够作为一个独立、可 review 的变更开展。

本任务是父任务 `09-04-integrity-error-domain-mapping` 的 T2-C 合同决策，依赖已完成的 `unknown-integrity-error-boundary-correction`。前置工作提交为 `43c252da`，归档提交为 `a805aeeb`，session journal 提交为 `1a526da9`。

## Background

前置任务已把未知 `IntegrityError` 恢复为默认服务端 500 边界。因此，本任务不能再用 `REVISION_CONFLICT` 或其他既有码掩盖未识别约束；只有经本任务明确批准且能由 PostgreSQL `sqlstate` 与 `diag.constraint_name` 精确识别的配置身份约束，才可在后续 T2 映射为稳定领域错误。

当前存在三类待决问题：

1. AI Header `(channel_id, normalized_name)` 与 AI Model `(channel_id, model_id)` 重复目前没有领域映射，落入默认 500；
2. 全局自然化 Prompt 不存在、请求却携带 `expected_revision` 时，当前错误地返回 `REVISION_CONFLICT`；
3. platform type/profile/prompt/account 已有重复错误合同的成熟度不一致，需要冻结哪些部分原样复用、哪些部分在 T2 收敛。

## Requirements

### R1. 冻结约束到领域错误的准确映射

- 明确 AI Header、AI Model、platform type、platform profile、platform prompt、platform account 六条 identity unique 的最终数据库约束名。
- 对每条分支冻结精确的 `code`、`message`、HTTP status 与 `details`。
- AI Header、AI Model 的合法重复输入必须成为用户可纠正的具名 409；其他未列名的 `IntegrityError` 必须继续走默认 500，不能降级为宽泛 409。
- 凡存在预检的路径，预检与真实数据库竞态必须返回完全相同的领域合同；没有预检的路径直接以数据库约束为权威。

### R2. 区分资源不存在与 stale revision

- 全局自然化 Prompt 不存在且 `expected_revision != null` 时，必须返回资源缺失语义，不能返回 `REVISION_CONFLICT`。
- 只有资源存在且提交的 revision 与当前 revision 不一致时，才返回 `REVISION_CONFLICT`。
- 冻结四种可观察结果：不存在并携带 revision、不存在且 revision 为 null、存在但 revision 过期、存在且 revision 当前。
- 保留 GET 在资源不存在时返回 204，以及 PUT 使用 `expected_revision: null` 首次创建的现有能力。

### R3. 冻结前端恢复行为

- 字段级 identity 冲突应定位到准确输入字段，保留可安全保留的草稿，不进入 revision 冲突锁定态，不自动重放请求，也不触发成功后的 cache invalidation。
- AI Header 的值属于不回显输入；任意保存失败后仍必须清空 `value`，仅保留 `name` 与 `isSensitive`，由用户重新输入值。
- 真正的 `REVISION_CONFLICT` 必须继续冻结旧基线并要求显式重新加载；identity conflict 不得复用该恢复分支。
- 全局自然化 Prompt 的资源缺失与 stale revision 都不得自动提交或自动合并；重新加载后的 204/200 结果必须驱动不同基线。
- 前端只能按精确 `code` 和结构化 `details.errors[].loc` 判断，不得解析 `message`。

### R4. 冻结合同同步范围

- 明确哪些决定要求修改 `contracts/openapi.yaml`、runtime response metadata、generated client、Frontend V2 行为文档与稳定 Trellis specs。
- 只有 operation 的公开 HTTP response status 集合变化时才修改 OpenAPI status；`ErrorDetail.code` 仍为开放字符串，不因新增领域 code 改成枚举或第二套注册表。
- generated client 只能由既有 contract generator 生成，不能手工修改。
- 权威事实只写入其既有 owner，避免在 OpenAPI、数据库合同、稳定规范和前端行为文档之间复制不必要的实现细节。

### R5. 冻结后续 T2 实施边界

- 列出可修改的 production、router、contract、generated、frontend、test、documentation 与 stable spec 文件。
- 列出明确禁止修改或仅作为 validation target 的文件。
- Required validation 必须覆盖真实 PostgreSQL diagnostics、预检与数据库竞态等价性、事务/副作用原子性、runtime/OpenAPI/generated 同步和前端字段投影。
- 冻结停止条件、独立 review 上限与原子回滚边界。

### R6. 保持任务边界

- 除创建 Trellis 子任务所需的 task scaffold 与父子关系元数据外，本任务正文只创建并完成 `prd.md`、`design.md`、`implement.md`。
- 不运行 `task.py start`，不实施 T2，不修改业务代码、OpenAPI、generated client、稳定 spec、数据库或生产数据。
- 不提交、不归档、不 push；现有其他脏文件与 artifacts 全部保持不动并排除在本任务之外。

## Confirmed Contract Decisions

| 分支 | 决策 |
| --- | --- |
| AI Header identity 重复 | 新增 `409 AI_CHANNEL_HEADER_NAME_EXISTS`，字段定位 `body.name` |
| AI Model identity 重复 | 新增 `409 AI_MODEL_ID_EXISTS`，字段定位 `body.model_id` |
| platform type slug 重复 | 原样复用 `409 PLATFORM_TYPE_SLUG_EXISTS` 及现有字段错误 |
| platform profile slug 重复 | 复用 `409 PLATFORM_SLUG_EXISTS` 与现有 message；把空 `details` 收敛为 `body.slug` 字段错误 |
| platform prompt name 重复 | 复用 `409 PLATFORM_PROMPT_NAME_EXISTS` 与现有 message；把空 `details` 收敛为 `body.name` 字段错误 |
| platform account normalized identifier 重复 | 原样复用 `409 PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 及现有字段错误 |
| 全局自然化 Prompt 不存在且携带 revision | 复用 `409 HUMANIZATION_PROMPT_MISSING`，不再使用 `REVISION_CONFLICT` |
| 未列名或 diagnostics 不匹配的 `IntegrityError` | 保持 unknown，继续由默认服务端 500 边界处理 |

精确 message、`details`、数据库约束名和前端恢复矩阵以 `design.md` 为准。

## Constraints

- PostgreSQL 是业务状态唯一权威；Redis 不参与本任务判断。
- 只允许使用结构化 `IntegrityError.orig.sqlstate` 与 `IntegrityError.orig.diag.constraint_name` 识别已批准约束；禁止解析数据库文本或在 rollback 后重新查询来猜测原因。
- 已批准事实、内容、发布与 GEO 历史的不可变规则不受本任务影响。
- revision 校验优先级保持现状：更新请求先验证当前 revision，再处理 identity duplicate；同一请求同时 stale 与 duplicate 时返回 `REVISION_CONFLICT`。
- 成功审计只能在可能失败的 identity flush 之后追加；失败不能留下 SUCCESS AuditLog、revision 增量、测试状态失效或部分行。
- 不创建 migration，不重命名约束，不改变 schema，不新增前端自然化 Prompt 页面。
- 不恢复前置任务移除的未知 `IntegrityError -> REVISION_CONFLICT` 行为。

## Out of Scope

- 任何 T2 业务实现、测试实现、contract generation 或 UI 实现。
- AI channel 自身 `name` 唯一性；当前数据库并无该合同，测试 fixture 中的 `AI_CHANNEL_NAME_EXISTS` 不是可复用的运行时合同。
- 其他 content、identity、publication、GEO 领域的约束映射。
- 数据库迁移、数据修复、生产数据操作、权限或状态机改造。
- 自动创建、自动覆盖或自动合并自然化 Prompt。
- 全仓 full suite、E2E 或 release gate 执行。

## Acceptance Criteria

- [x] 六条 configuration identity unique 的准确 constraint、code、message、status、details 已逐项冻结。
- [x] AI Header/Model 已明确选择新 code，未误用 `INVALID_HEADER`、`REVISION_CONFLICT` 或测试 fixture 中不存在的运行时 code。
- [x] platform type/account 已明确原样复用 wire/recovery 合同，profile/prompt 已明确仅扩充字段级 `details`。
- [x] 全局自然化 Prompt 的资源不存在与 stale revision 已形成可观察、可测试的不同响应。
- [x] 每个错误分支的前端恢复行为已定义，包含 Header secret 清除和禁止自动 replay。
- [x] OpenAPI、runtime response metadata、generated client、Frontend V2 文档与稳定 specs 的必要/非必要变更已逐项说明。
- [x] T2 精确文件边界、required validation、停止条件、review 上限和回滚边界已冻结。
- [x] 规划不依赖未证实的兼容字段或消息解析，不把未知约束变成静默成功或猜测 409。
- [x] 除 Trellis task scaffold/父子元数据外，本任务仅产出三份规划文档；未运行 `task.py start`，未实施 T2，未提交、归档或 push。

## Review Question

批准本 Contract Decision，是否同意后续 T2 按 `design.md` 的合同矩阵与 `implement.md` 的原子文件边界实施？若任何 code、message、details 或恢复语义需要调整，应在批准 T2 开发前修改本任务文档。
