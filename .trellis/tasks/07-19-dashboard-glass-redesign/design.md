# 技术设计

## 1. 设计结论

本任务只重组总览页的信息层级和视觉表现，不改变数据来源、查询生命周期、路由、权限或业务状态。页面继续使用现有 React、Ant Design、TanStack Query、`PageHeader`、`MetricTile`、主题 Token 和全局 CSS；不增加图表库、组件库、页面级主题 Provider 或新接口。

信息层级采用用户已确认的顺序：四个真实 GEO 结果作为顶部管理层指标，审核/发布/GEO 问题计数进入运营状态和待办，最后提供四个现有工作流快捷入口。`ui-ux-pro-max` 的“执行层仪表盘最多 4–6 个顶部指标、状态需图标或文字辅助、移动端按内容优先级重排”建议适用于本页；其新字体、硬编码配色、趋势图、弹跳动画和新增依赖建议与项目约束冲突，不采用。

本任务不拆父子任务。一个页面、同一组样式和测试共同形成可独立验收的改造，拆分只会重复触及相同文件。

## 2. 权威边界与不变量

- `GET /api/v1/dashboard/summary` 是待审、待发布、发布关注和近 30 日准确性问题的唯一摘要来源。
- `GET /api/v1/geo-metrics` 是人工观测、文章结果、推荐结果和推荐率的唯一来源。
- `/api/v1/auth/me.display_name` 已由 `AuthProvider` 持有，只用于真实用户问候，不新增身份请求。
- `/products`、`/tasks`、`/publications`、`/observations` 是唯一快捷入口和处理入口集合。
- 保留两条总览查询的并行加载、统一错误、双查询重试、缓存时间和路由预取。
- 不显示周期、趋势、同比、近期动态、负责人、优先级、更新时间、逾期、服务健康或 AI 渠道健康。
- `article_recommendation_rate === null` 继续显示 `—`；零计数是有效业务值，不隐藏为未知。

## 3. 页面信息架构

```text
真实用户问候 + 唯一主操作“进入内容任务”
        ↓
四个 GEO 管理指标
人工观测｜文章结果｜已推荐文章｜文章推荐率
        ↓
运营状态摘要
审核流程｜发布流程｜GEO 观测
        ↓
待处理事项（真实类别计数 + 现有处理入口）｜快捷入口（四条现有路由）
```

### 3.1 页头

- 使用紧凑 `PageHeader`，标题与参考图一致为“总览”，描述中使用 `auth.user.display_name` 做真实问候。
- 不在页头放置大幅 Hero 或虚构筛选器；现有工作流入口集中到快捷入口，降低首屏垂直占用。
- 不增加日期范围、同比选择器、全局搜索或通知入口。

### 3.2 管理层指标

- 保留 `MetricTile`，依次展示 `manual_observation_count`、`article_result_count`、`recommended_article_count`、`article_recommendation_rate`。
- 推荐率继续复用既有整数百分比换算和 `Progress`；空值显示 `—` 且不渲染进度。
- 未推荐文章计数只作为已推荐文章的补充说明或待办数据，不占用第五张顶部卡片。

### 3.3 运营状态摘要

- 审核流程：同时展示 `pending_fact_reviews` 与 `pending_content_reviews`。
- 发布流程：同时展示 `pending_publications` 与 `publication_attention`。
- GEO 观测：同时展示 `not_recommended_article_count` 与 `recent_accuracy_errors`。
- 每组只根据所属真实计数选择“正常”“待处理”或“需关注”的展示语义；状态包含可读文字和图标/徽标，不只依赖颜色。
- 状态摘要不推导新的业务总数，不把这些计数称为系统健康度。

### 3.4 待处理事项

- 展示六个稳定类别：发布需关注、近 30 日准确性问题、待审事实、待审内容、待人工发布、未推荐文章。
- 每行只包含真实类别、计数和现有路由入口；非零异常优先排序并提高语义强调，零值显示为已清零/中性状态。
- 不请求列表明细，不拼接各业务列表，也不虚构负责人、优先级和更新时间。

### 3.5 快捷入口

