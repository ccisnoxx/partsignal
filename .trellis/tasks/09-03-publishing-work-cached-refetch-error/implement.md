# Publishing Work 缓存刷新失败保留投影实施计划

## 0. Planning Gate

- [x] P2 根因、三个 query authority、现有正确模式与测试缺口已从当前代码、稳定 specs 和基线审计核实。
- [x] `prd.md` 已收敛需求、验收标准、范围与动作安全边界；阻断性开放问题为空。
- [x] `design.md`、本实施计划、research 与 implement/check manifests 已准备供审阅。
- [x] 用户已于 2026-09-04 在最终规划摘要之后明确批准实施。
- [x] 已显式执行 `task.py start .trellis/tasks/09-03-publishing-work-cached-refetch-error`，Task 状态为 `in_progress`。

## 1. 实施步骤

### Phase A：建立缓存刷新失败回归

- [x] 已扩展 `publication-work-page.test.tsx`：先成功缓存，再让 Summary / Ready / Works refetch 返回各自 structured error，证明并修复原先隐藏投影的路径。
- [x] 已扩展 `publication-work-list.spec.ts`：使用现有 fixture mode setter 与 synthetic visibility change 触发 production-artifact focus refetch，没有用 reload 冒充后台刷新。
- [x] 已断言三个 endpoint 请求独立、真实 request ID 保留、cached metrics/cards/actions/rows/pagination 不消失；逐区块 retry 不联动 siblings，Work retry 再次失败仍保留旧投影。
- [x] 已保留现有 initial loading/error/empty、URL、START 409、焦点和响应式断言；另增加无缓存 exact key 初始失败不回退旧 key 的负例。

### Phase B：修复渲染分支

- [x] 已在 `publication-work-page.tsx` 增加页面内局部 cached-refresh alert，统一 structured error、已保留数据说明和单一 retry 入口。
- [x] Summary 只在 `error && !data` 时替换内容；`data && error` 同时显示指标和 stale alert。
- [x] Ready Queue 只在 `error && !data` 时替换内容；`data && error` 保留 cards/空态及服务端 action projection。
- [x] Work List 只在 `error && !data` 时显示错误 EmptyTable；`data && error` 保留 rows/空态与分页，并在 table 外显示 stale alert。
- [x] 筛选/分页切换到无缓存 exact key 时仍采用首次 loading/error，没有扫描其他 key 或建立 fallback。

### Phase C：定向验证与审查

- [x] focused component test 已通过；正式 production-artifact 双 project gate 在产品与 E2E 候选稳定后仅运行一次并通过。Review 后只补 component 证据，未改变该 gate 已证明的候选。
- [x] frontend lint、typecheck、`api:check`、Task validate 与 task-scope trailing-whitespace 均通过；Review 补测后受影响 test 文件 ESLint 和 focused component 重新通过。
- [x] 实际 diff 只包含预计页面、两类定向测试与本 Task 文档；现有 fixture 能力足够，未修改 fixture。
- [x] backend、OpenAPI、generated client、数据库、Makefile、CI、业务设计和 `integrity-error-domain-mapping` 均无变化；任务外 dirty/index 三组哈希保持不变。
- [x] 已完成 touched-scope 中文注释、developer-visible text 与 stale comment/docstring 检查；本次逻辑由清晰组合状态直接表达，无需增加代码注释或 docstring，新增用户可见提示为中文。
- [x] 独立只读 review 已完成；其两项测试证据缺口在唯一一次定向修复中关闭，同一 reviewer 定向复核未发现新 material issue。

### Phase D：收尾准备

- [x] 本文件已更新为实际验证结果；未运行 optional suites 保持 `NOT_RUN` 并写明原因。
- [x] 已判断无需更新稳定 spec：现有 `state-management.md` 和 `available-actions-contract.md` 已完整覆盖 cached refetch error 与服务端动作权威，本 Task 只修复实现漂移。
- [ ] 提交产品代码前给出路径受限 commit plan 并取得用户确认；不得带入现有任务外 dirty/index。
- [ ] 提交后按 `trellis-finish-work` 完成归档与 journal；不得 push。

