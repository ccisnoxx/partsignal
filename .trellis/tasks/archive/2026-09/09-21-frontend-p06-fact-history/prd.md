# P06 事实版本历史

## Goal

验收 `/products/$productId/facts/versions` 的产品专用服务端分页、六列只读历史与版本链接。

## Requirements

- 前置 P03/F05 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.6 节、`05-business-actions-state-and-api-contract.md` ProductFactHistoryList、`08-testing-quality-and-acceptance.md` Fact History 段和 `contracts/openapi.yaml` 的 ProductFactHistoryList。
- 页面只请求 Product 专用 history read model；服务端决定倒序与分页，URL 持有 `page`/`pageSize`。严格展示版本、状态、数据级别、变更摘要、提交人、提交时间六列，版本可进入只读详情；无操作列或业务命令。
- 响应的 product 和每个 item 身份与 URL 不一致时阻断整表。生产预览严格 fixture 覆盖 direct/refresh/Back/Forward、四档宽度、错误、键盘与浏览器错误审计。

## Acceptance Criteria

- [x] model/组件测试证明分页、服务端顺序、身份阻断和只读表格。
- [x] 当前候选生产预览浏览器测试证明 URL 恢复、六列/版本链接、状态与四档宽度；含跨产品 item 阻断。
- [x] 记录实际修改、证据与 P07/P08 下一步。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：生产历史页面、model 和路由经合同核对可保留；`frontend/tests/e2e/fact-history.spec.ts` 新增其他产品 item 混入时隐藏整表、链接与分页的浏览器断言。
- `fact-history.model.test.ts` 与 `fact-history-page.test.tsx`：2 files / 7 tests 通过。当前候选生产构建预览 `fact-history.spec.ts` 两个 Playwright project 共 8/8，通过 375/768/1024/1440 的页面根溢出检查；严格 fixture 拒绝未声明 API。`npm run typecheck`、`npm run lint` 与 `git diff --check` 通过。生产 build 有既有大 chunk 警告，无构建失败。
- 浏览器 fixture 仅验前端合同，真实 PostgreSQL 产品历史与版本不可变性留 P08。下一步 P07 单版本详情，然后 P08 真实 Product Facts 闭环。
