# Frontend V2 Content Task Detail 历史平台 fixture

## Goal

修复 `test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count` 的测试数据构造：通过生产系统已有的合法平台删除生命周期形成 `ContentTask.platform_profile_id = NULL`，继续证明 Content Task Detail 在平台实体不存在后使用冻结 snapshot，同时不削弱数据库不可变守卫。

## Background and confirmed facts

- 基线为干净 `main` commit `d6d17296395204907b0662e17a4fd1ef449253bc`；刷新远端后 `origin/main...main = 0/82`，本地没有落后提交。
- PostgreSQL targeted test 已精确复现：测试在 `backend/tests/integration/test_content_task_detail.py:384` 提交 ORM `UPDATE content_tasks SET platform_profile_id=NULL`，`partsignal_guard_content_task_platform()` 以 SQLSTATE `55000` 和“内容任务平台不可原地修改”拒绝。
- `0025_markdown_facts_direct_platform` 建立任务平台身份不可原地修改规则；`0037_simplify_deletion_lifecycle` 将外键改为 `ON DELETE SET NULL`，并只允许 PostgreSQL 外键触发器在删除平台时为非 `OPEN` 任务受控解绑。
- `delete_platform_profile` 是生产平台删除命令：平台必须先停用，且不存在 `OPEN` ContentTask 或非终态 PublicationWork；命令删除 PlatformProfile 后由数据库外键/触发器把终态任务平台外键置空，snapshot 保持不变。
- 当前测试在历史平台断言前还创建了一个 `OPEN` repair task；它会正确阻止平台删除。该任务的来源投影断言完成后，可通过现有 `cancel_content_task` 合法转为 `CANCELLED`。
- `content_tasks_out` 在实时 PlatformProfile 不存在时返回 `platform.id = null`、snapshot name/website URL 和 `logo = null`；Content Task Detail 直接复用该投影。

## Why this state is required

Detail 测试需要“平台实体已经被合法物理删除、任务历史仍保留”的真实状态，才能区分实时平台投影与历史 snapshot fallback，并证明页面不会为失效配置返回可导航 ID 或已删除 Logo。

## In Scope

- 仅调整 `backend/tests/integration/test_content_task_detail.py` 的历史平台 fixture 构造。
- 在既有 repair source 断言后，使用现有内容任务取消命令终止 repair task。
- 使用现有平台启停命令和 `delete_platform_profile` 删除原平台，让数据库合法产生 `platform_profile_id = NULL`。
- 保留并继续断言：
  - `historical_platform.id is None`
  - `historical_platform.name == task.platform_profile_name_snapshot`
  - `historical_platform.logo is None`
- 保留 current pointer、source、Activity、fixed query count、HTTP 权限/404 和 `REPEATABLE READ` 等原测试目标。
- 只有全部 required validation（尤其 `make verify`）通过，才在 `docs/frontend-v2/07-migration-plan.md` 追加本修复证据并把当前 Phase 3 exit gate 判为 `MET`。

## Out of Scope

- 不修改 production read model、平台删除服务、数据库 schema/trigger/constraint、migration 或合同。
- 不修改 OpenAPI、frontend、frontend-v2、V1 或 Publishing 行为。
- 不直接 UPDATE `platform_profile_id`，不关闭或绕过 trigger，不使用 `session_replication_role`，不 defer constraint。
- 不删除历史平台场景，不新增依赖，不创建通用 integration fixture/helper/framework。
- 不改写归档任务或 `frontend-v2-content-abstraction-review` 当时的 `NOT_MET` 历史结论。

## Key decisions

1. **普通 ORM UPDATE 非法**：平台身份是冻结业务身份，数据库明确拒绝普通原地修改；测试不能比生产代码拥有更宽权限。
2. **合法生产路径**：停用平台后调用 `delete_platform_profile`；服务先检查活动业务，随后由 `ON DELETE SET NULL` 与受控 trigger depth 路径解绑非 `OPEN` 历史任务。
3. **复用服务而非直接受控 DELETE**：直接 `db.delete(profile)` 虽可能触发外键，但会跳过生产服务的停用、活动引用、审计和 Logo 生命周期检查；复用现有服务更小且不复制完整流程。
4. **处理 repair task 阻断**：来源 fallback 断言完成后调用现有 `cancel_content_task`，保留 repair task 历史并满足平台删除合同；不通过伪造状态或删除 fixture 绕过门禁。
5. **测试职责边界**：既有平台删除生命周期 integration test 已证明停用/阻断、终态任务与工作解绑、snapshot 保留；本 Detail 测试仍需证明该真实状态进入 Content Task Detail 后的 snapshot fallback，以及原有 pointer/source/Activity/query-count/事务隔离目标没有回归。

## Acceptance Criteria

- [ ] targeted test 不再执行或产生普通 `platform_profile_id` UPDATE。
- [ ] 平台通过现有取消、停用和删除服务形成真实历史状态，数据库不可变守卫保持原样。
- [ ] 删除后数据库中的目标 ContentTask `platform_profile_id` 为 `NULL`，PlatformProfile 不存在，snapshot 未改变。
- [ ] 三个历史平台 fallback 断言原样保留并通过。
- [ ] 原测试其余 pointer/source/Activity/fixed query count/HTTP/`REPEATABLE READ` 断言全部保留并通过。
- [ ] 单个 targeted test、整个 `test_content_task_detail.py`、既有平台删除生命周期 test、backend lint/typecheck、`make verify` 和 `git diff --check` 全部通过。
- [ ] 只有上一项全部成立时，迁移计划追加新证据并将**当前** Phase 3 exit gate 判为 `MET`；历史 `NOT_MET` 记录保持原样。
- [ ] 最终 diff 不包含 production、合同、schema、migration、frontend、V1、Publishing 或依赖变更。

## Open Questions

无。用户拥有的范围、风险、兼容性与 gate 决策均已明确。
