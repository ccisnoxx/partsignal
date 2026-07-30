# 全站数据表与表格型列表审计清单

## 审计口径

- 范围：`frontend/src` 中所有登录后业务数据表，包括 Ant Design `Table`、原生业务矩阵表和弹窗内数据表。
- 当前基线：共 24 张表，覆盖内容任务、产品事实、发布、GEO、配置中心、设置和用户管理。
- “静态风险”表示代码缺少确定的列宽、收缩、省略或滚动约束，仍需真实浏览器和边界数据验证；不能等同于已经视觉复现。
- 普通帮助说明、表单字段、时间线和非表格导航列表不计入 24 张表；但实施阶段仍对发布动态、附件列表等密集数据列表做页面级溢出检查。

## 完整清单

| # | 页面 / 表 | 源码 | 初始结论 | 重点边界 |
| --- | --- | --- | --- | --- |
| 1 | 内容任务列表 | `frontend/src/features/content-tasks/ContentTasksPage.tsx:179` | 已有产品/平台省略，需全尺寸复核 | 超长品牌、型号、平台；固定操作列 |
| 2 | AI 作业列表 | `frontend/src/features/content-tasks/ContentTasksPage.tsx:530` | 静态高风险 | 失败原因无宽度/省略；固定操作列 |
| 3 | 内容版本列表 | `frontend/src/features/content-tasks/ContentTasksPage.tsx:561` | 静态高风险 | 长标题无稳定收缩；自然化按钮 |
| 4 | 产品事实列表 | `frontend/src/features/product-facts/ProductsPage.tsx:98` | 静态高风险 | 连续型号、长品牌/类别；固定操作列 |
| 5 | 事实版本列表 | `frontend/src/features/product-facts/ProductFactsPage.tsx:229` | 静态高风险 | 长变更说明；220px 操作区换行 |
| 6 | 待发布候选 | `frontend/src/features/publications/PublicationWorkspace.tsx:447` | 用户已报告 | 极长标题、账号集合、固定操作列 |
| 7 | 发布记录 | `frontend/src/features/publications/PublicationWorkspace.tsx:512` | 浏览器已复现 | 长账号越过最终 URL；操作组合宽度 |
| 8 | 发布异常待办 | `frontend/src/features/publications/PublicationWorkspace.tsx:625` | 静态高风险 | 长平台/账号；110px 操作列 |
| 9 | GEO 观测记录 | `frontend/src/features/geo-observations/GeoObservationsPage.tsx:234` | 浏览器已复现 | 平台和记录人换行导致行高异常 |
| 10 | GEO 文章观测结果 | `frontend/src/features/geo-observations/GeoObservationForm.tsx:234` | 静态高风险 | 文章标题、平台、表单控件行高 |
| 11 | GEO 问题库 | `frontend/src/features/geo-observations/GeoTopicsPage.tsx:64` | 静态高风险 | 标准问题和变体长文本 |
| 12 | GEO 平台表现 | `frontend/src/features/geo-observations/GeoInsightsPage.tsx:221` | 已有局部约束，需复核 | 平台名、省略可访问性、移动横滚 |
| 13 | GEO 内容排行 | `frontend/src/features/geo-observations/GeoInsightsPage.tsx:281` | 静态高风险 | 无 `scroll.x`；长标题挤压指标列 |
| 14 | GEO 覆盖矩阵 | `frontend/src/features/geo-observations/GeoInsightsPage.tsx:332` | 原生表格例外，需复核 | 动态平台列、打印和移动横滚 |
| 15 | AI 渠道列表 | `frontend/src/features/configuration/AIChannelsPage.tsx:283` | 已有局部约束，仍有风险 | 长渠道名/描述、API URL、固定操作列 |
| 16 | AI 请求 Header | `frontend/src/features/configuration/AIChannelDetailPage.tsx:420` | 静态高风险 | Header 名称和值、敏感值、固定操作列 |
| 17 | AI 模型列表 | `frontend/src/features/configuration/AIChannelDetailPage.tsx:436` | 静态高风险 | display name、model ID、操作列 |
| 18 | AI 渠道操作日志 | `frontend/src/features/configuration/AIChannelDetailPage.tsx:478` | 静态高风险 | 动作、对象、请求 ID 连续字符串 |
| 19 | 全局审计日志 | `frontend/src/features/configuration/AuditLogPage.tsx:452` | 静态高风险 | 动作列无宽度；固定详情操作列 |
| 20 | 模型发现弹窗 | `frontend/src/features/configuration/ModelDiscoveryModal.tsx:35` | 静态高风险 | 未包 `TableRegion`；model ID 换行增高 |
| 21 | 平台列表 | `frontend/src/features/configuration/PlatformsPage.tsx:347` | 已有单元格 CSS，需复核 | 平台名、官网、域名、Prompt、固定操作列 |
| 22 | 平台类型列表 | `frontend/src/features/configuration/PlatformTypesPage.tsx:33` | 静态高风险 | 长名称、slug、190px 操作区 |
| 23 | 发布账号列表 | `frontend/src/features/settings/SettingsPage.tsx:235` | 静态最高风险 | 外层 `overflow:hidden` 与横滚冲突；长账号 |
| 24 | 用户列表 | `frontend/src/features/users/UserManagementPage.tsx:356` | 静态高风险 | 用户名/显示名无稳定省略；选择列和固定操作列 |

