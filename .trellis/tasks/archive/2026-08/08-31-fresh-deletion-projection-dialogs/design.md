# Frontend V2 删除 Dialog 最新投影设计

## 1. 设计结论

四个页面不共享一个新的 Dialog 框架，而是在各自权威 query owner 内实现同一个状态不变量：删除 Dialog 的 intent 只保存稳定 ID、命令与焦点返回点；当前对象、当前删除 surface 和当前请求 revision 始终从该 owner 的最新 TanStack Query cache 派生。

删除确认不是打开时冻结的表单 baseline。Dialog 打开期间，服务端 projection可以通过窗口聚焦、显式 refetch、mutation invalidation 或 QueryClient 更新而变化；展示与资格必须随之变化。唯一需要冻结的是已经发出的单次 HTTP mutation variables，以及任意 409 后“必须显式 reload 才能再次确认”的恢复门禁。

## 2. 目标 owner

### 2.1 Platform Profile

- Query owner：`PlatformListPage` 的 `platformListQueryOptions(search)`。
- Exact key：该 options 的 `queryKey`，等价于 `platformKeys.list(platformSearchToApiParams(search))`。
- Local deletion state：一个 `PlatformDeletionIntent`，替换 `blockerTarget` 以及 RowActions 内建静态 DELETE confirmation。
- 保留：现有 `enableTarget`、status mutation、list/detail/accounts consumer invalidation、页码回退。

### 2.2 Platform Type

- Query owner：`PlatformTypesPage` 的 `platformTypeListQueryOptions()`。
- Exact key：`platformKeys.types()`。
- Local deletion state：一个 `PlatformTypeDeletionIntent`，替换 `conditions`、`deleteTarget` 中的完整对象和 Delete Dialog 内 `canonical` state。
- 保留：Editor 的 form baseline、三类 consumer invalidation、blocker canonical URL。

### 2.3 Platform Account

- Query owner：Accounts tab 内的 `platformAccountsQueryOptions(platformId, active)`。
- Exact key：`platformKeys.accounts(platformId)`。
- Local deletion state：从 `AccountCommandTarget`/`AccountBlockerTarget` 拆出的 `AccountDeletionIntent`。
- 保留：Account Editor、enable/disable command target与既有 publication consumer invalidation；不得从 Platform Detail 派生账号删除资格。
- Query options 增加 `refetchOnWindowFocus: 'always'`。这只补齐既有人工跨标签页流程，不增加轮询。

### 2.4 User

- Query owner：`UserListPage` 的 `userListQueryOptions(search)`。
- Exact key：该 options 的 `queryKey`，等价于 `userKeys.list(userSearchToApiParams(search))`。
- Local deletion state：从共享 `CommandTarget` 拆出的 `UserDeletionIntent`。
- 保留：edit、reset、enable/disable、bulk selection 与 secret lifecycle；不得查询 User Detail 或 Audit补 projection。

## 3. 本地状态模型

每个 domain 使用本地窄类型，不建立泛型框架：

```ts
type DeletionCommand = 'view-delete-conditions' | 'delete';

type DeletionIntent = {
  id: string;
  command: DeletionCommand;
  focusReturn: HTMLElement | null;
};
```

各页面保留自己的真实 command literal，例如 `delete-platform-type`、`view-account-delete-conditions`、`delete-user`，避免创建第二套跨 domain command enum。

intent 的 `command` 只记录用户入口与审计/测试语义，不冻结 Dialog 形态。用户从“查看删除条件”打开后，最新 projection恢复 DELETE，Dialog 可以直接转换为确认；用户从 DELETE 打开后，最新 projection出现 blocker，Dialog 也必须转换为条件 surface。

以下内容不得进入删除 intent 或 Dialog `useState`：完整 DTO、对象名称、revision、`deletion`、blockers、`primary_task`、`available_actions`、platform/account counts、当前 surface 或 `canonical` 对象。

mutation 自己的 pending/error/variables 属于一次网络尝试的生命周期，不是第二份业务 projection。显式 reload 复用 query observer 状态，不新增 canonical object或 reload result副本。

