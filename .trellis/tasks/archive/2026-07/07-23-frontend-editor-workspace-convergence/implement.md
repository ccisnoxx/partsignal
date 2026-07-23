# 第三批：编辑与规则工作区视觉统一实施

## 实施顺序

1. [x] 产品入口：页面作用域、PageHeader/列表表面、创建弹窗反馈、错误聚焦和未保存关闭确认。
2. [x] 产品事实详情：标题/章节/动态表单/版本区域/保存栏统一，补未保存离开与切换确认。
3. [x] 内容编辑：降低外围装饰，统一队列/正文/审核表面，补修订表单首错聚焦和离开保护。
4. [x] 平台规则：统一四区和操作层级，补 RuleEditor dirty、错误、pending、取消确认及窄屏阶段验证。
5. [x] Prompt：统一列表/编辑/真实预览/安全边界，保留现有未保存和冲突逻辑，限制窄屏列表高度。
6. [x] 收敛 `global.css`：只修改目标页面命名空间、既有断点和 reduced-motion 规则。
7. [x] 补齐目标组件测试和新 Playwright，用真实登录和 API 验证主题、窄屏、键盘、错误聚焦和未保存。
8. [x] 运行 TypeScript、Lint、完整测试、构建和第一/第二批回归，审查 Diff 与文档一致性。
9. [x] 按批准范围修正 Ant Design 共享控件边界 Token，补针对性测试并重跑目标页、第一批和第二批回归。

## 预计业务文件

- `frontend/src/features/product-facts/ProductsPage.tsx`
- `frontend/src/features/product-facts/ProductsPage.test.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.test.tsx`
- `frontend/src/features/content-editor/ContentEditorPage.tsx`
- `frontend/src/features/content-editor/RevisionForm.tsx`
- `frontend/src/features/content-editor/ContentEditorPage.test.tsx`
- `frontend/src/features/configuration/PlatformRulesPage.tsx`
- `frontend/src/features/configuration/PlatformRuleDetail.tsx`
- `frontend/src/features/configuration/PlatformRuleMetaPanel.tsx`
- `frontend/src/features/configuration/PlatformPromptsPage.tsx`
- `frontend/src/features/configuration/PromptMarkdownEditor.tsx`
- `frontend/src/features/configuration/PromptOutputPreview.tsx`
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
- `frontend/src/app/theme.ts`
- `frontend/src/app/ThemeProvider.test.tsx`
- `frontend/src/styles/global.css`
- `frontend/tests/e2e/editor-workspace-convergence.spec.ts`

## 针对性验证

在 `frontend/` 运行：

```bash
npm test -- \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx

npm run typecheck
npm run lint
npm test
npm run build
```

目标 Playwright：

```bash
npm run e2e -- tests/e2e/editor-workspace-convergence.spec.ts
```

第一、第二批回归：

```bash
npm run e2e -- \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts
```

## Playwright 检查矩阵

- 真实管理员登录和真实 API；运行时查询有效产品、内容版本、平台规则和 Prompt ID，不硬编码本次观察 UUID。
- 1440×1000 的浅色、深色和跟随系统；五个目标路由无运行时错误且只有一个 H1。
- 1024、768、375、320px 无页面级横向溢出；验证规则移动阶段和 Prompt 有界列表。
- 键盘操作 Tabs、平台/版本项、按钮、弹窗和错误定位；焦点环与关闭后的焦点返回清晰。
- 客户端错误聚焦首个字段；服务端错误/409 显示 Alert 并保留草稿。
- 未保存状态、取消离开保留内容、确认离开清理内容和 `beforeunload`。
- `colorScheme: dark`、`reducedMotion: reduce` 下主题和动效符合要求。

## Diff 与文档门禁