## 共性根因

1. 多数表设置了 `scroll.x`，但没有让列宽总和、唯一弹性列和实际 `scroll.x` 形成明确合同；Ant Design 自动布局会受内容长度反向影响。
2. 多个高变化文本列没有 `ellipsis`、可收缩子容器或固定的两行身份布局，长中文、连续 ID、URL 和账号会扩大列宽或数据行。
3. 部分表只给 `<td>` 设置省略，内部 `Space`、`a`、`strong`、双行容器或表单控件没有 `min-width: 0`，因此子元素仍可越过单元格。
4. 固定操作列宽度与实际按钮组合不一致，且固定列不透明背景只在少数页面局部实现。
5. `TableRegion` 的正确职责是语义焦点和外层宽度边界，横向滚动应由 Ant Table 持有；设置页和审计页的局部 `overflow:hidden` 可能裁切滚动或 sticky 内容。
6. 现有组件测试主要覆盖请求和操作，E2E 只覆盖用户、平台、AI 渠道和审计四个工作台的页面级无溢出，没有逐单元格、相邻列、行高和全部 24 张表的清单式回归。

## 全表统一验收不变量

- 每张表必须声明一个主要弹性文本列；状态、数字、时间和操作列使用可解释的固定宽度。没有长文本主列的表可以全部固定宽度。
- 普通数据单元格默认单行省略；“名称 + 次要标识”等身份单元格最多保持固定两行，每一行独立省略。只有业务明确要求阅读全文的表格单元格才允许有界多行。
- 省略文本必须通过 Tooltip、`title`、详情入口或等价键盘可访问方式查看完整值；不能只对鼠标悬停可见。
- 连续 ID、slug、账号和 URL 不得使用无上限换行把数据行撑高；表格内优先单行省略，详情区再完整换行。
- 操作按钮不得换行、裁切或越过固定操作列；固定列背景在普通、悬停、选中和异常行状态下均完全不透明。
- 正常表和紧凑表的数据行高度只能在预定档位内变化，不能由任意长文本决定。
- 文档根节点不能产生横向滚动；必要的横向滚动只能发生在表格滚动容器内，键盘可以聚焦并操作。
- `1440×1000` 与 `375×900` 下逐表验证；真实 200% 浏览器缩放至少覆盖普通宽表、固定操作列、紧凑指标表、原生动态矩阵和弹窗表五类代表。
- 浅色和深色均验证固定列遮挡、焦点、Tooltip、边界和对比度。

## 实施分类

- 必须直接修复：用户已报告的 6、7、9，以及静态高风险表。
- 先验证、违反不变量才修改：已有局部约束的 1、12、14、15、21。
- 现有原生覆盖矩阵保留其动态列和横向滚动设计，不机械改成 Ant Table。
- 不使用一条全局 `table-layout: fixed` 覆盖所有表；共享修复只限于真实一致的不变量，例如可收缩省略类、固定操作列不透明背景和 `TableRegion` 宽度边界。

## 实施复核

- 2026-07-30 重新扫描 `frontend/src/**/*.tsx`，仍为 24 个业务 `<Table>` / `<table>` 实例，未出现清单外新增表。
- 1–3：任务主列表保留有界产品/平台单元格；AI 作业失败原因、内容版本标题改为固定宽度单行省略，操作列保持固定。
- 4–5：产品、品牌、类别与事实变更说明改为有界省略，操作列不再被长文本挤压。
- 6–8：待发布标题、发布记录标题/平台/账号、发布异常平台/账号均建立列宽和子元素收缩边界；发布记录操作列加入可发现的物理删除项。
- 9–14：观测平台、记录人、文章、问题与排行标题均采用有界展示；平台表现和排行声明内部横滚，原生覆盖矩阵保留动态列例外。
- 15–20：AI 渠道既有约束通过；Header、模型、渠道日志、审计动作及模型发现弹窗补齐宽度、省略和 `TableRegion`。
- 21–24：平台、平台类型、发布账号、用户列表的高变化字段统一有界；移除会裁切 Ant Table 内部横滚的外层 `overflow: hidden`。
- 回归设施删除了把 CDP 页面缩放误当 tab zoom 的旧断言；真实浏览器 200% tab zoom 现覆盖任务、发布、GEO、用户和 AI 五类业务表。
- `cross-page-visual-convergence.spec.ts` 持有精确的 24 表源码标记与页面、Tab、弹窗映射；`1440×1000`、`375×900` 会逐一访问这些表面，并检查文档边界、可见表格区域、单行省略和固定列不透明背景。
