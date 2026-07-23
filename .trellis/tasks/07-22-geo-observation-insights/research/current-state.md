# GEO 分析洞察现状调查

> 规划决策更新（2026-07-22）：用户已批准以当前人工观测作为未来唯一洞察数据集，并补充 `query_topic_id` 及逐篇发现、提及、引用、准确性事实。本文先记录实施前缺口，再给出已批准的解决边界；最终业务口径以 `prd.md` 的 D1–D5 为准。

## 调查范围与基线

- 调查基于 2026-07-22 的 `main` 工作树。工作树已有 26 项用户未提交改动，其中 `07-20-geo-observation-records` 正在修改 GEO 前端、后端、OpenAPI、数据库文档和测试；本任务不得覆盖或回退这些改动。
- 视觉基准为用户提供的 1570×1001 桌面原型图。图中可见 192px 左右侧栏、顶部工具区、两级 GEO 导航、单行高密度筛选、5 张趋势卡、2 个并列分析区、3 个内容排行区及底部 2 个分析区。
- 仓库和历史会话没有此前已批准的分析洞察指标定义。现有 `07-20-geo-observation-records` 任务明确把分析洞察和导出排除在观测记录任务外，因此本任务不能把其原型数值当作既有事实。

## 已有能力

### 前端与公共布局

| 能力 | 当前实现证据 | 结论 |
| --- | --- | --- |
| GEO 路由 | `frontend/src/app/App.tsx:52-53` 仅注册 `/observations` 和更正路由 | 没有分析洞察路由 |
| GEO 二级导航 | `frontend/src/app/AppLayout.tsx:24-27` 仅含“观测记录” | 可以在同一分组增加“分析洞察”，无需新建平行模块 |
| 公共工作台 | `frontend/src/app/AppLayout.tsx:64-167` 已有响应式侧栏、顶栏、主题和用户菜单；`AppLayout.tsx:94-123` 已给 GEO 使用紧凑 192px 侧栏 | 可复用；当前没有原型中的全局搜索、通知或帮助能力 |
| 观测页签 | `frontend/src/features/geo-observations/GeoObservationsPage.tsx:259-267` 已有局部 `geo-subnav` | 可改为真实路由页签 |
| URL 筛选 | `GeoObservationsPage.tsx:90-199` 已实现默认近 30 天、URL 序列化、规范化、重置和清除 | 可复用语义与日期边界，不能复制一套状态模型 |
| 记录筛选 | `GeoObservationsPage.tsx:276-305` 支持日期、类型、产品、搜索词、问题主题、搜索平台、模型、发布内容、结论、记录人和历史范围 | 洞察所需“内容平台、内容主题、发布内容 ID”仍缺精确维度 |
| 统计和表格 | `GeoObservationsPage.tsx:268-356` 已用服务端统计、分页表格、列设置和局部滚动 | 布局和状态处理可复用，现有统计没有趋势或分组 |
| 详情与登记 | `GeoObservationDrawer.tsx`、`GeoObservationForm.tsx` 已实现真实详情、附件、新建和追加式更正 | 洞察不应复制登记或详情逻辑 |

### 可复用组件和依赖

| 组件或能力 | 证据 | 适用范围 |
| --- | --- | --- |
| `PageHeader` | `frontend/src/shared/components/PageHeader.tsx:5-22` | 页面标题和真实操作 |
| `MetricTile` | `frontend/src/shared/components/MetricTile.tsx:6-27` | 简单数值卡；趋势卡需要局部扩展，不能把业务计算塞入组件 |
| `QueryFailure` / `QueryLoading` / `NoData` | `frontend/src/shared/components/AsyncState.tsx:6-22` | 分区加载、错误、重试和空状态 |
| `TableRegion` | `frontend/src/shared/components/TableRegion.tsx:4-5` | 排行表和窄桌面局部滚动 |
| `StatusTag` | `frontend/src/shared/components/StatusTag.tsx:46` | 优先级和覆盖状态的文字+颜色表达 |
| `PlatformAvatar` | `frontend/src/shared/components/PlatformAvatar.tsx:5-10` | 内容发布平台已有可信 Logo 时展示；GEO 平台当前只有自由文本，不能伪造 Logo |
| 图表 token | `frontend/src/app/theme.ts:10-80,83-129` | 已有 6 个图表色、网格、坐标轴、Tooltip 和轨道 token |
| 响应式壳 | `AppLayout.tsx:118-132`、`frontend/src/styles/global.css:647-714` | 桌面侧栏与移动 Drawer、现有断点 |

