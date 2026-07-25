# Research: 共享移动端触控目标

- Query: 共享移动顶栏的导航按钮、主题按钮和 Ant Drawer 关闭按钮为何分别只有 `36×40` 与 `24×24 CSS px`，其所有者、消费者、断点、焦点约束及最小修复面是什么？
- Scope: mixed
- Date: 2026-07-25

## Findings

### 结论

这是共享壳层的尺寸所有权缺口，不是三个页面各自的样式问题。

1. `AppLayout` 在 Ant `lg` 断点以下渲染纯图标导航按钮；`ThemeModeControl` 在 Ant `md` 断点以下也变为纯图标按钮（`frontend/src/app/AppLayout.tsx:153-172,191-193`，`frontend/src/shared/components/ThemeModeControl.tsx:11-36`）。
2. 项目把 Ant 全局 `controlHeight` 固定为 `36`（`frontend/src/app/theme.ts:186-225`）。Ant Button 的基础样式把按钮高度设为 `controlHeight`，并把纯图标按钮宽度也设为 `controlHeight`（`frontend/node_modules/antd/es/button/style/index.js:130-152`），因此两个纯图标按钮的基础框均为 `36×36`。
3. `global.css` 在 `max-width: 767px` 只设置 `.ant-btn { min-height: 40px; }`，没有同步最小宽度（`frontend/src/styles/global.css:1158-1162,1298-1301`）。最终宽度仍为 36、高度被抬到 40，精确得到线上观测的 `36×40`。
4. `AppLayout` 的移动导航 Drawer 没有关闭按钮尺寸 prop，只使用默认 `closable=true`（`frontend/src/app/AppLayout.tsx:164-166`）。Ant Drawer 将关闭按钮宽高计算为 `fontSizeLG + paddingXS`（`frontend/node_modules/antd/es/drawer/style/index.js:145-169`）；当前派生值是 `16 + 8 = 24`，精确得到 `24×24`。项目 Drawer 主题只覆盖背景与遮罩颜色，CSS 也只覆盖关闭按钮颜色，没有覆盖几何（`frontend/src/app/theme.ts:226-243`，`frontend/src/styles/global.css:1063-1066`）。
5. 父任务线上报告已在 375px 与真实 200% 缩放场景复现上述尺寸，并把责任层定位为共享移动顶栏和 Drawer（`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:83-88`）。这与代码推导完全一致。

因此最小且覆盖共同根因的修复仅需 `frontend/src/styles/global.css`：复用现有 `max-width: 991px` 响应式块，对 `.app-header .ant-btn` 和 `.ant-drawer-close` 设置 `min-width/min-height: 44px`。使用最小尺寸而非固定尺寸，可保留用户按钮现有 50px 高度和带文字主题按钮的自然宽度。

建议的最小形状是：

```css
@media (max-width: 991px) {
  .app-header .ant-btn,
  .ant-drawer-close {
    min-width: 44px;
    min-height: 44px;
  }
}
```

该修复不需要修改 `AppLayout.tsx`、`ThemeModeControl.tsx`、`theme.ts` 或任何业务页面，也不需要新增 Token、组件包装或 Drawer `styles.close` prop。不要把全局 `controlHeight` 从 36 改成 44：36px 是已批准的桌面标准控件高度（`.trellis/spec/frontend/visual-system.md:83-96`），修改它会无差别放大全站桌面控件。也不要在每个 Drawer 上重复 `styles={{ close: ... }}`：Ant 虽支持语义 `styles.close`，但逐消费者设置会制造多份尺寸来源。

### 尺寸来源与断点链

#### 导航按钮

- 所有者：`AppLayout`。
- 创建点：`frontend/src/app/AppLayout.tsx:169-172` 的无 children Ant `Button`，仅传 `icon={<MenuUnfoldOutlined />}` 和 `aria-label="切换导航"`。
- 出现条件：`desktopSider = !!screens.lg`；`screens.lg === false` 时渲染 Drawer 与导航按钮（`frontend/src/app/AppLayout.tsx:153-171`）。
- Ant 断点：`screenLG=992`，因此 Drawer/导航按钮覆盖 CSS 视口 `<992px`。项目 CSS 已有完全对应的 `@media (max-width: 991px)`（`frontend/src/styles/global.css:1136-1140`）。
- 尺寸：项目 `controlHeight=36` → Ant icon-only `width=36;height=36`；`<768px` 时全局 `min-height:40` → `36×40`。
- 额外边界：在精确 768–991px 区间，当前 `max-width:767px` 规则不生效，导航按钮实际仍是 `36×36`，同样低于 44px。修复必须挂到既有 991px 壳层断点，而不能只修 767px 以下。

