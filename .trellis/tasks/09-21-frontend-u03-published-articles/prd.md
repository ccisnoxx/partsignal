# U03 发布成果列表

## Goal

验收 `/publishing/articles` 的服务端搜索、排序、分页、固定只读列、URL 恢复与详情链接。

## Requirements

- 前置 U02、F05 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.3 节、`05-business-actions-state-and-api-contract.md` PublishedArticle List 合同、`11-frontend-redevelopment-task-list.md` U03 和 OpenAPI。
- 页面只使用一次列表响应绘制五列；标题进入 canonical Article Detail，URL domain 打开公开页面；不按分页结果本地搜索/排序、不逐行读取配置、不显示业务操作列。
- `q/page/pageSize/sort` 使用 canonical URL，六种排序、count 和页内行由服务端处理；加载、空结果、筛选空态、错误和缓存刷新可辨识。
- 发布成果核验状态文案与中文界面一致，移动与桌面可操作且无页面横向溢出。

## Acceptance Criteria

- [x] model/组件测试验证参数映射、固定五列、只读链接、状态与失败处理。
- [x] 当前候选浏览器验证 URL direct/refresh/Back/Forward、搜索/排序/分页、空态/错误、宽度和键盘进入详情。
- [x] 记录实际代码、验收证据及 U04 下一步。

## Notes

- 本项拥有发布成果列表及其直接测试；详情独立验收归 U04。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`published-article-list-page.tsx` 将“首次核验”状态徽标由英文 `Passed` 改为中文“通过”，组件和浏览器定位器同步。既有单请求列表、服务端 `search/sort/page/page_size`、五列只读布局和 canonical URL 实现经核对符合合同，无额外数据行为修改。
- `published-article.model.test.ts` + `published-article-list-page.test.tsx`：2 files / 6 tests 通过；`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 当前候选生产预览 `published-articles.spec.ts` 移动/桌面 6/6 通过：键盘打开详情、URL direct/refresh/Back/Forward、搜索/排序/分页、空态/筛选空态/typed 错误、375/768/1024/1440 宽度。该 fixture 只验证前端列表与详情 handoff，真实栈闭环留 U07。构建仅有既存大 chunk 提示。
- 下一步 U04 发布成果详情，核对不可变来源快照、lineage、首次成功核验和问题入口。