`frontend/package.json` 和 `package-lock.json` 没有 ECharts、Recharts、Chart.js、Ant Design Charts、XLSX、PDF 或 CSV 导出依赖。仓库也没有折线图、漏斗图、迷你趋势或通用报表导出实现。最小方案应使用原生 SVG/CSS 和浏览器打印能力；只有用户明确要求服务器生成文件且原生能力不满足时才评估新依赖。

### API、服务和数据模型

| 能力 | 证据 | 当前语义 |
| --- | --- | --- |
| 共享筛选 | `backend/app/services/geo_observation.py:47-67,76-188` | 列表与指标使用同一 `GeoObservationFilters` 和链尾查询 |
| 分页和详情 | `backend/app/services/geo_observation.py:381-420`、`backend/app/routers/observation.py:110-141` | 服务端分页、稳定排序和历史详情已实现 |
| 现有指标 | `backend/app/services/geo_observation.py:423-480` | 实时聚合，但把全部筛选行载入内存；只返回当前汇总，不返回时间序列或分组 |
| 旧模型观测 | `backend/app/models/geo_files.py:24-56`、`backend/app/schemas/geo_files.py:36-67` | 只读历史类型，含问题主题、模型、提及、推荐、准确性和引用 |
| 人工观测 | `backend/app/schemas/geo_files.py:99-139`、`GeoObservationForm.tsx:151-208` | 当前写入类型，含产品、自由文本 GEO 平台、自由文本搜索问题、逐篇推荐/未推荐、截图和备注 |
| 逐篇结果 | `backend/app/models/geo_files.py:74-86` | 每条人工观测覆盖当前全部公开发布，每篇只有 `recommendation_status` |
| 发布和内容平台 | `backend/app/models/publication.py:25-60` | 发布记录可经账号关联稳定的 `platform_profile_id`、标题、URL 和发布时间 |
| 内容角度 | `backend/app/models/content.py:27-94` | `ContentTask.content_angle` 是真实可查询字段；用户已确认原型“内容主题”精确映射该字段 |
| 目标问题 | `backend/app/models/configuration.py:27-38` | `QueryTopic` 是问题配置全集；当前只读旧观测关联它，人工观测不关联 |

## 现有指标权威口径

现有 `/api/v1/geo-metrics` 的所有筛选与记录列表一致，默认排除被更正记录。以下口径由 `backend/app/services/geo_observation.py:423-480` 唯一实现：

| 指标 | 分子 | 分母 | 无分母行为 | 数据类型 |
| --- | --- | --- | --- | --- |
| `mention_rate` | `mentioned is true` 的旧模型观测数 | 旧模型观测数 | 当前返回 `0` | 只读旧模型观测 |
| `recommendation_rate` | `recommendation == RECOMMENDED` 的旧模型观测数 | 旧模型观测数 | 当前返回 `0` | 只读旧模型观测 |
| `citation_rate` | 至少存在一条 Citation 的旧模型观测数 | 旧模型观测数 | 当前返回 `0` | 只读旧模型观测 |
| `accuracy_rate` | `accuracy == ACCURATE` 的旧模型观测数 | 排除 `NULL` 和 `UNJUDGEABLE` 后的旧模型观测数 | 返回 `null` | 只读旧模型观测 |
| `article_recommendation_rate` | 人工逐篇结果中 `RECOMMENDED` 数 | `RECOMMENDED + NOT_RECOMMENDED` 数 | 返回 `null` | 当前人工观测 |
| `not_recommended_article_count` | 人工逐篇结果中 `NOT_RECOMMENDED` 数 | 不适用 | 返回 `0` | 这是结果出现次数，不是去重内容数 |

