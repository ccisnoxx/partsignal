# 前端失败恢复与全 UI 验收设计

## 责任边界

本任务不重复实现发布、审核或 GEO 的正常业务交互。领域子任务各自交付契约消费、正常页面和目标组件测试；本任务只负责：

- 共享加载、失败、无权限和重试原语。
- 各领域真实空状态与前置入口的完整覆盖。
- 跨 feature 查询失效和工作台聚合导航。
- 从内容任务创建开始的全 UI 端到端验收。

## 查询状态模型

每个依赖查询显式区分：

1. `loading`：显示稳定骨架或加载提示，不渲染可提交空表单。
2. `permission denied`：403 显示无权限，不提供无意义的写重试。
3. `error`：显示中文错误、`request_id` 和重试操作。
4. `empty`：由领域页面给出准确前置条件和导航入口。
5. `success`：只有所有必需依赖成功后启用提交。

共享组件只实现 `QueryLoading`、`QueryFailure + retry` 和 `PermissionDenied`。空状态不做万能推断，由产品、任务、发布和 GEO 页面分别定义。

## 路由与可恢复状态

- 发布详情：`/publications/:publicationId`
- 发布异常详情：`/publication-attentions/:attentionId`
- 发布修复：`/publication-attentions/:attentionId/repair`
- 内容审核：沿用 `/content/:contentVersionId`
- 事实版本：`/products/:productId?tab=versions&fact_version_id=...`
- GEO 筛选：`/observations?...`
- GEO 更正：`/observations/:observationId/correct`

刷新、工作台跳转和分享 URL 必须恢复相同上下文。Modal 可以作为视觉呈现，但其资源 ID 与打开状态必须由路由驱动。

## Query Key 与失效矩阵

新增轻量 query-key 定义函数，不引入通用数据层：

- publication detail/list/candidates/attention/repair context
- content/fact review context
- GEO list/metrics/history/candidates，key 包含规范化筛选
- dashboard summary
- content task detail/list

各 mutation 明确失效相关资源。例如发布验证成功后必须刷新发布详情/列表、任务详情/列表、候选、异常和 Dashboard。不得只刷新当前 Modal 对应查询。

Query key 只集中命名和参数，不封装业务请求或错误解释，避免无意义抽象。

## 工作台导航

Dashboard 只消费服务端计数并链接到领域拥有的筛选语义：

- 待审事实 → 具体事实审核队列/版本深链。
- 待审内容 → 内容审核队列/版本深链。
- 待发布 → 发布候选筛选。
- 发布异常 → `OPEN PublicationAttention` 列表。
- 近期准确性错误 → GEO `accuracy=PARTIAL,INCORRECT` 与时间窗筛选。

计数不由前端重新计算。

## E2E 边界

受控 fixture 可以准备：

- 账号和登录状态。
- 平台、账号、批准事实、问题、测试 AI 渠道和模型。
- 真实 HTTP 测试替身所需环境。

从“创建内容任务”开始，以下被验收步骤必须全部走 UI：

1. 创建任务并生成草稿。
2. 查看审核证据、退回/修改/批准。
3. 选择匹配平台账号、登记发布并验证，观察任务自动完成。
4. 制造发布异常、查看待办、创建修复任务并显式解决。
5. 登记 GEO 观测、筛选、追加更正并查看历史。
6. 从 Dashboard 深链到待办和错误结果。

测试文件中将 fixture 准备与被验收业务步骤明确分区。不得用 `page.request` 绕过上述步骤。

## 测试分层

- 领域组件测试：由各领域子任务负责正常交互与业务错误。
- 共享组件测试：本任务覆盖 loading、500、403、retry 和空状态承载。
- Playwright：一条完整主闭环，加少量关键失败路径；不把组件矩阵全部复制到 E2E。

## 回滚

共享状态组件可独立回滚，但不能恢复把错误伪装为空数据的旧分支。全 UI E2E 失败时阻止父任务完成，不通过 `page.request` 绕过失败步骤。

## 最终确认补充

- 稳定路由至少覆盖发布详情/修复、具体事实版本、内容审核、GEO URL 筛选和记录更正；刷新后资源 ID 与筛选必须保持。
- Query key 只集中命名和规范化参数，不封装业务请求、业务状态解释或第二套 DTO。
- mutation 失效矩阵必须覆盖跨域副作用：发布验证刷新任务，发布失效刷新异常，GEO 更正刷新列表/指标/Dashboard。
- Playwright fixture 可以调用 API 准备账号、平台、批准事实、测试模型和外部替身；测试文件必须明确标出 fixture 边界。
- fixture 完成后，所有被验收业务动作只能通过页面交互；允许测试读取外部替身调用计数，但不能用 API 代替业务动作。
