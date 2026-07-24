# 当前实现与视觉漂移证据

## 权威规范

- `.trellis/spec/frontend/visual-system.md:11-17` 定义规范、`theme.ts`、`global.css`、Ant Design 与共享组件的权威顺序，并禁止页面形成第二套视觉体系。
- `.trellis/spec/frontend/visual-system.md:253-264` 明确禁止页面字体、重复 Token、独立深色覆盖、第二套状态/卡片体系和廉价紫蓝渐变模板。
- `.trellis/spec/frontend/visual-system.md:266-279` 要求主题、视口、200% 缩放、键盘、对比度和第二套视觉体系检查。

## 当前壳层分裂

- `frontend/src/app/AppLayout.tsx:129-139` 识别 Dashboard、GEO、配置、审计、业务设置、用户、平台、规则和 Prompt 路由。
- `frontend/src/app/AppLayout.tsx:163-165` 把这些路由映射成多组 `app-shell-*` class，并为侧栏选择 `184/186/188/190/192/220/248px` 等不同宽度。
- `frontend/src/styles/global.css:52-85` 为 Dashboard/GEO 重写全局画布、侧栏、顶栏、内容边距、导航和主按钮。
- `frontend/src/styles/global.css:804-880` 为配置、用户和审计页面再次重写同一全局壳层。
- `frontend/src/styles/global.css:1443-1445`、`:1603-1604` 为平台管理、平台规则和 Prompt 管理继续修改顶栏网格与内容边距。

## 视觉所有权分散

- `global.css:2-14` 定义字体、圆角和动效；`theme.ts:178-186` 又维护等价 Ant Design 数值。
- `global.css:61` 定义 `--geo-border/surface/text-*`，`:830` 定义 `--um-*`，`:857` 定义 `--audit-*`。
- `global.css:830`、`:857` 为页面写入独立 `PingFang SC` 字体覆盖。
- 用户页在 `global.css:940-980` 重写 PageHeader、主按钮、Card、Table、StatusTag、圆角与阴影。
- AI 配置页在 `global.css:1080-1110` 定义独立 14px 外壳圆角、阴影、玻璃和表格密度。
- Prompt 工作区在 `global.css:1602-1688` 定义独立三栏表面、状态和文本尺度。

## 规模证据

只读命令输出：

```text
visual-system 固化提交 e90ce4c：global.css 908 行
当前 HEAD：global.css 1721 行
e90ce4c..HEAD：global.css +875 / -62
当前唯一 app-shell-* class：8 组
box-shadow 声明：86
border-radius 声明：157
```

上述阴影和圆角包含合法表达，计数只说明审计面规模，不能直接视为 243 个违规。

## 当前门禁缺口

- `frontend/scripts/check-theme-colors.mjs:7` 只匹配十六进制和 RGB；当前页面使用 `color-mix()` 派生新主色/表面时检查仍返回 0。
- `frontend/playwright.config.ts:4-14` 只有一个 Desktop Chrome 配置。
- 现有 E2E 使用 `page.screenshot()` 输出构件，但没有稳定的跨路由壳层比较或 `toHaveScreenshot()` 基线。
- CI 会执行 lint、typecheck、test、build 和 E2E，但没有独立的视觉契约矩阵。
- 已归档 Dashboard/GEO 与编辑工作区任务验证了局部页面的主题、视口、键盘和业务行为，没有把全部页面放在同一共享壳层基准下比较。

## 最小结构性方向

1. 复用并简化现有 `AppLayout`，不创建新 `PageShell`。
2. 删除路由级壳层 class 和页面级基础 Token，保留页面真实内容布局。
3. 在现有 `theme.ts`/`global.css` 边界内统一字体、圆角、阴影和动效的运行时值。
4. 扩展现有检查脚本，不引入新依赖。
5. 使用现有 Playwright 增加跨路由计算样式矩阵和三个页面类型的最小视觉基线。

## 最终规划补充审计

### 八组壳层

- `AppLayout.tsx:129-139,163-168` 定义 Dashboard、GEO、配置、用户、审计、平台、规则和 Prompt 八组视觉 class、多组 Sider 宽度及路由级折叠按钮。
- GEO 当前同时获得 `app-shell-dashboard` 与 `app-shell-geo`。
- `global.css:52-85,805-880,1026-1028,1444-1445,1603-1604` 是八组桌面主规则；响应式覆盖位于 `996-1012,1220-1315,1353-1354,1534-1546,1691-1702`。
- `global.css:356-358,1299-1302` 还通过 `:has(page)` 改写全局搜索、用户区和 Header，属于路由视觉分支。

### Token 消费

- `--um-*` 定义于 `global.css:830`，消费于用户壳层和 `837-985` 的按钮、Card、Table、StatusTag、分页及帮助区。
- `--audit-*` 定义于 `global.css:857`，消费于审计壳层和 `889,903,913,918,932,936`。
- GEO 基础边界、表面和文字别名定义于 `global.css:61`，消费于壳层和 `178-317` 的筛选、Card、表格、漏斗、矩阵与推荐。
- GEO 趋势/平台数据系列由 `GeoInsightsPage.tsx:252-255,502-506` 和 `global.css:261-264` 消费，可直接迁移到现有 `--ps-geo-series-*`。
- `--geo-accent` 和 `--geo-rate-color` 是真实数据表达，不是页面主题，必须保留。

