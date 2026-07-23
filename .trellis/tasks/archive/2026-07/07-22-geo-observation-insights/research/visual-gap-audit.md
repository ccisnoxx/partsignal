# Research: GEO 分析洞察 1570×1001 视觉差异审计

- Query: 对比用户提供的 1570×1001 原型图与当前 1570×1001 验收图，按严重度输出可执行视觉差异；重点覆盖蓝灰玻璃外壳、侧栏/顶栏、内容容器、平台与漏斗列宽、三张排行列宽、表格行高/字号、下半区比例与配色，并映射到 selector 和 `file:line`。
- Scope: internal
- Date: 2026-07-22

## Findings

### 结论

当前页面已经具备全部主要业务区块，侧栏代码宽度也确为任务约定的 192px；主要差距不是缺组件，而是三组共享视觉不变量失真：

1. GEO 页面继续继承 Dashboard 的 8px 外框、62px 顶栏和 24px 内容内边距，使页面整体比原型向右、向下收缩。
2. 中部与底部共用的 `1.18fr / .82fr` 把原型约 48:52 的左右关系变为 59:41，平台表异常宽、漏斗和建议异常窄。
3. 为强行压入单屏，筛选、表格、覆盖和建议大量使用 9–11px 字号及单行截断；这既低于原型的有效文字层级，也直接违反任务设计的最小正文 12px。

建议先修共享几何，再修局部组件。仅改卡片内部 padding 无法解决根因。

### 测量方法与总览

- 两张 PNG 均为原始 1570×1001 RGB 图，未缩放后再测量。
- 坐标以左上角 `(0, 0)` 为原点；圆角、阴影和抗锯齿边界存在约 ±2px 误差。
- 颜色取卡片/背景内部像素，不取文字或边框；区域均值按截图原始 RGB 像素计算。

| 区域 | 原型约束框 | 当前约束框 | 可见差异 |
| --- | --- | --- | --- |
| 侧栏 | `x=0–192`, 宽约 193px，全高 | `x=8–199`, 宽 192px，`y=8–992` | 宽度正确，但整体内缩 8px，顶部与底部被外框截短 |
| 顶栏 | `x=193–1569`, `y=0–56`, 高约 57px | `x=200–1561`, `y=8–69`, 高 62px | 当前右移 7px、下移 8px、高约多 5px |
| 主内容有效宽度 | `x≈201–1554`, 宽约 1354px | `x≈225–1538`, 宽约 1314px | 当前少约 40px（约为原型的 97.0%），左起点晚约 24px |
| 筛选区 | `y≈88–166`, 高约 79px | `y≈125–205`, 高约 81px | 自身高度接近，但整体晚约 37px |
| 趋势区 | `y≈174–328`, 高约 155px | `y≈246–369`, 高约 124px | 当前晚约 72px且少约 31px；中间新增的数据质量条占约 31px |
| 平台 + 漏斗 | `y≈334–553`, 高约 220px | `y≈374–575`, 高约 202px | 当前晚约 40px、高少约 18px |
| 三张排行 | `y≈555–740`, 高约 186px | `y≈582–762`, 高约 181px | 总高度接近，当前晚约 27px |
| 问题 + 建议 | `y≈746–989`, 高约 244px | `y≈769–996`, 高约 228px | 当前晚约 23px、少约 16px，建议列明显被压窄 |

颜色证据：

| 采样/区域 | 原型 | 当前 | 判断 |
| --- | --- | --- | --- |
| 外层左上内部 `(8,8)` | `#E3E9FA` | `#FBFBFC` | 原型蓝灰色度 `B-R=23`，当前仅 `1`，当前近白 |
| 顶栏上下文背景 `(300,40)` | `#E6EDFC` | `#F9FBFE` | 当前缺少清晰蓝灰玻璃基底 |
| 顶栏区域平均色 | `#EBEEF7` | `#F6F6F8` | 当前亮度更高、色度更低，层级趋平 |
| 稳定覆盖数据单元格内部 | `#EBF7F4` | `#FFFFFF` | 当前仅标签着色，数据面无状态层 |
| 尚未覆盖数据单元格内部 | `#FFF7EA`（原型按覆盖强度继续过渡至红） | `#FFFFFF` | 当前矩阵缺少原型的语义色块 |
| 建议行内部 | `#F4F5FC` | `#F2F2F7` | 两者接近；这里不是主要色差，主要问题是当前列宽与单行裁切 |