## 4. 当前 projection 解析

每个页面在 render 时从当前 query data按 intent ID解析：

```tsx
const currentTarget = deletionIntent
  ? query.data?.items.find((item) => item.id === deletionIntent.id)
  : undefined;
```

解析只允许使用当前活动 exact query key：

- Platform/Profile 与 User 的筛选、分页 query改变后，不扫描 `platformKeys.lists()` 或 `userKeys.lists()` 下的旧 cache。
- Account 只读取当前 Platform 的 accounts key，不回退 Platform Detail、Publication ready items 或其他 Platform 的 Accounts cache。
- Type 只读取唯一 types key。

页面现有 action/projection validator仍先执行。合法 current target 再投影为以下 presentation-only surface；surface 不保存到 state：

```ts
type DeletionSurface =
  | { kind: 'confirm'; target: CurrentProjection }
  | { kind: 'blocked'; target: CurrentProjection }
  | { kind: 'unavailable'; target: CurrentProjection }
  | { kind: 'loading' }
  | { kind: 'missing' };
```

这不是第二套业务状态机：`kind` 只是由 query lifecycle 与服务端 `available_actions/deletion` 即时计算的 render 分支。

## 5. 删除 surface 判定

判定顺序固定为：

1. 没有 intent：不渲染 deletion Dialog。
2. 当前 query 正在 refetch：渲染同步中 surface，确认按钮不可用。
3. 当前 query error，包含“已有旧 data 的后台失败”：渲染不可执行刷新 surface；不得以旧 cache提交。
4. 最新成功 query 中 ID 不存在：进入 missing/关闭流程，清理 intent，禁止跨 key回退。
5. current target通过现有 validator后，最新 `available_actions` 包含 DELETE且最新 `deletion.blockers` 为空：confirm。
6. 最新 `available_actions` 不含 DELETE且最新 blockers 非空：blocked。
7. 其余 actor-aware 合法投影：unavailable，不补 DELETE。

若现有 model 判定为未知 token或自相矛盾 projection，继续走现有显式失败边界，不用 `unavailable` 隐藏合同错误。

`primary_task` 不用于推导 DELETE，但 Dialog 的“当前服务端资格”说明若展示 primary task，必须直接来自 current target并使用既有 registry；不得基于 role/status生成说明。

## 6. 状态转换

| 当前 surface | 事件 | 下一 surface / local state | 规则 |
| --- | --- | --- | --- |
| confirm | query 更新 revision/name，仍可删 | confirm | Dialog 不重挂载，立即显示新值 |
| confirm | DELETE 撤销且 blocker出现 | blocked | 确认按钮消失；不调用 mutation |
| confirm | DELETE 撤销且无 blocker | unavailable | 禁止确认，展示服务端当前不可执行资格 |
| blocked | blocker数量/类型变化 | blocked | 立即显示最新 blockers |
| blocked | blockers清除且 DELETE 出现 | confirm | 需要用户主动确认；不自动 DELETE |
| 任意 | refetch开始 | loading | 暂停确认，不清 intent |
| 任意 | refetch失败 | unavailable/error | 保留 intent/focus；旧 cache不可执行 |
| 任意 | 最新成功 items不含 ID | closed/missing | 清理 intent；不得在旧 key复现 |
| confirm | DELETE pending | pending confirm | 该次 request variables固定；禁止第二次点击 |
| pending | success | closed | 先完成既有 invalidation/页码/consumer行为，再清 intent |
| pending | 409 | frozen | 展示 ErrorEnvelope/request ID；确认禁用 |
| frozen | 被动 focus/cache更新 | 按最新 surface展示，但保持 frozen | 不自动解除、不 replay |
| frozen | 显式 reload失败 | frozen | 保留原 409/request ID；旧 cache不算成功 |
| frozen | 显式 reload成功 | current confirm/blocked/unavailable/closed | reset mutation error；不自动 DELETE |

## 7. action-time revision

render-time current target只负责展示。确认事件必须再次读取同一 exact query key，避免事件闭包持有上一次 render对象：

