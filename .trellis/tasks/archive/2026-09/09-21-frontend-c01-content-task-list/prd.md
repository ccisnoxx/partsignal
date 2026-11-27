# C01 内容任务列表

## Goal

验收 `/content/tasks` 的服务端列表、URL 筛选分页、生命周期动作和永久删除确认。

## Requirements

- 前置 F05/P08 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.1 节、`05-business-actions-state-and-api-contract.md` ContentTaskListItem、`08-testing-quality-and-acceptance.md` Phase 3.1 和 `contracts/openapi.yaml`。
- 列表仅消费服务器 ContentTaskListItem 与按需平台筛选引用；六列显示任务、平台、聚合阶段、当前内容、最近更新、操作，不从多个 raw status 推导工作流，也不浏览器跨域 join。
- `q/workflowStage/archiveStatus/platformId/page/pageSize` 由 URL 管理并映射服务端分页/筛选；canonical direct/refresh/Back/Forward。服务端 primary/available_actions 决定入口；直接实现 CANCEL/DELETE/ARCHIVE/RESTORE/PERMANENT_DELETE，命令受 CSRF/revision 与确认保护。永久删除先取实时范围 preview；409 不重放，Dialog 关闭恢复触发器焦点。
- 生产构建严格 fixture 验收空/错/加载、四档宽度与浏览器错误；真实 Content 闭环留 C08。

## Acceptance Criteria

- [x] model/组件测试覆盖 URL、六列、动作、冲突与 preview。
- [x] 当前候选生产预览浏览器测试覆盖 direct/refresh/Back/Forward、筛选分页、命令、永久删除、错误、焦点和响应式。
- [x] 记录实际改动、证据与 C02 下一步。

## Scope

拥有 Content Task List 与直接测试；共享生命周期命令只在出现具体缺口时调整。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：现有 Content Task List/model/lifecycle 符合当前合同，本项未修改生产代码或测试；C01 PRD 是本轮验收记录。
- `content-task-list.model.test.ts` 与 `content-task-list-page.test.tsx`：2 files / 14 tests 通过。当前候选生产构建预览 `content-task-list.spec.ts`：两个 Playwright project 14/14 通过，覆盖六列、服务端投影、URL direct/refresh/Back/Forward 与筛选分页、Query Topic 引用、CANCEL/DELETE 的 CSRF/comment/revision 和 409 不重放、永久删除实时 preview/确认、loading/empty/error/retry、375/768/1024/1440 页面根无溢出以及键盘/Dialog 焦点。严格 fixture 拒绝未声明 API 并审计浏览器错误。
- 该 fixture 只证明生产 artifact 的前端合同，Content 真实闭环留 C08；本项无生产代码变化，复用 P06 之后仍有效的 typecheck/lint 和本次构建证据。下一步 C02 创建内容任务。
