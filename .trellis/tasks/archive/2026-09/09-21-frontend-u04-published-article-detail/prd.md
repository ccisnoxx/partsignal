# U04 发布成果详情

## Goal

验收 `/publishing/articles/$articleId` 的已核验成果、冻结来源 Markdown、lineage、核验快照、时间线和问题入口。

## Requirements

- 前置 U03 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.4 节、`05-business-actions-state-and-api-contract.md` PublishedArticle Detail 合同、`11-frontend-redevelopment-task-list.md` U04 和 OpenAPI。
- 首屏单次 Article Detail 读取；标题/URL/发布时间、冻结平台账号、来源 ContentVersion、Fact/生成/review lineage、首次 PASSED verification 与有序事件均只读，身份不一致显式拒绝展示。
- 仅在 `OPEN_ISSUE` token 时提供 kind+description 问题登记；成功采用服务端 Issue ID 进入 canonical Issue Workspace。已有开放问题按 `HANDLE_CONTENT_ISSUE + open_issue_id` 交接，409 不重放并须显式重载。
- 面向用户的详情状态、问题历史和结果标签保持中文；目标宽度与键盘可用。

## Acceptance Criteria

- [x] 组件/模型验证只读快照、身份、错误、token 与问题登记和冲突恢复。
- [x] 当前候选浏览器验证列表→详情、错误/空态、问题 handoff、目标宽度和焦点；真实栈完整闭环归 U07。
- [x] 记录实际代码、验收证据和 U05 下一步。

## Notes

- 本项拥有发布成果详情及直接测试；Issue List/Workspace 分别归 U05/U06。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`published-article-detail-page.tsx` 保持问题 Dialog 在自动刷新撤销 `OPEN_ISSUE` token 后挂载、冻结旧表单与命令，仅显式重载后采用新投影；409 后取消再打开也维持冻结。失去登记按钮后，关闭 Dialog 的焦点回退至“处理内容问题”链接，再回退到可聚焦的成果标题。用户可见的成果、核验、问题状态文案改为中文。
- 详情组件 `published-article-detail-page.test.tsx` 8/8 通过，覆盖单次 Article GET、只读 Markdown/核验/lineage/事件、token 命令、409 取消重开、自动撤销 token 后草稿保留与焦点、typed 错误及身份不一致拒绝展示。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 当前候选生产预览 `published-articles.spec.ts` 与 `published-content-issues.spec.ts` 移动/桌面 12/12 通过，覆盖列表键盘进入单读详情、四档宽度、问题登记后按 canonical Issue ID 交接及 Issue Workspace。真实服务端不可变历史与完整问题修复闭环留 U07，fixture 不替代该门禁。构建仅有既存大 chunk 提示。
- 独立只读审查发现并促成修正自动刷新丢草稿与触发器卸载后的焦点缺口；复核确认均解除阻断。下一步 U05 内容问题列表。
