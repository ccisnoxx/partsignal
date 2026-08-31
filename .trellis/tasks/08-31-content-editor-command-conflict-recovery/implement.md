# Content Editor 提交审核冲突恢复实施计划

## Scope

本计划只实现 Content Editor `SUBMIT_REVIEW` 与现有 revision conflict 恢复语义的一致性，并关闭显式 reload 对 stale cache data 的错误采用。不得修改后端、OpenAPI、generated client、数据库、生产数据、其他业务 surface 或全局错误框架。

当前阶段仅完成审计和规划。所有实施项保持未勾选；用户批准后才运行 `task.py start`。

## Phase A：冻结基线与失败复现

- [x] 开始实施前再次确认主工作目录位于 `main`，记录并避开所有既有脏文件/artifacts。
- [x] 读取本 Task 的 `prd.md`、`design.md`、本文件、research 与注入 spec context；确认父 Task 和 `v2-live-readonly-acceptance` 状态未改变。
- [x] 在现有组件测试中增加最小失败复现：submit-review 409 目前只显示 Dialog 普通 error，页面没有统一 conflict/request ID/reload。
- [x] 冻结初始 GET 和单次 submit POST 计数，避免修复过程把自动 refetch/replay 写成测试预期。

## Phase B：统一 conflict owner

- [x] 将 workspace 现有 conflict 提升为 Content Editor query 边界唯一的结构化 `{ code, message, requestId }`；删除原字符串 conflict 副本。
- [x] 让 `applyMutationError` 的 `REVISION_CONFLICT` 分支写入这一 owner；SAVE、DELETE、ABANDON 保持原成功/失败合同。
- [x] 在 `submitReview` catch 中只把 `REVISION_CONFLICT` 交给统一 owner；普通错误继续抛给 Dialog 当前路径。
- [x] 使用同一 conflict 对象在文档区、ErrorSummary 和 Submit Dialog 投影服务端 code/message/request ID；不新增 Dialog conflict/reload state。
- [x] conflict 期间禁用携带旧 revision 的 Editor 写动作和 Dialog 确认按钮，且不从 status/error 推导动作资格。

## Phase C：显式 reload 与 context adoption

- [x] conflict 进入时取消 editor-context exact query 的在途读取，并在该唯一 conflict 存在期间关闭当前 observer 的 window-focus refetch。
- [x] 给 workspace 的自动高 revision adoption effect 增加 conflict gate；显式 reload 前不得 reset form、revision、mode 或 conflict。
- [x] 修改 `onReload` 合同：每次点击发起一次真实 refetch；只有 result 明确成功且含 fresh data 时返回 canonical context，失败时不得返回旧 cache data。
- [x] reload 成功后按 fresh response 重置完整表单、base revision 和 mode，采用 task/current-content 的 `primary_task`/`available_actions`，关闭 Dialog并清除 conflict/request ID。
- [x] reload 失败后保留原 conflict、request ID、表单、base revision、Dialog/comment；继续使用 query error owner 提供重试，不创建 `reloadError` state。
- [x] 确认 reload 的任何分支都不会调用、retry 或 replay submit mutation。

## Phase D：Dialog 生命周期与可访问性

- [x] 打开 Submit Dialog 后把焦点置于备注 textarea；409 后保留 Dialog、备注和焦点约束。
- [x] 用稳定 alert/live-region 关联并宣告结构化 code/message/request ID。
- [x] 记录 Submit 触发器作为普通关闭焦点；当 trigger 因 conflict 禁用或 canonical action 消失时，回退到 Content Editor 标题/冲突恢复区域。
- [x] conflict 后取消只关闭 Dialog并放弃备注，不清除 conflict、不读、不写；页面 reload 入口仍可操作。

## Phase E：组件测试

- [x] 扩展 submit 409 测试，断言 Dialog 保持、审核备注与所有本地表单值保留、code/message/request ID 精确展示、初始 GET=1、submit POST=1。
- [x] 模拟 window focus/背景采用条件，断言 conflict 下没有新增 GET，旧/更高 cache context 不会重置表单或动作。
- [x] 覆盖 reload failure：GET 增加 1、POST 仍为 1、旧 cache data 不被采用、原 conflict/备注/表单保持且重试可用。
- [x] 覆盖下一次 reload success：GET 再增加 1、POST 仍为 1，采用新的 title/body/revision、task `primary_task` 与 action projection，关闭 Dialog、清 conflict。
- [x] 覆盖 conflict 后取消：无新增 GET/POST，页面 conflict 与表单保留，焦点落在稳定目标。
- [x] 以参数化测试覆盖 submit 的 401、403、404、422、普通 5xx：保持现有普通 Dialog error，不出现 conflict/reload，不增加请求。
- [x] 保留并通过现有 submit success、SAVE conflict、DELETE/ABANDON 行为测试。