`contracts/database.md:214-216` 明确 `UNJUDGEABLE` 不进入准确率分母、人工观测覆盖当前全部公开文章、历史空逐篇结论不进入人工指标。用户本次要求“无真实数据使用空状态”，因此前三个比率的空分母 `0` 需要在本任务中改为 `null`，不能继续把“没有样本”显示成 0%。

## 原型模块支撑矩阵

| 原型模块 | 当前是否可直接支撑 | 已有证据或缺口 |
| --- | --- | --- |
| 时间范围 | 是 | 共享筛选已有包含首尾的 UTC 自然日语义 |
| 内容平台 | 部分 | 发布记录可关联 `platform_profile_id`，但 GEO 筛选尚无该参数 |
| GEO 观测平台 | 否 | 旧类型用 `model_name`，人工类型用自由文本 `search_platform`，没有统一平台维度或别名规则 |
| 内容主题 | 规划已解决 | 已批准精确映射 `ContentTask.content_angle`，选项只取有真实发布记录的 distinct 原值 |
| 发布内容 | 部分 | 现有筛选是标题/URL 模糊搜索，没有稳定 `publication_record_id` 筛选或全局选项投影 |
| 搜索问题 | 否 | 旧类型关联 `query_topic_id`，人工类型只存自由文本，无法基于配置全集计算“尚未覆盖” |
| 指标当前值 | 部分 | 旧模型四率和人工逐篇推荐率可算，但来源不同，不能混成一组同口径指标 |
| 环比和趋势 | 否 | 没有比较期定义、日序列或趋势响应 |
| 平台表现 | 否 | 没有统一 GEO 平台维度，也没有按平台聚合接口 |
| 转化链路 | 否 | 没有“被检索发现”事实；逐篇关系只有推荐状态，提及、引用和准确性不是内容级事实 |
| 最佳内容排行 | 部分 | 可按逐篇推荐次数/率排序；提及率、引用率和最小样本门槛未定义 |
| 下降内容排行 | 否 | 没有比较窗口、下降指标、阈值或最小样本定义 |
| 长期未提及 | 否 | 人工逐篇关系没有提及字段，“未推荐”不能替代“未提及” |
| 搜索问题覆盖 | 当前不可直接支撑，规划已解决 | 人工观测尚未关联问题全集；已批准补采 `query_topic_id` 及 3 次样本、60%/30% 覆盖阈值 |
| 优化建议 | 否 | 没有建议规则、优先级阈值或服务端实现；不得用随机/AI 文案冒充依据 |
| 导出洞察报告 | 否 | 没有导出 API、文件格式、库或通用下载流程；证据文件签名 URL 不是报表导出 |
| 顶部搜索 | 否 | 当前公共布局没有全局搜索；方案文档此前明确不放无真实能力的空入口 |

## 数据缺口与结构性影响

### 实施前发现的结构性缺口（规划已解决）

1. **分析数据集不统一**：四个 GEO 率只存在于只读旧模型观测，当前人工工作流只有逐篇推荐结果。直接合并会让同一筛选下的卡片、排行和漏斗使用不同样本。
2. **人工问题未规范化**：人工观测没有 `query_topic_id`，无法确认一个实际搜索词属于哪个配置问题，也无法计算问题全集中的“尚未覆盖”。
3. **内容级阶段事实缺失**：逐篇关系未保存发现、提及、引用和准确性，无法真实计算内容排行和同单位转化漏斗。
4. **GEO 平台是自由文本**：可以按精确字符串分组，但不能安全合并拼写变体或展示可信第三方 Logo；本任务不得增加模糊别名兼容。
5. **仓库原先没有产品口径**：转化链每层计数单位、覆盖阈值、排行排序、下降窗口、长期天数、最小样本、建议优先级和报告格式都无既有契约证据；用户已逐项确认并固定在 `prd.md` D2–D3。

