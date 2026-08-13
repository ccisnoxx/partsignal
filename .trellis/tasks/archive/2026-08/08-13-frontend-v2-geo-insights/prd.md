# Frontend V2 GEO Insights

## 目标与用户价值

在 `frontend-v2` 交付 `/geo/insights` 单页分析工作台，让用户通过一个服务端权威 GEO Insights read model，在可复制、可刷新、支持浏览器历史的筛选上下文中查看 GEO 表现、数据质量与服务端投影的建议，并仅对服务端允许的异常创建优化 Content Task。

## 已确认事实

- GEO Observation List、New GEO Observation、Observation Detail、Correction Workspace 与 Topics 均已完成并归档，交付已进入干净的 `main`。
- 当前没有其他活动 Trellis Task；本 Task 是 Frontend V2 Phase 5 的下一个独立交付。
- 当前 `frontend-v2/package.json` 未安装 ECharts；是否需要图表依赖须由现有合同、图表复杂度、可访问性和维护成本共同决定。
- 后端是指标口径、异常资格、动作资格和输入校验的最终权威；前端不得重新计算指标、异常或动作资格。
- 本 Task 已获授权在规划审批后从最新且干净的 `main` 创建临时分支 `codex/frontend-v2-geo-insights`；不得自动 push，合并回 `main` 后须删除本地和远程临时分支。

## 需求

### 路由、导航与筛选状态

- 注册 `/geo/insights` canonical route 和 GEO 导航入口，不注册 `/geo/insights/print`，也不显示失效的打印或导出入口。
- 页面使用一个 `GET /api/v1/geo-insights` read model；不得在浏览器组合多个分页 endpoint 计算 Dashboard。
- canonical URL 保存并恢复日期范围、Product、Content Platform、GEO Platform、Published Article 和 Query Topic 六类业务筛选。
- URL 参数须与 `date_from`、`date_to`、`product_id`、`content_platform_id`、`geo_platform`、`published_article_id`、`query_topic_id` API 参数显式一一映射。
- direct URL、refresh、Back、Forward 和 Filter Bar 重置均须保持正确；无效 URL 参数必须按项目既有 canonical search 规则处理，不得静默变为错误业务筛选。

### Insights 展示

- 展示 Discovery、Mention、Accuracy 的当前值、上一周期变化，以及三个指标的时间趋势。
- 空分母不得显示 `0%`，必须显示“暂无数据”或等价的明确无样本状态；上一周期无样本须与变化为零区分。
- 展示 GEO Platform Performance。
- 展示 Content Performance 的 Best、Declining、Long Unmentioned 分组。
- 展示 Question Coverage 的 Stable、Occasional、Uncovered、Insufficient Data 分组。
- 展示 Recommendations。
- 展示 Data Quality：eligible observations、excluded incomplete observations、excluded incomplete relations、unavailable sections。
- 页面必须分别表达 loading、empty、partial data、unavailable section、error、retry 和 stale optimization 状态。
- 所有 drill-down 仅消费服务端 `primary_task` / `detail_path`；只有已实现且支持精确筛选的 canonical 页面才可成为链接。前端不得依据 rate、status 或 `rule_code` 猜测动作或导航。

### 优化任务动作

- 仅在服务端投影允许的异常上显示“创建优化任务”。若现有合同无法表达动作资格，须先提出最小 contract-first 变更，不得在页面层推导资格。
- 服务端动作 projection 必须同时表达 actor 资格与可直接并入 POST 的异常 source；前端不得根据 Declining/Long Unmentioned 所在区块或 Coverage status 推断 `rule_code`。
- 短 Dialog 只收集合同真实要求的 Product、Platform Profile 和 Approved Fact Version，并复用现有窄 options/read model；不得通过多个分页接口在浏览器拼装完整候选。
- 使用稳定 `Idempotency-Key` 调用 `POST /api/v1/geo-insights/optimization-content-tasks`。
- 服务端必须重新计算异常；前端不得把当前卡片视为最终资格。
- `GEO_INSIGHT_STALE`、HTTP 409 或资格变化不得自动重放。冲突时保留用户输入，并提供显式 reload 以获取最新 Insights。
- 成功后使用响应中的 `ContentTask.id` 导航到 `/content/tasks/$taskId`，不得通过 Content Task List 搜索新任务 ID。
- 成功后仅失效 Insights 和真实受影响的 Content Task query keys。
- Question Coverage 的服务端复算须纳入 Dialog 最终选择的 Product 与 Platform Profile，保证不可变来源快照对应实际创建目标；卡片只提供候选入口，不是最终资格。

