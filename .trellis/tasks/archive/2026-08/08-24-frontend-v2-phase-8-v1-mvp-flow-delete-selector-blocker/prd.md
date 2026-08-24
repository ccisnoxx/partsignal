# Frontend V2 Phase 8 V1 MVP Flow Delete Selector Blocker

## Goal

A29：在旧 `frontend/` 的 `mvp-flow` Playwright owner 中，将 Header 删除动作定位到本次打开的可见菜单，消除 strict selector 歧义，同时保持产品 UI、可访问名称、业务流程和 runner 不变。

## Background

- Phase 8 final recheck 固定候选 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce` 的 V2 real-stack `16 passed` 后，V1 `mvp-flow` 得到 `51 passed / 1 failed`。
- 唯一测试失败位于 `frontend/tests/e2e/mvp-flow.spec.ts:452`：页面级 `getByRole('menuitem', { name: '删除' })` 同时匹配两个 menuitem。
- 触发器 `headerMore` 已具有唯一可访问名称；问题属于测试 locator ownership，不是已证实的产品行为缺陷。
- 本 Task 是 Phase 8 parent 的第一个新 blocker；A30 与它独立，但实施顺序固定为 A29 → A30。

## Requirements

1. 仅在 final recheck evidence 获准提交、工作区回到 clean `main` 后启动；启动时冻结新的候选 HEAD，确认其产品祖先包含 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce`。
2. 修改范围默认只有 `frontend/tests/e2e/mvp-flow.spec.ts` 与本 Task artifacts；不得修改产品组件、可访问名称、菜单渲染、API、合同、fixture、runner 或 V2 tests。
3. locator 必须从唯一 Header 触发器进入本次打开的可见菜单 owner，再按精确 role/name 选择“删除”；不得用 `.first()`、`.last()`、数组下标、force、sleep、retry 或宽松文本匹配掩盖歧义。
4. 保留既有键盘/焦点恢复、删除确认 Dialog、取消动作与后续流程断言；不得缩短 `mvp-flow` 业务覆盖。
5. 先运行最小静态/type/lint 检查，再通过项目现有两键环境、动态非 0 独占 Redis DB 与 `e2e-local.sh` 运行目标 V1 `mvp-flow`；不得创建临时 playwright-cli 流程。
6. 目标 E2E 失败时完成 runner cleanup，不修改或重跑未受相关变化影响的命令；本 Task 不运行 `make e2e`、`make verify` 或 Phase 8 recheck。
7. 证据不得包含连接值、password、Cookie、CSRF、header/body、storage state、签名 URL或敏感正文；必须记录 database、Redis、storage、process、ports cleanup。
8. A29 完成只关闭 selector owner；Phase 8 保持 `NOT_MET`，A30 仍开放，不更新 docs 07/08，不开始 Phase 9。

## Acceptance Criteria

- [x] 失败根因由页面级重复 menuitem 定位收敛到当前可见菜单 owner，没有产品缺陷推断或产品修改。
- [x] `mvp-flow.spec.ts` 不再使用该页面级歧义 locator，且没有 `.first()`、force、sleep、retry 或弱化断言。
- [x] 相关 frontend lint/typecheck 通过。
- [x] 现有隔离 runner 中目标 V1 `mvp-flow` 通过，实际 pass/fail/skip、耗时和退出码已记录。
- [x] database、Redis、storage、services 和固定端口 cleanup 完整，证据无敏感值。
- [x] diff 仅包含获准测试/evidence，未运行完整 gate、未更新 07/08、未开始 A30 或 Phase 9。
- [x] 提交计划单独报告并等待批准；不自动 commit、push、PR 或归档父任务。

## Out of Scope

- 修改旧前端产品菜单、Ant Design overlay 生命周期或业务删除合同。
- 修复 Celery 输出 owner、运行 A30、最终 `make verify` 或新的 Exit Gate recheck。
- 处理 `mvp-flow` 中未复现的其他 locator、重构测试 helper 或拆分长测试。
