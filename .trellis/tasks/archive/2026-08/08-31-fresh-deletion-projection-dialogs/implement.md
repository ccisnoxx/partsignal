# Frontend V2 删除 Dialog 最新投影实施计划

## Scope

本计划只统一 Platform Profile、Platform Type、Platform Account 和 User 的删除条件/删除确认 Dialog 状态所有权。删除 intent 只保存 ID、命令与 `focusReturn`，业务展示、资格与 DELETE revision 从当前权威 query projection 派生。

本计划已获用户批准并完成实现与 required validation；当前等待提交计划确认。Task 保持 `in_progress`，不得归档父 Task 或 `v2-live-readonly-acceptance`，不得修改 backend、OpenAPI、generated client、数据库或生产数据，不得纳入既有脏文件/artifacts。

## Phase A：启动门禁与失败基线

- [x] 开始实施前再次确认主工作目录位于 `main`；记录全部既有 dirty/untracked文件并与本 Task touched scope隔离。
- [x] 读取本 Task 的 `prd.md`、`design.md`、本文件、research、`implement.jsonl`/`check.jsonl`注入上下文；另完整读取体积过大而未自动注入的 `.trellis/spec/frontend/state-management.md`，并确认父 Task仍为 planning、`v2-live-readonly-acceptance`仍为 `in_progress`。
- [x] 运行用户批准后的 `python3 ./.trellis/scripts/task.py start .trellis/tasks/08-31-fresh-deletion-projection-dialogs`；在批准前不得执行。
- [x] 在四个现有 page component test中分别增加最小失败复现：Dialog打开后 current query更新，但 Dialog仍显示/提交旧 row snapshot。
- [x] 对每个失败复现同时冻结 GET/DELETE调用次数和 `expected_revision`；测试不得只检查按钮文案。

## Phase B：API 与 query owner收窄

- [x] 在 `platform.api.ts` 将 Platform Profile、Platform Type、Platform Account 的 delete helper改为接收显式 `{ id, expectedRevision }`；enable/disable/update helper保持现有 baseline。
- [x] 在 `user.api.ts` 将 `deleteUser` 改为接收显式 `{ id, expectedRevision }`；edit/reset/status/bulk helper不改。
- [x] 给 `platformAccountsQueryOptions` 增加 `refetchOnWindowFocus: 'always'`，不改 staleTime、不加 polling、不改全局 QueryClient。
- [x] 保持 Platform List、Platform Types、Users既有 focus-always配置和 exact query keys；不得增加 detail query或跨 key cache fallback。
- [x] 检查 delete helper调用者，确保只有本 Task四类 deletion owner受签名影响，不创建完整 DTO兼容 overload或 silent fallback。

## Phase C：Platform Profile deletion intent

- [x] 在 `platform-list.model.ts` 将 DELETE action改为 `confirmation: 'custom'`；保留服务端 token/矛盾 projection显式校验，不把 name/account count固化到 RowActions pending presentation。
- [x] 在 `platform-list-page.tsx` 用 `{ id, command, focusReturn }` 替换删除 blocker完整对象 state，并新增同一 deletion intent驱动的确认 surface。
- [x] 每次 render从当前 `platformListQueryOptions(search)` result按 ID解析 Profile；name/account count/revision/primary/actions/deletion全部来自 current target。
- [x] 确认事件从 exact list cache重新解析并验证 target；只有 query fresh、DELETE存在、blockers为空、无409 freeze时才用当前 revision调用 delete helper。
- [x] 保留 enable Dialog、status命令、consumer invalidation、detail/accounts cache remove、最后一行页码回退和 request ID Notice。
- [x] 任意删除409保持一次请求、冻结确认并提供显式当前列表 reload；passive invalidation/refetch只更新展示，不清 freeze、不 replay。
- [x] search/page/pageSize scope变化与最新 items移除目标时清 deletion intent；关闭焦点优先原 trigger，断连时安全 fallback。

## Phase D：Platform Type deletion intent

- [x] 保留 Editor target/form baseline，只将 conditions/delete target收敛为 `{ id, command, focusReturn }`。
- [x] 删除 `PlatformTypeDeleteDialog` 的完整 `canonical` state；conditions/delete两个 surface始终读取 types query当前 target。
- [x] 保留 existing projection validator、PlatformProfile blocker link、`PLATFORM_TYPE_IN_USE` details与三类 consumer invalidation。
- [x] 修改显式 reload：检查 `types.refetch()` 的 error和data，成功后按 ID解析；只在成功后 reset mutation freeze，不把 fresh对象存入 Dialog。
- [x] 覆盖可删除↔blocked双向转换、最新 name/revision、目标消失、任意409 no replay和 lazy focus return。

## Phase E：Platform Account deletion intent