## Phase F：Playwright fixture 与 E2E

- [x] 将 Editor fixture 的 mutation 模式细分为 submit-review revision conflict，不让 SAVE 的既有 conflict 分支误控制所有命令。
- [x] fixture 在 submit conflict 时先更新服务端 canonical state，再返回精确 `REVISION_CONFLICT`、message 与 request ID；记录每个 editor GET/command POST。
- [x] 增加 one-shot editor-context reload failure 控制；失败后仍可切回 success，并返回更新后的 current content revision、task `primary_task` 与 task/current-content actions。
- [x] E2E 从真实用户点击出发断言 409 后 Dialog/comment/本地输入与结构化错误保留，GET 仍为初始 1、submit POST 为 1。
- [x] E2E 断言失败 reload 后 GET=2、POST=1且所有状态保留；成功 retry 后 GET=3、POST=1且采用 canonical context/actions。
- [x] E2E 断言 conflict 后取消不读不写，页面统一 conflict 仍可见；成功提交、DELETE、ABANDON 既有场景继续通过。

## Required Validation

以下命令在实现完成后必须执行；失败时只修复能归因于本 Task 的问题：

```bash
npm --prefix frontend run test -- src/domains/content/content-editor-page.test.tsx
npm --prefix frontend run e2e -- tests/e2e/content-editor.spec.ts --project=foundation-mobile --project=foundation-desktop
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run api:check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-31-content-editor-command-conflict-recovery
! rg -n '[[:blank:]]+$' .trellis/tasks/08-31-content-editor-command-conflict-recovery frontend/src/domains/content/content-editor-page.tsx frontend/src/domains/content/content-editor.model.ts frontend/src/domains/content/content.api.ts frontend/src/domains/content/content-editor-page.test.tsx frontend/tests/e2e/content-editor.spec.ts frontend/tests/e2e/fixtures/content.fixture.ts
```

验证意图：定向 Vitest 证明状态机、普通错误与请求次数；定向 Playwright 在两个既有 viewport project 中证明真实 Dialog/query 行为；typecheck/lint/build 证明前端静态和 production artifact；`api:check` 证明 OpenAPI/generated client 未漂移；Trellis/whitespace 检查证明任务上下文与 touched scope 可交付。

## Optional Full-suite Validation

以下检查不作为本前端局部修复的关闭条件；若准备发布或用户要求全量门禁再运行：

```bash
npm --prefix frontend run test
npm --prefix frontend run e2e
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests/integration/test_content_editor_context.py -k manual_draft_save_submit_and_changes_requested_revision
make verify
```

跳过理由：实现不修改 backend、公共合同、数据库或共享基础设施；required validation 已直接覆盖变更 owner、完整 Content Editor E2E 文件、两档 Playwright project 和生成合同一致性。残余风险是仓库其他 domain 的全量回归，仅在 release gate 中由 full suite 关闭。

## Diff 与完成审查

- [x] 检查 diff，确认没有第二份 conflict/reload owner、自动 replay、silent fallback、广泛 catch、status-based action 推导或 unrelated refactor。
- [x] 确认 backend、`contracts/openapi.yaml`、generated schema、数据库、生产数据和既有脏文件无 diff。
- [x] 执行 touched-scope 文档文字检查；本 Task 若没有新增非显然逻辑注释，说明为何现有中文命名/测试足以表达合同。
- [x] 报告 required validation 的实际结果和 optional full suite 是否跳过；不以未观察的测试结果代替证据。
- [x] 提交前向用户展示 commit plan 并等待确认；不得自动 commit 或 push。

## Review Gate

- [x] 用户明确批准本 PRD/design/implement 后才执行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/08-31-content-editor-command-conflict-recovery`。
- [x] 本 Task 完成前不归档父 `frontend-v2-functional-contract-conformance-baseline`，不改变 `v2-live-readonly-acceptance` 的 `in_progress` 状态。