### 可访问性、响应式与测试数据

- 验证 375、768、1024、1440 四个视口，页面根不得出现横向溢出。
- 图表不得只用颜色表达含义；趋势必须提供文本摘要、数值和键盘/屏幕阅读器可理解的替代信息。
- Playwright E2E 使用 strict generated-type fixtures；fixture 必须拒绝未声明 API。

## 约束

- 遵循 contract-first；如需改变 API，先修改 `contracts/openapi.yaml`。
- 优先复用现有 GEO domain、Filter、Table、Dialog、Form、structured error、Idempotency-Key、canonical navigation 和 generated OpenAPI client 模式。
- Server state 使用 TanStack Query；URL state 使用 TanStack Router；form state 使用 React Hook Form + Zod。
- 不新增通用 Analytics、Chart、DataTable 或 workflow framework，不为 Print、Workbench 或未来页面预建扩展点。
- 不修改旧 `frontend/` 业务 UI；V1 仅作为现行业务行为和可访问性参考。
- 不修改 Topics 或 Observation 页面，除非只补充 Insights 所需且合同已支持的精确 canonical drill-down 参数。
- 审计已证明历史平台 UUID 无冻结 owner：平台删除后仍被 GEO 引用的 Published Article 会被旧 Insights 内连接静默丢弃。用户已批准增加一列最小冻结身份迁移。

## 验收标准

- [ ] `/geo/insights` 可从 GEO 导航进入，并可通过 direct URL、refresh、Back、Forward 恢复全部合法业务筛选。
- [ ] 页面只以 `GET /api/v1/geo-insights` 为 Insights 数据源，URL 与七个 API filter 参数存在明确、可测试的一一映射。
- [ ] Discovery、Mention、Accuracy 当前值、上一周期变化和趋势正确呈现；当前或上一周期无样本时不伪装成 `0%` 或零变化。
- [ ] Platform Performance、Content Performance、Question Coverage、Recommendations 和 Data Quality 按合同呈现完整、空、部分和 unavailable 状态。
- [ ] 所有可点击 drill-down 均来自服务端投影并落到已实现、支持精确筛选的 canonical target；无真实 target 的项目不显示伪链接。
- [ ] 仅服务端允许的异常显示优化任务动作；Dialog 只加载合同要求的窄候选并保留冲突后的用户输入。
- [ ] GET 的动作 source 是 actor-aware 且可直接合并进 POST；Coverage POST 以所选 Product/Platform 复算，页面不推断 `rule_code` 或最终资格。
- [ ] 优化任务 POST 使用符合既有生命周期规则的稳定 `Idempotency-Key`，不自动重放 stale/409/资格变化失败。
- [ ] 优化任务成功后直接使用响应 `ContentTask.id` 进入 canonical detail，并精确失效 Insights 与受影响的 Content Task cache。
- [ ] loading、empty、partial、unavailable、error、retry、stale optimization 均有可访问且可区分的表现。
- [ ] 375/768/1024/1440 下页面根无横向溢出；趋势信息不依赖颜色，包含文本、数值及辅助技术可理解的替代内容。
- [ ] strict generated-type fixture Playwright 覆盖主要业务流，并在页面请求未声明 API 时失败。
- [ ] 平台删除后，仍被 GEO 引用的 Published Article 继续以冻结 UUID/名称进入 Insights 和精确 Content Platform 筛选；无法回填的既有成果使迁移显式失败，不猜测身份。
- [ ] required validation 直接覆盖合同、URL 状态、read model 展示、优化任务竞态/幂等、响应式与可访问性；optional full-suite validation 单独列出。
- [ ] 未实现 `/geo/insights/print`、打印/PDF、Workbench、完整 GEO real-stack E2E、GEO vertical slice 抽象回顾或旧前端 UI 修改。

## 明确排除

- `/geo/insights/print`、打印 CSS、PDF 导出。
- Workbench、完整 GEO real-stack E2E、GEO vertical slice 抽象回顾。
- 客户端重新计算服务端指标、异常规则或动作资格。
- 客户端组合多个分页 endpoint 计算 Dashboard 或 options 候选。
- 自动重放失败的优化任务 POST。
- 新通用 Analytics、Chart、DataTable 或 workflow framework。
- 除本次已批准的 0043 历史平台 UUID 快照迁移外的数据库变更。

## 已解除的阻塞

用户已批准通过 0043 迁移冻结 `PublicationWork.platform_profile_id_snapshot`。迁移使用确定性回填、PublishedArticle 预检、插入与历史更新守卫及安全降级门禁；无法恢复的生产数据仍会按设计显式阻止部署。
