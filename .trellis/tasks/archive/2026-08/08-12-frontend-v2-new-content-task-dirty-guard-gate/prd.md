# Frontend V2 New Content Task DirtyGuard Gate

## 目标

确定 Phase 4 Exit Gate 中 New Content Task DirtyGuard unit failure 的真实根因，并以最小修改恢复稳定、真实的回归证明：页面拥有的 `productId` canonical URL 同步不触发离开确认；Cancel、浏览器真实导航和成功创建仍分别遵守既有 DirtyGuard / canonical navigation 合同。

## 已确认事实

- 当前 `main` 上按指定命令两次精确运行“必填错误完整关联 ErrorSummary，DirtyGuard 覆盖 Cancel”，结果均为 `1 passed / 8 skipped`；历史 Gate 中的同名失败当前不能由该单命令稳定复现。
- shared `src/design-system/forms/dirty-guard.test.tsx` 精确运行结果为 `1 passed`。
- 完整 `new-content-task-page.test.tsx` 当前为 `8 passed / 1 failed`；完整 V2 unit 为 `281 passed / 1 failed`。两者当前都失败在 `new-content-task-page.test.tsx:194`：选择第二个 Product 后、尚未执行 `:196` 的 URL `waitFor` 时，DirtyGuard Dialog 已打开并把表单 DOM 设为 inert，因而无法按可访问角色取得“已批准事实版本” combobox。
- `new-content-task-page.tsx:255-263` 在一次 Product 选择事件中先更新 RHF/清空 Fact，再调用 `onProductIdChange`；`new.tsx:24-26` 随后异步写入 `productId` search，但没有等待，也没有声明该写入由页面自己拥有。
- `dirty-guard.tsx:30-40` 的共享合同会拦截每次真实 router navigation，从而覆盖 pathname、search 与 hash。该行为由归档 `frontend-v2-publication-workspace-core` 明确批准，并由 shared test 直接证明。
- Git 历史表明 New Content Task 的 URL 同步先由 `326df9f` 引入；后续 `1035878` 才把 DirtyGuard 从 pathname 比较扩大到每次真实导航，而 New Content Task route 未同步声明 canonical search 写入的所有权。
- TanStack Router 当前锁定版本原生支持 navigation option `ignoreBlocker: true`，语义正是“仅本次导航绕过已注册 blocker”；不需要修改 DirtyGuard props、共享判断或增加第二个 blocker。
- 当前目标用例在 `new-content-task-page.test.tsx:375-377` 选择 Product 后立即点击 Cancel，没有等待 `router.state.location.search`。因此通过时也不能区分 Dialog 属于页面内部 search 同步还是 Cancel；它不是可靠的 Cancel 回归证明。
- 现有 production-artifact 定向诊断中，成功创建进入 canonical Detail、Cancel 后继续编辑并恢复焦点、浏览器 Back 后确认离开三项均通过；productId Back/Forward 场景失败时，DOM 只剩 DirtyGuard Dialog，进一步证明 full-URL 用户导航与页面内部 canonical 写入需要在测试中明确区分。
- `docs/frontend-v2/04-design-system-and-interaction-spec.md` 当前没有名为 Form/DirtyGuard 的章节；其中与本任务直接相关的现有要求只有 form error 关联与 Dialog/可访问性。DirtyGuard 的当前有效合同来自 state-management spec、归档 full-URL 决策和现有共享实现/测试；本任务不借机扩写 04。

## 需求

1. 共享 DirtyGuard 继续拦截脏表单期间的真实 pathname、search、hash、Back/Forward 与离页导航；不得削弱或增加公共 props。
2. Product 选择导致的 `productId` 写入属于 `/content/tasks/new` 页面拥有的 canonical URL 同步，不是离开页面。仅该次 route navigation 使用 TanStack Router 原生 `ignoreBlocker`。
3. Product canonical 同步必须在表单已经因其他字段变脏时仍能完成；同步后 Fact 清空、Platform 保留，且不得先出现 DirtyGuard Dialog。
4. Cancel 继续走普通 navigation，不使用 `ignoreBlocker`。脏表单点击 Cancel 必须稳定打开离开确认 Dialog。
5. 点击“继续编辑”后保留 Product、Fact/Platform 当前值、pathname、search 与页面位置，并把焦点合理恢复到 Cancel 触发器。
6. 再次 Cancel 后点击“放弃修改并离开”，必须进入 `/content/tasks`。
7. 创建成功继续先 reset 表单、清除幂等键、失效列表，再使用 POST response ID 进入 canonical Detail；不得误弹 DirtyGuard。
8. ErrorSummary 与字段 `aria-invalid` 断言保留；测试必须等待可观察的 URL/DOM 状态，不增加 sleep、固定延迟、轮询循环或扩大 timeout。
9. 不新增 helper framework、页面级 blocker、全局状态、兼容分支或依赖。

## 验收标准

- [x] 表单已脏时显式更换 Product，`productId` search 更新完成且没有 DirtyGuard Dialog；Fact 清空、Platform 保留。
- [x] 缺失三字段仍同时关联 FormField 与 ErrorSummary。
- [x] canonical search 完成后点击 Cancel，唯一出现的确认 Dialog 可归因于 Cancel navigation。
- [x] 点击“继续编辑”后表单值、`/content/tasks/new?productId=...`、页面位置和 Cancel 焦点均保留。
- [x] 点击“放弃修改并离开”后进入内容任务列表。
- [x] 创建成功进入 POST response ID 对应的 `/content/tasks/$taskId`，列表 query 失效且没有 DirtyGuard Dialog。
- [x] shared DirtyGuard search/hash 精确测试保持通过，证明公共 full-URL 合同未被削弱。
- [x] New Content Task 精确用例、完整 component 文件、V2 unit、typecheck、lint、相关 production-artifact test 与 `git diff --check` 全部通过。

## 排除项

- 不修改 shared DirtyGuard 实现或 props；若实施发现必须修改，立即停止并重新报告影响范围。
- 不修改 `new-content-task-page.tsx` 的表单/创建业务逻辑，除非实施证据推翻当前 route-owner 结论；不得预先扩大。
- 不修改 backend、OpenAPI、数据库、generated types、V1、其他 domain、Content AI real-stack timeout。
- 不运行 Phase 4 最终 closeout、`make verify`、完整 `make e2e`，不进入 GEO。
- 仅使用用户批准的 `codex/frontend-v2-new-content-task-dirty-guard-gate`；未经后续确认不提交、合并、push 或归档。

## 阻塞问题

无。实施仍须等待用户对本规划的后续明确批准。