### 已批准的最小数据演进

- 以当前人工观测作为未来分析的权威数据集；只读旧模型观测继续在观测记录中展示，但不与人工分析分母混合。
- 复用 `geo_observations.query_topic_id` 关联人工观测与配置问题；人工内容级发现、提及、引用和准确性与现有推荐事实统一只保存在 `geo_observation_publications`，不在观测根重复保存同义值。
- `geo_observation_publications` 增加已确认的发现/提及/引用/准确性事实。历史人工记录不能回填猜测值，保持 `NULL` 并在洞察响应中报告被排除数量；新写入契约要求完整。
- `search_platform` 先按精确字符串聚合，不建立别名映射或新平台注册表；若用户要求受控平台管理，再单独批准数据模型和管理界面。

上述演进涉及 PostgreSQL 迁移、OpenAPI、服务端 Schema、登记表单、前端生成类型和测试。数据集与阶段定义已明确确认，当前只等待用户评审完整规划材料后决定是否进入实施。

## 契约、权限和导出影响

- `contracts/openapi.yaml` 新增服务端权威洞察读模型 `GET /api/v1/geo-insights`，使用全部页面筛选并一次返回筛选选项、指标、趋势、平台对比、漏斗、排行、问题覆盖、建议和数据完整性说明。
- 现有 `GET /api/v1/geo-metrics` 应把旧模型字段显式改名为 `legacy_*`，并把无分母比率改为 `null`；人工洞察使用独立且明确的关系级字段名。两者只复用确实相同的筛选/SQL 片段，不能让同一个字段名代表两种分母。
- 已批准补采人工事实，`GeoObservationCreate`、`ManualGeoObservation` 和逐篇结果 Schema 必须同步更新；旧记录的缺失必须显式可见。
- 洞察读取沿用 `CurrentUser`；补充登记和更正仍由 `EngineerUser + CSRF` 强制。前端筛选或按钮不承担权限控制。
- 已批准的无依赖导出方案是同一真实洞察响应的打印专用视图，由浏览器原生“另存为 PDF”；不新增直接下载 PDF/XLSX 的服务端方案。

## 预计涉及文件

### 规划确认后必改

- 契约和类型：`contracts/openapi.yaml`、`backend/app/schemas/geo_files.py`、`frontend/src/shared/api/schema.d.ts`（生成）、`frontend/src/shared/api/types.ts`。
- 后端：`backend/app/routers/observation.py`、`backend/app/services/geo_observation.py`、`backend/app/models/geo_files.py`、新 Alembic 迁移、`backend/tests/integration/test_publication_review_closure.py`、`backend/tests/unit/test_contract.py`。
- 前端路由与数据：`frontend/src/app/App.tsx`、`AppLayout.tsx`、`routeLoaders.ts`、`routePrefetch.ts`、`shared/api/queryKeys.ts`、`queryOptions.ts`。
- 页面和样式：新增 `frontend/src/features/geo-observations/GeoInsightsPage.tsx` 及最少局部组件/测试，更新 `frontend/src/styles/global.css`。
- E2E 和文档：`frontend/tests/e2e/mvp-flow.spec.ts` 或独立 GEO 用例、`contracts/database.md`、`docs/GEO多平台内容运营系统方案设计.md`，必要时 `docs/testing.md`。

### 不应改动

- 不新增 Redis 业务缓存、第二套 DTO、客户端指标公式、固定假数据、通用图表框架或与 GEO 无关的全局视觉重构。
- 本任务已确认不在公共顶栏增加全局搜索，也不增加仅有外观的通知或帮助入口。