### P1-1：外壳和内容容器共同造成 40px 横向损失、37px 首屏下移

**证据**

- `AppLayout` 把 GEO 也归为 `compactShell`，同时挂上 `app-shell-dashboard app-shell-geo`：`frontend/src/app/AppLayout.tsx:113-115,138-141`。
- Dashboard 壳固定 `padding: 8px`，顶栏 `top: 8px; height: 62px`，内容 `padding: 18px 24px 24px`：`frontend/src/styles/global.css:50-58`。
- GEO 自己只覆盖背景/边框/选中态，没有收回外框和内容 padding：`frontend/src/styles/global.css:59-66`。
- 截图结果是主内容从原型约 `x=201` 变为当前约 `x=225`，右边从约 `1554` 变为 `1538`，有效宽度减少约 40px；筛选首行由约 `y=88` 下移到 `y=125`。

**可执行调整**

- 仅在 `.app-shell-geo` 范围覆盖 Dashboard 几何，不改其他页面：目标为外框 `padding: 0`、侧栏/顶栏 `top: 0`，顶栏约 58px。
- 将 `.app-shell-geo .app-content` 的桌面内边距目标调整为 `padding: 0 16px 12px 8px` 左右量级，使内容重新落到 `x≈200/201–1554`；最终值用新截图微调，不通过绝对定位补偿。
- 保留 `Layout.Sider width={192}`，该值已经符合设计，不应改成另一宽度：`frontend/src/app/AppLayout.tsx:141`。

### P1-2：平台/漏斗和下半区共用错误的 59:41 比例

**证据**

- 原型平台与漏斗约为 `653px : 695px = 48.4% : 51.6%`；当前约为 `770px : 536px = 58.9% : 41.1%`。
- 当前 CSS 精确写成 `1.18fr / .82fr`，即 59:41：`frontend/src/styles/global.css:199`。
- 同一 selector 同时作用于平台/漏斗和问题覆盖/建议：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:396-399,405-408`。因此底部覆盖表被放大到约 770px，建议卡被压到约 536px；原型同样是左约 653px、右约 695px。

**可执行调整**

- 把 `.geo-insight-two-column` 桌面比例改为约 `0.94fr 1fr`（48.5:51.5），同时修复中、下两行；不要分别给两个区块写第二套比例。
- 如果底部业务文案在 48.5:51.5 下仍溢出，只对内部建议行调整布局，不重新扩大左列。
- `@media (max-width: 959px)` 已把两列降为一列，响应式边界无需另建：`frontend/src/styles/global.css:905-909`。

### P1-3：漏斗是“矮宽满格柱”，与原型“高窄分段柱 + 阶段转换标记”相反

**证据**

- 原型最高柱约 54px 宽、92px 高；当前最高柱约 80px 宽、49px 高，宽约多 48%，高度约少 47%。
- 当前 `.geo-insight-funnel-stage` 将图表轨道锁成 50px 高，六列又用 `1fr` 吃满狭窄容器：`frontend/src/styles/global.css:206-212`。
- 当前转换率位于每列底部文字中：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:218-227`；原型把转化率做成相邻柱之间的轻量徽标，视觉上明确“阶段间”关系。

**可执行调整**

- 在完成 P1-2、使漏斗列变宽后，把轨道目标高度提高到约 88–92px，列宽固定在约 56–60px，通过 `justify-content: space-around` 分配余量，避免柱子继续横向拉伸。
- 将 `conversion_from_previous` 作为阶段间标记呈现；可复用现有服务端值，不得在前端重算转化率。
- 保留 DOM 的六阶段和空状态，不引入图表依赖。

