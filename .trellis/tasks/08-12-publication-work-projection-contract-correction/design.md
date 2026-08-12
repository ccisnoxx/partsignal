# Design — Publication Work Projection Contract Correction

> 已按本设计实施：修正现有共享投影中的一个来源选择错误，没有建立新层。

## 1. Authoritative snapshot invariant

| Work 状态 | 显示平台名 | 显示账号标签 / identifier | live 缺失时 | live rename/delete 后 |
| --- | --- | --- | --- | --- |
| `PREPARING` / `PLATFORM_REVIEW` / `AWAITING_VERIFICATION` / `ACTION_REQUIRED` | `PlatformProfile.name` | `PlatformAccount.label` / `account_identifier` | `409 PUBLICATION_CONTEXT_INCOMPLETE` | rename 立即可见；按数据库约束 delete 应被阻止 |
| `COMPLETED` / `CLOSED` | `PublicationWork.platform_profile_name_snapshot` | `PublicationWork.platform_account_label_snapshot` / `account_identifier_snapshot` | 不依赖 live | rename/delete 均不得改变显示 |

补充边界：

- Work 的两个 live ID 继续按现有模型返回，终态配置删除后可为 `null`；不新增 snapshot ID。
- 三个 snapshot 列已经由数据库设为非空，写路径在 Work 创建及合法的准备期账号切换时维护；本 Task 不修改持久化规则。
- 若读取结果的任一必需显示字段仍为 `null`，共享 DTO 边界显式返回 409，不把损坏数据交给 Pydantic 形成非结构化 500。

## 2. Current read-surface data flow

```text
GET /publication-works
  -> router.list_publication_works
  -> list_publication_works
  -> _work_context_query
  -> page-wide latest verification/event batch queries
  -> _work_list_item
  -> PublicationWorkListItem[]

GET /publication-works/{work_id}
  -> router.get_publication_work
  -> publication_work_out
  -> _work_context_query + event/verification/file queries
  -> _work_list_item
  -> PublicationWorkOut

GET /publication-works/{work_id}/workspace-context
  -> router.get_publication_workspace_context (REPEATABLE READ)
  -> publication_workspace_context
  -> _work_context_query.add_columns(...)
  -> event/verification/file/account queries
  -> _work_list_item
  -> PublicationWorkspaceContext.work + platform.name
```

| Surface | 共享 identity owner | 现有查询边界 | 实际消费者 |
| --- | --- | --- | --- |
| Work List | `_work_context_query()` + `_work_list_item()` | 固定 4 条；已有 1/2 行对称断言 | V1 `PublicationsPage.tsx`、V2 `publication-work-page.tsx` 显示平台名/账号标签；V2 同时显示 identifier |
| Work Detail | 同上 | context + events + verifications + files，批量按关系读取 | V1 `PublicationsPage.tsx` 详情抽屉显示平台名/账号标签 |
| Workspace Context | 同上；`platform.name` 复用同一 row label | 固定 5 条；已有账号数量增长断言 | V2 `publication-workspace-page.tsx` 显示 `platform.name`、Work 账号标签/identifier；V1 不消费该 surface |

结论：三个 endpoint 已有同一个投影 owner。修复应留在这条链上，router 与 Pydantic schema 都不需要改动。

## 3. Root cause and minimal shared fix

根因是 `_work_context_query()` 的三个 `coalesce(live, snapshot)` 不知道 Work 状态：它同时造成终态 live-first 漂移和非终态 snapshot fallback。

批准实施后只做两处同链修正：

1. 在 `_work_context_query()` 将三个 `coalesce` 改为同构的 SQL `case`：非终态选择 live 列，`COMPLETED` / `CLOSED` 选择 Work snapshot。保留原 label、outer join、row shape 与调用方。
2. 在已有 `_work_list_item()` 中，在 DTO 构造前检查三个选择结果；任一缺失时抛出 `AppError("PUBLICATION_CONTEXT_INCOMPLETE", ..., 409)`。latest event 的现有 409 保持不变。

这不是两个 projection owner：query 仍负责来源选择，现有 row-to-DTO 函数仍负责统一完整性边界和映射。不会增加 helper、wrapper、查询或 endpoint 分支。

## 4. `website_url` boundary

- OpenAPI 只在 `PublicationWorkspacePlatform.website_url` 声明 nullable website；PublicationWork List/Detail 没有该字段。
- 当前 Workspace query 同时读取 `PlatformProfile.website_url` 与 `ContentTask.platform_website_url_snapshot`，现有返回逻辑独立于 Work 的 name/account identity snapshot。
- 本 Task 不修改该选择、不新增 Work website snapshot、不把 website 加到 List/Detail，也不为终态发明新语义。
- 相关既有 Workspace 断言保留为回归；若未来要求 Work-owned frozen website，必须先单独修改权威数据/合同，不在本 Task 猜测。

## 5. OpenAPI error matrix

