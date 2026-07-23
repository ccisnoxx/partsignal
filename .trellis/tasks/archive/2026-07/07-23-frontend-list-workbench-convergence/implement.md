# 实施计划

## 1. 基线与所有权

- [x] 读取目标页面、共享组件、测试及 `global.css` 的当前版本和 diff，保留其他任务的既有修改。
- [x] 运行目标组件测试、TypeScript 和 Lint，确认实施前基线。
- [x] 不修改 `theme.ts`、共享组件公开接口、后端、契约或依赖。

## 2. 页面实现

- [x] 用户管理改用 `MetricTile`，统一紧凑状态列和响应式指标网格。
- [x] 平台管理改用 `MetricTile`，补足筛选标签，删除重复整行入口并固定操作列。
- [x] AI 渠道改用 `PageHeader`、统一筛选/状态/操作列，保留状态轨道、三栏布局和原路由。
- [x] AI 详情统一状态、Header/模型操作列、真实用量指标和操作日志结果列。
- [x] 审计日志不改业务 JSX，仅验证它与统一样式保持一致。
- [x] 对 `global.css` 做命名空间内的小范围收敛，删除仅因本任务替换而失效的私有规则。

## 3. 测试

- [x] 更新 `UserManagementPage.test.tsx`：真实指标、元信息、状态及原交互不变。
- [x] 更新 `ConfigurationPages.test.tsx`：平台指标/筛选/单一入口和 AI 主从表状态/操作/用量。
- [x] 保持 `AuditLogPage.test.tsx` 通过。
- [x] 更新 `ai-channel-management.spec.ts` 中受布局收敛影响的断言。
- [x] 新增 `list-workbench-convergence.spec.ts`，覆盖四页结构、局部横向滚动和响应式不变量。

## 4. 自动验证

```bash
cd frontend

npm test -- \
  src/features/users/UserManagementPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx

npm run typecheck
npm run lint
npm run build

PLAYWRIGHT_HTML_OPEN=never npm run e2e -- \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts
```

## 5. 浏览器验收

- [x] 使用真实 API 和管理员登录检查用户、平台、AI 渠道/详情、审计日志。
- [x] 检查 375、768、1024、1440px，额外确认 320px 和真实 200% 浏览器缩放。
- [x] 分别检查浅色、深色和跟随系统的文字、边界、状态、焦点和浮层。
- [x] 仅键盘检查 PageHeader 操作、筛选、TableRegion、行操作、菜单、分页、Dialog/Drawer 焦点顺序与恢复。
- [x] 以 `prefers-reduced-motion: reduce` 检查非必要动效和过渡被停止，状态仍可理解。
- [x] 检查控制台错误和失败请求，不以启动服务代替真实页面调用。

## 6. 收尾

- [x] 检查 diff 是否出现无关修改、第二来源、重复状态映射、隐藏 fallback、整行第二入口或排除页面变化。
- [x] 对照 `prd.md` 逐项证明验收标准。
- [x] 给出准确改动文件、验证结果、剩余风险和提交计划；不提交、不归档、不推送。