### P1-4：趋势与排行缺失原型的父级层次；导出按钮靠绝对定位贴到页签

**证据**

- 原型趋势区有一个完整父面板：“GEO 指标趋势”标题、右侧比较周期、内部五张指标卡；当前 DOM 只有五张并列 Card，没有父级标题或比较周期：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:388-395`。
- 原型排行区有一个“内容表现排行”父面板，再分三组；当前是三张同层 Card：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:400-404`。
- 当前 PageHeader 被绝对定位到右上，文案裁成 1×1px，页签再硬留 170px：`frontend/src/styles/global.css:156-166`；对应 DOM 是 PageHeader 后紧跟 subnav：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:494-508`。
- 这与实施质量点“不通过绝对定位硬贴截图”直接冲突：`.trellis/tasks/07-22-geo-observation-insights/implement.md:139`。

**可执行调整**

- 把页签和导出操作放入一个普通 flex 顶部工具行；移除 PageHeader 的绝对定位与 `.geo-subnav { padding-right: 170px; }` 补偿。可继续保留一个语义 H1，但不要用绝对坐标承载可见按钮。
- 趋势区增加一个父级 Card/section header，显示“GEO 指标趋势”和响应中的比较期；数据质量条保持真实存在，可放在筛选后或父级标题下，不得因原型没有而删除。
- 排行区增加一个父级 section header；三张排行可降为内部 group，减少三层重复边框/标题头。

### P1-5：排行内部列宽超出卡片 1.43–1.82 倍，默认截图看不到全部核心指标

**证据**

- 原型三列约 `452 / 439 / 447px`，当前约 `433 / 433 / 433px`。三列比例都接近 1/3，`repeat(3, 1fr)` 本身不是根因；40px 总容器损失让每列再少约 13px：`frontend/src/styles/global.css:213`。
- 当前“表现最佳”在约 433px 卡内强制 `scroll.x=620`（1.43 倍），“下降/长期”强制 `790`（1.82 倍）：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:243-277`。
- 当前截图中最佳排行默认只看到“发布内容/内容平台/观测/提及”，推荐率和引用率在右侧滚动区外；原型默认视图同时显示全部核心列。
- 固定列目前为内容平台 112px、观测 70px、三个率各 78px，总计已达 416px，尚未计算标题列：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:249-257`。

**可执行调整**

- 先通过 P1-1 把单卡恢复到约 446px，再把内容平台目标收至约 76–84px、观测约 52–56px、率列约 56–60px；给标题留一列自适应空间。
- “最佳”应在桌面默认完整显示全部核心列，不再无条件 `scroll.x=620`；“长期”可让天数列约 68–76px。
- “下降依据”是经批准的额外业务信息，不能为了像原型而删除；只有下降表在确实超过最小宽度时保留局部横向滚动。这也符合 `.trellis/spec/frontend/component-guidelines.md:39-54` 的列宽规则。

### P1-6：9–11px 正文字号低于已批准的 12px 下限，并依靠单行截断隐藏信息

**证据**

- 任务设计明确“最小正文 12px”，实现计划要求 12–14px 信息层级：`.trellis/tasks/07-22-geo-observation-insights/design.md:248-255`、`.trellis/tasks/07-22-geo-observation-insights/implement.md:129-139`。
- 当前筛选标签 10px、Select 11px：`frontend/src/styles/global.css:171-176`。
- 趋势元信息/Tooltip/说明 10px：`frontend/src/styles/global.css:188-198`。
- 通用洞察表头 10px、表体 11px；排行表体又降到 10px、`line-height: 1.15`：`frontend/src/styles/global.css:203-218`。
- 覆盖矩阵、图例和建议依据普遍 10px，建议序号最低 9px，并强制标题与依据单行省略：`frontend/src/styles/global.css:223-250`。
- 排行行高被锁为 24px：`frontend/src/styles/global.css:217-218`。原型截图可见行高约 20–21px，但其文字视觉大小约 11–12px；当前是“字更小、行反而更空”。

**可执行调整**

- 所有业务正文/表体恢复到 12px；辅助元信息最低 11px，但只有非关键说明可低于正文。筛选标签、表体、覆盖图例、建议依据不应使用 9–10px。
- 排行保持约 24px 行高即可，使用约 `line-height: 1.25` 和 1–2px 纵向 padding，让字体增大而不必显著增高整行。
- 建议标题允许一行，依据至少允许两行或在更宽的右列中完整显示；不得同时把标题和依据都裁成单行。
- 先修宽度再提高字号，避免用新的横向滚动掩盖旧的布局问题。

### P2-1：顶栏和侧栏密度偏大，顶栏搜索框比原型宽约 84px

**证据**

- 当前顶栏 62px，原型约 57px；当前品牌区 74px，原型约 58px：`frontend/src/styles/global.css:56-57`。
- 当前搜索框在 1570px 下命中 500px 上限，截图约 `x=573–1072`；原型约 `x=576–991`，宽约 416px：`frontend/src/styles/global.css:38`。
- 当前 GEO 桌面顶栏保留导航折叠按钮，面包屑起点约 `x=276`；原型上下文文字约从 `x=207` 开始。按钮由 `frontend/src/app/AppLayout.tsx:152-156` 渲染。
- 侧栏 192px 宽正确；不应通过改宽度解决内部密度。

**可执行调整**

- 仅为 `.app-shell-geo` 将顶栏搜索宽度上限收至约 416–430px，顶栏目标高约 58px，品牌块目标高约 58–62px。
- 是否保留桌面折叠按钮属于共享导航交互，不要仅为截图删除；若保留，压缩其占位并让面包屑更接近侧栏边界。
- 原型底部有侧栏“收起”，当前 GEO 没有（代码只给 Configuration 渲染：`frontend/src/app/AppLayout.tsx:144`）。这是导航产品差异，不建议在本次纯视觉修正中新增第二入口。

### P2-2：筛选本体高度接近原型，但控件过矮、首屏位置被壳和质量条共同打散

**证据**

- 原型筛选面板高约 79px，当前约 81px，外框高度不是问题。
- 当前七列来自开始/结束日期分开呈现，加五类选择；原型把日期合成一个范围控件。当前 CSS 是 `repeat(7, minmax(124px, 1fr))`，控件仅 26px 高：`frontend/src/styles/global.css:167-176`；DOM 在 `frontend/src/features/geo-observations/GeoInsightsPage.tsx:425-447`。
- 当前数据质量条高约 31px且位于筛选与趋势之间：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:349-373,376-389`。这是需求明确要求的信息，不能当作视觉冗余删除。

