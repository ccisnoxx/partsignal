# Query Topic Dialog 实时投影实施计划

## 0. Planning Gate

- [x] P1 根因、exact query authority、既有同类模式与测试缺口已从当前代码、稳定 specs、历史审计和前序 Task 核实。
- [x] 用户确认删除资格变化时保留 Dialog 并原位切换为最新阻断说明。
- [x] `prd.md` 已完成收敛重写，阻断性开放问题为空。
- [x] `design.md`、本实施计划、research 与 implement/check manifests 已准备供审阅。
- [x] 用户已在 2026-09-03 本最终规划摘要之后明确批准实施。
- [x] 已显式执行 `task.py start .trellis/tasks/09-03-query-topic-dialog-live-projection`，Task 状态为 `in_progress`。

## 1. 实施步骤

### Phase A：先建立失败回归证据

- [x] 扩展 `geo-topics.fixture.ts` controller，以 generated `QueryTopicListItem` 类型按 ID 更新/移除当前列表投影；不放宽未声明 API/runtime error 检查。
- [x] 增加查看引用 Dialog 的 focus-refetch 回归：名称、三类引用、链接和 deletion guidance 不关闭重开即可更新。
- [x] 增加删除 Dialog 的 live transition 回归：可删 → blockers/不可执行 → 可删，并断言最终 DELETE 使用最新 revision。
- [x] 覆盖 list fetching/error/目标消失时不发送 DELETE、旧 intent 不复现、断开触发器不会被强制聚焦。
- [x] 扩展现有删除 409 回归：被动 refetch 更新 projection 但不解冻、不 replay；显式 reload 仍产生点击后的 fresh options GET。
- [x] 扩展编辑回归：已有草稿在被动 list refetch 后保持不变。

### Phase B：修复单一状态 owner

- [x] 将查看引用和删除 target 改为仅保存 `{id, focusReturn}` 的 intent；编辑 target 保持独立。
- [x] 从当前 `topics.data.items` 派生两个 Dialog 的 current topic；exact query identity 变化或目标消失时清 intent。
- [x] 查看引用 Dialog 全部展示字段改为消费派生 current topic，移除随 topic ID/字段变化的 Root `key`，关闭时只向仍连接的触发器返回焦点。
- [x] 删除 Dialog 按最新 `available_actions + deletion + references` 原位转换确认/阻断/不可执行 surface，并在 fetching/error/conflict 时禁止确认。
- [x] 删除 mutation 改为接收 `{id, expectedRevision}`；confirm-time 同步读取 exact query state/data 并用当时 revision，移除打开时 revision 副本。
- [x] 409 被动投影更新只更新展示；显式 reload 保留 `fetchFreshQueryTopics()`，校准当前 exact list 后才 reset freeze，失败不 replay。

### Phase C：定向验证与边界复核

- [x] 先运行开发性最小 Query Topics 单项目/定向用例，确认新增失败证据转绿；不把正式双 project gate 当开发循环。
- [x] 在最终候选上只运行一次 Query Topic mobile/desktop production-artifact 正式门禁（20 passed，20.3s）。
- [x] 运行 frontend lint、typecheck、`api:check` 与 Task validate/trailing-whitespace；本次审查复用实施代理已通过的 lint/typecheck，并补跑 api:check、Task validate 和限定范围 whitespace。
- [x] 检查实际 diff 只包含预计三个产品/测试文件与本 Task 文档；核实 backend、OpenAPI、generated client、数据库、Makefile、CI 和 `integrity-error-domain-mapping` 无变化。仓库中已有任务外 dirty/index 保持不动。
- [x] 完成 touched-scope 中文注释、developer-visible text 与 stale comment/docstring 检查；新增中文注释说明 exact query 切换、成功投影确认目标消失及显式恢复后的列表校准边界，未增加机械性注释。
- [x] 由独立 `trellis-check` agent 完成一次全审查；补充了同 revision 仅改变 blockers/actions 的回归证据，并完成一次定向复核。

### Phase D：收尾准备

- [x] 将本文件更新为实际验证结果；未运行 optional suites 保持 `NOT_RUN` 并写明原因。
- [x] 判断稳定 spec 是否需要更新；无需更新，因为 `state-management.md:85-110` 已完整规定 intent-by-ID、exact-query、409 freeze 与焦点合同，本 Task 只修复实现漂移。
- [ ] 提交产品代码前给出路径受限 commit plan 并取得用户确认；不得带入现有任务外 dirty/index。
- [ ] 提交后按 `trellis-finish-work` 完成归档与 journal；不得 push。