- [x] 保留 Account Editor与 enable/disable command target；从共享 target中拆出 deletion intent，删除 blocker/confirm不再持有完整 Account。
- [x] 删除 `PlatformAccountCommandDialog` 中仅为 delete保存的 account副本；若 status commands仍复用该 Dialog，确保删除分支独立读取 live target且不扩大 status baseline重构。
- [x] current target只从 `platformKeys.accounts(platformId)`读取；不得从 Platform Detail或Publication queries拼资格。
- [x] 修正删除显式 reload：accounts refetch有 error时失败，即使旧 data存在；success data按 ID解析后才 reset 409 freeze。
- [x] `PLATFORM_ACCOUNT_IN_USE`、`REVISION_CONFLICT`及其他删除409统一保留 ErrorEnvelope/request ID、禁用旧确认并显式 reload；不改变 enable/disable的既有错误范围。
- [x] 目标消失/Accounts tab卸载时清 deletion intent；普通取消回原 row trigger，行消失时回既有 create trigger或安全默认。
- [x] 不顺带修复 Accounts整区 cached refetch error presentation；只保证删除 Dialog在 query error时不可执行。

## Phase F：User deletion intent

- [x] 保留 edit/reset/status `CommandTarget`、bulk selection与secret lifecycle；从共享 target中拆出 delete/blocker intent。
- [x] User deletion Dialog按当前 Users list items解析 ID，实时读取 username/display name/revision/primary/actions/deletion；Audit链接只使用 live ID。
- [x] 以 latest `available_actions/deletion`双向转换 blocker/confirm；用同 revision改变动态业务引用时也必须更新资格。
- [x] 确认事件从当前 exact users list cache重新解析并调用窄 delete helper；不跨其他筛选/分页 cache找 User。
- [x] `REVISION_CONFLICT`、`USER_IN_USE`、`USER_ACTIVE`及其他删除409统一 freeze、显式 reload、request ID/no replay。
- [x] current search key变化、最新 items移除目标、query 401/403或后台 refetch error时，清理或禁用 deletion surface；旧 ADMIN cache不得继续执行 DELETE。
- [x] 目标仍存在时恢复真实 trigger；目标消失或权限 surface替换时不聚焦断开节点、不猜相邻行。

## Phase G：component / model回归

- [x] `platform-list-page.test.tsx`：cache/focus更新 name/revision；DELETE→blocker；最新 revision query参数；target missing；409 freeze/reload/no replay；focus。
- [x] `platform-types-page.test.tsx`：blocker→DELETE与DELETE→blocker；current href/count/name/revision；target missing；reload failure不采用旧 cache；request ID/focus。
- [x] `platform-workspace-page.test.tsx`：Accounts focus always真实增加 GET；live label/revision/actions；delete409与非 revision blocker409；reload error有旧 data仍冻结；target missing/focus。
- [x] `user-list-page.test.tsx`：同 revision动态 blockers/actions变化；delete latest revision；目标/scope消失；409 freeze与显式 reload；401/403 stale-data不可执行；focus。
- [x] 对应四个 model test继续覆盖未知 token、重复 action、DELETE/deletion矛盾；仅在 model action shape变化时做最小更新。
- [x] 每个测试结束恢复 `focusManager`及 QueryClient状态，防止跨测试泄漏；不通过修改测试放宽服务端 projection合同。

## Phase H：Playwright fixtures 与 E2E

- [x] `platforms.fixture.ts` 增加按 Profile ID更新projection、移除目标、一次性删除409与DELETE request capture；未声明 API仍失败。
- [x] `platform-types.fixture.ts` 在既有 conflict/block injection上增加通用按 ID更新/remove能力；保留精确 request ID与revision capture。
- [x] `platform-workspace.fixture.ts` 增加 Accounts GET计数、按 Account ID更新/remove、delete409与revision校验；不得让 profile detail假装账号 projection owner。
- [x] `users.fixture.ts` 增加按 User ID更新/remove与delete409；保留敏感字段/未声明请求哨兵，不把 reset conflict泛化成固定成功。
- [x] `platform-list.spec.ts` 覆盖 Dialog打开后projection更新、旧 DELETE被禁止及最新 revision request。
- [x] `platform-types.spec.ts` 覆盖 ALLOWED↔BLOCKED、409 request ID/no replay、explicit reload和focus。
- [x] `platform-workspace.spec.ts` 覆盖独立 Accounts GET在focus后更新，删除使用该 owner最新 revision，目标消失不保留可执行Dialog。
- [x] `system-users.spec.ts` 覆盖动态 blocker/update或delete409代表性场景、显式 reload、无 replay、focus；不得宣称 fixture是real-stack。

## Phase I：规范与文档同步

- [x] 更新 `.trellis/spec/frontend/state-management.md` 的 Account删除与跨标签页投影段落：删除 Dialog首次确认取当前 query projection；409后仍必须显式 reload且不 replay。非删除 edit/status baseline不变。
- [x] 更新 `.trellis/spec/backend/available-actions-contract.md` 的 Platform/User示例，区分“读取当前 cache revision”与“点击确认后自动 GET+DELETE”；保留服务端最终权威和409 no replay。
- [x] 只更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md`、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md` 中被 live deletion Dialog直接改变的说明；若复核后现有措辞已兼容，则在 closeout说明无需改动的依据。
- [x] 不修改 `contracts/openapi.yaml`、generated schema、backend、database docs或其他后续 Task设计。
- [x] 对 touched TypeScript/tests/spec/docs执行中文注释、错误、developer-visible text检查；只给非显然状态转换/409边界增加必要中文说明。