| Surface | 已证实 runtime | 当前 OpenAPI | 目标 OpenAPI | 本 Task 动作 |
| --- | --- | --- | --- | --- |
| List `GET /api/v1/publication-works` | `200`; `401` 无效会话；`403` 受限临时密码会话；`409` latest event 或 identity context 不完整；`422` 非法分页/status/UUID | `200/401/422` | `200/401/403/409/422` | 增加共享会话 runtime 已存在的 `403` 与 F-15 要求的 `409`，均引用 `ErrorResponse` |
| Detail `GET /api/v1/publication-works/{work_id}` | `200/401/403/404/409/422` | `200/401/403/404/409/422` | 不变 | Contract assertion 冻结现状 |
| Workspace `GET /api/v1/publication-works/{work_id}/workspace-context` | `200/401/403/404/409/422` | `200/401/403/404/409/422` | 不变 | Contract assertion 冻结现状 |

`403` 的 List 缺口来自与 Detail/Workspace 相同的 `CurrentUser -> _resolve_current_session()` runtime 路径；补这一行不改变权限或运行时，只避免在“合同一致”目标下留下已确认的第二个响应遗漏。

## 6. Regression design

| Requirement | 最小证据 |
| --- | --- |
| 非终态 live rename | PostgreSQL 集成：创建 `PREPARING` Work，修改 Profile name、Account label/identifier，分别读取 List/Detail/Workspace，断言三者同值且为新 live 值 |
| 非终态 live 缺失 | Unit：构造非终态共享 projection row 的缺失 identity，直接断言 `_work_list_item()` 抛出 code/status 精确的 AppError；数据库约束本就禁止合法写入 dangling live lineage，不绕过约束造假 |
| `COMPLETED` / `CLOSED` frozen | PostgreSQL 集成：分别完成与关闭 Work，记录 snapshot，live rename 后读取三 surface；合法删除 live Account/Profile 后再次读取，断言三个字段仍等于 snapshot、live IDs 可为 `null` |
| 三 surface 对称 | 同一集成测试用一个 assertion helper 比较 List item、Detail、Workspace `work` 及 `platform.name`，不复制三套业务规则 |
| List malformed runtime 409 | PostgreSQL 中直接创建合法 Work row 但不创建 latest event，通过真实 FastAPI GET 调用 List，断言 HTTP 409、`error.code == PUBLICATION_CONTEXT_INCOMPLETE`、存在 request ID |
| Error contract | Unit 读取冻结 OpenAPI，断言三个 GET 的精确 response set 与 `ErrorResponse` 引用；运行既有 runtime/frozen contract checker |
| Bounded query count | 扩展现有 list 1/2 行固定 4 queries 断言；为 Workspace 增加多条事件/核验历史后仍为 5 queries，证明新状态选择没有 N+1 |

## 7. Exact implementation whitelist

### Production and contract

1. `backend/app/services/publication_queries.py`
2. `contracts/openapi.yaml`
3. `frontend/src/shared/api/schema.d.ts`（只由生成命令更新）
4. `frontend-v2/src/shared/api/generated/schema.d.ts`（只由生成命令更新）

### Tests

5. `backend/tests/unit/test_security_and_publication.py`
6. `backend/tests/unit/test_contract.py`
7. `backend/tests/integration/test_publication_workflow.py`

### Documentation and Task artifacts

8. `docs/frontend-v2/07-migration-plan.md`（实施验证成功后只追加 F-14/F-15 关闭记录，Phase 4 仍不得标 `MET`）
9. 本 Task 的 `prd.md`、`design.md`、`implement.md`

明确不改：`backend/app/routers/publication.py`、`backend/app/schemas/publication.py`、`backend/app/models/publication.py`、`backend/app/services/publication.py`、`contracts/database.md`、数据库 migration、两套前端生产代码及前端测试。实施若证明必须越过白名单，应停止并重新取得批准。

## 8. Compatibility and risks

- DTO 字段与成功响应 shape 不变；变化只影响字段来源和 List 声明的错误 union。
- 非终态损坏数据将从静默 snapshot 显示改为显式 409，这是要求内的 fail-closed 行为，不保留兼容 fallback。
- SQL `case` 在既有主查询中计算，不引入额外 round trip；主要回归风险是状态条件写反，由 live/terminal 对称集成测试直接覆盖。
- V1/V2 都已经使用结构化错误通道；不需要页面兼容逻辑。生成类型与双 typecheck 足以验证响应声明变化。

## 9. Rollback point

- 规划基线：`main` commit `01de56b7ae85047af16bd28015cf4a13dd29c053`；创建 Task 前工作树干净。
- 实施是纯 read-model/OpenAPI/生成类型变更，没有 migration、数据回填或状态写入，因此回滚只需把上述白名单作为一个一致单元恢复到实施前内容。
- 不使用 feature flag、双投影、兼容 alias 或 snapshot fallback 作为回滚机制。生成结果若出现白名单外漂移，停止而不是接受机械噪声。

## 10. Rejected alternatives

- 三个 endpoint 各自判断状态：会制造三套规则和回归面。
- 保留 `coalesce` 再在前端修正：无法区分权威来源，并继续隐藏 lineage 损坏。
- 新增 projection service/DTO：现有 owner 已完整覆盖三个 surface，没有第二抽象的必要。
- 新增 website snapshot 或 fallback：没有 Work-owned 权威合同，属于数据合同扩张。
