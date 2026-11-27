# U05 内容问题列表

## Goal

验收 `/publishing/issues` 的服务端状态筛选、问题摘要、主操作、详情导航与 canonical 列表刷新。

## Requirements

- 前置 U04、F05 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.5 节、`05-business-actions-state-and-api-contract.md` PublishedContentIssue List 合同、`11-frontend-redevelopment-task-list.md` U05 和 OpenAPI。
- 单次服务端列表响应绘制六列，默认 canonical URL 为 `status=OPEN&page=1&pageSize=20`；ALL 只在 API 省略 status，分页与 count 均由服务端处理。
- 主入口和 overflow 严格按 `primary_task`、`available_actions` 与 repair task ID；详情和修复入口进入 canonical 路由，不在列表内伪执行命令。
- 创建/解决状态变化后返回列表能看到刷新后的服务端投影；移动/桌面、加载/空态/失败和键盘导航可用。

## Acceptance Criteria

- [x] model/组件覆盖 URL/API 参数、动作合同、六列和首屏单读。
- [x] 当前候选浏览器覆盖 OPEN/RESOLVED/ALL、创建与解决后的列表刷新、URL 恢复、详情/主动作和目标宽度。
- [x] 记录实际代码、验收证据和 U06 下一步。

## Notes

- 本项拥有内容问题列表、动作映射与直接测试；问题命令表单归 U06。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：列表和动作映射经合同核对满足六列、单次服务端读取、primary/overflow token 与 canonical 链接，无业务代码改动。直接测试补充 structured error/request ID 且不伪造行；浏览器测试补充创建后 OPEN 列表、解决后 OPEN 清空/RESOLVED 行、ALL API 省略 status、刷新与 Back/Forward。
- `published-content-issue.model.test.ts` + `published-content-issue-list-page.test.tsx`：2 files / 5 tests 通过，覆盖 URL/API 映射、动作合同、缺 token/repair ID fail fast、六列单读和失败恢复。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 当前候选生产预览 `published-content-issues.spec.ts` 移动/桌面 6/6 通过，覆盖列表→Workspace、Issue 创建/修复/解决后列表投影、OPEN/RESOLVED/ALL、canonical URL、375/768/1024/1280/1440 宽度。该 fixture 不替代 U07 真实栈闭环。构建仅有既存大 chunk 提示。
- 下一步 U06 内容问题工作区。