## Required Validation

实现完成后必须从仓库根目录执行以下命令。失败时只修复能归因于本 Task的问题：

```bash
npm --prefix frontend run test -- \
  src/domains/configuration/platform-list-page.test.tsx \
  src/domains/configuration/platform-list.model.test.ts \
  src/domains/configuration/platform-types-page.test.tsx \
  src/domains/configuration/platform-types.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/identity/user-list-page.test.tsx \
  src/domains/identity/user-list.model.test.ts

npm --prefix frontend run e2e -- \
  tests/e2e/platform-list.spec.ts \
  tests/e2e/platform-types.spec.ts \
  tests/e2e/platform-workspace.spec.ts \
  tests/e2e/system-users.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop

npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run api:check

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-31-fresh-deletion-projection-dialogs

git diff --check
! rg -n '[[:blank:]]+$' \
  .trellis/tasks/08-31-fresh-deletion-projection-dialogs \
  frontend/src/domains/configuration/platform-list-page.tsx \
  frontend/src/domains/configuration/platform-list.model.ts \
  frontend/src/domains/configuration/platform-types-page.tsx \
  frontend/src/domains/configuration/platform-workspace-page.tsx \
  frontend/src/domains/configuration/platform.api.ts \
  frontend/src/domains/identity/user-list-page.tsx \
  frontend/src/domains/identity/user.api.ts \
  frontend/tests/e2e/platform-list.spec.ts \
  frontend/tests/e2e/platform-types.spec.ts \
  frontend/tests/e2e/platform-workspace.spec.ts \
  frontend/tests/e2e/system-users.spec.ts
```

验证意图：八个定向 Vitest证明四个独立 query owner、projection validator与request revision；四个 Playwright spec在两个现有 viewport project中证明 production artifact的Dialog/query/focus/request行为；typecheck/lint/build证明静态与production artifact；`api:check`证明公共合同无漂移；Trellis/diff/whitespace检查证明规划、代码与touched scope一致。

默认 Playwright配置会运行 `npm run build` 后启动 Vite preview；单独保留 build gate，以便 `PARTSIGNAL_E2E_BASE_URL` 被设置时仍独立证明构建。两个合法 project只有 `foundation-mobile` 与 `foundation-desktop`，不得使用不存在的 `--project=e2e`。

## Optional Full-suite Validation

以下重型检查不作为此前端局部状态所有权修复的默认关闭条件；准备发布、触及共享 `RowActions`/Dialog primitive或用户要求全量门禁时再执行：

```bash
npm --prefix frontend run test
npm --prefix frontend run e2e
make contract-check
make verify
```

跳过理由：本 Task不修改backend、公共API、数据库或共享基础设施；required validation已覆盖全部四个目标页面、对应model、四个production-artifact E2E与生成合同一致性。残余风险是其他domain的全量前端与real-stack回归，仅由release gate关闭。

## Observed Validation（2026-08-31）

- 定向 Vitest：`8 files / 62 tests passed`。
- production-artifact Playwright：四个 spec、`foundation-mobile` 与 `foundation-desktop` 共 `54 passed`。
- `typecheck`、`lint`、`build`、`api:check` 均以退出码 0 通过；build 仅保留既有 `markdown-editor` chunk size warning。
- Trellis context validate、`git diff --check` 与 touched-scope trailing whitespace 检查通过。
- Optional 全量 frontend/real-stack/repository gate 按本计划跳过；残余风险仅为未覆盖 domain 的 release-level 全量回归，不改变本 Task 定向证据。

## Diff 与完成审查

- [x] 检查 diff，确认没有完整删除 target DTO、Dialog canonical副本、旧 blocker/status/role资格推导、自动 GET+DELETE、409自动解冻/replay、跨 key cache fallback、全局 store或generic deletion framework。
- [x] 确认 Platform Profile/Type/Account/User四个DELETE payload都由当前 query cache revision生成；测试断言实际参数。
- [x] 确认 focus return与业务 target分离，断开节点不会被聚焦，ALLOWED↔BLOCKED转换不会提前关闭Dialog。
- [x] 确认现有 consumer invalidation、request ID、精确 blocker链接、CSRF、页码回退、响应式surface和unknown projection显式失败未回归。
- [x] 确认 backend、OpenAPI、generated schema、数据库、生产数据、Query Topic/Product/ContentTask及既有 dirty/artifacts无 diff。
- [x] 报告 required validation实际结果、optional full suite是否跳过及残余风险；不得用未观察结果代替证据。
- [x] 非平凡 TypeScript改动完成 touched-scope中文文档检查，并在最终回复说明注释/docstring/developer-visible text的处理。
- [x] 提交前向用户展示精确 commit plan并等待确认；不得自动 commit或push。

## Review Gate

- [x] 用户明确批准本 PRD/design/implement后，才运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/08-31-fresh-deletion-projection-dialogs`。
- [x] 本 Task完成前不归档父 `frontend-v2-functional-contract-conformance-baseline`，不改变 `v2-live-readonly-acceptance` 的 `in_progress` 状态。