```ts
function confirmDeletion() {
  const queryState = queryClient.getQueryState(exactKey);
  const data = queryClient.getQueryData<CurrentList>(exactKey);
  const current = data?.items.find((item) => item.id === intent.id);

  if (!isFreshAndDeletable(queryState, current) || deletionMutationHas409) return;
  remove.mutate({ id: current.id, expectedRevision: current.revision });
}
```

`isFreshAndDeletable` 不成为共享业务 helper；各 domain复用自己的 projection validator，然后只检查最新 DELETE token与最新 blockers组合。query lifecycle guard也必须在事件内复核，避免 refetch刚开始时沿用旧 render状态。

四个 DELETE API helper收窄为显式参数：

```ts
type DeleteTarget = { id: string; expectedRevision: number };
```

- Platform Profile 的 status命令继续使用现有 `runPlatformCommand`；DELETE拆成自己的窄 helper或让该函数的 DELETE分支接收窄 variables，不能继续传完整 Profile。
- Platform Type、Platform Account、User 的 delete helper不再接收完整 DTO。
- mutation variables只固定该次请求的 ID/revision；不包含 name、deletion或actions。

确认时不得先 `refetch()` 然后自动 DELETE。服务端仍以该次 expected revision、权限与实时 blocker作最终裁决。

## 8. 409 与显式 reload

### 8.1 freeze owner

任意 domain request error只要 HTTP status为 409，就冻结当前 deletion mutation；不能只识别 `REVISION_CONFLICT`，因为 `PLATFORM_TYPE_IN_USE`、`PLATFORM_ACCOUNT_IN_USE`、`USER_IN_USE`、`USER_ACTIVE` 等竞态也会撤销删除资格。

freeze 由 deletion mutation的结构化 error派生，不保存额外 canonical对象。确认按钮条件必须同时要求：current surface为 confirm、query fresh、mutation不 pending、当前没有未解除的 409。

被动 query更新可以让 Dialog显示最新 blocker/name/actions，但不能调用 `mutation.reset()`，因此不能自动解冻。

### 8.2 explicit reload

四个页面的显式 reload都调用其当前 query observer的 `refetch()`：

1. 调用前不清除原 409 error/request ID。
2. 检查 `result.error`；存在 error时直接失败，即使 `result.data` 仍指向旧 cache。
3. 要求成功结果包含 data；否则显式失败。
4. 成功后按 ID从该响应解析 current target。
5. 只有完成上述步骤后才 `mutation.reset()`，解除 freeze。
6. current target缺失则清 intent并关闭；blocked/unavailable则展示当前资格；confirm也仍等待用户第二次点击。

Platform Account reload可以保留既有对 Platform Detail consumer的失效，但删除 target的权威解析只能来自 Accounts refetch结果。整区 cached-error surface的视觉处理仍留给 `configuration-secondary-stale-state`。

### 8.3 error contract

继续使用 `PlatformRequestError`/`UserRequestError` 中的 code/message/request ID，不新增 error envelope类型或字符串解析。现有 blocker-specific 409详情与精确链接保留；不自动重试 mutation。

## 9. scope、目标消失与权限

### 9.1 scope change

Platform/Profile 与 Users 的 canonical search变化前，页面自己的 filter/page handler先清 deletion intent。浏览器 Back/Forward或外部 route search更新时，以 exact query key变化为依赖清理 intent，避免切回旧 cache后 Dialog无用户操作地复现。

Accounts tab卸载会自然销毁 section state；同一 tab内最新 accounts result移除目标时仍需清 intent。Types没有分页 scope，只处理 items消失。

### 9.2 missing target

最新成功 query不含 ID时，render立即不再提供可执行 surface；随后清理 intent。关闭过程中仍使用 intent中独立保存的 focusReturn。不得显示旧名称、旧 revision或旧 blocker。

### 9.3 permission loss

