# 优化 Prompt 管理与 AI 草稿创建：实施计划

## 1. 实施步骤

- [x] 在 `frontend/src/app/AppLayout.tsx` 将配置中心子导航改为“Prompt 管理”，并在 `AppLayout.test.tsx` 断言导航和当前上下文名称。
- [x] 在 `frontend/src/features/configuration/PlatformPromptsPage.tsx` 用紧凑绑定摘要替换大号绑定 `Alert`，保留真实平台名称、数量和未绑定删除语义。
- [x] 在 `frontend/src/styles/workspace.css` 增加最小 Prompt 绑定摘要样式，复用现有语义 Token，并覆盖窄屏换行。
- [x] 更新 `frontend/src/features/configuration/ConfigurationPages.test.tsx`，断言绑定平台标签和无警告图标的紧凑语义。
- [x] 在 `frontend/src/features/content-tasks/ContentTasksPage.tsx` 派生明确的 AI 生成阻断原因，终态与非公开事实不再只显示静默禁用按钮。
- [x] 复用 `TaskCreateModal` 增加可选创建完成回调；详情页从阻断提示打开该弹窗，创建后导航到新任务。
- [x] 使用一次性 React Router navigation state，在新任务和事实查询确认 `OPEN + PUBLIC` 后打开现有 AI 生成弹窗并清除状态。
- [x] 更新 `ContentTasksPage.test.tsx`，覆盖终态阻断、新任务引导、一次性自动打开弹窗、非 `PUBLIC` 不自动打开以及原有 Prompt/模型提交流程。
- [x] 更新 `frontend/tests/e2e/mvp-flow.spec.ts` 的生成交互顺序，使其先打开弹窗，再选择模型和提交；保留服务端载荷与最终草稿断言。

## 2. 必需验证

在 `frontend/` 执行：

```bash
npx vitest run src/app/AppLayout.test.tsx src/features/configuration/ConfigurationPages.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx
npm run typecheck
npm run lint
```

在本地真实 API/E2E 栈可用时执行：

```bash
npx playwright test tests/e2e/mvp-flow.spec.ts
```

浏览器验收：

- 1440px 浅色下检查 Prompt 标签密度和任务生成弹窗。
- 375px 检查绑定标签换行、弹窗和新任务入口无横向溢出。
- 检查深色模式文字、边界和语义色。
- 走通“终态任务 → 新建任务 → 新任务详情 → 确认 Prompt → 选择模型”的真实交互。

## 3. 可选验证

以下检查覆盖面较大，不作为本任务完成的默认门禁；只有结果与本次改动存在因果关系时才进入修复范围：

```bash
npm test
npm run build
npm run e2e
```

## 4. 风险与回滚点

- 一次性导航状态若未及时清除，浏览器前进/后退可能重复打开弹窗；单元测试必须覆盖只消费一次。
- 创建新任务后，平台仍可能缺少 Prompt 或全局没有可用模型；弹窗必须展示现有服务端错误或空模型状态，不能伪造可用配置。
- 不修改视觉基线；只有用户验收并明确批准新的 Prompt 页面视觉后，才可在独立步骤更新自动截图基线。
- 任何验证失败若来自既有 E2E 环境、线上未登录状态或无可用测试任务，只报告环境阻断，不修改业务代码规避。

## 5. 验证结果

- 定向单元测试：3 个测试文件、55 个用例通过。
- `npm run typecheck` 通过。
- `npm run lint` 通过，包含主题颜色守卫。
- Playwright 浏览器验收通过：1440px 浅色、375px 浅色、1440px 深色均无横向溢出；已走通“终态任务 → 新建任务 → 自动打开 AI 弹窗 → 选择模型 → 创建作业”，一次性路由状态已清除。
- 真实 API E2E 未执行：本地既有 Docker Vite 代理返回 `ECONNREFUSED`；浏览器验收改用 Playwright 路由数据，未修改业务代码规避环境问题。