**可执行调整**

- 保留两个原生日期输入，避免为模拟原型引入日期范围组件或新依赖；在恢复内容宽度后，将控件提高到约 30–32px、标签/值提高至 12px。
- 数据质量条保持一行摘要，限制详情展开时才增高；通过 P1-1 消除顶部 37px 空间损失，而不是压缩趋势卡或隐藏质量信息。
- 当前 `@media (max-width:1199px)` 已变为三列，符合较窄桌面重排目标：`frontend/src/styles/global.css:867-884`。

### P2-3：蓝灰玻璃氛围过弱，覆盖矩阵只有标签着色而没有数据面层级

**证据**

- 当前 `.app-shell-geo` 只把系列色以 5–8% 的径向渐变混入近白背景，顶栏又以 97–98% 白色 Surface 混色：`frontend/src/styles/global.css:59-61`。
- Light token 本身为 `bgCanvas #F5F5F7`、`bgSurface #FFFFFF`、`chartSeries1 #0066CC`、`chartSeries5 #5E5CE6`：`frontend/src/app/theme.ts:83-97`。当前实际采样接近 `#FBFBFC/#F9FBFE`，说明氛围层在截图中几乎不可见。
- 当前覆盖矩阵只给表头 `var(--ps-bg-subtle)`，数据 `td` 没有状态背景：`frontend/src/styles/global.css:223-231`；状态文字通过 `StatusTag` 映射 success/warning/danger/neutral，语义来源是正确的：`frontend/src/shared/components/StatusTag.tsx:29-51`。

