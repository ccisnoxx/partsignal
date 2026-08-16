# 修复 Frontend V2 Phase 6 Fact Workspace unit blocker

## Goal

关闭当前候选唯一的 Fact Workspace unit P2 blocker，同时保持 Fact Workspace、受控 MarkdownEditor、revision conflict 与显式 reload 的 production 行为不变；完成最终候选门禁后据实重新判定 Frontend V2 Phase 6 Exit Gate。

## Confirmed Facts

- 规划基线为 clean `main` at `8e685dd725887639e25804c86aa21abc73eee34b`，相对 `origin/main` ahead 225；不因此 pull 或 push。
- 前置 Task `frontend-v2-phase6-integration-verify-blockers` 已归档并 fast-forward 合入 `main`，原两个 backend integration P2 已关闭，完整 backend integration 为 `116 passed`。
- 前置最终候选唯一一次 `make verify` 在 V2 unit 以 `72 passed / 1 failed files`、`426 passed / 1 failed tests / 13.56s` 停止；失败位于 `fact-workspace-page.test.tsx:197`，期望 `AO## 初始事实`，实际 `LCL## 初始事实`。
- 当前分支零 diff 下独立运行 `fact-workspace-page.test.tsx` 为 `1 passed file / 9 passed tests / 1.77s`；没有代码或环境变化，不重复运行完整 V2 suite。
- production catch 只设置 error/conflict/request ID，dirty guard 阻止后台 workspace reset，只有 `reloadCanonical()` 调用 `form.reset()`；符合 `.trellis/spec/frontend/state-management.md` 的权威合同。
- production-artifact `fact-workspace.spec.ts` 已在真实浏览器中用 exact Markdown 证明 409 保留本地值、显式 reload 才采用 canonical 值。
- 当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 为 `NOT_MET`。

## Requirements

### R1. 修复测试权威边界，不修改正确 production

- 不把 CodeMirror 的虚拟化/增量渲染 DOM `textContent` 当成 RHF 受控 Markdown 的权威值。
- revision conflict unit 必须继续证明本地 Markdown、dirty 状态和 request ID 保留，且只有显式 reload 才采用服务端 canonical Markdown/revision。
- 使用现有稳定公开边界，例如受控 Preview、字符/行数、mutation payload 或状态文案；不得删除值保留断言、只等待任意文本、增加 sleep/retry 或降低语义强度。

### R2. 同根 sibling 必须同时收口

- 搜索确认同一不稳定模式还存在于 Fact Workspace 背景 refetch 用例和 MarkdownEditor readonly toggle 用例。
- 仅修正这三处同根捕获；不清理其它 `textContent` 用法、测试、组件或页面。
- 不新增 test helper、CodeMirror adapter、测试专用 production API、兼容 fallback 或抽象。

### R3. 保持产品与合同不变

- 不修改 `fact-workspace-page.tsx`、`markdown-editor.tsx`、API、generated types、backend、database、permission、deployment 或依赖。
- 保持 Markdown 是唯一可编辑事实来源、409 不自动 replay、不自动覆盖 dirty 草稿、显式 reload 才丢弃本地值。

### R4. 分层验证与 Gate 重判

- 先分别运行 MarkdownEditor 与 Fact Workspace 精确 unit，再运行完整 Frontend V2 unit。
- 精确与完整 V2 unit 通过后，运行 V2 API drift、typecheck、lint、build、根 contract-check 与 `git diff --check`。
- 所有前置验证通过后，使用本机 PostgreSQL source URL 和独占 Redis DB 14，只对最终候选运行一次 `make verify`，记录实际计数、耗时和 cleanup。
- 更新 frontend quality spec 的 CodeMirror/jsdom 测试边界，以及 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 和本 Task evidence；不修改已归档 Task。
- 只有最终候选 `make verify` 完整退出 `0`、cleanup 完整且 open P0/P1/P2 为 `0/0/0`，Phase 6 Exit Gate 才能改为 `MET`。

## Acceptance Criteria

- [x] 三处同根 CodeMirror `textContent` 捕获由稳定公开语义边界替代，没有 sleep、模糊断言、弱化断言或新 helper。
- [x] Fact Workspace 409 unit 继续精确证明本地 Markdown 保留、request ID、dirty 和显式 canonical reload。
- [x] 背景 refetch failure 与 readonly toggle 继续证明受控 Markdown 未丢失。
- [x] `fact-workspace-page.test.tsx`、`markdown-editor.test.tsx` 分别通过，完整 Frontend V2 unit 无失败。
- [x] V2 api:check、typecheck、lint、production build、contract-check 与 diff check 通过。
- [x] production、API、database、permission、deployment、dependency 和产品行为零变化。
- [x] Frontend quality spec、`07`、`08` 与唯一最终候选结果一致。
- [x] 最终 `make verify` 只运行一次，实际 counts/duration/cleanup 完整记录；Gate 只按实际结果判定。
- [ ] 提交前展示 commit plan 并取得确认；不自动 push 或创建 PR。

## Out of Scope

- 修改 Fact Workspace 或 MarkdownEditor production 实现。
- 新增产品能力、自动 merge、协同编辑、测试专用 state accessor 或通用 CodeMirror testing framework。
- 清理其它测试的 DOM 查询、运行时性能、V1 或其它 domain blocker。
- 修复最终门禁中新出现且与当前三处 unit owner 无因果关系的失败。

## Planning Gate

- 当前没有未解决的产品、UX、兼容或范围决策；root owner 和最小边界由代码、spec、E2E 与独立目标测试共同确定。
- 本 Task 为 release/Phase gate blocker，必须补齐 `design.md`、`implement.md` 和 research evidence，并在实施前取得新的明确批准。
- 规划批准前不创建分支、不运行 `task.py start`、不修改 production/test/spec/docs 权威文件。
