# 发布管理页 UI/UX 重构：技术设计

## 1. 设计结论

本任务只替换 `/publications` 的呈现层与页面内导航，不修改发布领域模型、API、权限或状态转换。最小可行设计是继续使用一个 `PublicationsPage.tsx` 作为页面所有者，复用现有查询与共享组件，把当前三个资源平级 Tab 改为任务优先的三个视图：

```text
/publications
├─ 待处理（默认，tab=works）
│  ├─ 紧凑状态摘要
│  ├─ 开放内容问题（有数据时优先）
│  ├─ 当前发布工作（服务端已按处理优先级排序）
│  └─ 待开始内容
├─ 发布成果（tab=articles）
│  └─ 首次核验成功的只读成果
└─ 历史记录（tab=history）
   ├─ 已关闭发布工作（status=CLOSED）
   └─ 已解决内容问题（status=RESOLVED）
```

桌面使用紧凑表格，移动端使用任务卡片；二者消费同一查询结果与动作投影。页面不增加通用页面壳、查询聚合层、全局 Store、组件库或新依赖。

## 2. 页面信息架构

### 2.1 页头与一级视图

- 根容器改回项目标准 `.page-stack`，并增加单一页面限定类 `.publication-workbench`。
- `PageHeader` 只保留页面身份和一句业务说明，不放展示型 Hero 或额外主按钮。
- 一级 `Tabs` 使用“待处理 / 发布成果 / 历史记录”。继续使用现有 `tab` 查询键；为减少无价值 URL 迁移，默认值保留 `works`，发布成果保留 `articles`，仅新增 `history`。
- 切换一级视图时清理不再适用的分页、状态、选中对象与资源类型参数，避免跨视图脏状态。

### 2.2 待处理工作台

- 顶部使用一条紧凑状态摘要展示服务端五个真实计数。该区域是工作导航提示，不复制 `MetricTile` 大卡，不在前端重算统计。
- 开放内容问题有记录时排在当前发布工作之前；无记录时不渲染整块空面板，避免挤压核心工作。
- 当前发布工作直接使用 `GET /publication-works` 未指定状态的响应；后端 `publication_queries.py:359-419` 已保证只返回未终结工作，并按 `ACTION_REQUIRED → AWAITING_VERIFICATION → PLATFORM_REVIEW → PREPARING` 排序。
- 当前发布工作保留紧凑状态筛选，继续通过 `status` 查询键和现有 API 过滤；筛选只作用于工作区块，不改变开放问题和待开始项。
- 待开始项继续使用现有实时派生接口，不创建前端副本或分页协议。
- 发布工作与开放问题各自保留独立分页，分别使用 `work_page` 与 `issue_page`；待开始项不分页。这样不伪造跨资源全局顺序，也不截断超过一页的真实待办。

### 2.3 发布成果与历史记录

- 发布成果继续读取 `PublishedArticle`，保持只读；使用 `page` 查询键分页。
- 历史记录内部使用紧凑分段选择“已关闭工作 / 已解决问题”，继续复用 `status=CLOSED|RESOLVED` 和 `page`。
- `COMPLETED PublicationWork` 不在历史记录重复显示，因为对应事实已经由只读发布成果持有。

## 3. 响应式呈现

### 3.1 桌面

- `min-width: 768px` 使用 Ant Design `Table` + `TableRegion`。
- 内容/标题列保持弹性并使用现有 `TableCellText` 或等价 Tooltip 省略合同；状态、时间、数量和操作列使用紧凑宽度。
- 操作列仅容纳 `primary_action` 和“更多操作”，宽度按真实按钮收敛，不再使用 220–230px；固定列必须保留不透明背景与相邻列边界。
- 1440×1000 首屏中，页头、一级导航、紧凑摘要和第一组可行动内容必须可见。

### 3.2 移动端

- `<768px` 不渲染发布页业务表格，改用本页局部任务卡片列表；不靠隐藏固定列或缩小字体维持桌面表格。
- 卡片按“标题/对象 → 状态与类型 → 平台和时间 → 当前说明 → 操作”顺序呈现。标题是明确详情入口，主动作始终可见，次级动作继续进入 Dropdown。
- 卡片按钮、分页和 Drawer 关闭入口满足至少 44×44 CSS px；正文允许换行，长 URL 留在详情中处理。
- 卡片与桌面表格消费同一数组、同一 `ActionButtons` 和同一详情打开函数，不复制权限或状态逻辑。

## 4. URL 与详情所有权

- 保留 `tab`、`status`、`page`、`selected`，新增必要的 `kind=work|article|issue`、`work_page`、`issue_page`。
- 混合视图中的选中对象必须带 `kind`，由它决定详情查询。发布成果页可以从 `tab=articles` 确定 `article`；没有明确资源所有者的值不猜测加载。
- 当前已部署的 `tab=works` 和 `tab=articles` 继续有效；旧 `tab=issues` 不保留别名，因为新信息架构已明确由 `tab=works&kind=issue` 表达开放问题、由 `tab=history&status=RESOLVED&kind=issue` 表达问题历史。
- 页面使用共享 `useFocusReturn` 记录详情触发器；Drawer 在 `afterOpenChange(false)` 后恢复仍存在的原触发器。直接 URL 打开时没有触发器，关闭只清理 URL，不猜测相邻元素。