**可执行调整**

- 只提高 `.app-shell-geo` 外层、顶栏和侧栏的 token 混色强度，目标先对齐外层约 `#E3E9FA`、顶栏约 `#E6EDFC` 的蓝灰色度；卡片内容仍保持接近 Surface，避免整页染蓝。
- 不硬编码这些采样色；继续用现有 `chartSeries*`、`glassSurface*`、`bg*` token 的 `color-mix()`，符合设计约束。
- 给覆盖行/单元格增加由已有 `status` 决定的 soft token 背景（稳定/偶尔/未覆盖/数据不足），但不按 count 在前端发明热力算法；当前服务端没有提供可用于“强度热图”的第二指标。
- 建议行的 `#F2F2F7` 已接近原型 `#F4F5FC`，不需要另造配色；在修复右列宽度后，保持现有语义优先级 Tag 即可。

### P3：已确认不应作为视觉缺陷修复的差异

- 原型顶部搜索是跨内容/任务/平台/数据的业务搜索；任务 D4 明确不实现该能力：`.trellis/tasks/07-22-geo-observation-insights/prd.md:32-34,47`。当前顶栏 `AutoComplete` 仅搜索页面导航：`frontend/src/app/AppLayout.tsx:157-173`。可以调宽度，但不能宣称已实现原型搜索语义，也不应为视觉验收补固定结果。
- 原型问题覆盖只有三类状态；当前多了“数据不足”一行。这是 D2f/R6 要求的真实第四状态，不应为了像截图而删除：`.trellis/tasks/07-22-geo-observation-insights/prd.md:30,82-84`。
- 原型有可信第三方平台 Logo；当前使用中性 `GEO` 标识。任务明确禁止伪造 Logo：`.trellis/tasks/07-22-geo-observation-insights/prd.md:46`，当前实现 `frontend/src/features/geo-observations/GeoInsightsPage.tsx:188-198` 是正确边界。
- 两图数据集不同（平台数、空排行、建议优先级、覆盖计数均不同）；这些内容差异不能作为 CSS 缺陷。

### 最小修复顺序

1. 修 `.app-shell-geo` 的外框、顶栏、内容 padding 和蓝灰氛围；重新截图确认内容约 `x=201–1554`。
2. 将共享两列比例改为约 48.5:51.5；同步验证平台/漏斗与覆盖/建议。
3. 重做漏斗轨道宽高，移除导出按钮绝对定位，补趋势/排行父层级。
4. 收紧排行固定列与 `scroll.x`，再把业务正文恢复到最低 12px。
5. 最后调整覆盖状态 soft 背景、边框、阴影和 1–2px 间距；不要先用局部 padding 对冲共享几何。

## Files Found