若服务端返回当前对象但 actions/deletion被 actor-aware清空，surface为 unavailable。若 Users query因角色变化返回 401/403且保留旧 data，query error优先于旧 data，删除 Dialog不可执行并关闭/要求重新加载。完整 ADMIN route revalidation不在本 Task重构，但旧缓存不能继续支撑 DELETE。

## 10. focusReturn

`RowActions` 继续作为 command与真实触发器的交接 owner。Platform Profile DELETE改成 `confirmation: 'custom'` 后也通过同一路径得到 overflow trigger。

Dialog `finalFocus` 使用关闭时求值的函数，不把对象名称或 selector存进 intent：

1. `focusReturn?.isConnected` 时返回原元素。
2. 同一目标仍存在但 React替换了节点时，可复用已有 `resolveFocusReturn` 按原 aria-label寻找重建触发器的模式；解析只服务焦点，不参与业务对象查找。
3. 目标已删除或 scope变化时，不查找相邻行。Platform Types、Accounts、Users可使用页面已有 create trigger作为闭包 fallback；Platform List没有稳定创建入口时返回仍存在的 filters/管理入口，否则 `null`。
4. ALLOWED↔BLOCKED只换 Dialog body，不关闭 Dialog，因此不提前触发 focus restore。

focus helper若确有四处机械重复，可以把“connected element或null”放在 design-system现有 utility附近；不得把业务 ID/query或Dialog状态放入共享 helper。

## 11. 页面级改造

### 11.1 Platform List

- `resolvePlatformOverflowActions` 的 DELETE改为 custom confirmation，不再把 name/account count固化到 action对象。
- 页面以 deletion intent统一 blocker/confirm。
- 删除 API与mutation variables改用 `{ id, expectedRevision }`；enable/disable路径不变。
- 409 error继续显示 request ID，增加/保留显式 list reload，并让 passive invalidation只更新展示、不解冻。
- 删除成功后保留现有 detail/accounts remove、consumer invalidation与最后一行页码回退。

### 11.2 Platform Types

- Editor target保持现状；conditions/delete合并为 deletion intent。
- 删除 Delete Dialog 的 `canonical` state；name、link、blocker、revision都取 live target。
- `reloadCanonical` 改为成功结果 gate，不返回业务对象给 Dialog持有；成功只更新 query并 reset freeze。
- 保留 `PLATFORM_TYPE_IN_USE` details与 precise href。

### 11.3 Platform Accounts

- Accounts query增加 focus always。
- edit/status target保持；delete/blocker拆成 deletion intent，删除 Command Dialog内 account副本。
- `reloadAccount` 检查 `fresh.error`，删除 target只从 fresh accounts result解析。
- 任意删除 409都进入同一 freeze/reload；其他 enable/disable冲突语义不扩大。
- 删除成功或目标消失时使用 create trigger作为稳定 fallback；普通取消优先原 row trigger。

### 11.4 Users

- edit/reset/status `CommandTarget`保持；delete/blocker拆成 deletion intent。
- User deletion Dialog接收 live user与query/mutation状态，不接收完整 target user。
- `USER_BUSINESS_HISTORY`链接始终使用 live user ID；blocker count来自 live deletion。
- 任意删除 409冻结；显式 Users refetch成功后才 reset。
- search scope变化、items移除、401/403 stale error都禁止旧 Dialog提交。

## 12. 测试设计

### 12.1 Component tests

四个页面各自直接证明独立 query owner：

- Platform Profile：打开确认后更新当前 list cache为新 name/revision；断言标题变化与 DELETE query使用新 revision。再更新为 blocked或移除 ID，断言不提交、焦点安全。
- Platform Type：conditions打开后 focus/cache update变为可删除，再反向变 blocked；断言双向 surface、精确 blocker link、最新 revision payload与目标消失。
- Platform Account：`focusManager.setFocused(false/true)` 后 accounts GET增加；Dialog采用新 label/revision/actions。覆盖 refetch error有旧 cache时不解除 409、不提交旧 revision。
- User：用相同 revision只改变 `deletion/available_actions`，证明 Dialog资格随服务端动态引用变化；覆盖 DELETE 409、request ID、显式 reload、scope/目标消失与401/403 stale-data禁用。

