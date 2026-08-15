# Frontend V2 AI Channel Workspace Closeout

## Goal

在 AI Channel Workspace 的 Core、Models、Runtime 已全部交付后，删除阶段性 delivered-tab gate、其专用过期 not-found 文案和对应单元测试，使路由直接消费已经封闭为五个合法 tab 的 canonical search。本 Task 只做最终过渡代码清理，不改变 Workspace 业务行为、API、合同、持久化或设计。

## 已确认事实

- 本 Task 是父 Task `08-14-frontend-v2-ai-channel-workspace` 的最终 closeout 子 Task；Core、Models、Runtime 三个子 Task 已归档并合入当前本地 `main`。
- 创建本 Task 前主工作区位于 clean `main`；本地 `main` 比 `origin/main` 超前 206 个提交，因此分支基线使用当前本地最新 `main`，不执行远端同步。
- `aiChannelWorkspaceSearchSchema` 已把路由 search 封闭为 `basic | request | models | usage | logs`，未知 tab 会 canonicalize 为 `basic`。
- `isDeliveredAIChannelWorkspaceTab` 当前对上述五个合法 tab 恒为 `true`；路由中的两处 gate 已不可达。
- route-level `notFoundComponent` 只服务于该阶段性 gate，文案“该 AI 渠道区域尚未交付 / 当前已提供基本信息、请求配置与模型管理”已过期。
- API Detail 返回 404 时的“未找到 AI 渠道 / 该渠道不存在，或已被删除”仍是有效真实错误状态，不在本 Task 范围内。

## Requirements

1. 用户批准本规划后运行 `task.py start`，从当前本地最新 `main` 创建且只创建临时分支 `codex/frontend-v2-ai-channel-workspace-closeout`。
2. 删除 `isDeliveredAIChannelWorkspaceTab` 的定义与导出、路由中的两处调用和不再需要的 import。
3. 删除只由 delivered gate 使用的 route-level `notFoundComponent` 及过期文案。
4. 删除 `ai-channel-workspace.model.test.ts` 中对应 helper import 和四条恒真断言；保留五 tab canonical search、真实 API 404 和其他 Workspace 测试。
5. 生产代码范围只允许触及：
   - `frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts`
   - `frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts`
   - `frontend-v2/src/routes/_app/_admin/settings.ai_.$channelId.tsx`
6. 不修改 OpenAPI、backend、generated types、`contracts/database.md`、Frontend V2 权威文档、依赖或其他页面；本次删除不改变任何合同或持久化事实。
7. 完成 Required validation 后展示精确 commit plan 并等待用户确认；确认前不提交。确认后提交、归档 closeout 与父 Task、fast-forward 合入 `main`、删除临时分支后停止；不 push、不创建 PR。

## Acceptance Criteria

- [x] Workspace route 不再包含 delivered-tab gate、`notFound()` 阶段保护或“区域尚未交付”文案。
- [x] 五个 canonical tab 的 URL、查询参数和页面行为保持不变；未知 tab 仍 canonicalize 到 `basic`。
- [x] 真实 AI Channel Detail 404/403/generic 页面行为保持不变。
- [x] 对应恒真 helper 测试被删除，没有用新 helper、fallback 或兼容分支替代。
- [x] 以下 Workspace 单测通过：
  `npm --prefix frontend-v2 run test -- src/domains/configuration/ai-channel-workspace.model.test.ts src/domains/configuration/ai-channel-workspace-page.test.tsx`
- [x] `npm --prefix frontend-v2 run lint` 通过。
- [x] `npm --prefix frontend-v2 run typecheck` 通过。
- [x] 以下 Core/Models/Runtime Playwright 通过：
  `npm --prefix frontend-v2 run e2e -- tests/e2e/ai-channel-workspace-core.spec.ts tests/e2e/ai-channel-workspace-models.spec.ts tests/e2e/ai-channel-workspace-runtime.spec.ts`
- [x] `git diff --check` 通过，diff 仅含获批的删除与 Trellis Task 记录。
- [ ] 提交前已展示精确 commit plan 并获得用户确认；最终没有 push、PR、临时分支或活动 Workspace Task。

## Out of Scope

- 新增、调整或重构 Workspace tab、search、表单、Runtime、API、缓存、错误状态或测试架构。
- 删除真实资源 not-found/forbidden/generic 状态及其文案或测试。
- 运行 V1、backend、contract、build、完整 V2 unit/E2E 或 real-stack 套件；本次纯前端不可达代码删除不影响这些边界。
- 修改父 Task 的历史阶段设计；其 Core → Models → Runtime gate 记录属于已执行决策历史。

## 风险与延后项

- 主要风险是误删真实 API 404 展示；通过限定三份文件、保留 page-level error mapping，并运行 Workspace unit 与三份 production-artifact Playwright 控制。
- 不运行 build 或全套测试；lint、typecheck、targeted unit 与三份 Workspace Playwright 已直接覆盖本次删除，剩余风险仅为与本变更无直接关系的仓库级回归。

本 Task 是单一不可达过渡代码删除，没有新的架构、合同、数据流或迁移设计，因此按 lightweight 流程只维护 `prd.md`，不创建空 `design.md` 或 `implement.md`。

## 实施结果（2026-08-15）

- 生产代码只修改已批准的三份文件，共删除 delivered helper/export、路由两处恒假保护、route-level 过期 not-found 组件及四条恒真断言；没有新增代码。
- Workspace targeted Vitest：`2 files / 16 tests passed`；lint、typecheck 均通过。
- Core/Models/Runtime Playwright：mobile/desktop 两个项目共 `20 passed`；只有既有 build chunk-size 与 `NO_COLOR/FORCE_COLOR` 警告。
- `git diff --check` 通过；残留搜索确认 helper 与两段过期文案均为零引用。
- `.trellis/spec/frontend/state-management.md` 已准确记录最终五 tab 合同；本次没有新合同、模式或 gotcha，因此不更新稳定 spec、OpenAPI、数据库或 Frontend V2 文档。
- 当前停在提交门禁；未提交、未 push、未创建 PR。
