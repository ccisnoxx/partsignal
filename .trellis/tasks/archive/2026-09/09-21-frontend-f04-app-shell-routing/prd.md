# F04 App Shell、导航、URL schema 与 404

## Goal

完成清单 F04：验收 App Shell、导航元数据、面包屑、URL schema 和未知路径 404，并修复本轮发现的可见导航文案缺口。

## Requirements

- 前置：F01–F03 本轮通过。权威：`docs/frontend-v2/02-information-architecture-and-routing.md` 第 6、8–12 节、`.trellis/spec/frontend/visual-system.md` 与现有 route metadata。
- `AppShell` 是唯一业务导航 owner；active nav 从 `navId` match 元数据推导，移动导航使用 Sheet，pathname 变化聚焦主内容，search 变化不抢焦点。
- Breadcrumb 从 route metadata 生成；本轮检查发现 Content Editor/Review 与 GEO Observation New/Correct 四个 canonical route 仍使用英文或中英混杂面包屑，修正为与业务导航一致的中文。
- URL schema 由各 route/domain 持有，direct/refresh/Back/Forward 保持可恢复；未知路径显式 404。legacy 转换完整验收归 I01。

## Acceptance Criteria

- [x] Shell、navId、面包屑、移动导航和 pathname 焦点符合上述行为；四处已确认的面包屑文案一致。
- [x] AppShell 直接测试与相关 production artifact 浏览器场景通过，含 URL 恢复和未知路径 404。
- [x] 实际 diff、验证和 F05/F06 下一步记录清楚。

## Scope

仅修改 `frontend/src/routes/` 的可见导航元数据与必要错误标题；不修改业务状态、URL schema、legacy redirect 或 AppShell 状态结构。F05 Agent 仅拥有 `frontend/src/design-system/data-table/`。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：四个 canonical route 的面包屑与标题统一中文：内容编辑、内容审核、新建观测、更正观测。更正页的加载和失败标题同步改为中文。未改动路由路径、URL 参数或业务状态。
- `app-shell.test.tsx`：6/6 通过；`legacy-routing.spec.ts` 与 `products-list.spec.ts` 在生产构建预览下：22/22 通过，覆盖未知路径 404、直达/刷新/Back/Forward、legacy 路由及四档宽度的产品列表。此结果验证当前候选 worktree，不能代表真实后端联调。
- `npm run lint` 与 `git diff --check` 通过。四处文案没有逐条专属浏览器断言，依赖 route metadata 检查、构建及现有路由场景。
- 下一步：F05 表格组件验收；F06 复用表单、只读 Detail 和 Markdown pattern 并检查真实交互；legacy 全量合同留待 I01。