- `/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/codex-clipboard-d5ea4ad5-95f8-4bb4-824a-7daaa5adb023.png` — 用户提供的 1570×1001 视觉原型。
- `.trellis/tasks/07-22-geo-observation-insights/acceptance-1570x1001.png` — 当前真实页面的同尺寸验收截图。
- `.trellis/tasks/07-22-geo-observation-insights/prd.md` — 页面视觉、数据真实性、响应式和验收边界。
- `.trellis/tasks/07-22-geo-observation-insights/design.md` — 192px 壳、最小 12px、六区比较和 token 约束。
- `.trellis/tasks/07-22-geo-observation-insights/implement.md` — 高保真实施项、12–14px 层级及禁止绝对贴图的质量点。
- `frontend/src/app/AppLayout.tsx` — 侧栏宽度、顶栏结构、导航搜索、用户操作和内容容器所有者。
- `frontend/src/features/geo-observations/GeoInsightsPage.tsx` — 筛选、趋势、平台、漏斗、排行、覆盖、建议的 DOM 与 Table 列宽。
- `frontend/src/styles/global.css` — GEO 壳、全部 `.geo-insight-*` selector、响应式和打印样式。
- `frontend/src/app/theme.ts` — Light/Dark 颜色 token 与 Ant Design 组件 token 的唯一来源。
- `frontend/src/shared/components/StatusTag.tsx` — 覆盖与建议状态的中文标签及语义 tone 映射。
- `.trellis/spec/frontend/component-guidelines.md` — Table 自适应列、局部滚动和主题 token 规则。
- `.trellis/spec/frontend/quality-guidelines.md` — 响应式、主题与宽表局部滚动质量要求。
- `frontend/package.json` — 当前声明 React `^19.2.0`、Ant Design `^6.2.0`、icons `^6.0.1`。

## Code Patterns

- GEO 通过一个 `AppLayout` 同时复用 Dashboard 紧凑壳和 GEO 主题类：`frontend/src/app/AppLayout.tsx:113-115,138-141`。
- 所有分析区块由单个 `InsightSections` 按固定顺序编排：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:376-410`。
- 平台/漏斗与覆盖/建议共用 `.geo-insight-two-column`，这是比例的单一权威修复点：`frontend/src/styles/global.css:199,221`。
- 三张排行共用 `repeat(3, 1fr)`，外层比例无明显错误；真实溢出来自 Table 固定列和 `scroll.x`：`frontend/src/styles/global.css:213-219`、`frontend/src/features/geo-observations/GeoInsightsPage.tsx:243-277`。
- 主题颜色必须从 `theme.ts` 注入的 `--ps-*` 变量消费，当前 GEO 样式已经采用该模式：`frontend/src/app/theme.ts:116-137`、`frontend/src/styles/global.css:59-66`。

## External References

- 未访问外部网页或设计规范；本审计只依据两张原始截图、任务合同、仓库源码和本地依赖声明。
- 本地版本声明：Ant Design `^6.2.0`、React `^19.2.0`，见 `frontend/package.json:20-27`。

## Related Specs

- `.trellis/tasks/07-22-geo-observation-insights/prd.md:40-47,121-134` — 1570×1001 主验收、紧凑工作台壳、响应式与 AC1/AC12。
- `.trellis/tasks/07-22-geo-observation-insights/design.md:248-255` — 192px 侧栏、最小正文 12px、主题 token、六区域截图比较。
- `.trellis/tasks/07-22-geo-observation-insights/implement.md:129-139` — 高保真区域、12–14px 层级、禁止绝对定位贴图。
- `.trellis/spec/frontend/component-guidelines.md:35-54,58-75` — TableRegion、列宽、自适应列、主题变量和可访问交互。
- `.trellis/spec/frontend/quality-guidelines.md:35-47` — 交互信息保留、主题与响应式验收。

## Caveats / Not Found

- 本报告是静态截图审计，未启动浏览器读取 computed style；边框、阴影和圆角测量按像素观察存在约 ±2px 误差，但 40px 内容宽差、59:41 列比、50px 漏斗轨道和 9–11px 字号均有源码证据，不受该误差影响。
- 两张截图使用不同业务数据，未把计数、平台数、空状态、优先级分布或内容标题差异归因于视觉实现。
- 原型中的业务全局搜索、第三方 Logo、仅三类覆盖状态不属于本任务可复制的视觉事实，分别受 D4、Logo 真实性和 D2f 约束。
- 未发现需要新增图表库、热图库或第二套 design token 的理由；现有 SVG、CSS Grid、Ant Card/Table 和主题变量足以完成修正。
