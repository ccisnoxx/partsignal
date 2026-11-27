# P01 产品事实列表与视觉样板

## Goal

完成清单 P01：验收 `/products` 真实列表交互，并形成桌面与窄屏可操作视觉样板。

## Requirements

- 前置 F04、F05 本轮完成。权威：`docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.1 节、`04-design-system-and-interaction-spec.md`、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`；API 以 `contracts/openapi.yaml` 的 `ProductListItem/ProductList` 为准。
- 服务端承担筛选、排序、分页、total、workflow stage、唯一 primary 与 available actions；URL 拥有 `q/page/pageSize/sort/factStatus/workflowStage`。列表单次 read model，不逐行请求 Detail。
- 六列、状态与当前事实、对象详情链接、loading/empty/filtered empty/error、删除资格和冲突反馈可操作；桌面与窄屏样板符合设计规范。
- R00 发现 `05` 第 6 节对 `VIEW_FACT_HISTORY` 的过期否定，与 OpenAPI、`03` 和服务端投影冲突；本任务修正该稳定文档。

## Acceptance Criteria

- [x] Model/component 与 production artifact 浏览器场景证明 URL、API、行操作和状态，覆盖四档宽度及键盘焦点。
- [x] 检查桌面/窄屏实际截图，记录视觉样板的保留或改动结论。
- [x] 修正过期合同描述，记录实际 diff、验证、fixture 限制与 P02 下一步。

## Scope

拥有 Product 列表 Domain/Route 与所涉测试、P01 截图证据以及 `05` 中明确过期的一句合同描述。保持其他任务文件与业务逻辑不变，API 修改须另行按合同优先流程判断。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`ProductsListPage` 在小于 768px 的产品主单元格显示事实状态，列表表格在小于 1024px 使用页面专属紧凑列宽；状态列小于 768px 隐藏。共享 Table Kit 与业务动作资格未变。`products-list.spec.ts` 增加 320/375/768/1024/1440 状态可见和无页面根溢出断言，组件测试适配桌面列与窄屏摘要双 DOM 表达。
- 合同：`05-business-actions-state-and-api-contract.md` 第 6 节修正 `VIEW_FACT_HISTORY` 过期否定。`contracts/openapi.yaml`、`backend/app/services/projections.py` 及 `03` 的列表定义均支持它作为服务端 row primary；未修改 API。
- `products-list-page.test.tsx` 与 `products-list.model.test.ts` 10/10 通过。生产构建预览的 `products-list.spec.ts` 两个 project 所有五个场景已通过：第一次合跑 10/12 中两个因新增断言的 locator 同时找到桌面/移动 DOM 而失败，改为按宽度定位后两项 2/2 通过；随后扩充 320px，相关两项再次 2/2 通过。相关类型检查、lint、`git diff --check` 通过；生产构建由 Playwright webServer 成功执行。
- [桌面与窄屏视觉复核](./research/visual-review.md) 保留两张生产预览截图。Fixture 严格隔离认证与列表 API，只证明前端页面/产物；真实 Product Facts 业务闭环留在 P08。
- 下一步 P02 新建产品表单，继而 P03 详情和后续事实链。此任务不代表本轮完整清单完成。

## 独立复核跟进

独立只读 reviewer 发现移动状态摘要缺少读屏字段名（P2）；已在产品主单元格补充 `sr-only` 的「事实状态：」，并新增小于 768px 时的 Playwright ARIA snapshot 断言。修复后目标宽度场景两个 project 2/2 通过。复核未独立运行测试，也未验证真实后端；没有其他已确认缺陷。