## 2. Required Validation

| 状态 | 命令 | 证明目标 |
| --- | --- | --- |
| PASS（8/8） | `npm --prefix frontend test -- src/domains/publication/publication-work-page.test.tsx` | 三 surface 初始错误与 cached refetch error 分流、投影/动作/分页保留、失败/成功独立 retry、无缓存 exact key 负例 |
| PASS（10/10，14.0s） | `npm --prefix frontend run e2e -- tests/e2e/publication-work-list.spec.ts --project=foundation-mobile --project=foundation-desktop` | production artifact focus refetch、请求独立性、真实告警、两档项目宽度与交互回归 |
| PASS | `npm --prefix frontend run lint` | task-scope TypeScript/React/ESLint 约束；Review 补测后另对受影响 test 文件通过 ESLint |
| PASS | `npm --prefix frontend run typecheck` | 类型与 generated schema 使用一致 |
| PASS | `npm --prefix frontend run api:check` | OpenAPI generated client 无漂移 |
| PASS | `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-publishing-work-cached-refetch-error` | Task 元数据与 artifacts 合法；仅提示大型 state spec 注入截断 warning |
| PASS | `git diff --check -- .trellis/tasks/09-03-publishing-work-cached-refetch-error frontend/src/domains/publication/publication-work-page.tsx frontend/src/domains/publication/publication-work-page.test.tsx frontend/tests/e2e/fixtures/publication.fixture.ts frontend/tests/e2e/publication-work-list.spec.ts` | task-scope trailing whitespace |

正式 E2E 双 project gate 已在 targeted component 证据转绿、产品与 E2E 候选稳定后运行唯一一次并通过。独立 Review 后只补充 component test 的失败重试和无缓存 exact-key 负例，产品代码与 E2E spec 未变化，因此没有重复正式 gate。

## 3. Optional Validation

| 状态 | 命令 | 未运行时的原因 / 剩余风险 |
| --- | --- | --- |
| NOT_RUN | `npm --prefix frontend test` | 全量 component suite 与本地三个 surface 分支相比价值较低；focused test + production E2E 覆盖直接边界 |
| NOT_RUN | `npm --prefix frontend run build` | production-artifact E2E 的 webServer 已执行 build；不重复已证明步骤 |
| NOT_RUN | `make verify` | 无 backend、公共合同、数据库、权限、共享核心或 release-scope 变化；保留非目标领域剩余风险 |

## 4. Review Gate

独立 reviewer 必须核对：

- `data && error` 与 `error && !data` 对成功空态同样正确，不使用业务值 truthiness 判断缓存存在；
- 三个 surface 不共享 error flag、retry 或 fallback，Work List 不扫描其他 search key；
- stale 状态没有静默删除 server-projected actions，也没有把缓存动作当成权限；
- alert 结构合法、request ID 可见、重试可访问且不出现重复入口；
- production E2E 真正从成功缓存进入 focus refetch error，而不是 reload 后的初始失败；
- 无 task-scope 外代码、合同、generated、数据库、Makefile、CI 或业务设计变化。

结果：PASS。首次审查未发现产品实现问题，指出失败 retry 与无缓存 exact-key 两项测试证据缺口；唯一一次定向补测后，focused component 8/8，同一 reviewer 定向复核确认两项均关闭且没有新 material issue。

## 5. 预期改动与停止条件

预期改动：

- `frontend/src/domains/publication/publication-work-page.tsx`
- `frontend/src/domains/publication/publication-work-page.test.tsx`
- `frontend/tests/e2e/publication-work-list.spec.ts`
- 本 Task 文档与 context manifests

`frontend/tests/e2e/fixtures/publication.fixture.ts` 只作为既有测试能力依赖；mode setter / request observation 已满足场景，实际未修改。

若实现需要修改 backend、OpenAPI、generated client、数据库合同、权限、业务状态转换、Query 全局配置、跨领域组件或启动 `integrity-error-domain-mapping`，立即停止并返回规划阶段报告，不顺手扩域。