- `package.json`、锁文件、contracts、backend、共享组件、第一批和第二批页面源文件不得变化。
- `theme.ts` 只允许把 Ant Design `colorBorder` 映射到既有 `borderStrong`，并提高深色 `borderStrong` 使其相对 `bgSurface` 达到 3:1；不得改变其他主题角色。
- `global.css` 只触及目标页面作用域，不全量重排或格式化。
- 新增或实质修改的复杂逻辑补必要中文注释、错误和反馈文本；不添加机械注释。
- 不新增依赖，不创建统一三栏组件、表单工厂、新 PageShell 或第二套设计系统。
- 验证完成后报告准确 Diff、结果、剩余风险和提交计划；不提交、不归档、不推送。

## 实施验证记录

2026-07-23 完成实现与验证：

- 四个目标测试文件分批运行共 48/48 通过；全量单测 21 个文件、118/118 通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 均通过；构建只报告既有主包体积提示。
- 新增 Playwright 4/4 通过，覆盖真实登录/API、明暗与跟随系统主题、1024/768/375/320px、键盘、客户端与服务端错误聚焦、未保存确认和 reduced-motion。
- 第一、第二批 Playwright 回归运行 7 项，6 项通过。唯一失败位于本批禁止修改的第一批 `/audit`：真实数据渲染出的紧凑中性状态标签文本为空，不满足既有用例的“状态标签非空”断言；复跑结果一致。
- `git diff --check` 通过；未修改依赖、契约、后端、共享组件、第一/第二批页面或 `theme.ts`。

2026-07-24 完成补充审计：

- 使用隔离 Chrome 配置写入浏览器原生 200% 默认缩放，实测外窗 1440px、CSS 视口 720px、`Page.getLayoutMetrics().cssVisualViewport.zoom === 2`；五个目标路由均只有一个 H1、保留可见主操作且无页面级横向溢出。
- 产品新增弹窗通过纯键盘打开和 Escape 关闭后，焦点返回“新增产品”触发器，且 `:focus-visible` 保持可见。
- 浅色和深色的主要文字对比度分别为 16.83:1、15.63:1，次要文字为 7.91:1、11.18:1；聚焦输入边界分别为 5.57:1、4.66:1。
- 现有未聚焦输入边界对比度仅为浅色 1.52:1、深色 1.86:1；`--ps-border-strong` 在深色表面为 2.84:1，仍低于规范的 3:1。修复必须调整共享主题 Token，而 `design.md` 明确要求此时停止实施并返回规划，因此任务保持 `in_progress`，不以目标页硬编码颜色或独立深色覆盖绕过。
- 复核产品新增、产品事实、内容修订和平台规则的真实计算样式后，四类 Ant Design 表单均由 `theme.ts` 的全局 `colorBorder = borderDefault` 产生同一问题；未发现可在单个目标页面修正的局部选择器根因。Prompt Markdown textarea 按既有专用编辑器设计保持无边框，由编辑器卡片承担边界。

2026-07-24 范围恢复：

- 用户批准继续处理上述共享根因；`theme.ts` 仅纳入控件边界映射和深色 `borderStrong` 对比度修正。
- 主题修正必须有针对性测试和真实计算样式证据，并重跑第一、第二批 Playwright；不得借此修改对应页面或其他主题角色。

2026-07-24 最终验证：

- `theme.ts` 将 Ant Design `colorBorder` 从 `borderDefault` 映射到既有 `borderStrong`，并仅把深色 `borderStrong` 从 `#636366` 调为 `#67676A`；前一等距整数步 `#666669` 只有 2.9731:1，新值相对 `bgSurface` 为 3.0180:1，浅色保持 3.2605:1。
- `ThemeProvider.test.tsx` 锁定浅、深主题的 Token 映射和 3:1 基线；五个目标测试文件 57/57 通过，全量单测 21 个文件、121/121 通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 通过；构建仍只有既有主包大于 500 kB 提示。
- 第三批 Playwright 4/4 通过，并直接读取代表性 Ant Design Input 的真实计算边界与背景验证浅、深模式均至少 3:1；第一、第二批 Playwright 回归 7/7 通过。
- 现有 `visual-system.md` 已明确输入边界至少 3:1、控件由主题映射持有，不重复增加规范条目。
