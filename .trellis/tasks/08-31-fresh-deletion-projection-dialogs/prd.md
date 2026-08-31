# Frontend V2 删除投影 Dialog 实时一致性

## Goal

统一 Platform Profile、Platform Type、Platform Account 和 User 的删除条件/删除确认 Dialog 状态所有权：删除 Dialog 本地只保存稳定对象 ID、命令类型和 `focusReturn`，所有业务资格、展示字段与提交参数始终从该页面当前活动 TanStack Query 的最新服务端 projection 派生。

本 Task 是 `frontend-v2-functional-contract-conformance-baseline` 的独立后续 Task，唯一可评审目标是：**Dialog 只保存稳定 ID，所有业务资格和提交参数从最新服务端 query projection 派生。**

## Authoritative Inputs

- 根 `AGENTS.md`、`.trellis/workflow.md` 与相关 `.trellis/spec/`。
- 父 Task 的 `prd.md`、`design.md`、`implement.md` 和 `research/route-conformance-matrix.md`。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`、`04-design-system-and-interaction-spec.md`、`05-business-actions-state-and-api-contract.md`、`06-code-architecture-and-project-structure.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md`。
- `contracts/openapi.yaml` 及当前 generated client。
- 四个目标页面、对应 model/API/query options/component tests、四个 Playwright spec/fixture，以及 `RowActions`、Dialog、focus return、409 reload 的现有模式。
- 本 Task 的 `research/deletion-dialog-live-projection-audit.md`。

## Confirmed Problem

四类页面的表格或 Accounts tab 已由 TanStack Query持有最新服务端 read model，但删除 Dialog 仍保存点击时的完整 row 对象：

- Platform Profile blocker state 保存完整 `PlatformProfile`；DELETE 还依赖 `RowActions` 打开时保存的静态 confirmation presentation。
- Platform Type 的 conditions/delete target 保存完整 `PlatformType`，delete Dialog 又保存一份 `canonical` 对象。
- Platform Account 的 blocker/command target 保存完整 `PlatformAccount`，command Dialog 又保存一份 `account` 对象。
- User 的 blocker/delete 与非删除命令共用保存完整 `User` 的 `CommandTarget`。

窗口聚焦、显式 refetch、mutation invalidation 或其他 query cache 更新后，表格行可以得到新名称、revision、`primary_task`、`available_actions` 与 `deletion`，但已打开 Dialog 仍显示和提交旧快照。删除资格撤销后可能继续确认，blocker 清除后仍显示旧条件，目标离开当前筛选/分页或被删除后仍可能保留可执行 Dialog。

OpenAPI 已经在四类 query response 中提供 `id/name-or-label/revision/primary_task/available_actions/deletion`，DELETE 也已经要求 `expected_revision`。问题只在前端状态所有权和测试，不需要改变公共合同或服务端。

## Requirements

1. 四类删除条件与删除确认 Dialog 的业务本地 state 必须统一为 `{ id, command, focusReturn }`。不得保存完整 `PlatformProfile`、`PlatformType`、`PlatformAccount`、`User`，不得保存其名称、revision、deletion、blockers、primary task 或 action projection 副本。
2. 每个 Dialog 的对象名称、revision、`deletion.blockers`、`primary_task` 和 `available_actions` 必须从当前页面当前活动的权威 query result 按 ID 派生：Platform List query、Platform Types query、当前 Platform 的 Accounts query、当前 Users list query。不得跨筛选/分页 cache 找对象，也不得增加逐行 detail query。
3. Platform Accounts query 必须与另外三个 owner 一样使用 `refetchOnWindowFocus: 'always'`，确保跨标签页修改后重新聚焦会真实回读。不得增加轮询、全局 store、BroadcastChannel 或第二份 cache。
4. Platform Profile DELETE 必须离开 `RowActions` 的静态 confirmation，改用 custom Dialog；Platform Account/User 只拆分删除家族 intent，非删除 edit/status/reset/bulk 不做全面重构。
5. Dialog 打开期间，query cache 或 query result 更新后必须在同一次 React render 中采用最新 projection。名称和 revision 更新时立即显示新值；`DELETE + 空 blockers` 与“无 DELETE + 非空 blockers”之间必须双向转换，原始命令不得锁死 Dialog surface。
6. 最新 projection 不再允许 DELETE 时，确认按钮必须立即不可用；有 blockers 时转换为最新 blocker surface，无 blockers或权限不再投影删除能力时显示当前不可执行状态或安全关闭。不得从旧 blocker 数量、role、status、`is_active`、`account_type` 或错误码恢复资格。
7. 最新成功 query 中不再包含目标 ID 时，必须清理 deletion intent 并关闭 Dialog；不得回退旧快照或其他 query key。筛选、分页、外部删除、权限投影变化与本页删除成功都适用。query refetch 失败但保留旧 cache data 时，Dialog 不得把旧 data 当 fresh canonical projection执行删除。
8. 每次用户点击确认时，必须在调用 mutation 前从当前活动 query 的精确 cache key 重新解析目标并复核最新删除 projection。DELETE helper 只接收当前 `{ id, expectedRevision }`；测试必须断言实际 request 参数使用 query 更新后的 revision，而不只断言按钮文案。
9. 不得在首次确认前为了获取 revision 自动发起 GET 并串联 DELETE。首次确认使用当前 cache；服务端仍在命令边界最终复核。mutation pending 后该次 `{ id, expectedRevision }` 固化为请求变量，随后 query 更新不改写在途请求。
10. 任意删除 409 都必须展示现有结构化错误与 `request_id`，冻结该次旧确认并禁止自动 retry/replay。后台 focus refetch 可以更新展示，但不能自行解除 409 freeze；只有用户触发的显式 reload 成功后才能清除 mutation error并按最新 projection重新确认、转换 blocker 或关闭。
11. 显式 reload 必须检查 query observer 结果确实成功。refetch 失败且同时保留旧 cache data 时，不得声称加载成功、不得采用旧 revision、不得解除 409 freeze。reload 成功后也不得自动调用 DELETE。
12. `focusReturn` 必须与业务对象状态分离。ALLOWED↔BLOCKED surface 转换保持同一焦点返回点；普通关闭时恢复仍连接的原触发器；目标消失时不得聚焦断开节点或猜测相邻业务行，应使用既有稳定页面 fallback或交回 Dialog primitive。
13. 现有 domain action/projection validator、query keys、consumer invalidation、结构化错误 parser 与 request ID 文案继续作为权威 owner；未知 token 和矛盾 projection继续显式失败。不得建立跨 domain 通用 Dialog 框架、第二类型系统或全局 invalidation registry。
14. Platform Profile、Platform Type、Platform Account、User 各自必须有针对其独立 query owner 的 component 回归。Playwright 使用现有 production-artifact fixture，以代表性场景证明 Dialog 打开后 projection 更新、最新 revision request、禁止陈旧提交和 focus行为。
15. 实施时同步修正与本不变量直接冲突的稳定 Trellis/frontend 文档措辞：首次 DELETE 采用当前 query projection；一旦 409，只有显式 reload 才能解除 freeze且绝不 replay。不得把该文档同步扩成其他命令的 live-baseline 重构。

## State and Ownership Matrix

| 对象 | 权威 query owner | deletion intent | query 更新后的目标规则 | DELETE request source |
| --- | --- | --- | --- | --- |
| Platform Profile | 当前 `platformListQueryOptions(search)` | `{ id, command, focusReturn }` | 只在当前筛选/分页 items 中解析 | 当前 list cache 的 `id/revision` |
| Platform Type | `platformTypeListQueryOptions()` | `{ id, command, focusReturn }` | 只在 types items 中解析 | 当前 types cache 的 `id/revision` |
| Platform Account | 当前 Platform 的 `platformAccountsQueryOptions(platformId, active)` | `{ id, command, focusReturn }` | 只在当前 Accounts tab items 中解析 | 当前 accounts cache 的 `id/revision` |
| User | 当前 `userListQueryOptions(search)` | `{ id, command, focusReturn }` | 只在当前筛选/分页 items 中解析 | 当前 users list cache 的 `id/revision` |

## Projection Transition Matrix

| 最新服务端 query projection | Dialog 结果 | 网络行为 |
| --- | --- | --- |
| `DELETE` 存在，`deletion.blockers=[]` | 显示最新名称与 revision 的确认 surface | 仅用户再次点击才 DELETE |
| `DELETE` 撤销，blockers 非空 | 立即转换为最新 blocker surface | 不 DELETE |
| blockers 清除且 `DELETE` 恢复 | 立即转换为确认 surface | 不自动 DELETE |
| 无 DELETE、无 blocker / actor-aware 权限不再提供删除 | 显示当前不可执行资格或安全关闭 | 不 DELETE |
| query 正在 refetch | 同步中并禁用确认 | 等待 GET，不 DELETE |
| query/refetch 失败且保留旧 data | 显式刷新错误 surface；旧 data 不可提交 | 只有用户 reload 才 GET |
| 最新成功 items 不含 ID | 清理 intent、关闭 Dialog | 不 DELETE |
| DELETE 返回任意 409 | 保留错误/request ID，冻结旧确认 | 无 retry/replay；显式 reload 只 GET |

## Non-goals

- 不包含 Query Topic Dialog；它属于后续 `query-topic-dialog-live-projection`。
- 不处理 Product 和 ContentTask blocker 导航合同。
- 不全面重构非删除类编辑、启停、reset 或 bulk command；仅在共享 target 中做完成删除 intent 分离所需的最小改动。
- 不修改 backend、`contracts/openapi.yaml`、generated client、数据库、迁移或生产数据。
- 不新增全局 store、轮询、BroadcastChannel、逐行 detail 请求、通用 deletion/Dialog 框架或第二份业务 cache。
- 不处理 `configuration-secondary-stale-state` 的整区 cached-error presentation；只保证删除 Dialog 不会在无法确认 fresh projection 时执行。
- 不调整视觉风格、品牌、配色或动效，不做无关重构。
- 本规划阶段不实施修复，不运行 `task.py start`，不提交、不推送。

## Acceptance Criteria

- [x] AC-01：Platform Profile、Platform Type、Platform Account、User 的删除条件/删除确认 state 均只保存稳定对象 ID、删除命令和 `focusReturn`；代码搜索与 component test 证明不存在完整业务对象 target、`canonical` 或 Dialog 内对象副本。
- [x] AC-02：四个 Dialog 展示的名称、`deletion.blockers`、`primary_task`、`available_actions` 与 revision 均来自当前活动 query data；不从打开时快照、role、status 或 blocker count 推导资格。
- [x] AC-03：Platform List、Platform Types、Users 保持 `refetchOnWindowFocus: 'always'`，Accounts 增加同一策略；测试模拟失焦、服务端 projection 变化、重新聚焦并断言发生新 GET。
- [x] AC-04：Dialog 打开后模拟 focus refetch 或 QueryClient cache 更新，界面立即显示最新名称、blocker count 与动作 projection。
- [x] AC-05：最新 deletion 从可删除变为 blocked 时，确认 surface 立即转换为最新 blocker surface或确认按钮不可用；不得继续提交旧 DELETE。
- [x] AC-06：最新 deletion 从 blocked 变为可删除时，Dialog 只依据最新 `available_actions` 与 `deletion` 转换为确认 surface；不得自动发 DELETE。
- [x] AC-07：最新 `available_actions` 撤销 DELETE 且没有 blocker时，Dialog 明确显示当前不可执行资格或关闭；不得用旧命令、角色、状态或错误码补出 DELETE。
- [x] AC-08：四个删除 mutation 都使用确认动作发生时当前 query projection 的 revision；component 与 Playwright request capture 必须断言更新后的 `expected_revision`，不只检查文案。
- [x] AC-09：确认事件在最新 target 缺失、query 正在刷新、query/refetch error、DELETE token 缺失或 blockers 非空时不会调用 DELETE helper。
- [x] AC-10：目标从最新成功列表消失，或当前 canonical scope 因筛选/分页切换后不再包含目标时，Dialog 被清理且不能在切回旧 cache key后自行重开。
- [x] AC-11：任意删除 409 展示服务端 code/message/request ID，确认立即冻结；窗口聚焦或 cache 更新不会解冻，显式 reload前 DELETE 请求数保持 1。
- [x] AC-12：显式 reload 失败时保留 409 freeze和原 request ID，不把旧 cache data当成功；reload 成功后按最新 projection转换/关闭，DELETE 请求数仍保持 1，只有用户重新确认才增加。
- [x] AC-13：409、focus refetch、mutation invalidation、目标消失和 ALLOWED↔BLOCKED 转换均不得自动 replay DELETE。
- [x] AC-14：Dialog 手动关闭及 projection 转换后，目标仍存在时焦点回到原触发器；目标已消失时不聚焦断开节点，并使用既有稳定 fallback或安全默认焦点。
- [x] AC-15：Platform Profile、Platform Type、Platform Account、User 各有 component 回归覆盖其独立 query key；至少一个测试对同 revision仅改变 blockers/actions，证明资格不依赖 revision 漂移。
- [x] AC-16：四个 Playwright fixture 能受控修改同一目标 projection、移除目标并捕获 DELETE revision；E2E 代表性覆盖 Dialog 打开后 projection 更新、禁止陈旧提交、409 no-replay/request ID与焦点恢复。
- [x] AC-17：现有精确 blocker 链接、request ID 展示、consumer invalidation、页码回退、CSRF、响应式 table/card、未知 projection 显式失败和 409 不重放合同不回归。
- [x] AC-18：不新增前端权限、status 或 blocker 资格推导，不新增轮询、全局业务状态、跨 key cache fallback或通用 Dialog 框架。
- [x] AC-19：OpenAPI、generated client、backend、数据库和生产数据无变更；`npm --prefix frontend run api:check` 通过。
- [x] AC-20：实现只触及本 Task 列出的删除 owner、必要 API helper签名、定向测试/fixture和直接冲突文档；既有脏文件与 artifacts 不进入 diff或提交。

## Review Gate

本文件、`design.md`、`implement.md` 与审计研究通过人工 review 后，才能运行 `task.py start`。用户明确批准前，本 Task 保持 `planning`；`v2-live-readonly-acceptance` 保持 `in_progress`，父 `frontend-v2-functional-contract-conformance-baseline` 不归档、不改变状态。