#### 主题按钮

- 所有者：`ThemeModeControl`，工作台消费方是 `AppLayout`（`frontend/src/app/AppLayout.tsx:191-193`）。
- 创建点：`frontend/src/shared/components/ThemeModeControl.tsx:30-36`。`compact=true` 时不渲染文字，Ant 将其识别为 icon-only Button。
- 条件：`compact={!screens.md}`；Ant `screenMD=768`，所以 `<768px` 时为纯图标（`frontend/src/app/AppLayout.tsx:192`）。
- 尺寸：同一 `controlHeight=36` 与移动 `.ant-btn { min-height:40px }` 共同得到 `36×40`。
- 另一个消费方：登录页以 `<ThemeModeControl expanded />` 使用 `Segmented`（`frontend/src/features/auth/LoginPage.tsx:31`），不会消费 `.theme-mode-control` Button，也不属于本缺陷。

#### Drawer 默认关闭按钮

- 所有者：Ant Drawer 内部 `DrawerPanel` 生成原生 `<button class="ant-drawer-close">`（`frontend/node_modules/antd/es/drawer/DrawerPanel.js:39-82`），不是 Ant `Button`，因此 `.ant-btn { min-height:40px }` 对它无效。
- `24×24` 来源：Ant Drawer 样式为 `width/height = fontSizeLG + paddingXS`（`frontend/node_modules/antd/es/drawer/style/index.js:145-169`）。当前主题派生 `fontSizeLG=16`、`paddingXS=8`；本地用 `theme.getDesignToken({ token: { controlHeight: 36 } })` 验证结果为 24。
- Drawer 组件 Token 没有 close-size 字段，只有 `zIndexPopup`、footer padding 与 `draggerSize`（`frontend/node_modules/antd/es/drawer/style/index.d.ts:1-26`）。通过 Drawer alias token 改 `fontSizeLG` 或 `paddingXS` 会连带标题、Header 或其他间距，不是最小修复。
- `frontend/src/styles/global.css:1063-1066` 的 `.mobile-drawer .ant-drawer-close` 目前只设颜色，正是共享导航 Drawer 最接近的现有样式所有者。

### 所有消费者

#### `AppLayout`

- 唯一产品消费点是 `frontend/src/app/App.tsx:41-71`，它包住全部登录后业务路由，因此一次共享壳层修复覆盖总览、产品、任务、内容审核、发布、GEO、设置、用户、审计和配置页面。
- `frontend/src/main.tsx:4-5` 只引入一次 `App` 与 `global.css`，确认不存在第二套应用壳层样式入口。

#### `ThemeModeControl`

- 工作台：`frontend/src/app/AppLayout.tsx:191-193`，受影响。
- 登录页：`frontend/src/features/auth/LoginPage.tsx:31`，使用 `expanded` Segmented，不受 icon-only Button 修复影响。

#### Ant `Drawer`

代码库共有 6 个 Drawer 创建点：

1. `frontend/src/app/AppLayout.tsx:164-166`：移动导航，默认关闭按钮；直接命中线上 `24×24`。
2. `frontend/src/features/publications/PublicationDrawer.tsx:58-74`：发布登记，默认关闭按钮；共享 `.ant-drawer-close` 规则可一并覆盖窄屏。
3. `frontend/src/features/geo-observations/GeoObservationDrawer.tsx:194-217`：GEO 详情，默认关闭按钮，`<768px` 为全宽 Drawer；共享规则可一并覆盖。
4. `frontend/src/features/configuration/PlatformRulesPage.tsx:414`：平台规则信息，默认关闭按钮；共享规则可一并覆盖 `<992px`。
5. `frontend/src/features/configuration/PlatformsPage.tsx:407-409`：`closable={false}`，复用 `PlatformDetailPanel` 自己的 `Button aria-label="关闭平台详情"`（`frontend/src/features/configuration/PlatformDetailPanel.tsx:46-60`），不消费 `.ant-drawer-close`。
6. `frontend/src/features/configuration/AuditLogPage.tsx:510-517`：`closable={false}`，复用 `AuditLogDetailPanel` 自己的 `Button aria-label="关闭日志详情"`（`frontend/src/features/configuration/AuditLogDetailPanel.tsx:71-89`），不消费 `.ant-drawer-close`。

