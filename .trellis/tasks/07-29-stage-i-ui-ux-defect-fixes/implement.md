# 实施计划：阶段 I UI/UX 五项缺陷修复

## 实施顺序

- [x] 1. 开始实现前加载 `trellis-before-dev`，重新读取当前任务三份规划文件、前端规范索引与待修改代码完整内容。
- [x] 2. 记录目标文件实施前 diff，确认哪些片段属于工作区既有修改。
- [x] 3. DEF-UI-01：把 GEO 打印摘要改为 Ant `Descriptions` 响应式列数。
- [x] 4. DEF-UI-02：把 AI 渠道表格悬停/选中及固定操作列背景改为不透明语义色混合。
- [x] 5. DEF-UI-03：让 API Key 状态与“重新配置”使用 `Space wrap`。
- [x] 6. DEF-UI-04：站内链接确认后使用 React Router 跳转，保留刷新/关页的 `beforeunload`。
- [x] 7. DEF-UI-05：补齐平台类型页的精确页头上下文。
- [x] 8. 补充组件测试和三处针对性 Playwright E2E 断言，不改现有视觉基线。
- [x] 9. 运行必需验证；失败时只修复能够归因于本任务的错误。
- [x] 10. 使用 `playwright-cli` 在五个原始视口复测，检查页面身份、框架错误覆盖层、控制台、失败请求、目标交互与几何，并将截图保存到仓库外。
- [x] 11. 加载 `trellis-check` 做最终规范、测试和 diff 检查；不运行任务归档、提交或推送。

## 计划修改文件

### 产品代码

- `frontend/src/features/geo-observations/GeoInsightsPage.tsx`
- `frontend/src/styles/workspace.css`
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`
- `frontend/src/features/configuration/PlatformPromptsPage.tsx`
- `frontend/src/app/AppLayout.tsx`

### 测试

- `frontend/src/app/AppLayout.test.tsx`
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`
- `frontend/tests/e2e/ai-channel-management.spec.ts`
- `frontend/tests/e2e/editor-workspace-convergence.spec.ts`

其中 `AIChannelDetailPage.tsx`、`PlatformPromptsPage.tsx`、`ConfigurationPages.test.tsx` 和 `ai-channel-management.spec.ts` 已有其他任务修改；本任务只追加对应缺陷片段。

## 必需验证

在 `frontend/` 中运行：

```bash
npx vitest run src/app/AppLayout.test.tsx src/features/configuration/ConfigurationPages.test.tsx
npm run typecheck
npx eslint src/app/AppLayout.tsx src/app/AppLayout.test.tsx src/features/geo-observations/GeoInsightsPage.tsx src/features/configuration/AIChannelDetailPage.tsx src/features/configuration/PlatformPromptsPage.tsx src/features/configuration/ConfigurationPages.test.tsx tests/e2e/dashboard-geo-convergence.spec.ts tests/e2e/ai-channel-management.spec.ts tests/e2e/editor-workspace-convergence.spec.ts
node scripts/check-theme-colors.mjs
npx playwright test tests/e2e/dashboard-geo-convergence.spec.ts tests/e2e/ai-channel-management.spec.ts tests/e2e/editor-workspace-convergence.spec.ts --project=e2e
```

Playwright E2E 若单文件包含与本任务无关的高成本场景，先使用精确 `--grep` 运行新增回归；只有新增断言依赖同文件前序状态时才运行整文件。

## Playwright CLI 原始视口复测

复用项目已有本地真实 API 测试栈和唯一命名会话，不访问或修改线上业务数据：

1. DEF-UI-01：`390×844`，打开带完整日期范围的 GEO 打印 URL，量测日期内容边界并截图。
2. DEF-UI-02/03：`320×800`，打开已配置 API Key 的 AI 渠道详情，检查固定操作列 alpha、底层文字遮挡和“重新配置”边界并截图。
3. DEF-UI-04：`1440×900`，产生未保存 Prompt，点击“产品事实”，确认一次后断言进入目标路由且没有原生对话框并截图确认前后状态。
4. DEF-UI-05：`390×844`，打开平台类型页，核对页头与 H1 并截图。
5. 每个页面运行 `playwright-cli console` 和 `playwright-cli requests`，记录真实错误/警告与失败状态。

截图输出目录使用当前 Codex 可视化工作区下的新建 `uiux-stage-i-fixes-*` 目录，保持仓库外。

## 可选重验证

以下检查不是本任务完成的默认前提；仅在针对性结果表明存在共享回归或用户要求时运行：

```bash
npm test
npm run build
npm run e2e
```

## 完成前审查

- [x] 五个缺陷分别有代码位置、自动测试结果、CLI 原始视口结果和修复后截图。
- [x] 没有页面级横向滚动、隐藏操作、透明固定列或重复离开确认。
- [x] 没有 API、数据合同、权限、业务状态或基线变化。
- [x] 没有新增依赖、Token、全局状态、抽象或兼容 fallback。
- [x] diff 不包含对既有工作区修改的回退，也不包含报告外重构。
- [x] 注释、docstring 和开发者可见文本无需新增；如代码分支含非显然规则，使用简短中文说明。
- [x] 最终只给出提交计划，等待用户确认；不提交、不推送。

## 验证记录

- Vitest：`AppLayout.test.tsx` 与 `ConfigurationPages.test.tsx` 共 52 项通过。
- 静态门禁：TypeScript、目标 ESLint、主题颜色守卫通过。
- Playwright E2E：三项缺陷回归与共享数据准备共 4 项通过；补充自定义确认框关闭断言后单项复跑共 2 项通过。
- Playwright CLI：原始视口全部通过；控制台均为 0 error / 0 warning，业务请求均为成功响应。
- 修复截图：`/Users/sc/.codex/visualizations/2026/07/29/019fad13-5796-7a63-a8de-a8233c859a28/uiux-stage-i-fixes-20260729-171300/`。
