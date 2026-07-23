# Dashboard 与 GEO 洞察视觉统一设计

## 权威来源

1. `.trellis/spec/frontend/visual-system.md`
2. `frontend/src/app/theme.ts`
3. `frontend/src/styles/global.css`
4. 现有 `PageHeader`、`MetricTile`、查询状态组件和目标页面实现

`ui-ux-pro-max` 仅用于图表类型、信息层级、响应式、键盘、替代文本和 anti-pattern 审查；不得运行 `--persist` 或采纳与项目视觉契约冲突的建议。

## 页面边界

- Dashboard 保留现有汇总与 GEO 指标查询、运营状态、待办和快捷入口，只把 PageHeader 移出查询提前返回，并统一局部指标卡布局。
- GEO 观测保留列表和指标两个独立查询。指标加载或失败只替换指标区，不阻断筛选和记录列表；列表继续使用 Ant Design Table 与 `TableRegion`。
- GEO 洞察主页面以 `PageHeader` 替换自定义工具栏，数据质量状态和导出按钮进入 actions，GEO 子导航仍位于页头后。打印页复用同一标题层级，不显示交互导航和筛选。
- `PageHeader.tsx`、`MetricTile.tsx`、`AsyncState.tsx`、`TableRegion.tsx`、`StatusTag.tsx` 不修改；现有接口已满足需求。

## 数据与契约

- Dashboard 继续读取 `/api/v1/dashboard/summary` 与 `/api/v1/geo-metrics`。
- GEO 观测继续读取 `/api/v1/geo-metrics`、`/api/v1/geo-observations`、产品和问题主题选项；筛选、分页、排序及 Drawer/Form 流程不变。
- GEO 洞察继续读取 `/api/v1/geo-insights`，保留日期、内容平台、GEO 平台、内容主题、发布内容和搜索问题筛选。
- 不修改 API 字段、Schema、缓存键、统计计算、空值含义、缺失点断线或打印查询参数。

## 视觉与交互

### PageHeader 与页面层级

- 删除目标页面局部标题字号覆盖，使用现有默认 `PageHeader` 24–30px 层级。
- Dashboard、GEO 观测和 GEO 洞察使用现有 12–20px 页面间距尺度；GEO 洞察不再使用 5px 全页压缩。
- GEO 洞察只在页面作用域内合并重复卡片表面规则，不创建共享包装组件。

### 指标卡与查询状态

- Dashboard 与 GEO 观测继续使用 `MetricTile`；通过现有页面包装类统一图标、标签、数值和说明间距。
- 描述性计数和比率使用数据序列语义；危险色只表达真实异常或负向状态。
- Dashboard 加载/失败在 PageHeader 后显示现有查询状态组件。
- GEO 观测指标区显式显示加载/失败；记录表使用现有 Table loading，空表使用 `NoData`，同屏筛选和清除入口继续可用。

### GEO 图表

- 折线、比率条、漏斗和矩阵类型保持不变。
- 趋势率图沿用 0–100% 刻度；数量图沿用现有最大值计算。显示 0、中间、最大三个纵轴标签和首末日期横轴标签，网格使用 `chartGrid`，坐标使用 `chartAxis`。
- 折线宽 2px；空值继续断线且不按零绘制。GEO 固定语义使用 `geoSeries*`，未推荐/缺失使用负向红色。
- 每张趋势图只有一个键盘入口；Left/Right/Home/End 更新活动点、可见标记和 Tooltip。鼠标 Hover 继续读取同一点数据。
- 趋势图使用直接标签，不新增图例；平台图例仅列提及率、推荐率、引用率、准确率。漏斗与矩阵继续使用文字、数值、状态和位置表达。

## 响应式、主题与打印

- 只复用现有 1399、1199、959、767、419px 断点，不新增相邻断点。
- 窄屏指标卡保持两列但不得重叠；多栏洞察依次降列，宽表只允许在 `TableRegion` 内横向滚动。
- 浅色、深色和跟随系统全部消费现有 Token；不增加页面独立深色覆盖。
- `prefers-reduced-motion` 继续由全局规则关闭非必要动画。
- 打印媒体隐藏应用导航、筛选和操作，保留 PageHeader、报告范围、数据质量、坐标、图例和直接数值。

## 回滚边界

- 变更集中在三个页面、对应测试、目标 E2E 和页面作用域 CSS；任何统计或筛选回归可按文件回退。
- 若现有 Token 无法满足对比度或图表语义，不在本任务扩展主题，返回规划并单独评估。
