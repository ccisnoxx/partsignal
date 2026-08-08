# 实施计划

## 精确修改文件范围

计划新增：

- `frontend-v2/src/app/auth/auth-provider.tsx`
- `frontend-v2/src/app/auth/auth-provider.test.tsx`
- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/app/layout/app-shell.tsx`
- `frontend-v2/src/app/layout/app-shell.test.tsx`
- `frontend-v2/src/app/layout/app-shell.stories.tsx`
- `frontend-v2/src/routes/_app/route.tsx`
- `frontend-v2/src/routes/_app/index.tsx`
- `frontend-v2/src/routes/_app/products/route.tsx`
- `frontend-v2/src/routes/_app/products/index.tsx`
- `frontend-v2/src/routes/_app/products/$productId.tsx`
- `frontend-v2/src/routes/_app/_admin/route.tsx`
- `frontend-v2/src/routes/_app/_admin/system.users.tsx`

计划修改：

- `frontend-v2/package.json`
- `frontend-v2/package-lock.json`
- `frontend-v2/src/app/providers.tsx`
- `frontend-v2/src/app/providers.test.tsx`
- `frontend-v2/src/app/router.ts`
- `frontend-v2/src/routes/__root.tsx`
- `frontend-v2/src/routeTree.gen.ts`（由 TanStack Router 插件生成）
- `.trellis/tasks/08-08-frontend-v2-app-shell-router-metadata/{prd.md,design.md,implement.md,task.json}`

只有在现有 token 无法表达已批准的响应式边界时才修改 `frontend-v2/src/styles/global.css`；默认不修改。不得修改上述范围外的业务、契约、旧前端或部署文件。

## 实施顺序

1. 从干净 `main` 创建并切换到 `codex/frontend-v2-app-shell-router-metadata`，激活本 Trellis Task。
2. 读取本 Task 三份文档与相关 frontend/spec 规范，复核现有 Router、Providers、primitives 和 OpenAPI 生成类型。
3. 添加最小 `zod` 依赖，建立路由级 search validation。
4. 实现真实 `AuthProvider`，将 live auth context 注入 Router context。
5. 定义 `NavId`、route metadata 扩展、导航 registry 与纯派生函数，并先完成针对性测试。
6. 重组最小 file-based route tree，建立 `_app` Outlet、产品嵌套路由与 `_admin` 真实权限边界。
7. 使用现有 primitives/tokens 实现响应式 App Shell、导航、Account Menu、Breadcrumb 和焦点行为。
8. 补齐组件测试、Provider/Router/search 组合测试和 Storybook 场景。
9. 运行必需验证；修复仅由本任务引入且属于范围内的失败。
10. 使用命名 `playwright-cli` session 完成视觉与浏览器历史验证，关闭并确认 session 清理。
11. 执行 `trellis-check`、spec 更新必要性评估、最终 diff 与验收审计；报告结果并给出 commit plan，等待确认。

## 验收标准

- App Shell、metadata、继承、breadcrumb、真实认证/管理员边界、search validation 和响应式/无障碍行为满足 `prd.md` 全部验收项。
- 新增逻辑有最小但有效的自动化回归检查。
- 运行时不出现假用户、假权限、固定成功适配器或静默 fallback。
- 旧 `frontend/`、后端、contracts、部署和无关文件无 diff。

## 必需验证命令

```bash
npm --prefix frontend-v2 ci
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run test -- src/app/auth/auth-provider.test.tsx src/app/navigation.test.ts src/app/layout/app-shell.test.tsx src/app/providers.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run build-storybook
git diff --check
git diff --exit-code main -- frontend backend contracts Makefile .github deploy
```

说明：最后一条命令只允许 `frontend-v2/` 有预期 diff；`frontend/`、后端、契约、CI 和部署必须无变更。

## 可选完整验证

```bash
make contract-check
make verify
```

仅当变更证据表明共享契约/仓库级行为受影响，或必需验证无法覆盖风险时运行；否则记录跳过原因。本任务按设计不修改 OpenAPI/database contract。

## Storybook 场景

- Desktop Admin（1440）：固定 Sidebar、完整 Account Menu、管理员入口、产品详情 breadcrumb。
- Desktop Anonymous（1024）：无 Account Menu 与管理员入口。
- Mobile Admin（375）：Sheet 导航打开/关闭、激活态、焦点返回。
- Tablet Anonymous（768）：移动 Shell 边界。
- Auth Loading：Skeleton/加载语义，不显示假身份。
- Auth Error：显式错误和重试动作。
- Forbidden Content：Shell 内可聚焦 403 内容边界。

Storybook 用户仅是测试 fixture，类型来自生成的 OpenAPI `User`，不得作为运行时 fallback。

## 浏览器视觉验证方案

使用唯一 session：`frontend-v2-app-shell-router`。

1. 启动 Vite/Storybook，执行 `playwright-cli -s=frontend-v2-app-shell-router open ...`。
2. 分别设置 375、768、1024、1440 viewport，核对移动/桌面导航切换、溢出、内容宽度、可见焦点和 Account Menu 场景。
3. 在真实 Vite 路由验证 `/`、`/products?q=...&page=...`、`/products/:id`、`/system/users` 的直接 URL 与刷新。
4. 从工作台进入产品列表和详情，再执行 Back、Forward，核对 URL、激活态、breadcrumb 与 pathname 焦点行为。
5. 用键盘验证 skip link、移动 Sheet、Account Menu、Escape、Tab 顺序与触发器焦点恢复。
6. 结束前执行 `playwright-cli -s=frontend-v2-app-shell-router close`，再用 `playwright-cli list --all --json` 确认该 session 不存在；不得使用 `close-all` 或 `kill-all`。

## 失败归因和停止条件

- 每次失败先确认是否由本任务 diff 引入、是否属于本任务范围，再修改代码或测试。
- 同一失败只有在代码、配置或环境发生足以影响结果的变化后才重跑。
- 若失败来自既有代码、环境、外部服务或疑似 flaky，记录证据，不扩大范围修复。
- 若 OpenAPI/真实实现无法确认认证、CSRF、退出或管理员边界，立即停止该部分，记录阻塞，不添加兼容字段、假数据或静默默认值。
- 若修复开始产生无关失败，或同一根因在无新证据下重复，停止并报告。
- `playwright-cli` session 无法关闭时，先报告状态；未经用户确认不得执行全局 kill。

## 明确非目标

- 业务页面、业务数据请求、Table Kit、Workspace、Form Kit、Editor Kit。
- 登录表单、账户安全表单、完整全局受保护路由流程。
- 万能 route config、权限框架、万能 search schema、动态 breadcrumb 框架。
- 全部未来业务路由、服务端 capability 模型、额外状态管理库。
- 修改或删除旧 `frontend/`，修改后端、contracts、部署或 CI。
- 新建稳定 Playwright Test E2E 基线（Phase 1.6）。
- commit、merge、push、归档或开始下一任务。
