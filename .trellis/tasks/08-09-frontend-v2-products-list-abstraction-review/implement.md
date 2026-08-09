# Products List 抽象回顾 Implementation Plan

## 审查对象和基线提交

- 基线：`afa347c92a83deb27fcfd77f07c033bbdbf9ee9a`。
- Products List 实现差异：`4e21412^..4e21412`；归档任务：`.trellis/tasks/archive/2026-08/08-09-frontend-v2-products-list/`。
- 审查对象：Product model/API/page/route、unit/component tests、Products fixture/Playwright、Products List 实施期间修改的 Auth、RowActions、AppShell/Foundation smoke、测试文档和 frontend specs。
- 规划分支：`codex/frontend-v2-products-list-abstraction-review`；base branch：`main`。

## Findings 记录方式

在 `design.md` 的 findings ledger 中记录 `severity / file:line / evidence / ownership / decision / change trigger / resolution`。最终报告沿用同一严重度顺序，并把每项放入六类归属矩阵；未证实的问题不转成代码变更。

## Domain / Design System / Shared 归属矩阵

- Product domain：search/canonicalization、URL→API mapping、query/action/status/formatter、Product filters/cells/dialog/page composition。
- Design System：Table Kit primitives/pattern、RowActions resolved presentation contract。
- Shared/App：generated API client/types、Auth session/CSRF、App Shell/Router providers。
- 不提升：Error parser、date/filter/status/action registry、DataTable/server-list hook；等待第二个真实消费者。

## 允许触发重构的证据门槛

1. 可复现缺陷或权威 spec 冲突；
2. 真实重复、稳定所有权、明确测试边界或多个具体消费者；
3. 修改后净减少复杂度，不新增只转发 wrapper、配置开关或兼容分支；
4. 仅文件长度、命名偏好或未来页面预测一律不触发。

## 实施顺序

1. 修复 blocker refetch：移除无条件清空 target，使用已有 query-derived `conditionsOpen` 决定关闭。
2. 扩充现有 component test：第一次 refetch 后 blocker 仍存在且内容更新，弹窗保持；第二次 blocker 消失后自动关闭。
3. AppShell test 将 Products GET mock 收窄到焦点测试，删除共享 suite 内的 Product normalization 重复用例。
4. 删除 component 层完整 URL 交互重复；Products Playwright 保留两个代表性 server-token 行，删除占位详情导航和六 token 重复，合并长文本断言。
5. 运行针对性验证、trellis-check、spec 更新必要性评估和最终 diff 审计。

## 预计修改文件上限

产品代码/测试最多修改 4 个现有文件，不新增实现文件：

```text
frontend-v2/src/domains/product/products-list-page.tsx
frontend-v2/src/domains/product/products-list-page.test.tsx
frontend-v2/src/app/layout/app-shell.test.tsx
frontend-v2/tests/e2e/products-list.spec.ts
```

Trellis planning artifacts 另含 `task.json`、`prd.md`、`design.md`、`implement.md`。若需要第五个代码/测试文件、任何新文件或权威文档行为变更，停止并重新评估范围。

## 针对性验证矩阵

| 变更 | 必需验证 |
|---|---|
| Product model/action coverage 保留 | `products-list.model.test.ts` |
| blocker component 行为与测试简化 | `products-list-page.test.tsx` |
| AppShell test mock 作用域 | `app-shell.test.tsx` |
| production-artifact Products 用户流程 | `tests/e2e/products-list.spec.ts` |
| 任意 TypeScript 变更 | frontend-v2 lint、typecheck |
| 最终范围与格式 | `git diff --check`、diff 审计 |

必需命令：

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/product/products-list.model.test.ts \
  src/domains/product/products-list-page.test.tsx \
  src/app/layout/app-shell.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run e2e -- tests/e2e/products-list.spec.ts
git diff --check
```

Products Playwright 的 webServer 已构建 production artifact，因此不重复单独运行 build。`make verify`、完整 frontend suite、Foundation smoke 和 backend/OpenAPI 检查不是必需验证；只有实际越过 shared/Table/Router/contract 边界时才扩大。

## 停止条件

- 需要修改 backend、OpenAPI、database、generated schema、Table Kit API、Router shared contract 或新增依赖。
- 预计超过 4 个现有代码/测试文件，或需要新增业务/shared 文件。
- 没有第二个真实消费者却要求提升 shared abstraction。
- 需要改变批准业务行为、解决 UPDATE UX 或开始后续页面。
- 工作树出现不明修改、active task 冲突或基线发生未复核变化。
- 同一失败在无新 root-cause 证据下重复，或修复开始扩展到无关范围。

## Rollback Point

- 当前 rollback point：`afa347c92a83deb27fcfd77f07c033bbdbf9ee9a`。
- 无数据、contract、部署或 public API 迁移；回滚为整体撤销本 Task 的四个代码/测试文件。
- 不使用 reset、历史改写或兼容层；需要回滚时使用可审计的普通反向修改。

## 明确非目标

- New Product、Product Detail、Fact Workspace/Review、Fact Version Detail、新业务路由。
- backend/OpenAPI/database/generated schema/V1/deployment/cutover 修改。
- 新依赖、Design System 大规模重构、跨 domain abstraction。
- 通用 Error Parser、Action/Status/Date/Filter registry、DataTable、server-list hook。
- 重写 Products List、改变业务行为、commit、merge、push、archive 或开始 New Product。

## 执行结果

- 代码/测试严格修改计划内 4 个既有文件，净变化 `+20/-65`；未新增实现文件、依赖、路由、shared abstraction 或业务能力。
- targeted Vitest：3 files、15 tests 全部通过。
- frontend-v2 lint、typecheck 全部通过。
- Products Playwright：mobile/desktop 共 10 tests 全部通过；webServer 使用 production artifact。
- `git diff --check` 和 Trellis task validation 通过。
- `trellis-update-spec` 评估为无需修改稳定 spec：`.trellis/spec/frontend/state-management.md` 已明确规定删除条件目标 ID 与最新 query projection 的所有权，本次只修复偏离并增加回归。