对默认 Ant Drawer 使用响应式全局 `.ant-drawer-close` 是共同所有者修复；只改 `.mobile-drawer .ant-drawer-close` 虽能修线上症状，但会让其他默认移动 Drawer 继续保留同一 24px 根因。两个 `closable={false}` 的自定义关闭按钮不属于父报告测得的 `24×24` 节点，见 Caveats。

### 焦点恢复与可访问性约束

- 目标下限：移动端关键操作至少 `44×44 CSS px`（`.trellis/spec/frontend/visual-system.md:252-258`）。
- 语义：导航按钮已有 `aria-label="切换导航"`（`frontend/src/app/AppLayout.tsx:171`）；主题按钮已有动态 `aria-label`，compact 模式另有 Tooltip（`frontend/src/shared/components/ThemeModeControl.tsx:31-35`）。Ant 的 `useClosable` 从 zh-CN locale 给默认关闭图标补充“关闭”可访问名称（`frontend/node_modules/antd/es/_util/hooks/useClosable.js:56-103`）。已证实问题是命中区域，不是缺少可访问名称。
- Drawer 焦点：Ant 6 的默认 `trap=true`、`focusTriggerAfterClose=true`（`frontend/node_modules/antd/es/drawer/useFocusable.js:1-12`），并把结果传给底层 Drawer（`frontend/node_modules/antd/es/drawer/Drawer.js:121-125,217-220`）。`AppLayout` 没有覆盖 `focusable`，必须继续沿用 Ant 的焦点圈定、Escape 关闭和触发器恢复。
- 路由焦点：`AppLayout` 只在 `location.pathname` 变化时把焦点移到 `Layout.Content`，并使用 `preventScroll`（`frontend/src/app/AppLayout.tsx:90-102,212-216`）；查询参数变化不抢焦点。单纯 Escape 关闭 Drawer 应恢复导航触发器，点击 Drawer 内导航链接造成 pathname 变化时则应聚焦内容区。
- CSS-only 最小修复不会改变 DOM、Tab 顺序、`aria-label`、Escape、焦点圈定、触发器恢复或 pathname 焦点规则；不要为尺寸问题新增手写 focus effect。

### 现有测试与最小浏览器回归

现有覆盖：

- `frontend/src/app/AppLayout.test.tsx:170-182` 已验证 pathname 变化聚焦 `.app-content`、查询参数变化不抢焦点；jsdom 不适合断言 CSS 几何。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:290-316` 已在 1024/768/375/320px 打开 280px 移动 Drawer、按 Escape 关闭并检查无页面溢出，但没有断言三个触控目标尺寸或关闭后的焦点。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:372-409` 已验证桌面主题按钮的可见焦点与 Dropdown 的 Escape 焦点恢复，但没有覆盖移动 Drawer。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:420-453` 已使用真实浏览器 200% tab zoom，并确认 CSS 视口进入移动导航，但没有测量目标尺寸。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:342-353` 的 375px 三张截图会包含关闭状态的共享顶栏；尺寸修复会产生预期视觉差异，但基线不能在未获用户最终批准时自动更新（`.trellis/spec/frontend/visual-system.md:306-313`）。

最小可运行回归应留在现有 `cross-page-visual-convergence.spec.ts`，不新增测试框架或页面级重复用例：

1. 在一个代表路由、375px 下读取“切换导航”和主题按钮 `boundingBox()`，断言宽高均 `>=44`。
2. 用导航按钮打开 `.mobile-drawer`，读取 `.ant-drawer-close`，断言宽高均 `>=44`；按 Escape 关闭后断言焦点回到“切换导航”。
3. 在精确 768px 再断言导航按钮高度/宽度 `>=44`，保护当前 767/768 断点缝隙。
4. 在现有真实 200% 用例中只对一个代表路由重复一次导航/主题几何断言；不必在三个路由重复共享壳层断言。
5. 继续运行现有 320px 无文档溢出检查，确认 44px 目标没有挤破 64px 顶栏。

建议针对性命令：

```bash
cd frontend
npx playwright test tests/e2e/cross-page-visual-convergence.spec.ts --grep "触控目标|代表窄屏|200% tab zoom"
```

如未新增独立“触控目标”测试名，则按实际修改后的测试名收窄 `--grep`。几何断言必须使用真实 Playwright 浏览器，不能放进 jsdom 单测。

### Files found

