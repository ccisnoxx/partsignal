# C03 内容任务详情

## Goal

验收 `/content/tasks/$taskId` 的单一任务详情快照、跨域摘要、服务端动作与生命周期命令。

## Requirements

- 前置 C02 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.3 节、`05-business-actions-state-and-api-contract.md` ContentTaskDetail、`08-testing-quality-and-acceptance.md` Phase 3.3 与 OpenAPI ContentTaskDetail。
- 首屏只请求一个精确 Detail GET；展示 Task、锁定 Product/Fact/Platform、当前内容、最近生成、审核、发布、真实来源与服务端原顺序 Activity，空投影显式“暂无”。不浏览器跨域 join，不猜当前内容指针。
- Primary 与 overflow 只由服务端 task token 决定；用户界面显示业务文案，不显示内部 token/英文实现标签。生命周期命令复用当前 Content owner 的 CSRF/revision/409/删除 blocker 与焦点恢复。
- 当前候选生产预览严格 fixture 验收入口、direct/refresh/Back/Forward、readonly、错误、四档宽度及键盘；真实 Content 闭环留 C08。

## Acceptance Criteria

- [x] 单一 Detail、内容和动作经组件/model 验收，修复用户可见的内部 token/英文实现标签。
- [x] 当前候选生产预览浏览器验收导航、状态、命令、错误和响应式。
- [x] 记录实际代码、验证与 C04 下一步。

## Scope

拥有 Content Task Detail 页面及直接测试；不改后端动作资格或 read model。受影响的既有真实栈断言随页面文案同步更新。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`content-task-detail-page.tsx` 移除摘要中的原始 `primary_task`，把英文实现标签和说明改为面向用户的中文；Product 状态、事实数据级别和发布问题状态使用 generated union 穷尽映射。服务端 token 仍只用于既有动作解析，API/query/命令资格和 Activity 顺序不变。组件测试、C03 浏览器测试、P08 与 Publishing 真实栈断言随文案调整。
- `content-task-detail-page.test.tsx` 与 `content-task-actions.test.ts`：2 files / 11 tests 通过。当前候选生产构建预览 `content-task-detail.spec.ts` 两个 Playwright project 14/14 通过，覆盖 List 入口、single Detail GET、direct/refresh/Back/Forward、空摘要、primary/overflow、409 canonical refetch、404/403/retry、readonly、四档宽度与键盘焦点。
- 本轮 `npm run typecheck`、`npm run lint`、`git diff --check` 通过；Playwright 启动的当前候选生产构建通过，只有既有大 chunk 警告。修改后的 P08/Publishing 真实栈断言尚未重跑；P08 先前 4/4 业务结果仍证明此前候选的服务端主链，新文案在本轮 C03 组件与 fixture 浏览器验收，后续 C08/U07 会复核相应真实栈场景。
- 本项未修改 OpenAPI、后端状态裁决或持久化。下一项 C04 编辑器核心。
