# Frontend V2 Foundation Bootstrap

## Goal

在不修改现有 `frontend/`、根合同或质量入口的前提下，建立可独立安装、开发、测试和生产构建的 `frontend-v2/` 最小工程基础，为后续 Phase 1 子任务提供唯一、可运行的应用入口。

## Background

- 任务基线为最新、干净的 `main`；实施分支为 `codex/frontend-v2-foundation-bootstrap`。
- `frontend-v2/` 当前仅有目录级 `AGENTS.md`，没有应用工程文件。
- `contracts/openapi.yaml` 是 API 类型唯一权威；V1 的 React Router、Ant Design theme、旧 AppLayout、页面级 CSS 和业务状态结构不得复制。
- 根 Makefile 和 CI 当前只接入 V1；V2 根质量入口属于后续 Phase 1.6，本任务只审计、不修改。

## In Scope

- React 19、TypeScript、Vite 和 Tailwind CSS 4 最小接入。
- TanStack Router 最小文件路由、TanStack Query provider。
- OpenAPI generated types、`openapi-fetch` client、`api:generate` 与 `api:check`。
- 最小 app providers/bootstrap 和非业务根 Shell，只证明应用、Router、QueryClient 与 Tailwind 构建链可运行。
- Vitest、Testing Library、jsdom、ESLint、typecheck 和 production build。
- 独立 `package.json` 与 `package-lock.json`，按实施时兼容稳定版本固化依赖。

## Requirements

- `frontend-v2` 必须可以通过自身 lockfile 完成 `npm ci`，并独立运行 dev、test 和 build。
- 文件依赖方向从起点保持 `routes -> domains -> design-system/shared`；本任务没有真实消费者，不创建 `domains/` 或 `design-system/` 空目录。
- Router 使用文件路由；生成的 `src/routeTree.gen.ts` 提交到仓库且禁止手工编辑。
- QueryClient 只有一个应用所有者，由 app provider 与 Router context 共享；不提前加入业务 query key、stale time 或全局 Store。
- OpenAPI 类型只从 `../contracts/openapi.yaml` 生成到 `src/shared/api/generated/schema.d.ts`，不得手写重复 DTO。
- API client 只建立 typed transport 和 cookie credential 边界；无消费者的 CSRF、401、错误包装和 auth UI 延后。
- Tailwind 只接入 Vite plugin 与 `@import "tailwindcss"`；不建立 token、theme 或 primitives。
- 新增的中文开发者可见文本和必要注释遵循项目规则；生成文件保留工具生成文本。
- `frontend/`、`contracts/openapi.yaml`、Makefile、CI、Docker、Compose、nginx 和部署文件必须无修改。

## Out of Scope

- Tokens、shadcn/Base UI primitives、Storybook、Table/Form/Workspace/Editor Kit。
- 完整 Sidebar、Breadcrumb、route metadata、search validation、auth UI 和业务页面/domain。
- Playwright、CodeMirror、ECharts、TanStack Virtual、Redux、Zustand、Next.js。
- Dockerfile、nginx、Compose、Makefile、CI、部署接入、V1 删除或迁移。
- 空目录、barrel、未来 wrapper、通用 helper 或尚无消费者的依赖。

## Acceptance Criteria

- [ ] `npm --prefix frontend-v2 ci` 从 lockfile 成功安装。
- [ ] 根路由渲染最小非业务 Shell；测试证明 Router 和 QueryClient provider 共同运行。
- [ ] production build 生成 JS/CSS 资产，Shell 中的 Tailwind utility 经构建处理。
- [ ] `api:generate` 能从根 OpenAPI 生成 schema；`api:check` 对一致产物成功、对缺失或漂移产物明确失败。
- [ ] lint、严格 typecheck、Vitest/Testing Library 测试和 production build 全部通过。
- [ ] 直接依赖均有当前代码或配置消费者；没有未消费依赖、手写 API DTO、V1 UI 复制、空目录或未来抽象。
- [ ] `frontend/`、根合同、Makefile、CI 和部署文件保持无 diff。
- [ ] 不 push、不合并、不归档、不继续下一 Task；提交前单独展示 commit plan 并等待确认。

## Source Documents

- `AGENTS.md`
- `frontend-v2/AGENTS.md`
- `docs/frontend-v2/01-technical-architecture.md`
- `docs/frontend-v2/06-code-architecture-and-project-structure.md`
- `docs/frontend-v2/07-migration-plan.md` 第 3、4、6.1、16 节
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