## 5. 组件边界

继续在 `PublicationsPage.tsx` 内保留以下局部职责，避免为一个页面增加通用抽象：

- `ActionButtons`：只渲染服务端 `primary_action` 与其余 `available_actions`。
- `ActionModal`：沿用现有命令字段、载荷、校验和反馈。
- `DetailDrawer`：根据显式资源类型读取详情并呈现摘要、历史与动作。
- 页面局部桌面表格与移动卡片：只负责同一资源数组的不同视觉投影。

不提取通用“响应式列表”或“工作台配置”组件。若实现后单文件因稳定职责明显失控，只允许把 Overlay 整体移到一个相邻文件；不得先为行数预建接口或工厂。

## 6. 样式边界

- 删除 `workspace.css:420-507` 与移动断点中只服务旧页面、当前无消费者的 `.publication-*` 规则。
- 在同一位置写入新的页面局部结构：工作台、紧凑摘要、视图区块、桌面表格、移动任务卡片、Drawer 分区。
- 所有颜色、边框、圆角、阴影、字体和动效继续消费 `--ps-*` Token 或 Ant Design 主题；不采用 UI 建议工具输出的 Web Font、原始色值、Hero、夸张字号或新图标库。
- 复用现有 `@media (max-width: 767px)` 断点，不新增相邻断点；`@supports` 不透明回退同步移除失效类并保留新 Drawer 表面。

## 7. 数据流与业务合同

```text
URL 查询参数
  → 选择视图、资源类型、筛选与分页
  → 现有 React Query queryKeys
  → 现有发布读取 API
  → 同一响应投影为桌面表格或移动卡片
  → 用户触发服务端 primary_action / available_actions
  → 现有显式命令 API
  → 统一失效 publications / tasks / dashboard / geo 查询
```

- 摘要、工作优先级、动作资格、权限和状态转换继续由服务端拥有。
- 前端只解析受支持 URL 枚举；不从字段组合推断动作，不合并分页结果计算业务顺序，不为缺失数据补默认事实。
- API、OpenAPI 生成类型、数据库与后端代码均不修改。

## 8. 测试设计

### 8.1 组件测试

- 默认视图显示“待处理”，并同时呈现当前工作、待开始与开放问题的正确区域。
- URL 可恢复工作、成果和问题详情；混合视图的 `kind` 选择唯一详情查询。
- 原有失败核验继续待处理、服务端动作投影、关闭影响和提交载荷测试全部保留。
- 历史视图只查询 `CLOSED` 或 `RESOLVED`，不重复展示发布成果。

### 8.2 真实浏览器

- 在现有 `mvp-flow.spec.ts` 的真实发布闭环中增加失败核验后的移动工作卡片与详情入口验证，再复核成功形成成果；后续开放问题改走统一待处理入口。
- 直接测量 1440×1000 第一组行动区是否位于首屏，375px 卡片标题与主操作是否可点击且不相交。
- `cross-page-visual-convergence.spec.ts` 的 24 表清单仍保留发布桌面表；375px 对这两项改为验证已登记的移动替代区域，而不是要求被设计取消的表格可见。
- 真实 200% 缩放中，发布管理验证移动任务卡片边界和关键操作；其他四类代表表继续使用原表格边界检查。

### 8.3 人工视觉批准

- 自动检查通过后，用独立命名的 `playwright-cli` 会话检查 1440×1000 与 375×900 浅色页面，并补看桌面深色 Drawer。
- 候选截图先放任务候选资产；只有用户明确批准最终页面后，才登记到任务 `assets/approved/manifest.md`。本任务不新增跨页自动截图基线，几何与交互回归已由定向 E2E 保护。

## 9. 兼容、回滚与风险

- 无数据库迁移、接口兼容或部署顺序要求；代码和静态资源同版本发布即可。
- 回滚只涉及本任务前端组件、样式和测试，不影响已产生的发布工作、成果、问题或 GEO 数据。
- 主要风险是混合视图分页、移动替代表导致旧 24 表门禁误判，以及 URL 详情类型不明确；设计分别用独立分页键、显式移动替代清单和 `kind` 约束处理。
- 不保留旧 `.publication-*` 样式或旧 `tab=issues` 兼容分支，避免形成第二套信息架构。

## 10. 影响文件

- `frontend/src/features/publications/PublicationsPage.tsx`
- `frontend/src/styles/workspace.css`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- 当前任务的规划与经用户批准的视觉资产

不修改根合同、后端、数据库、依赖清单或权威业务设计文档。