## 2. Required Validation

| 状态 | 命令 | 证明目标 |
| --- | --- | --- |
| PASS | `npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --project=foundation-desktop` | production artifact 下的 live projection、最新 revision、409 freeze、编辑草稿、焦点及四档宽度 |
| PASS | `npm --prefix frontend run lint` | React hooks、类型消费与前端静态质量 |
| PASS | `npm --prefix frontend run typecheck` | exact query data、mutation variables 与 generated fixture types |
| PASS | `npm --prefix frontend run api:check` | OpenAPI/generated client 无漂移 |
| PASS | `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-query-topic-dialog-live-projection` | Task 结构与 context manifests |
| PASS | `git diff --check -- frontend/src/domains/geo/query-topic-list-page.tsx frontend/tests/e2e/fixtures/geo-topics.fixture.ts frontend/tests/e2e/geo-topics.spec.ts .trellis/tasks/09-03-query-topic-dialog-live-projection` | task-scope trailing whitespace |

正式双 project E2E 已在 targeted checks 通过的最终候选上运行一次并通过（20 passed，20.3s）；若后续代码发生变化，需重新建立门禁证据。

## 3. Optional Validation

| 状态 | 命令 | 默认不运行原因 |
| --- | --- | --- |
| NOT_RUN | `npm --prefix frontend test` | 变更局限于单页 Dialog/query 状态与已有 production-artifact fixture；Required E2E 直接覆盖浏览器 focus/query 行为 |
| NOT_RUN | `npm --prefix frontend run build` | 定向 E2E 使用项目 Playwright webServer 的 production build/preview，单独 build 属于重复证明 |
| NOT_RUN | `make verify` | 不改变 backend、公共合同、数据库、共享基础设施或 release gate；仓库级门禁超出最小证明范围 |

若实施发现公共 contract、共享状态或跨域影响，停止并报告需要调整的最小验证，不静默扩大 Task。

### 已运行的定向验证

- PASS：`npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --grep '实时更新|原位切换|创建与更新|DELETE 409'`（4 passed）。
- PASS：`npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --grep 'fetching/error'`（1 passed）。
- PASS：`npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile`（10 passed）。
- PASS：`npm --prefix frontend run lint`。
- PASS：`npm --prefix frontend run typecheck`。
- PASS：`npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --project=foundation-desktop --grep '删除 Dialog 按最新 blocker'`（2 passed，8.6s；复核同 revision 资格转换）。
- PASS：`npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --project=foundation-desktop`（20 passed，20.3s）。
- PASS：`npm --prefix frontend run api:check`（OpenAPI 类型与根合同一致）。
- PASS：`python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-query-topic-dialog-live-projection`。
- PASS：`git diff --check -- frontend/src/domains/geo/query-topic-list-page.tsx frontend/tests/e2e/fixtures/geo-topics.fixture.ts frontend/tests/e2e/geo-topics.spec.ts .trellis/tasks/09-03-query-topic-dialog-live-projection`。

`npm --prefix frontend test`、单独 build 与 `make verify` 按 Optional Validation 保持未运行；独立审查未再修改产品代码，lint/typecheck 复用实施代理在当前实现候选上记录的通过结果。

## 4. 预计变更与提交边界

预计产品/测试变更仅包含：

- `frontend/src/domains/geo/query-topic-list-page.tsx`
- `frontend/tests/e2e/fixtures/geo-topics.fixture.ts`
- `frontend/tests/e2e/geo-topics.spec.ts`
- `.trellis/tasks/09-03-query-topic-dialog-live-projection/`

不得使用 `git add -A`、`git add .` 或 `git commit -a`；提交时必须路径受限暂存，并在提交前后核对 staged diff 与 `git show --name-status`。现有 `.gitignore`、`backend/app/schemas/configuration.py` 和 staged artifacts 删除保持原样。

## 5. Stop Conditions

出现以下任一情况时停止实施并报告：

- 必须修改 backend、OpenAPI、generated client、数据库合同、Makefile、CI 或稳定业务设计文档；
- 必须改变编辑 Dialog 草稿/409 基线、全局 query staleTime 或前序 fresh options reload 语义；
- 无法从当前 exact list query 安全派生目标或必须扫描其他分页/筛选 cache；
- 修复需要新增全局 store、通用 Dialog framework、轮询、额外 endpoint 或自动 mutation replay；
- 修复需要吸收或启动 `integrity-error-domain-mapping`；
- 现有任务外 dirty/index 状态妨碍路径受限提交且无法安全隔离。
