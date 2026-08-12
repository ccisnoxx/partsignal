# Publication Work Projection Contract Correction

> 当前状态：已按批准方案完成白名单实施与 required validation；Task 保持 `in_progress`，等待 commit plan 确认。

## Goal

关闭 Phase 4 Publishing 抽象回顾中的 F-14 与 F-15，使 PublicationWork 的显示身份投影、结构化运行时错误与 OpenAPI 合同一致。本 Task 只关闭该投影/合同 blocker，不负责 Phase 4 最终 closeout，也不提前进入 GEO。

## Confirmed Background

- `PublicationWork` 已持久化非空的 `platform_profile_name_snapshot`、`platform_account_label_snapshot`、`account_identifier_snapshot`；终态 `COMPLETED` / `CLOSED` 允许 live Profile/Account 外键在删除后变为 `null`。
- Work List、Work Detail、Workspace Context 目前都经过 `backend/app/services/publication_queries.py` 的 `_work_context_query()` 与 `_work_list_item()`；不存在三个 endpoint 各自独立的身份投影。
- 当前 `_work_context_query()` 对三个显示字段使用无状态区分的 `coalesce(live, snapshot)`：终态仍存在 live 配置时会随改名漂移，非终态 live lineage 缺失时会静默回退 snapshot。
- `_work_list_item()` 已在 latest event 缺失时抛出结构化 `PUBLICATION_CONTEXT_INCOMPLETE` / 409，因此 List runtime 可以返回 409；冻结 OpenAPI 尚未声明。
- `PublicationWork` 没有 website snapshot。`PublicationWorkspacePlatform.website_url` 是独立的 nullable Workspace 字段，当前来源为 live Profile website 或 ContentTask 已锁定的 platform website snapshot，不属于本 Task 的 Work identity invariant。

## Requirements

### R1. 唯一 snapshot invariant

- `PREPARING`、`PLATFORM_REVIEW`、`AWAITING_VERIFICATION`、`ACTION_REQUIRED` 的 `platform_profile_name`、`platform_account_label`、`account_identifier` 必须读取当前 live Profile/Account。
- 上述非终态 Work 缺失任一必需 live identity 时，所有读取面都返回结构化 `PUBLICATION_CONTEXT_INCOMPLETE` / HTTP 409；不得回退 Work snapshot、填默认值或丢弃记录。
- `COMPLETED`、`CLOSED` 必须无条件读取 Work 保存的三个 frozen snapshot；后续 live rename 或 delete 不得改变历史显示。
- 现有 `platform_profile_id` / `platform_account_id` 语义不变：终态删除后允许为 `null`，本 Task 不发明 frozen ID。
- `website_url` 不新增 Work snapshot、不新增兼容字段、不纳入三个身份字段的状态分支；只保留现有权威 Workspace 合同与来源。

### R2. 单一投影 owner

- List、Detail、Workspace Context 必须继续共用现有 `_work_context_query()` → `_work_list_item()` 投影链。
- 状态相关来源选择只在共享 SQL query 中表达，完整性错误只在共享 row-to-DTO 边界显式抛出。
- 不新增 endpoint-local fallback、第二 DTO、第二 projection service、wrapper 或前端 join。

### R3. OpenAPI 与生成类型

- `GET /api/v1/publication-works` 必须声明 runtime 可返回的结构化 409。
- 审计并冻结 List、Detail、Workspace Context 的实际错误矩阵；只增加已有 runtime 路径，不发明新错误。
- 实施阶段使用现有 `api:generate` 命令分别重新生成 V1/V2 TypeScript schema；不得手改生成文件。

### R4. Backend regression

- 非终态 live rename 后，List、Detail、Workspace 都返回最新 live 值。
- 非终态 live identity 缺失时返回 `PUBLICATION_CONTEXT_INCOMPLETE` / 409。
- `COMPLETED` 与 `CLOSED` 在 live rename/delete 后，三个读取面都返回 frozen snapshot。
- malformed Work 缺 latest event 时，真实 List HTTP runtime 返回结构化 409。
- Contract assertion 覆盖三个 GET 的完整响应矩阵。
- 查询次数不随当前列表行数或事件/核验历史数量线性增长。

### R5. Consumer compatibility

- V1 继续消费 Work List 与 Work Detail 的既有字段；只机械更新 `frontend/src/shared/api/schema.d.ts`，不修改 V1 runtime、页面或测试。
- V2 继续消费 Work List 与 Workspace Context；不修改生产页面、domain API、fixture 或页面测试来补偿后端。
- 响应 DTO 字段集合不变；仅显示值来源和声明的错误响应发生修正。

### R6. Scope boundaries

- 不修改 Publication 状态机、命令、权限、数据库 schema、migration 或持久化写路径。
- 不处理 Content DirtyGuard unit failure、Content AI real-stack timeout。
- 不改写或重跑完整 Publishing E2E，除非实施证据显示本次修改直接破坏既有断言。
- 不进入 Phase 4 最终 gate 重判、closeout、GEO 或其他后续 Task。

## Acceptance Criteria

- [x] AC1：非终态四个状态只读 live identity，任一必需 live lineage 缺失时三个读取面均以 `PUBLICATION_CONTEXT_INCOMPLETE` / 409 失败，且没有 snapshot fallback。
- [x] AC2：`COMPLETED` / `CLOSED` 只读三个 Work snapshot，live rename/delete 后 List、Detail、Workspace 的显示保持冻结。
- [x] AC3：实现只修改现有共享 `_work_context_query()` / `_work_list_item()` 投影链，不新增 DTO、projection owner、endpoint fallback 或查询。
- [x] AC4：`website_url` 保持现有 Workspace 合同与来源；Work DTO、数据库与 OpenAPI 不新增 website snapshot/兼容字段。
- [x] AC5：List、Detail、Workspace 的 OpenAPI 响应矩阵与已证实 runtime 一致；List malformed context 的 HTTP 回归返回结构化 409。
- [x] AC6：V1/V2 schema 由现有命令重新生成，两个前端 typecheck 与 contract check 通过，生产页面无修改。
- [x] AC7：Backend targeted unit/integration/contract tests 覆盖 live rename、missing live identity、终态 rename/delete、三读取面对称和 bounded query count。
- [x] AC8：专项 required validation 全绿，diff 仅包含批准白名单；迁移计划只记录 F-14/F-15 关闭，不把完整 Phase 4 标记为 `MET`。

## Planning Decision

本任务按一个共享 read-model 根因修正完成，未拆分子 Task，也未扩张到其他 Phase 4 blocker。
