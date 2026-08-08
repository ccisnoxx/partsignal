# Frontend V2 Foundation Bootstrap 实施计划

## Ordered Steps

1. 核对任务处于 `planning`，记录分支 `codex/frontend-v2-foundation-bootstrap`，读取本任务三份文档和相关前端规范。
2. 核对 npm 当前稳定版本、engine 与 peerDependencies；保持 TypeScript 5.9 兼容线，只安装设计中已有消费者的依赖。
3. 创建 package、Vite、TypeScript、ESLint、HTML 与最小 Tailwind 配置。
4. 创建 QueryClient、Router、Providers、根/索引 route、入口和最小非业务 Shell。
5. 创建 typed API client、`api:generate` 和标准库实现的 `api:check`。
6. 创建最小 Testing Library setup 和一个 Providers/Router/QueryClient smoke test。
7. 运行一次 `npm --prefix frontend-v2 install` 生成独立 lockfile。
8. 首次运行 `npm --prefix frontend-v2 run api:generate` 创建 committed schema。首次生成前 `api:check` 失败是预期，不得跳过或改成固定成功。
9. 运行一次 Vite build 生成 committed `routeTree.gen.ts`，随后从 `npm ci` 开始运行 Required Validation。
10. 按 Trellis check 自审全部 diff、依赖消费和范围；只修复可归因于本任务的问题。

## Package Scripts

```json
{
  "dev": "vite --config vite.config.ts --host 0.0.0.0",
  "build": "tsc -b && vite build --config vite.config.ts",
  "lint": "eslint . --max-warnings 0",
  "typecheck": "tsc -b --pretty false",
  "test": "vitest run",
  "test:watch": "vitest",
  "api:generate": "openapi-typescript ../contracts/openapi.yaml -o src/shared/api/generated/schema.d.ts",
  "api:check": "node scripts/check-openapi.mjs"
}
```

## Required Validation

按顺序运行：

```bash
npm --prefix frontend-v2 ci
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
git diff --check
git diff --exit-code main -- frontend Makefile .github/workflows/ci.yml contracts/openapi.yaml
```

若 Required Validation 失败，只在代码、配置或环境发生会影响结果的变化后重跑；不扩大范围修复无关失败。

## Optional Validation

- 如自动测试无法充分证明 dev server，可临时启动 `npm --prefix frontend-v2 run dev -- --host 127.0.0.1` 做一次只读 smoke；不创建 Playwright 测试。
- 因 V1 零修改，默认不重跑 V1 全套；如审查需要额外证明，可运行 `npm --prefix frontend run typecheck` 与 `npm --prefix frontend run build`。

## Review Gates

- 直接依赖逐项映射到当前源码、配置或测试消费者；移除只为未来准备的依赖。
- 搜索并确认没有 Ant Design、React Router、V1 theme/AppLayout、页面级 CSS、手写 API DTO、空目录、barrel 或薄 wrapper。
- 检查 generated 文件均有唯一生成命令并被 ESLint 排除，普通源码无 lint 豁免。
- 检查 `frontend/`、合同、Makefile、CI 和部署文件无 diff。
- 检查新增注释、错误和开发者可见文本符合中文规则；生成文本除外。
- 报告结果后等待 commit plan 确认，不 push、合并、归档或继续下一任务。

## Rollback Point

本任务没有跨目录迁移。回滚只删除本任务新建的 `frontend-v2` 工程文件和对应 Trellis task 文件，明确保留既有 `frontend-v2/AGENTS.md` 与完整 `frontend/`；不得使用覆盖用户改动的 broad reset。
