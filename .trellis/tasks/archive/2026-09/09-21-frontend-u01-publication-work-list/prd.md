# U01 Ready Queue 与发布工作列表

## Goal

验收 `/publishing/work` 的待开始队列、工作列表、服务端筛选分页与开始发布。

## Requirements

- 前置 C08、F05 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.1 节、`05-business-actions-state-and-api-contract.md` PublicationWorkListItem/Ready 合同、`11-frontend-redevelopment-task-list.md` U01、OpenAPI 与前端 Table Kit/状态 owner 规则。
- 页面以 summary、ready items、work list 三个窄读取呈现独立 surface。Ready 候选可无匹配账号，只有服务端 `START` token 才显示开始入口；用户明确选择返回的账号，服务端再次校验资格。创建使用 CSRF/稳定幂等键，409 不自动重放且保留输入/request ID。
- 工作列表固定六列；身份摘要、阶段、事件、主操作和 overflow 来自服务端投影，URL 保存筛选/分页并按服务端参数读取。加载、空态、失败/缓存刷新分别可恢复，四档宽度、键盘/焦点和 TableRegion 可用。
- 面向用户的待开始区标题及内容版本标签保持中文界面一致。

## Acceptance Criteria

- [x] model/组件检查覆盖三个 surface、token、账号选择、创建命令、冲突、URL 与表格行为。
- [x] 当前候选生产预览浏览器覆盖 direct/refresh/Back/Forward、加载/错误/空态、375/768/1024/1440、键盘焦点；连续真实发布命令留待 U07 闭环，但 C08 已证明 Content handoff。
- [x] 记录实际代码、验收证据及 U02 下一步。

## Notes

- 本项拥有发布工作列表/待开始队列及直接测试；不改 Publishing 服务端状态合同。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`frontend/src/domains/publication/publication-work-page.tsx` 将待开始队列标题、缓存刷新区名与“已批准内容 v”标签改为中文；直接组件和浏览器定位器同步更新。三个 Query、Ready token、账号选择、稳定幂等键和列表动作注册无额外代码变更。
- `publication-work.model.test.ts` + `publication-work-page.test.tsx`：2 files / 12 tests 通过，覆盖 URL/API 映射、服务端 primary/overflow、无账号合同异常、CSRF/幂等、409、pending 和三个 surface 的独立错误/刷新。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 当前候选生产预览 `publication-work-list.spec.ts` 移动/桌面 10/10 通过，覆盖三个窄 endpoint、固定六列、direct/refresh/Back/Forward、筛选分页、开始发布确认/焦点、375/768/1024/1440 与空态/刷新错误。该 fixture 不代表真实发布完成。
- C08 本轮真实栈已证明批准内容的服务端 `START_PUBLICATION` 投影和 `/publishing/work` handoff；U07 将从 Ready Queue 操作真实 START、登记和核验，当前 U01 不借用历史门禁。下一步 U02 发布工作区。