所有测试都必须断言 DELETE mock调用次数与 `expected_revision`，并在测试结束恢复 TanStack `focusManager`，避免跨测试泄漏。

### 12.2 Fixture / Playwright

四个 fixture增加最小受控能力：按 ID替换 projection、移除目标、一次性删除 409、记录 list GET与DELETE参数。不得增加任意脚本执行或 fallback success；未声明 API继续失败。

四个现有 spec各覆盖一个 owner-specific回归：

- `platform-list.spec.ts`：Dialog打开后 Profile变 blocked或revision更新，禁止旧提交并断言最新 revision。
- `platform-types.spec.ts`：ALLOWED↔BLOCKED与既有 409 no-replay/request ID/focus。
- `platform-workspace.spec.ts`：Accounts独立 GET在 focus后更新，delete使用该 key的新 revision。
- `system-users.spec.ts`：User同 revision动态 blocker变化、目标消失或删除 409后的显式 reload与无 replay。

E2E是 production-artifact fixture，不宣称真实 backend/PostgreSQL闭环。服务端最终权威已有后端合同，本 Task不新增 real-stack orchestration。

## 13. 影响文件

实施预期只涉及：

- `frontend/src/domains/configuration/platform-list-page.tsx`
- `frontend/src/domains/configuration/platform-list.model.ts`
- `frontend/src/domains/configuration/platform-types-page.tsx`
- `frontend/src/domains/configuration/platform-workspace-page.tsx`
- `frontend/src/domains/configuration/platform.api.ts`
- `frontend/src/domains/identity/user-list-page.tsx`
- `frontend/src/domains/identity/user.api.ts`
- 四个对应 page component test；仅在 action validator需补纯函数回归时触及对应 model test。
- `frontend/tests/e2e/platform-list.spec.ts`
- `frontend/tests/e2e/platform-types.spec.ts`
- `frontend/tests/e2e/platform-workspace.spec.ts`
- `frontend/tests/e2e/system-users.spec.ts`
- 四个对应 fixture文件。
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/backend/available-actions-contract.md`
- 直接被新删除 Dialog baseline措辞影响的 Frontend V2文档段落。

不修改 `RowActions`/Dialog primitive，除非实现时发现 custom command或 lazy finalFocus的既有公开合同无法满足；当前审计已证明它们足够，因此默认无共享组件 diff。

## 14. 文档合同裁决

现有规范中“提交打开 Dialog 时 revision”与“提交前自动拉最新 revision是错误”用于阻止自动 replay。本 Task 将其收窄为：

- 删除 Dialog打开期间，被动 query update属于服务端 read model正常更新，首次确认使用当前 cache revision。
- 确认点击本身不先 GET，不自动把最新 revision串联到 DELETE。
- 一旦 DELETE返回409，本次确认 context冻结；只有显式 reload成功后才能让用户再次确认，仍不 replay。
- 非删除 edit/status/reset/bulk baseline不因本 Task改变。

该裁决在实现阶段同步写入稳定 spec，避免代码与规范形成第二事实源。

## 15. 风险与关闭方式

- **render closure仍旧**：确认事件直接读取 exact QueryClient cache并再验证，component断言 cache更新后的 request revision。
- **refetch失败保留旧 data**：显式检查 query/refetch error；Accounts与四个 deletion Dialog都不得把旧 data当成功。
- **409被被动刷新解冻**：freeze从 mutation 409 error派生，只有显式 reload成功调用 reset。
- **target在旧 cache重现**：scope key变化清 intent，目标解析只看当前 key。
- **focus指向卸载行**：lazy finalFocus检查 `isConnected`并使用稳定 fallback/null；E2E覆盖真实浏览器焦点。
- **抽象膨胀**：各 domain本地实现同一小型不变量，不建立 generic deletion framework。
- **范围污染**：diff检查确保 Query Topic、Product/ContentTask blocker、secondary stale surface、非删除命令、backend/contracts/generated/database和既有 artifacts无变更。