- 产品事实 → `/products`
- 内容任务 → `/tasks`
- 人工发布 → `/publications`
- GEO 观测 → `/observations`
- 使用 React Router `Link` 和现有 Ant Design 图标；视觉顺序等于 DOM/Tab 顺序，不增加权限分支。

## 4. 数据流

```text
AuthProvider.user.display_name ───────────────→ 页头真实问候

dashboardSummaryQueryOptions ──→ 运营状态 ──→ 待处理事项
geoMetricsQueryOptions ─────────→ 四个核心指标 ─→ GEO 状态/待办

既有 Link 路由 ──────────────────────────────→ 处理入口/快捷入口
```

页面不建立派生 Store、Context 或第二份缓存。数组仅用于本页声明稳定的展示顺序和字段映射，不成为业务状态源。

## 5. 视觉与交互

- 由 `AppLayout` 只在 `/` 为外壳增加 `app-shell-dashboard` 类并缩窄桌面侧栏，用现有图表色 Token 混合出参考图的淡蓝、淡紫和淡粉环境光；其他路由外壳不变。
- 在 `.dashboard-page` 范围内使用现有 `--ps-glass-*`、边框、阴影、状态色和图表色变量；不修改 `theme.ts`，不引入图片、Canvas、Web Font 或大面积装饰动画。
- 四个指标卡使用 Ant Design 图标和四种现有语义色形成参考图式圆形图标层级；状态摘要横向排列，待办使用紧凑表格式列表，右侧使用 2×2 快捷入口和真实重点提醒。
- 交互只改变边框、背景或阴影，不通过位移造成布局抖动；继续使用 150–220ms 现有动效并服从 `prefers-reduced-motion`。
- `@supports not (backdrop-filter)` 将总览玻璃表面回退为 `--ps-bg-raised`，保持边框和文字对比度。
- 1440/1024px 使用双列工作区；768px 以下按“指标 → 状态 → 待办 → 快捷入口”单列排列；375px 指标保持两列，操作目标至少 44px 且不产生页面级横向滚动。
- 全局 `:focus-visible` 继续负责键盘焦点；不把普通容器加入 Tab 顺序。

## 6. 文件边界

| 文件 | 计划变更 |
|---|---|
| `frontend/src/app/AppLayout.tsx` | 仅为总览路由增加外壳类并缩窄桌面侧栏，使参考图的整体画布和导航比例可落地；导航、权限和路由行为不变。 |
| `frontend/src/features/dashboard/DashboardPage.tsx` | 重排信息架构，接入真实用户问候、运营状态、待办和快捷入口；保留查询与错误行为。 |
| `frontend/src/features/dashboard/DashboardPage.test.tsx` | 覆盖真实字段映射、空比率、零/非零状态、快捷和处理链接。 |
| `frontend/src/styles/global.css` | 增加 `.dashboard-*` 页面级玻璃、布局、状态、待办、快捷入口和响应式样式。 |
| `frontend/tests/e2e/mvp-flow.spec.ts` | 更新现有闭环末尾的总览断言，不新建第二套 E2E 数据。 |
| `frontend/scripts/measure-production-performance.mjs` | 同步总览新标题的路由就绪断言，保持生产性能检查可运行。 |
| `frontend/README.md` | 记录总览的信息层级和玻璃边界，保持文档与实现一致。 |

默认不修改 `contracts/`、`backend/`、`deploy/`、`frontend/package*.json`、`theme.ts`、共享组件 API、路由表和生成类型。调用方搜索补充了生产性能脚本的标题断言，不改变性能测量逻辑。若实现还必须越过该边界，返回规划阶段重新评审。

## 7. 兼容、回滚与风险

- 无数据迁移、配置迁移或灰度分支；回滚只需反向应用上述总览相关 diff。
- 主要风险是玻璃表面在深色、禁用模糊或 200% 缩放下层级不足；通过 Token、可见边框、降级样式和真实浏览器矩阵验证控制。
- 指标与待办使用相同底层计数但承担不同任务：顶部只展示 GEO 结果，待办才展示行动计数，避免同一数字跨区重复。
- 参考图的趋势、动态和人员信息明确不实现；未来只有在后端契约提供权威历史序列或事项明细后才进入新任务。
