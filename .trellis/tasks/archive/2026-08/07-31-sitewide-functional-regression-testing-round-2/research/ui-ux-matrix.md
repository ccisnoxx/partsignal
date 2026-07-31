# 第二轮全路由 UI/UX 矩阵

## 1. 本节证据口径

- 当前冻结清单为 26 个功能路径模式，另含 1 个通配入口；动态路由使用共享开发库中的真实对象，只执行读取和打开。
- `ui-route-probe.mjs` 在 `1440×1000`、`375×900` 对 26 个功能路径和通配入口完成 54 次稳定扫描，逐页记录可访问标题、最终路径、文档溢出、移动导航触控尺寸、API 响应、console 和 request failure。
- 同一提交、同一轮已经通过的 `cross-page-visual-convergence.spec.ts` 继续提供 `1024×768`、`320×800`、浅色/深色/跟随系统、reduced-motion、键盘、对比度、11 张视觉基线及五类页面真实 200% tab zoom 证据，不重复运行相同检查。
- 功能状态、结构化失败、刷新/重登和业务副作用复用本轮 W0～W6、第 6 节和第 7 节结果；截图只证明视觉状态，不替代请求或数据证据。

## 2. UI/UX 统一维度

| 维度 | 状态 | 本轮结果 |
| --- | --- | --- |
| 全路由 `1440×1000` | PASS | 26/26 功能路径及通配入口均完成稳定渲染；0 页面级横向溢出、0 缺失可访问标题、0 API 4xx/5xx |
| 全路由 `375×900` | PASS | 26/26 功能路径及通配入口均完成稳定渲染；0 页面级横向溢出，工作台移动导航目标均至少 44px |
| `1024×768`、`320×800` 临界点 | PASS | 数据列表、编辑审核、分析洞察三类代表页边距、堆叠、Drawer 和局部滚动通过 |
| 五类页面真实 200% 缩放 | PASS | 内容任务、发布、GEO、用户、AI 配置均保留标题、主要操作和表格局部滚动，无文档溢出 |
| 浅色、深色、跟随系统 | PASS | 主要静态/动态路由、认证入口、表格、Tooltip、模态、状态和图表使用同一语义主题；system 能实时响应系统配色 |
| reduced-motion | PASS | 登录、工作台、编辑审核和分析页取消非必要动画，状态与操作不依赖动效 |
| 文字与非文字对比度 | PASS | 共享主文字/表面 ≥ 4.5:1、强边界/表面 ≥ 3:1，代表 Tooltip ≥ 4.5:1；焦点环可见 |
| 非颜色单一表达 | PASS | 状态同时包含文字/图标或位置；图表具有坐标、图例、数值和键盘 Tooltip |
| 仅键盘与焦点恢复 | FAIL | 登录、全局搜索、导航、菜单、表单和打印链可用；Dropdown→确认及详情 Drawer/侧栏关闭仍受 `PS-QA-201`、`PS-QA2-UI-002` 影响 |
| console 与请求 | FAIL | 新增 `PS-QA2-UI-003`；登录 favicon 仍为 `PS-QA2-UI-001`；GEO 更正证据图被 ORB 拦截归入 `PS-QA2-ENV-001` |
| 视觉基线 | PASS | 同轮 11 张批准基线均在既定阈值内；未发现需要新增截图才能解释的几何偏差 |

## 3. 逐路由结果

双视口“PASS”只表示标题、布局、触控和读取请求通过；“综合”同时合并本轮已确认的功能与交互缺陷。

| # | 路径模式 | `1440×1000` | `375×900` | console/request | 综合 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `/login` | PASS | PASS | FAIL（`PS-QA2-UI-001`） | FAIL |
| 2 | `/change-password` | PASS | PASS | PASS | PASS；独立认证页以可访问 `H2`“修改密码”作为标题，`H1` 不适用 |
| 3 | `/` | PASS | PASS | PASS | PASS |
| 4 | `/products` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 5 | `/products/:productId` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 6 | `/tasks` | PASS | PASS | PASS | FAIL（`PS-QA-201`） |
| 7 | `/tasks/:taskId` | PASS | PASS | PASS | FAIL（`PS-QA2-FUNC-001`） |
| 8 | `/content/:contentVersionId` | PASS | PASS | PASS | PASS |
| 9 | `/publications` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA2-UI-002`） |
| 10 | `/publications/:publicationId` | PASS | PASS | FAIL（`PS-QA2-UI-003`） | FAIL |
| 11 | `/publication-attentions/:attentionId` | PASS | PASS | PASS | PASS |
| 12 | `/publication-attentions/:attentionId/repair` | PASS | PASS | PASS | FAIL（`PS-QA2-FUNC-002`） |
| 13 | `/observations` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 14 | `/observations/insights` | PASS | PASS | PASS | PASS |
| 15 | `/observations/insights/print` | PASS | PASS | PASS | PASS |
| 16 | `/observations/topics` | PASS | PASS | PASS | PASS |
| 17 | `/observations/:observationId/correct` | PASS | PASS | BLOCKED（`PS-QA2-ENV-001`：历史证据图 ORB） | FAIL（另有 `PS-QA2-FUNC-003`） |
| 18 | `/settings` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 19 | `/users` | PASS | PASS | PASS | FAIL（`PS-QA-201`） |
| 20 | `/audit` | PASS | PASS | PASS | FAIL（`PS-QA2-UI-002`） |
| 21 | `/configuration` | PASS | PASS | PASS | PASS；按当前数据重定向至 AI 渠道详情 |
| 22 | `/configuration/ai` | PASS | PASS | PASS | FAIL（`PS-QA-201`） |
| 23 | `/configuration/ai/channels/:channelId` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-203`） |
| 24 | `/configuration/platform-types` | PASS | PASS | PASS | FAIL（`PS-QA-201`） |
| 25 | `/configuration/platforms` | PASS | PASS | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 26 | `/configuration/prompts` | PASS | PASS | PASS | PASS |
| — | `*` | PASS | PASS | PASS | PASS；已登录未知路径重定向至总览 |

26 个功能路径综合为 9 `PASS`、17 `FAIL`、0 `NOT_RUN`；GEO 更正页的文件预览子能力另有 1 个有证据的环境 `BLOCKED`，但该路由已因独立产品缺陷记为 `FAIL`。

## 4. 新增与复用结论

- 新增：`PS-QA2-UI-003`，发布详情在两个主视口均稳定输出 Ant Design Timeline `items.children` 弃用警告。
- 复用：`PS-QA2-UI-001`、`PS-QA-201`～`203`、`PS-QA2-UI-002` 仍存在；本节没有重复拆分同源页面缺陷。
- 环境归因：GEO 更正页两个历史证据图片请求均为 `net::ERR_BLOCKED_BY_ORB`；共享开发 `fake-oss` 仍退出，归入 `PS-QA2-ENV-001`。隔离 E2E 的临时对象存储链已通过，因此不判为新的文件合同缺陷。
- `playwright-cli` 命名会话已退出；未保存认证状态。工具生成的本节临时 snapshot/console 文件已按精确文件名删除，未影响用户原有会话和诊断产物。
