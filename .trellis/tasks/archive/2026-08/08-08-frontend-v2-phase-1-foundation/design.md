# Frontend V2 Foundation Bootstrap 技术设计

## Architecture

应用启动链保持最短且所有权明确：

```text
index.html
  -> src/main.tsx
  -> AppProviders
      -> QueryClientProvider
      -> RouterProvider
          -> __root.tsx
          -> index.tsx
```

- `src/app/query-client.ts` 创建唯一 `QueryClient`。
- `src/app/router.ts` 用生成的 route tree 创建 Router，并把同一 QueryClient 放入 Router context，为未来 loader/prefetch 保留单一入口。
- `src/app/providers.tsx` 只组合 Query 和 Router provider，不加入 auth、theme、notification 或 Store。
- `src/routes/__root.tsx` 是最小语义 Shell；`src/routes/index.tsx` 是唯一非业务证明页。

## File Boundaries

```text
frontend-v2/
├── package.json
├── package-lock.json
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── eslint.config.js
├── scripts/check-openapi.mjs
└── src/
    ├── main.tsx
    ├── vite-env.d.ts
    ├── routeTree.gen.ts
    ├── app/{providers.tsx,providers.test.tsx,query-client.ts,router.ts}
    ├── routes/{__root.tsx,index.tsx}
    ├── shared/api/{client.ts,generated/schema.d.ts}
    ├── test/setup.ts
    └── styles/global.css
```

根 `.gitignore` 已覆盖 `node_modules/`、`dist/` 和 `*.tsbuildinfo`，不新增重复 ignore 文件。生成的 route tree 和 OpenAPI schema 是源码构建输入，必须跟踪；ESLint 忽略它们，其他源码直接 lint。

## Build and Runtime

- Vite 插件顺序为 TanStack Router、React、Tailwind。Router plugin 使用文件路由默认目录并启用自动代码拆分。
- V2 dev server 使用 `5174`，避免与 V1 的 `5173` 冲突；`/api` 代理读取 `VITE_API_PROXY_TARGET`，默认 `http://localhost:8000`。
- `global.css` 只导入 Tailwind；页面只用少量 utility，禁止 token、theme 或组件 CSS。
- `build` 先执行 `tsc -b` 再执行显式 `vite --config vite.config.ts build`。提交 route tree 后，干净安装可在 Vite 生成前独立 typecheck。
- 支持 Node `^22.22.2 || >=24.15.0`，满足当前 Vite、ESLint、Vitest 和 jsdom 的 engine 交集，并兼容现有 CI 的 Node 22 主线。

## Router and Query

- 根 route 使用 `createRootRouteWithContext` 声明只含 `queryClient` 的 Router context。
- `router.ts` 直接导入 `routeTree.gen.ts`，声明 TanStack Router `Register` 类型；不建立 router factory 或 wrapper。
- QueryClient 不设置 speculative defaults；业务 query policy 由真实 domain 消费者建立。
- 组件测试渲染真实 `AppProviders`，将 history 置于 `/`，断言根 heading、Router location 和 QueryClient provider 组合可用。

## API Type Ownership

- 权威输入：`contracts/openapi.yaml`，本任务不修改。
- 派生产物：`frontend-v2/src/shared/api/generated/schema.d.ts`，只由 `openapi-typescript` 写入并提交。
- `api:generate` 负责显式生成；不使用 `postinstall`，避免安装过程静默改写源码。
- `api:check` 用 Node 标准库创建临时目录，重新生成后逐字节比较，并在 `finally` 清理临时目录。漂移时以中文错误提示运行 `npm run api:generate`。
- `client.ts` 从 generated `paths` 创建 `openapi-fetch` client，设置同源 base URL 和 `credentials: "include"`；不实现尚无消费者的 DTO、错误模型或认证流程。

## Dependencies

运行时依赖仅包括 React/ReactDOM、TanStack Router、TanStack Query、`openapi-fetch`。开发依赖仅包括 Vite/React/Router/Tailwind 构建链、TypeScript 与类型包、OpenAPI 生成器、Vitest/jsdom/Testing Library、ESLint flat config 所需包。

TypeScript 固定在最新兼容的 5.9 线：当前 TypeScript 7 不满足 `openapi-typescript` 7 与 `typescript-eslint` 8 的 peer contract。不会安装 Zod、Router CLI、Query ESLint plugin、user-event、React Router、Ant Design 或其他无当前消费者的包。

## Compatibility and Rollback

- `frontend/` 与 V2 无源码共享，不会改变 V1 构建或运行路径。
- 根合同、Makefile、CI 和部署入口不变；V2 根质量入口留给 Phase 1.6。
- 回滚只移除本任务新增文件，保留 `frontend-v2/AGENTS.md`。没有数据库、合同或部署迁移。