- `.trellis/tasks/07-25-staging-visual-defect-fixes/task.json`：当前修复任务元数据，父任务为 `07-25-post-deployment-visual-acceptance`。
- `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md`：当前仍是 TBD 占位，尚无可执行触控目标验收条目。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/prd.md`：父任务要求 375px、真实 200% 与 280px 移动 Drawer 验收。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`：线上 `36×40`、`24×24` 的原始观测证据。
- `.trellis/spec/frontend/visual-system.md`：44px 触控目标、断点、焦点、Drawer 和基线规则的权威规范。
- `.trellis/spec/frontend/component-guidelines.md`：AppLayout pathname 焦点与 Ant Drawer 触发器焦点恢复约束。
- `.trellis/spec/frontend/quality-guidelines.md`：真实浏览器 375/768/1024/1440、200% 和键盘链验收要求。
- `frontend/src/app/AppLayout.tsx`：移动导航 Drawer、导航触发器、主题控件消费和 pathname 焦点所有者。
- `frontend/src/shared/components/ThemeModeControl.tsx`：主题按钮 compact/expanded 渲染所有者。
- `frontend/src/app/theme.ts`：Ant `controlHeight=36` 与 Drawer 主题覆盖所有者。
- `frontend/src/styles/global.css`：顶栏、移动按钮、Drawer 和响应式断点的共享 CSS 所有者。
- `frontend/src/app/App.tsx`：`AppLayout` 的唯一产品消费点与全部登录后路由。
- `frontend/src/app/ThemeProvider.tsx`：全局 Ant `ConfigProvider` 与主题装配点。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`：现有窄屏、截图、焦点和真实 200% 回归。
- `frontend/src/app/AppLayout.test.tsx`：现有 pathname/query 焦点单测。
- `frontend/package.json`、`frontend/package-lock.json`：Ant 依赖声明与锁定版本。

### External references

- 锁文件版本：`frontend/package-lock.json:3313-3317` 锁定 `antd@6.5.0`；`frontend/package.json:20-24` 声明 `antd@^6.2.0`。
- [Ant Design Drawer 官方文档](https://ant.design/components/drawer/)：`styles` 支持 `close` 语义节点；`focusable` 支持 `trap` 与 `focusTriggerAfterClose`；默认 closable，支持 Escape/onClose。
- [Ant Design Button 官方文档](https://ant.design/components/button/)：无 `size` 时使用默认 medium Button，icon-only 仍消费 Button 尺寸体系。
- [Ant Design 主题定制官方文档](https://ant.design/docs/react/customize-theme/)：全局 Token 与组件 Token 的覆盖边界。

### Related specs

- `.trellis/spec/frontend/visual-system.md:83-104`：共享几何与 AppLayout/CSS 所有权。
- `.trellis/spec/frontend/visual-system.md:244-258`：复用已有断点、真实 200% 与 44px 触控目标。
- `.trellis/spec/frontend/visual-system.md:306-323`：视觉基线批准规则和浏览器验收清单。
- `.trellis/spec/frontend/component-guidelines.md:68-76`：pathname 焦点与 Ant Drawer 焦点恢复。
- `.trellis/spec/frontend/quality-guidelines.md:41-47,51-59`：E2E/真实浏览器质量门禁。

## Caveats / Not Found

- 当前子任务 `prd.md` 的 Requirements 与 Acceptance Criteria 仍为 `TBD`，所以研究以父任务线上报告和已生效视觉规范为准；进入实现前应把“导航、主题、默认 Drawer 关闭按钮在 375px、768px 和真实 200% 下均至少 44×44，Escape 后焦点恢复”写成明确验收条件。
- `frontend/package-lock.json` 锁定 `antd@6.5.0`，但当前本地 `frontend/node_modules/antd/package.json` 显示 `6.5.1`。本研究检查的内部公式来自本地 6.5.1；线上尺寸与锁定依赖行为一致，但最终实现验证应基于 `npm ci`/CI 锁定版本，不应依赖未锁定的本地安装漂移。
- 两个 `closable={false}` Drawer 使用自定义 Ant Button 关闭入口，不会被 `.ant-drawer-close` 规则覆盖。父报告没有测量这两个节点；如果本任务验收范围提升为“所有移动 Drawer 的所有关闭入口”，还需在真实浏览器测量 `关闭平台详情` 与 `关闭日志详情`，再决定是否给它们的既有 header selector 同样加 44px 最小尺寸。不要在缺少测量证据时改写其组件结构。
- 本研究未修改产品代码、测试、任务主文档或视觉基线，也未重跑浏览器；运行时尺寸证据来自父任务 2026-07-25 的真实公网验收，代码推导用于确认其根因与最小修复面。