### 字体、圆角、阴影和渐变

- 页面字体覆盖仅见 `global.css:830,857,941`；前两项删除，`.data-code` 改为等宽字体。
- 非规范圆角、外部字面量阴影和蓝紫主操作渐变集中在 `global.css`；其他 CSS/TS/TSX 文件未发现同类字面量。
- 4px 紧凑状态、50% 圆形、999px 胶囊、0 reset、认证、打印、焦点/选中 inset 和数据图形是受限例外。
- Prompt 平台选中背景虽然不是主按钮，但当前从图表紫色派生选中表面，应改为 `actionPrimarySoft`。

### 测试

- `check-theme-colors.mjs` 当前只递归扫描 `src` 中 CSS/TS/TSX，唯一文件 allowlist 是 `app/theme.ts`，只识别 hex 和 rgb/rgba。
- 现有 Playwright 只有 `page.screenshot()` 输出，没有 `toHaveScreenshot()` 基线。
- 唯一显式数据不足 skip 位于 `dashboard-geo-convergence.spec.ts:142`；实施后改为有数据验证图表、无数据验证真实 NoData。
- `editor-workspace-convergence.spec.ts` 已在缺少产品、内容版本、平台或规则版本时抛出错误，不得降级为 skip。
- CI 通过 `deploy/scripts/e2e-local.sh` 运行全量 Playwright，新 spec 无需修改 CI 或 Playwright 配置即可进入门禁。

### 必改与风险文件

必改产品范围锁定为 `theme.ts`、`AppLayout.tsx`、对应单测、`global.css` 和 `GeoInsightsPage.tsx` 的 GEO 系列引用。`ThemeProvider.tsx`、共享组件、其他页面 TSX、`playwright.config.ts` 和 CI 是验证风险文件，不预先承诺修改。

## 不应采用

- 再进行一轮逐页自由美化。
- 根据 `ui-ux-pro-max` 重新生成配色、字体、图标或页面结构。
- 为每种页面创建视觉 variant、配置对象或新的包装组件。
- 一次性迁移全部 CSS Modules；当前根因可通过删除重复壳层和收敛 Token 解决。

## 实施后核验（2026-07-24）

- 八组 `app-shell-*` 及其 `:has(page)` 旁路已删除，`AppLayout` 固定使用单一 `app-shell`。
- `--um-*`、`--audit-*` 与 GEO 基础表面/文字/边界别名已删除；GEO 系列直接消费 `--ps-geo-series-*`。
- 字体、圆角、阴影和动效由 `theme.ts` 的单一常量流向 Ant ThemeConfig 与 CSS 变量，`global.css` 只消费。
- `global.css` 的重复路由视觉规则以删除为主；没有新增 PageShell、卡片工厂、配置系统或 CSS Modules 迁移。
- 静态契约扩展到原始颜色、路由壳层、页面 Token、字体、数字圆角、外部阴影、主操作渐变、图表色派生基础表面和禁止依赖；原始颜色只允许出现在 `projectThemes` 值区，并由 14 个 Node 标准库测试覆盖。
- Playwright 新增 19 路由壳层矩阵、三类页面九个视觉基线，以及响应式、system、键盘搜索选择、Tab、可见焦点、reduced-motion 和打印断言。
- 真实 200% 不再使用 CDP 页面缩放仿真；测试通过 Manifest V3 fixture 调用浏览器 `chrome.tabs.setZoom`，验证三类页面的有效视口、移动壳层、关键内容和无文档溢出。
- 当前视觉范围验证全部通过；全量 `mvp-flow.spec.ts` 的旧用户字段、遗留测试管理员状态和 Ant Select 隐藏虚拟选项曾阻塞 AC11。用户于 2026-07-24 授权后，测试已改用 `temporary_password`、显式首次改密和仅限本测试命名规则的账号清理；可检索 Select 以本轮唯一文本普通点击精确可见选项，固定枚举只对已确认的标签遮挡使用精确强制点击。标准本地栈完整 MVP 2/2 通过，产品契约与业务流程仍不变。
- MVP 写入真实 GEO 观测后，洞察截图的指标、曲线和漏斗发生预期数据变化；跨路由视觉 spec 仅增加这些动态节点的精确遮罩，壳层、筛选器、卡片边界、静态标签和操作继续参与比较。无更新模式目标测试 1/1、相关视觉整批 22/22 通过。
- 最终 `trellis-check` 发现静态脚本曾无条件放行任意 `inset` 阴影；现已把例外收紧到代码库中真实的筛选器 inset、差异标记、选中态、焦点态和认证场景，并以第 14 个 Node 测试证明任意 `inset` 会失败。
