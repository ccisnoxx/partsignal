# Frontend V2 New Content Task DirtyGuard Gate — Implementation Plan

> 已按用户批准激活并完成实施与 required validation；当前等待 commit plan 确认。

## 1. 精确修改文件

1. `frontend-v2/src/routes/_app/content/tasks/new.tsx`
   - 仅在 `onProductIdChange` 的 search navigation 增加 `ignoreBlocker: true`。
   - Cancel 与 `onCreated` 保持普通 navigation，不绕过 DirtyGuard。
2. `frontend-v2/src/domains/content/new-content-task-page.test.tsx`
   - component router harness 镜像生产 route 的 canonical navigation option。
   - 先等待 `productId` search 完成，再断言 dependent Fact、Platform 保留和无误弹 Dialog。
   - 保留 ErrorSummary/字段关联；把 Cancel 流程拆成可归因的 stay/leave 断言，并覆盖值、URL、页面位置与焦点。
   - 保留成功创建进入 canonical Detail、列表失效和无 DirtyGuard 的既有证明。
3. `frontend-v2/tests/e2e/new-content-task.spec.ts`
   - 在现有用例内区分页面-owned Product search push 与用户发起的 Back/Forward full-URL navigation。
   - 复用现有 fixture/页面，不新增 spec、helper 或 orchestration；补齐 stay/leave 后的 URL、值和焦点断言。

预计不修改：

- `frontend-v2/src/design-system/forms/dirty-guard.tsx`
- `frontend-v2/src/design-system/forms/dirty-guard.test.tsx`
- `frontend-v2/src/domains/content/new-content-task-page.tsx`
- contracts、backend、generated types、V1、其他 domain 与权威文档

若实施需要越出上述三文件或改变 DirtyGuard 公共行为/props，停止并先报告，不自行扩大。

## 2. 执行顺序

1. 用户批准最新规划后，从最新、tracked-clean 的本地 `main` 创建 `codex/frontend-v2-new-content-task-dirty-guard-gate` 并运行 `task.py start`。
2. 在 production route 标记唯一 canonical search navigation 为 `ignoreBlocker`。
3. 同步 component harness，并重写现有断言的事件顺序；不增加等待时长或时间型同步。
4. 对齐现有 New Content Task Playwright full-URL 场景，明确 internal push 与 real Back/Forward 的不同合同。
5. 运行下列 required validation；只修复由本次改动导致或本任务已确认的失败。
6. 检查 diff，确认 shared DirtyGuard、业务创建流程及范围外文件未变化，再报告结果和提交计划；未经确认不提交、不 push。

## 3. Required validation

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/content/new-content-task-page.test.tsx \
  -t "必填错误完整关联 ErrorSummary，DirtyGuard 覆盖 Cancel"

npm --prefix frontend-v2 run test -- \
  src/domains/content/new-content-task-page.test.tsx

npm --prefix frontend-v2 run test -- \
  src/design-system/forms/dirty-guard.test.tsx

# 排除单文件调度偶然性，直接证明原 281/1 unit gate 已关闭。
npm --prefix frontend-v2 run test

npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint

# 直接运行真实 route 的 production-artifact 同域回归；Playwright webServer 自行构建当前 artifact。
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/new-content-task.spec.ts \
  --project=foundation-desktop

git diff --check
```

失败归因规则：没有代码、配置或环境变化时不重复同一失败；不得用 sleep、固定延迟、轮询循环、timeout 扩大或弱断言使其变绿。

## 4. Optional validation

无默认重型门禁。本 Task 不运行 `make verify`、完整 `make e2e`、Content AI real-stack 或 Phase 4 closeout。只有实施意外触及 shared DirtyGuard（应先停止并获批）时，才按用户要求增加所有直接消费者相关测试和独立 production build。

## 5. Review gate

- [x] production diff 只为 route-owned `productId` canonical navigation 增加单次 blocker bypass。
- [x] shared DirtyGuard 的 pathname/search/hash 真实导航合同与测试逐字保留。
- [x] Cancel stay/leave、Product URL 同步、成功 Detail 三条证据互不借用同一个未归因 Dialog。
- [x] 没有 sleep、timeout、轮询、弱化查询、第二 blocker、兼容分支或新 helper。
- [x] 代码、测试、state-management spec 与归档 full-URL 决策一致；无需业务文档更新。
- [x] 未处理 Content AI timeout，未运行 Phase 4 最终 closeout，未进入 GEO。

## 6. Execution record — 2026-08-12

- 精确 blocker regression：`1 passed / 8 skipped`。
- New Content Task component：`9 passed`。
- shared DirtyGuard：`1 passed`。
- V2 unit：`48 files / 282 tests passed`，原 `281 passed / 1 failed` blocker 已关闭。
- V2 typecheck、lint：通过。
- New Content Task production-artifact：foundation desktop `10 passed`；Playwright webServer 使用当前 production build，仅报告既有 chunk-size warning。
- `git diff --check`：通过。
- `trellis-check`：spec、URL/form/router ownership、shared contract、测试归因、依赖方向、范围与 diff 自审均通过；无需更新稳定 spec 或业务文档。
- 分支：`codex/frontend-v2-new-content-task-dirty-guard-gate`；尚未 commit、merge、push、archive。
