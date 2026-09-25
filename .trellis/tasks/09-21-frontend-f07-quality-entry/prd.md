# F07 前端质量入口

## Goal

完成清单 F07：验收当前唯一 canonical `frontend/` 的静态、组件、Storybook、生产构建与相关浏览器质量入口。

## Requirements

- 前置 F01–F06 已有本轮证据。权威：`docs/frontend-v2/11-frontend-redevelopment-task-list.md` F07、`08-testing-quality-and-acceptance.md` 第 1–5 节、`10-frontend-redevelopment-plan.md` 第 6 节。
- `frontend/package.json` 与现有配置提供 lint、typecheck、unit/component、Storybook、Playwright、production build 和 API generated type check。只审查当前 canonical 前端路径，不把历史 V2 门禁当成本轮结果。
- 完整单测与 Storybook 构建可运行；此前 F01–F06 的相关 Playwright 和生产构建结果若输入未变可复用。失败先归因再处理。

## Acceptance Criteria

- [x] 静态、generated API、unit/component、Storybook 与 production build 入口有实际本轮结果。
- [x] 相关 Playwright 证据与 fixture/真实栈边界记录清楚。
- [x] 检查实际 diff 与工作树，并交接 P01。

## Scope

本任务以质量入口与证据为主；只有明确失败原因属于当前候选时才修复相应文件。不得把已授权范围扩成历史迁移或部署验收。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：质量入口配置已可复用，本任务没有修改生产代码或脚本。F01 修复一处原有 Vitest mock 类型不匹配；F02 调整 Base UI 菜单测试对真实 `data-highlighted` 语义的断言；F04 与 F05 的代码差异另见对应任务。
- 当前候选 worktree 的 `npm run api:check`、`npm run typecheck`、`npm run lint` 均通过；完整 `npm run test` 为 83 文件、540/540 通过；`npm run build-storybook` 成功且 `dist/storybook/index.html` 存在。F06 相关 Playwright 会自建生产 artifact，20/20 通过；F04/F05 联合浏览器场景 22/22 通过，`dist/index.html` 存在。
- Playwright 是严格 fixture 的前端产物验收，不代表真实服务栈；Storybook 本轮只验证构建，不声称每个视觉变体经人工逐项检查。Vite 对部分大 chunk 给出警告，尚无页面性能测量，留给性能证据驱动的后续处理。
- `git diff --check` 通过；工作树仅包含本轮 Trellis 任务目录和已列明的前端源/测试差异，候选位于独立 worktree。下一步 P01 `/products` 页面及桌面/窄屏视觉样板验收。
